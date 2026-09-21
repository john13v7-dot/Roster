/**
 * Forgiving parsers for user-typed values. Kotlin port of creche_roster.parsing.
 */
package com.creche.roster.engine

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

private val TIME_RE = Regex("""^\s*(\d{1,2})\s*[:.hH ]?\s*(\d{2})\s*$""")

private val DATE_FORMATS: List<DateTimeFormatter> = listOf(
    "yyyy-MM-dd",
    "dd/MM/yyyy",
    "dd-MM-yyyy",
    "dd.MM.yyyy",
    "dd/MM/yy",
    "dd MMM yyyy",
    "dd MMMM yyyy",
).map { DateTimeFormatter.ofPattern(it, Locale.ENGLISH) }

fun isBlank(v: Any?): Boolean = v == null || (v is String && v.isBlank())

/** Accepts 07:30, 7:30, 07.30, "07 30", 0730, 7h30, a LocalTime, or an Excel-style day fraction. */
fun parseTime(v: Any): LocalTime {
    return when (v) {
        is LocalTime -> LocalTime.of(v.hour, v.minute)
        is LocalDateTime -> LocalTime.of(v.hour, v.minute)
        is Number -> {
            val d = v.toDouble()
            if (d >= 0.0 && d < 1.0) {
                val minutes = Math.round(d * 24 * 60).toInt()
                LocalTime.of((minutes / 60) % 24, minutes % 60)
            } else {
                throw IllegalArgumentException("'$v' is not a time")
            }
        }
        is String -> {
            val m = TIME_RE.matchEntire(v)
            if (m != null) {
                val h = m.groupValues[1].toInt()
                val mi = m.groupValues[2].toInt()
                if (h in 0..23 && mi in 0..59) return LocalTime.of(h, mi)
            }
            throw IllegalArgumentException("'$v' is not a time (use e.g. 07:30)")
        }
        else -> throw IllegalArgumentException("'$v' is not a time (use e.g. 07:30)")
    }
}

fun parseDate(v: Any): LocalDate {
    return when (v) {
        is LocalDate -> v
        is LocalDateTime -> v.toLocalDate()
        is String -> {
            val s = v.trim()
            for (fmt in DATE_FORMATS) {
                try {
                    return LocalDate.parse(s, fmt)
                } catch (e: DateTimeParseException) {
                    // try the next format
                }
            }
            throw IllegalArgumentException("'$v' is not a date (use e.g. 21/09/2026)")
        }
        else -> throw IllegalArgumentException("'$v' is not a date (use e.g. 21/09/2026)")
    }
}

private val DAY_ABBR = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
private val MONTH_ABBR = listOf(
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

fun fmtDay(d: LocalDate): String {
    val dow = DAY_ABBR[d.dayOfWeek.value - 1]
    val mon = MONTH_ABBR[d.monthValue - 1]
    return "$dow ${d.dayOfMonth} $mon"
}

/** "Mon 21 Sep, Tue 22 Sep" for a list of dates (compact for long lists). */
fun fmtDays(daysIn: List<LocalDate>): String {
    val days = daysIn.sorted()
    if (days.isEmpty()) return ""
    if (days.size <= 3) return days.joinToString(", ") { fmtDay(it) }
    return "${fmtDay(days.first())} to ${fmtDay(days.last())}, ${days.size} days"
}

private val DASH_RE = Regex("""(\d)\s*[-–—]\s*(\d)""")

/** Show typed hours the way the printed roster does: "10:00 - 2:00" -> "10:00 – 2:00". */
fun normHours(text: Any?): String {
    if (text == null) return ""
    val s = text.toString().trim()
    return DASH_RE.replace(s) { m -> "${m.groupValues[1]} – ${m.groupValues[2]}" }
}

fun isOff(text: String): Boolean = text.trim().uppercase(Locale.ENGLISH) == "OFF"
