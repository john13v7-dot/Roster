package com.creche.roster.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OverridesTest {
    @Test
    fun solverPlansAroundOverridesWithoutRepairs() {
        val leave = listOf(Leave("Shehnaz", START, START.plusDays(13), "Holiday"))
        val over = listOf(Override("Jason", START, START.plusDays(13), "early"))
        val r = buildRoster(makeInputs(leave = leave, overrides = over))
        assertTrue(r.checks.none { it.rule == "Cover adjusted" })
        assertTrue(r.breaches.isEmpty())
    }

    @Test
    fun overrideOnARotatingPerson() {
        val over = listOf(Override("Manuel", START, START.plusDays(4), "late"))
        val r = buildRoster(makeInputs(overrides = over, weeks = 1))
        assertEquals(setOf("late"), slots(r, 0, "Manuel").toSet())
        assertTrue(r.weeks[0].days.all { d -> r.weeks[0].cells[("Manuel" to d)]?.overridden == true })
        assertTrue(r.breaches.isEmpty())
    }

    @Test
    fun lastMatchingOverrideRowWins() {
        val over = listOf(
            Override("Manuel", START, null, "late"),
            Override("Manuel", START.plusDays(2), null, "mid1"),
        )
        val r = buildRoster(makeInputs(overrides = over, weeks = 1))
        assertEquals(listOf("late", "late", "mid1", "mid1", "mid1"), slots(r, 0, "Manuel"))
    }

    @Test
    fun staticOverrideIsFreeText() {
        val over = listOf(
            Override("Priscilla", START, START, null, "OFF"),
            Override("Laura", START.plusDays(1), START.plusDays(1), null, "10:00 – 2:00"),
        )
        val r = buildRoster(makeInputs(overrides = over, weeks = 1))
        assertEquals("OFF", texts(r, 0, "Priscilla")[0])
        assertEquals("leave", kinds(r, 0, "Priscilla")[0])
        assertEquals("10:00 – 2:00", texts(r, 0, "Laura")[1])
        assertEquals("9:00 – 1:00", texts(r, 0, "Laura")[0])
    }
}
