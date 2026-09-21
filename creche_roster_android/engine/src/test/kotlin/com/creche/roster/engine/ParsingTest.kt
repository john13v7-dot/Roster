package com.creche.roster.engine

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class ParsingTest {
    @Test
    fun timeFormats() {
        val values: List<Any> = listOf("07:30", "7:30", "07.30", "07 30", "0730", "7h30", LocalTime.of(7, 30), 7.5 / 24)
        for (raw in values) {
            assertEquals("$raw", LocalTime.of(7, 30), parseTime(raw))
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun badTime() {
        parseTime("25:00")
    }

    @Test
    fun dateFormats() {
        assertEquals(START, parseDate("28/09/2026"))
        assertEquals(START, parseDate("2026-09-28"))
    }

    @Test
    fun twelveHourDisplay() {
        assertEquals("7:30", t12(LocalTime.of(7, 30)))
        assertEquals("1:30", t12(LocalTime.of(13, 30)))
        assertEquals("6:00", t12(LocalTime.of(18, 0)))
        assertEquals("7:30 – 4:30", Shift(LocalTime.of(7, 30), LocalTime.of(16, 30)).label)
    }

    @Test
    fun hoursAreNormalised() {
        assertEquals("10:00 – 2:00", normHours("10:00 - 2:00"))
        assertEquals("9.00 – 6.00", normHours("9.00-6.00"))
        assertEquals("OFF", normHours("OFF"))
    }

    @Test
    fun dateRangeHeading() {
        assertEquals("21st – 25th September 2026", dateRangeText(LocalDate.of(2026, 9, 21), LocalDate.of(2026, 9, 25)))
        assertEquals("28th September – 2nd October 2026", dateRangeText(LocalDate.of(2026, 9, 28), LocalDate.of(2026, 10, 2)))
        assertEquals("12th – 16th October 2026", dateRangeText(LocalDate.of(2026, 10, 12), LocalDate.of(2026, 10, 16)))
        assertEquals("19th – 23rd October 2026", dateRangeText(LocalDate.of(2026, 10, 19), LocalDate.of(2026, 10, 23)))
    }
}
