/**
 * The roster engine. Pure function: buildRoster(inputs) -> Roster.
 * Kotlin port of creche_roster.engine, kept line-for-line close to the
 * Python source so behaviour (including tie-breaking) stays identical.
 *
 * HARD RULES (always enforced or reported as a BREACH, never silently traded off)
 *   1. Opening cover: each floor has at least minOpen staff on the early start.
 *   2. Closing cover: each floor has at least minClose staff on the late start.
 *   3. Pairing: the two "paired" staff are always complementary.
 *      One on early => the other on late, and vice versa. If one of them is on
 *      leave, the pairing is suspended for those days and the other one's start
 *      time is set manually via an Override. (An override on a paired person is
 *      ignored on days when the partner works.)
 *
 * SOFT RULES (cost weighted)
 *   - Fair rotation: people get the start times they have had least so far.
 *   - Recency: avoid repeating last week's start time.
 *   - Floor mix: spread starts evenly across the four slots on each floor.
 */
package com.creche.roster.engine

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

private const val BIG = 1000.0 // penalty per missing person on a hard rule (dwarfs everything else)
private const val W_FAIR = 10.0
private const val W_RECENT = 3.0
private const val W_MIX = 1.0

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------
fun validate(inputs: Inputs): List<String> {
    val p = mutableListOf<String>()
    val s = inputs.settings

    if (s.rosterStart.dayOfWeek != DayOfWeek.MONDAY) {
        val dow = s.rosterStart.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.ENGLISH)
        val dateStr = "%02d/%02d/%04d".format(s.rosterStart.dayOfMonth, s.rosterStart.monthValue, s.rosterStart.year)
        p.add("Settings: roster_start $dateStr is a $dow. It must be a Monday.")
    }
    if (s.weeks !in 1..12) p.add("Settings: weeks must be between 1 and 12.")
    if (s.floors.isEmpty()) p.add("Settings: floors is empty.")
    if (s.title.isEmpty()) p.add("Settings: title is empty.")

    val shiftsOk = SLOTS.all { s.shifts.containsKey(it) }
    if (!shiftsOk) {
        p.add("Settings: every slot (early, mid1, mid2, late) needs a start and end time.")
    } else {
        for (sl in SLOTS) {
            val sh = s.shifts.getValue(sl)
            if (!sh.start.isBefore(sh.end)) p.add("Settings: $sl start must be before its end.")
        }
        val starts = SLOTS.map { s.shifts.getValue(it).start }
        if (starts.zipWithNext().any { (a, b) -> !a.isBefore(b) }) {
            p.add("Settings: start times must increase: early < mid1 < mid2 < late.")
        }
    }

    for (f in s.floors) {
        for ((label, table) in listOf("min_open" to s.minOpen, "min_close" to s.minClose)) {
            val v = table[f]
            if (v == null || v < 0) {
                p.add("Settings: ${label}_${f.lowercase(Locale.ENGLISH).replace(" ", "_")} must be a number, 0 or more.")
            }
        }
    }

    val names = mutableSetOf<String>()
    val paired = mutableListOf<String>()
    for (st in inputs.staff) {
        if (st.role !in ROLES) {
            p.add("Staff: '${st.name}' has role '${st.role}'. Use one of: ${ROLES.joinToString(", ")}.")
            continue
        }
        if (st.floor !in s.floors) {
            val who = st.name.ifEmpty { st.role }
            p.add("Staff: '$who' is on floor '${st.floor}', which is not in Settings floors (${s.floors.joinToString(", ")}).")
        }
        if (st.role == "vacant" || st.role == "blank") continue
        if (st.name.isEmpty()) {
            p.add("Staff: a row has no name.")
            continue
        }
        if (st.name.lowercase(Locale.ENGLISH) in names) {
            p.add("Staff: '${st.name}' appears more than once.")
        }
        names.add(st.name.lowercase(Locale.ENGLISH))
        if (st.role == "paired") paired.add(st.name)
        if (st.role == "fixed" && st.fixedSlot !in SLOTS) {
            p.add("Staff: '${st.name}' is fixed but has no valid slot (use early, mid1, mid2, late or a start time).")
        }
    }
    if (paired.size != 0 && paired.size != 2) {
        p.add("Staff: exactly two people must have role 'paired' (or none). Found ${paired.size}.")
    }

    val exact = inputs.staff
        .filter { it.role != "vacant" && it.role != "blank" && it.name.isNotEmpty() }
        .associateBy { it.name }
    for (lv in inputs.leave) {
        if (lv.name !in exact) p.add("Leave: '${lv.name}' is not in the Staff tab.")
        if (lv.end != null && lv.end.isBefore(lv.start)) p.add("Leave: ${lv.name} ends before it starts.")
    }
    for (ov in inputs.overrides) {
        if (ov.name !in exact) {
            p.add("Overrides: '${ov.name}' is not in the Staff tab.")
        } else if (exact.getValue(ov.name).role == "static") {
            if (ov.text.isEmpty()) {
                p.add("Overrides: ${ov.name} has own hours, so type the hours (e.g. 10:00 - 2:00) or OFF.")
            }
        } else if (ov.slot !in SLOTS) {
            p.add("Overrides: ${ov.name} has an unknown start time.")
        }
        if (ov.end != null && ov.end.isBefore(ov.start)) p.add("Overrides: ${ov.name} ends before it starts.")
    }
    return p
}

// --------------------------------------------------------------------------
// Fairness cost and the per-floor exact solver
// --------------------------------------------------------------------------
private fun cost(
    hist: Map<String, MutableMap<String, Int>>,
    lastSlot: Map<String, String>,
    name: String,
    slot: String,
): Double {
    val h = hist.getValue(name)
    val total = h.values.sum()
    var c = W_FAIR * (h[slot] ?: 0) / (total + 1).toDouble()
    if (lastSlot[name] == slot) c += W_RECENT
    return c
}

private val COUNT_COMPARATOR = Comparator<List<Int>> { a, b ->
    for (i in a.indices) {
        val cmp = a[i].compareTo(b[i])
        if (cmp != 0) return@Comparator cmp
    }
    0
}

/**
 * Exact minimum-cost slot assignment for one floor's rotating staff.
 *
 * State = how many people are on each slot so far (a 4-element list). Cost is
 * additive per person, hard/mix penalties depend only on the final counts, so
 * keeping the cheapest path per count vector is exact.
 */
private fun solveFloor(
    members: List<String>,
    preCounts: Map<String, Int>,
    needOpen: Int,
    needClose: Int,
    costFn: (String, String) -> Double,
): Map<String, String> {
    val start: List<Int> = SLOTS.map { preCounts[it] ?: 0 }
    var states: Map<List<Int>, Pair<Double, List<String>>> = mapOf(start to (0.0 to emptyList()))

    for (name in members) {
        val next = mutableMapOf<List<Int>, Pair<Double, List<String>>>()
        for (cnt in states.keys.sortedWith(COUNT_COMPARATOR)) {
            val (c, path) = states.getValue(cnt)
            for (i in SLOTS.indices) {
                val sl = SLOTS[i]
                val c2 = c + costFn(name, sl)
                val cnt2 = cnt.toMutableList().also { it[i] = it[i] + 1 }
                val cur = next[cnt2]
                if (cur == null || c2 < cur.first - 1e-12) {
                    next[cnt2] = c2 to (path + sl)
                }
            }
        }
        states = next
    }

    var bestTotal: Double? = null
    var bestPath: List<String> = emptyList()
    for (cnt in states.keys.sortedWith(COUNT_COMPARATOR)) {
        val (c, path) = states.getValue(cnt)
        val n = cnt.sum()
        var pen = BIG * (maxOf(0, needOpen - cnt[0]) + maxOf(0, needClose - cnt[3]))
        pen += W_MIX * cnt.sumOf { x -> val d = x - n / 4.0; d * d }
        val total = c + pen
        if (bestTotal == null || total < bestTotal - 1e-12) {
            bestTotal = total
            bestPath = path
        }
    }
    return members.zip(bestPath).toMap()
}

/** Decide the pair's base slots for the week. Always complementary. */
private fun choosePair(
    a: String,
    b: String,
    presentA: Boolean,
    presentB: Boolean,
    hist: Map<String, MutableMap<String, Int>>,
    lastSlot: Map<String, String>,
): Map<String, String> {
    fun share(name: String, slot: String): Double {
        val h = hist.getValue(name)
        return (h[slot] ?: 0) / (h.values.sum() + 1).toDouble()
    }
    if (!presentA && !presentB) return emptyMap()
    if (presentA && presentB) {
        val ea = share(a, "early")
        val eb = share(b, "early")
        val aEarly: Boolean = if (Math.abs(ea - eb) > 1e-9) {
            ea < eb
        } else {
            val la = lastSlot[a]
            val lb = lastSlot[b]
            when {
                la == "late" && lb != "late" -> true
                lb == "late" && la != "late" -> false
                la == "early" && lb != "early" -> false
                lb == "early" && la != "early" -> true
                else -> true
            }
        }
        return if (aEarly) mapOf(a to "early", b to "late") else mapOf(a to "late", b to "early")
    }
    // Only one of them works this week: the pairing is suspended. Give the one
    // who works the slot they have had least; the manager can override it.
    val who = if (presentA) a else b
    val slot = if (share(who, "early") <= share(who, "late")) "early" else "late"
    return mapOf(who to slot)
}

private fun mostCommonSlot(slots: List<String>): String {
    val counts = slots.groupingBy { it }.eachCount()
    return counts.keys.maxWithOrNull(compareBy({ counts.getValue(it) }, { SLOTS.indexOf(it) }))!!
}

// --------------------------------------------------------------------------
// Main entry point
// --------------------------------------------------------------------------
fun buildRoster(inputs: Inputs): Roster {
    val problems = validate(inputs)
    if (problems.isNotEmpty()) throw InputError(problems)

    val s = inputs.settings
    val staffKeys: List<Pair<String, Staff>> = inputs.staff.mapIndexed { i, st ->
        val key = if (st.role != "vacant" && st.role != "blank") st.name else "${st.role}#$i"
        key to st
    }
    val working = staffKeys.filter { (_, st) -> st.role in listOf("rotating", "fixed", "paired", "static") }
    val byName = LinkedHashMap<String, Staff>()
    for ((_, st) in working) byName[st.name] = st
    val pair: List<String> = working.filter { it.second.role == "paired" }.map { it.second.name }

    val hist: MutableMap<String, MutableMap<String, Int>> = LinkedHashMap()
    for (n in byName.keys) hist[n] = (inputs.history[n] ?: emptyMap()).toMutableMap()
    val period: MutableMap<String, MutableMap<String, Int>> = LinkedHashMap()
    for (n in byName.keys) period[n] = mutableMapOf()
    val lastSlot: MutableMap<String, String> = inputs.lastSlot.filterKeys { it in byName }.toMutableMap()
    val checks: MutableList<Check> = mutableListOf()
    val weeks: MutableList<WeekRoster> = mutableListOf()

    fun leaveKind(name: String, d: LocalDate): String? {
        for (lv in inputs.leave) if (lv.name == name && lv.covers(d)) return lv.kind
        return null
    }
    fun overrideSlot(name: String, d: LocalDate): String? {
        var found: String? = null
        for (ov in inputs.overrides) if (ov.name == name && ov.covers(d) && ov.slot != null) found = ov.slot
        return found
    }
    fun overrideText(name: String, d: LocalDate): String? {
        var found: String? = null
        for (ov in inputs.overrides) if (ov.name == name && ov.covers(d) && ov.text.isNotEmpty()) found = ov.text
        return found
    }
    // (slot, ignored). An override on a paired person only applies on days
    // when their partner is away; otherwise the pairing rule wins.
    fun effectiveOverride(name: String, d: LocalDate): Pair<String?, Boolean> {
        val ov = overrideSlot(name, d)
        if (ov != null && byName.getValue(name).role == "paired") {
            val partner = if (name == pair[0]) pair[1] else pair[0]
            if (leaveKind(partner, d) == null) return null to true
        }
        return ov to false
    }
    fun costFn(name: String, slot: String): Double = cost(hist, lastSlot, name, slot)

    for (wi in 0 until s.weeks) {
        val monday = s.rosterStart.plusWeeks(wi.toLong())
        val days = (0 until NDAYS).map { monday.plusDays(it.toLong()) }
        val present: Map<String, List<LocalDate>> =
            byName.keys.associateWith { n -> days.filter { d -> leaveKind(n, d) == null } }

        // ---- weekly base -------------------------------------------------
        // Manual overrides that apply this week decide the base slot, so the
        // solver plans around them instead of having to repair afterwards.
        val manual: MutableMap<String, String> = mutableMapOf()
        for ((n, st) in byName) {
            if (st.role == "static" || present.getValue(n).isEmpty()) continue
            val ovs = present.getValue(n).mapNotNull { d -> effectiveOverride(n, d).first }
            if (ovs.isNotEmpty()) {
                val counts = ovs.groupingBy { it }.eachCount()
                manual[n] = counts.keys.maxWithOrNull(
                    compareBy({ counts.getValue(it) }, { -SLOTS.indexOf(it) }),
                )!!
            }
        }

        val base: MutableMap<String, String> = mutableMapOf()
        for ((n, st) in byName) {
            if (st.role == "fixed" && present.getValue(n).isNotEmpty()) {
                base[n] = manual[n] ?: (st.fixedSlot ?: "early")
            }
        }
        if (pair.isNotEmpty()) {
            val a = pair[0]
            val b = pair[1]
            base.putAll(
                choosePair(a, b, present.getValue(a).isNotEmpty(), present.getValue(b).isNotEmpty(), hist, lastSlot),
            )
            for ((n, partner) in listOf(a to b, b to a)) {
                if (manual.containsKey(n) && present.getValue(partner).isEmpty()) {
                    base[n] = manual.getValue(n) // pairing is suspended all week: follow the override
                }
            }
        }
        for (floor in s.floors) {
            val floorPeople = byName.values.filter { it.floor == floor }
            for (st in floorPeople) {
                if (st.role == "rotating" && manual.containsKey(st.name)) base[st.name] = manual.getValue(st.name)
            }
            val pre: Map<String, Int> = floorPeople
                .mapNotNull { st -> base[st.name] }
                .groupingBy { it }
                .eachCount()
            val members = floorPeople.filter {
                it.role == "rotating" && present.getValue(it.name).isNotEmpty() && !manual.containsKey(it.name)
            }.map { it.name }
            if (members.isNotEmpty()) {
                base.putAll(solveFloor(members, pre, s.minOpen.getValue(floor), s.minClose.getValue(floor), ::costFn))
            }
        }

        // ---- daily pass --------------------------------------------------
        val cells: MutableMap<Pair<String, LocalDate>, Assignment> = mutableMapOf()
        val ignoredOverride: MutableMap<String, MutableList<LocalDate>> = mutableMapOf()

        for (di in days.indices) {
            val d = days[di]
            val slotOf: MutableMap<String, String> = mutableMapOf()
            val overridden: MutableSet<String> = mutableSetOf()
            for ((key, st) in staffKeys) {
                if (st.role == "blank") {
                    cells[key to d] = Assignment("blank")
                    continue
                }
                if (st.role == "vacant") {
                    val hoursText = st.hours.getOrElse(di) { "" }
                    cells[key to d] = Assignment("vacant", text = hoursText.ifEmpty { st.note })
                    continue
                }
                val lk = leaveKind(st.name, d)
                if (lk != null) {
                    cells[key to d] = Assignment("leave", text = lk)
                    continue
                }
                if (st.role == "static") {
                    val ovText = overrideText(st.name, d)
                    val hoursText = st.hours.getOrElse(di) { "" }
                    val text = ovText?.takeIf { it.isNotEmpty() } ?: hoursText.ifEmpty { null } ?: st.note
                    if (isOff(text)) {
                        cells[key to d] = Assignment("leave", text = "OFF")
                    } else {
                        cells[key to d] = Assignment("static", text = text)
                    }
                    continue
                }
                val (ov, ignored) = effectiveOverride(st.name, d)
                if (ignored) ignoredOverride.getOrPut(st.name) { mutableListOf() }.add(d)
                if (ov != null) {
                    slotOf[st.name] = ov
                    overridden.add(st.name)
                } else {
                    slotOf[st.name] = base.getValue(st.name)
                }
            }

            for (floor in s.floors) {
                repairFloor(d, floor, slotOf, overridden, byName, s, ::costFn, checks, wi)
                checkFloor(d, floor, slotOf, byName, s, checks, wi)
            }

            for ((name, slot) in slotOf) {
                cells[name to d] = Assignment("shift", slot, s.shifts.getValue(slot).label, overridden = name in overridden)
            }
        }

        // ---- pairing report ---------------------------------------------
        if (pair.isNotEmpty()) {
            reportPairing(pair, days, cells, ::leaveKind, ignoredOverride, checks, wi)
        }

        weeks.add(WeekRoster(monday, days, cells))

        // ---- update fairness memory ------------------------------------
        for (n in byName.keys) {
            val slotsList = days.mapNotNull { d -> cells[n to d]?.takeIf { it.kind == "shift" }?.slot }
            for (sl in slotsList) {
                val hm = hist.getValue(n)
                hm[sl] = (hm[sl] ?: 0) + 1
                val pm = period.getValue(n)
                pm[sl] = (pm[sl] ?: 0) + 1
            }
            if (slotsList.isNotEmpty()) lastSlot[n] = mostCommonSlot(slotsList)
        }
    }

    return Roster(
        inputs = inputs,
        staffKeys = staffKeys,
        weeks = weeks,
        checks = checks,
        periodCounts = period.mapValues { it.value.toMap() },
        cumulativeCounts = hist.mapValues { it.value.toMap() },
        lastSlot = lastSlot.toMap(),
    )
}

// --------------------------------------------------------------------------
// Daily repair and checks
// --------------------------------------------------------------------------
private fun needs(floor: String, s: Settings): Map<String, Int> =
    mapOf("early" to s.minOpen.getValue(floor), "late" to s.minClose.getValue(floor))

private fun repairFloor(
    d: LocalDate,
    floor: String,
    slotOf: MutableMap<String, String>,
    overridden: Set<String>,
    byName: Map<String, Staff>,
    s: Settings,
    costFn: (String, String) -> Double,
    checks: MutableList<Check>,
    wi: Int,
) {
    val need = needs(floor, s)
    val floorNames = slotOf.keys.filter { byName.getValue(it).floor == floor }
    for (target in listOf("early", "late")) {
        while (floorNames.count { slotOf[it] == target } < need.getValue(target)) {
            val cnt: Map<String, Int> = floorNames.mapNotNull { slotOf[it] }.groupingBy { it }.eachCount()
            val donors = mutableListOf<String>()
            for (n in floorNames) {
                if (byName.getValue(n).role != "rotating" || n in overridden) continue
                val cur = slotOf.getValue(n)
                if (cur == target) continue
                if (cur in need && (cnt[cur] ?: 0) <= need.getValue(cur)) continue // would break the other minimum
                donors.add(n)
            }
            if (donors.isEmpty()) break
            donors.sortWith(
                compareBy(
                    { n: String -> if (slotOf.getValue(n) in listOf("mid1", "mid2")) 0 else 1 },
                    { n: String -> costFn(n, target) },
                    { n: String -> floorNames.indexOf(n) },
                ),
            )
            val n = donors[0]
            val old = slotOf.getValue(n)
            slotOf[n] = target
            val what = if (target == "early") "opening" else "closing"
            checks.add(
                Check(
                    "INFO",
                    "Cover adjusted",
                    "$n moved from ${t12(s.shifts.getValue(old).start)} to ${t12(s.shifts.getValue(target).start)} " +
                        "on ${fmtDay(d)} to keep $floor $what cover.",
                    d,
                    wi,
                ),
            )
        }
    }
}

private fun checkFloor(
    d: LocalDate,
    floor: String,
    slotOf: Map<String, String>,
    byName: Map<String, Staff>,
    s: Settings,
    checks: MutableList<Check>,
    wi: Int,
) {
    val need = needs(floor, s)
    val cnt: Map<String, Int> = slotOf.entries
        .filter { byName.getValue(it.key).floor == floor }
        .map { it.value }
        .groupingBy { it }
        .eachCount()
    for ((slot, rule, what) in listOf(
        Triple("early", "Opening cover", "opening"),
        Triple("late", "Closing cover", "closing"),
    )) {
        val n = need.getValue(slot)
        if (n > 0 && (cnt[slot] ?: 0) < n) {
            checks.add(
                Check(
                    "BREACH",
                    rule,
                    "$floor $what: ${cnt[slot] ?: 0} on the ${t12(s.shifts.getValue(slot).start)} start, " +
                        "minimum is $n (${fmtDay(d)}).",
                    d,
                    wi,
                ),
            )
        }
    }
}

private fun reportPairing(
    pair: List<String>,
    days: List<LocalDate>,
    cells: Map<Pair<String, LocalDate>, Assignment>,
    leaveKind: (String, LocalDate) -> String?,
    ignoredOverride: Map<String, List<LocalDate>>,
    checks: MutableList<Check>,
    wi: Int,
) {
    val a = pair[0]
    val b = pair[1]
    val suspended = LinkedHashMap<String, MutableList<LocalDate>>()
    for (d in days) {
        val la = leaveKind(a, d)
        val lb = leaveKind(b, d)
        if (la == null && lb == null) {
            val sa = cells[a to d]?.slot
            val sb = cells[b to d]?.slot
            if (setOf(sa, sb) != setOf("early", "late")) {
                checks.add(Check("BREACH", "Pairing rule", "$a and $b are not complementary on ${fmtDay(d)}.", d, wi))
            }
        } else if (la != null && lb == null) {
            suspended.getOrPut(a) { mutableListOf() }.add(d)
        } else if (lb != null && la == null) {
            suspended.getOrPut(b) { mutableListOf() }.add(d)
        }
    }

    for ((absent, ds) in suspended) {
        val partner = if (absent == a) b else a
        val missing = ds.filter { d -> cells[partner to d]?.overridden != true }
        if (missing.isNotEmpty()) {
            checks.add(
                Check(
                    "WARNING",
                    "Pairing suspended",
                    "$absent is away: ${fmtDays(ds)}. $partner has no manual start time for ${fmtDays(missing)}, " +
                        "so the rotation slot is used. Add a row in Overrides to set it yourself.",
                    null,
                    wi,
                ),
            )
        } else {
            checks.add(
                Check(
                    "INFO",
                    "Pairing suspended",
                    "$absent is away: ${fmtDays(ds)}. $partner's start time is set manually in Overrides.",
                    null,
                    wi,
                ),
            )
        }
    }
    for ((name, ds) in ignoredOverride) {
        val partner = if (name == a) b else a
        checks.add(
            Check(
                "INFO",
                "Override ignored",
                "Override for $name ignored on ${fmtDays(ds)} because $partner is working: the pairing rule applies. " +
                    "You can delete or end that Overrides row.",
                null,
                wi,
            ),
        )
    }
}
