/**
 * Single source of truth for what a printed week looks like. Kotlin port of
 * creche_roster.layout. The app's roster screen and the PDF exporter both
 * render [weekGrid], so they can never disagree.
 */
package com.creche.roster.engine

import java.time.LocalDate

const val NCOLS = 2 + NDAYS + 2 // No, Name, Mon..Fri, break, empty
val COL_WIDTHS_CHARS: List<Int> = listOf(5, 18) + List(NDAYS) { 16 } + listOf(10, 10)

/** fill/color are hex without '#'. serif is used for the title only. */
data class CellStyle(
    val fill: String? = null,
    val color: String = "000000",
    val bold: Boolean = false,
    val italic: Boolean = false,
    val size: Int = 10,
    val align: String = "center",
    val border: Boolean = true,
    val serif: Boolean = false,
)

val STYLES: Map<String, CellStyle> = mapOf(
    "title" to CellStyle(color = "E04A32", bold = true, size = 22, align = "left", border = false, serif = true),
    "subtitle" to CellStyle(bold = true, size = 14, align = "left", border = false),
    "header" to CellStyle(fill = "D9D9D9", bold = true),
    "plain" to CellStyle(),
    "holiday" to CellStyle(fill = "C65B35", color = "F4CCB8"),
    "maternity" to CellStyle(fill = "2E9E57", color = "BFE6CB"),
    "off" to CellStyle(fill = "A9D18E"),
    "leave" to CellStyle(fill = "D9D9D9"),
    "blank" to CellStyle(border = false),
    "note" to CellStyle(color = "404040", italic = true, size = 9, align = "left", border = false),
    "note_warn" to CellStyle(fill = "FFEB9C", color = "7F6000", size = 9, align = "left", border = false),
    "note_bad" to CellStyle(fill = "FFC7CE", color = "9C0006", bold = true, size = 9, align = "left", border = false),
)

const val MAX_NOTES = 6

data class LCell(val text: String, val style: String)

data class GridRow(
    val cells: List<LCell>,
    // True: a single cell spanning every column.
    val merged: Boolean = false,
    // Relative height (1.0 = normal row).
    val height: Double = 1.0,
)

fun leaveStyle(text: String): String {
    val t = text.trim().lowercase()
    return when {
        t == "off" -> "off"
        t.contains("holiday") -> "holiday"
        t.contains("maternity") -> "maternity"
        else -> "leave"
    }
}

fun ordinal(n: Int): String {
    val suffix = if (n % 100 in 10..20) {
        "th"
    } else {
        when (n % 10) {
            1 -> "st"
            2 -> "nd"
            3 -> "rd"
            else -> "th"
        }
    }
    return "$n$suffix"
}

private val FULL_MONTHS = listOf(
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

private fun monthName(d: LocalDate) = FULL_MONTHS[d.monthValue - 1]

/** "21st – 25th September 2026" (or across months / years). */
fun dateRangeText(first: LocalDate, last: LocalDate): String {
    val dash = "–"
    return when {
        first.year == last.year && first.monthValue == last.monthValue ->
            "${ordinal(first.dayOfMonth)} $dash ${ordinal(last.dayOfMonth)} ${monthName(last)} ${last.year}"
        first.year == last.year ->
            "${ordinal(first.dayOfMonth)} ${monthName(first)} $dash ${ordinal(last.dayOfMonth)} ${monthName(last)} ${last.year}"
        else ->
            "${ordinal(first.dayOfMonth)} ${monthName(first)} ${first.year} $dash ${ordinal(last.dayOfMonth)} ${monthName(last)} ${last.year}"
    }
}

private val ORD_RE = Regex("""(\d+)(st|nd|rd|th)\b""")

/** Split "21st - 25th September" into runs; the boolean marks the raised suffix (st, nd, rd, th). */
fun ordinalRuns(text: String): List<Pair<String, Boolean>> {
    val runs = mutableListOf<Pair<String, Boolean>>()
    var pos = 0
    for (m in ORD_RE.findAll(text)) {
        val numEnd = m.groups[1]!!.range.last + 1
        runs.add(text.substring(pos, numEnd) to false)
        runs.add(m.groupValues[2] to true)
        pos = m.range.last + 1
    }
    runs.add(text.substring(pos) to false)
    return runs.filter { it.first.isNotEmpty() }
}

private fun merged(text: String, style: String, height: Double = 1.0): GridRow =
    GridRow(listOf(LCell(text, style)), merged = true, height = height)

fun noteHeight(text: String): Double {
    val lines = maxOf(1, (text.length + 89) / 90) // ceiling division
    return 0.75 * lines + 0.25
}

fun weekGrid(roster: Roster, wi: Int): List<GridRow> {
    val s = roster.inputs.settings
    val week = roster.weeks[wi]
    val rows = mutableListOf<GridRow>()

    rows.add(merged(s.title, "title", 2.0))
    rows.add(merged(dateRangeText(week.days.first(), week.days.last()), "subtitle", 1.6))
    rows.add(merged("", "blank", 0.7))

    if (s.dayHeaders) {
        val headerCells = mutableListOf(LCell("", "header"), LCell("Name", "header"))
        week.days.forEachIndexed { i, d ->
            headerCells.add(LCell("${DAY_NAMES[i]} ${d.dayOfMonth} ${MONTH_ABBR_LOCAL[d.monthValue - 1]}", "header"))
        }
        headerCells.add(LCell("Break", "header"))
        headerCells.add(LCell("", "header"))
        rows.add(GridRow(headerCells, height = 1.25))
    }

    var number = 0
    for ((key, st) in roster.staffKeys) {
        if (st.role == "blank") { // spacer row: bordered, empty, unnumbered
            rows.add(GridRow(List(NCOLS) { LCell("", "plain") }, height = 1.25))
            continue
        }
        val label: String
        if (st.number.trim() == "-") {
            label = ""
        } else {
            val typed = st.number.trim().toIntOrNull()
            number = typed ?: (number + 1)
            label = number.toString()
        }
        val dayCells = week.days.map { d ->
            val a = week.cells[key to d] ?: Assignment("blank")
            LCell(a.text, if (a.kind == "leave") leaveStyle(a.text) else "plain")
        }
        val hasContent = st.name.isNotEmpty() || dayCells.any { it.text.isNotEmpty() }
        val cells = mutableListOf(LCell(label, "plain"), LCell(st.name, "plain"))
        cells.addAll(dayCells)
        cells.add(LCell(if (hasContent) s.breakText else "", "plain"))
        cells.add(LCell("", "plain"))
        rows.add(GridRow(cells, height = 1.25))
    }

    // Anything that breaks a hard rule is printed under the table so nobody
    // hands out a broken roster without knowing.
    val bad = roster.checks.filter { it.week == wi && it.level == "BREACH" }
    for (c in bad.take(MAX_NOTES)) {
        val text = "BREACH: ${c.message}"
        rows.add(merged(text, "note_bad", noteHeight(text)))
    }
    if (bad.size > MAX_NOTES) {
        rows.add(merged("+ ${bad.size - MAX_NOTES} more (see the Checks screen)", "note_bad"))
    }
    return rows
}

private val MONTH_ABBR_LOCAL = listOf(
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
