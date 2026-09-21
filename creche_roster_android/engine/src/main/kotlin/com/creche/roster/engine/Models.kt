/**
 * Plain data classes shared by every module. No logic beyond tiny helpers.
 *
 * This is a Kotlin port of the Python creche_roster.models module. It is kept
 * deliberately close to the Python source (same field names in camelCase, same
 * string-keyed slots) so the two can be compared line by line.
 */
package com.creche.roster.engine

import java.time.LocalDate
import java.time.LocalTime

/** The four start-time slots that rotating staff share, earliest to latest. */
val SLOTS: List<String> = listOf("early", "mid1", "mid2", "late")

val SLOT_LABELS: Map<String, String> = mapOf(
    "early" to "Early",
    "mid1" to "Mid 1",
    "mid2" to "Mid 2",
    "late" to "Late",
)

val ROLES: List<String> = listOf("rotating", "fixed", "paired", "static", "vacant", "blank")

const val NDAYS = 5
val DAY_NAMES: List<String> = listOf("Mon", "Tue", "Wed", "Thu", "Fri")

/** Raised when the input data is wrong. Carries every problem found. */
class InputError(val problems: List<String>) :
    RuntimeException(problems.joinToString("\n") { "- $it" })

/** 7:30, 1:30, 12:00 ... the way the printed roster shows times. */
fun t12(t: LocalTime): String {
    val h = if (t.hour % 12 == 0) 12 else t.hour % 12
    return "$h:${t.minute.toString().padStart(2, '0')}"
}

data class Shift(val start: LocalTime, val end: LocalTime) {
    val label: String get() = "${t12(start)} – ${t12(end)}"
}

data class Settings(
    var title: String,
    var rosterStart: LocalDate,
    var weeks: Int,
    var floors: List<String>,
    var shifts: Map<String, Shift>,
    var minOpen: Map<String, Int>,
    var minClose: Map<String, Int>,
    var breakText: String = "10 MINS",
    // The old printed roster has no Mon..Fri header row.
    var dayHeaders: Boolean = false,
)

data class Staff(
    var name: String,
    var floor: String,
    // One of ROLES.
    var role: String,
    // fixed: slot name or start time; static/vacant: hours text.
    var note: String = "",
    // Resolved from note for role "fixed".
    var fixedSlot: String? = null,
    // Own hours Mon..Fri (static/vacant).
    var hours: MutableList<String> = MutableList(NDAYS) { "" },
    // Printed row number: empty = automatic, "-" = none, "12" = set it.
    var number: String = "",
)

data class Leave(
    val name: String,
    val start: LocalDate,
    // null = open ended (until the person is back).
    val end: LocalDate?,
    val kind: String = "Leave",
) {
    fun covers(d: LocalDate): Boolean = !start.isAfter(d) && (end == null || !d.isAfter(end))
}

data class Override(
    val name: String,
    val start: LocalDate,
    // null = open ended.
    val end: LocalDate?,
    // One of SLOTS (everyone except static staff).
    val slot: String? = null,
    // Free text hours (static staff only), e.g. "10:00 - 2:00" or "OFF".
    val text: String = "",
) {
    fun covers(d: LocalDate): Boolean = !start.isAfter(d) && (end == null || !d.isAfter(end))
}

data class Inputs(
    var settings: Settings,
    var staff: List<Staff>,
    var leave: List<Leave> = emptyList(),
    var overrides: List<Override> = emptyList(),
    // Days already worked on each start time before this roster (fairness memory).
    var history: Map<String, Map<String, Int>> = emptyMap(),
    var lastSlot: Map<String, String> = emptyMap(),
)

data class Assignment(
    // shift | leave | static | vacant | blank
    val kind: String,
    val slot: String? = null,
    val text: String = "",
    val overridden: Boolean = false,
)

data class Check(
    // INFO | WARNING | BREACH
    val level: String,
    val rule: String,
    val message: String,
    val day: LocalDate? = null,
    // 0-based week index.
    val week: Int? = null,
)

data class WeekRoster(
    val monday: LocalDate,
    val days: List<LocalDate>,
    // Keyed by (staff key, day).
    val cells: Map<Pair<String, LocalDate>, Assignment>,
)

data class Roster(
    val inputs: Inputs,
    // (unique key, staff) in display order.
    val staffKeys: List<Pair<String, Staff>>,
    val weeks: List<WeekRoster>,
    val checks: List<Check>,
    // Days per slot in THIS roster.
    val periodCounts: Map<String, Map<String, Int>>,
    // History plus this roster.
    val cumulativeCounts: Map<String, Map<String, Int>>,
    // Most recent slot per person.
    val lastSlot: Map<String, String> = emptyMap(),
) {
    val breaches: List<Check> get() = checks.filter { it.level == "BREACH" }
}
