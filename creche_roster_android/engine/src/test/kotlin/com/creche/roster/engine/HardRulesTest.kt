package com.creche.roster.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HardRulesTest {
    @Test
    fun ratiosMetForTwelveWeeks() {
        assertTrue(buildRoster(makeInputs(weeks = 12)).breaches.isEmpty())
    }

    @Test
    fun fixedPersonAlwaysOnTheirSlot() {
        val inp = makeInputs(weeks = 6)
        for (st in inp.staff) {
            if (st.name == "Hanny") {
                st.role = "fixed"
                st.fixedSlot = "early"
            }
        }
        val r = buildRoster(inp)
        for (wi in 0 until 6) assertEquals(setOf("early"), slots(r, wi, "Hanny").toSet())
    }

    @Test
    fun leaveDayIsMarkedAndCoverIsRepaired() {
        val day = START.plusDays(1)
        val r = buildRoster(makeInputs(leave = listOf(Leave("Manuel", day, day, "Sick")), weeks = 1))
        assertEquals("leave", kinds(r, 0, "Manuel")[1])
        assertEquals("Sick", texts(r, 0, "Manuel")[1])
        assertTrue(r.breaches.isEmpty())
    }

    @Test
    fun infeasibleCoverIsReportedNotHidden() {
        val inp = makeInputs(weeks = 1)
        inp.settings.minOpen = mapOf("All" to 99)
        val r = buildRoster(inp)
        assertTrue(r.breaches.isNotEmpty())
        assertTrue(r.breaches.all { it.rule == "Opening cover" })
    }

    @Test
    fun rotationSpreadsStartTimes() {
        val r = buildRoster(makeInputs(weeks = 12))
        for (name in ROTATING) {
            val seen = (0 until 12).flatMap { wi -> slots(r, wi, name) }.filterNotNull().toSet()
            assertTrue(name, seen.size >= 3)
        }
    }

    @Test
    fun historyMakesRotationContinueFromLastWeek() {
        val inp = makeInputs(weeks = 1, lastSlot = mapOf("Hanny" to "early", "Usha" to "late"))
        val r = buildRoster(inp)
        assertNotEquals("early", slots(r, 0, "Hanny")[0])
        assertNotEquals("late", slots(r, 0, "Usha")[0])
    }

    @Test
    fun deterministic() {
        val a = buildRoster(makeInputs(weeks = 6))
        val b = buildRoster(makeInputs(weeks = 6))
        for (wi in 0 until 6) assertEquals(a.weeks[wi].cells, b.weeks[wi].cells)
    }
}
