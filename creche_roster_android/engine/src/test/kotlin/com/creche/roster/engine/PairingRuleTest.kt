package com.creche.roster.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingRuleTest {
    @Test
    fun complementaryEveryDayWithoutLeave() {
        val r = buildRoster(makeInputs(weeks = 12))
        for (wi in 0 until 12) {
            val sh = slots(r, wi, "Shehnaz")
            val ja = slots(r, wi, "Jason")
            for (i in sh.indices) {
                assertEquals("week ${wi + 1}", setOf("early", "late"), setOf(sh[i], ja[i]))
            }
        }
        assertTrue(r.breaches.isEmpty())
    }

    @Test
    fun pairAlternatesFairly() {
        val r = buildRoster(makeInputs(weeks = 12))
        val shehnazEarly = (0 until 12).count { wi -> slots(r, wi, "Shehnaz")[0] == "early" }
        assertEquals(6, shehnazEarly)
    }

    @Test
    fun historyDecidesWhoStartsEarly() {
        val hist = mapOf("Jason" to mapOf("early" to 100), "Shehnaz" to mapOf("late" to 100))
        val r = buildRoster(makeInputs(weeks = 1, history = hist))
        assertEquals(setOf("early"), slots(r, 0, "Shehnaz").toSet())
        assertEquals(setOf("late"), slots(r, 0, "Jason").toSet())
    }

    @Test
    fun shehnazOnHolidayJasonStays0730() {
        val r = buildRoster(sampleInputs(START)) // Shehnaz away (open ended), Jason overridden
        for (wi in 0 until 4) {
            assertEquals(setOf("early"), slots(r, wi, "Jason").toSet())
            assertEquals(setOf("leave"), kinds(r, wi, "Shehnaz").toSet())
            assertEquals(setOf("Holiday"), texts(r, wi, "Shehnaz").toSet())
        }
        assertTrue(r.breaches.isEmpty())
        assertEquals("7:30 – 4:30", r.weeks[0].cells[("Jason" to START)]?.text)
    }

    @Test
    fun jasonOnHolidayShehnazOverride() {
        val r = buildRoster(
            makeInputs(
                leave = listOf(Leave("Jason", START, null, "Holiday")),
                overrides = listOf(Override("Shehnaz", START, null, "early")),
            ),
        )
        for (wi in 0 until 4) {
            assertEquals(setOf("early"), slots(r, wi, "Shehnaz").toSet())
            assertEquals(setOf("leave"), kinds(r, wi, "Jason").toSet())
        }
        assertTrue(r.breaches.isEmpty())
    }

    @Test
    fun noOverrideGivesWarningNotCrash() {
        val r = buildRoster(makeInputs(leave = listOf(Leave("Shehnaz", START, null, "Holiday"))))
        assertTrue(r.checks.any { it.level == "WARNING" && it.rule == "Pairing suspended" })
        for (wi in 0 until 4) {
            assertTrue(slots(r, wi, "Jason").all { it == "early" || it == "late" })
        }
    }

    @Test
    fun pairingResumesWhenPartnerReturns() {
        val leave = listOf(Leave("Shehnaz", START, START.plusDays(13), "Holiday")) // weeks 1 and 2
        val over = listOf(Override("Jason", START, null, "early")) // forgotten open-ended override
        val r = buildRoster(makeInputs(leave = leave, overrides = over))
        assertEquals(setOf("early"), slots(r, 0, "Jason").toSet())
        assertEquals(setOf("early"), slots(r, 1, "Jason").toSet())
        for (wi in listOf(2, 3)) {
            val sh = slots(r, wi, "Shehnaz")
            val ja = slots(r, wi, "Jason")
            for (i in sh.indices) assertEquals(setOf("early", "late"), setOf(sh[i], ja[i]))
        }
        // Jason covered 7:30 while she was away, so she takes it first.
        assertEquals(setOf("early"), slots(r, 2, "Shehnaz").toSet())
        assertTrue(r.checks.any { it.rule == "Override ignored" })
        assertTrue(r.breaches.isEmpty())
    }

    @Test
    fun partialWeekLeave() {
        val leave = listOf(Leave("Shehnaz", START.plusDays(2), START.plusDays(4), "Holiday")) // Wed-Fri
        val over = listOf(Override("Jason", START.plusDays(2), START.plusDays(4), "early"))
        val r = buildRoster(makeInputs(leave = leave, overrides = over, weeks = 1))
        val sh = slots(r, 0, "Shehnaz")
        val ja = slots(r, 0, "Jason")
        for (i in 0..1) assertEquals(setOf("early", "late"), setOf(sh[i], ja[i]))
        assertEquals(listOf("early", "early", "early"), ja.subList(2, 5))
        assertEquals(listOf(null, null, null), sh.subList(2, 5))
        assertTrue(r.breaches.isEmpty())
    }
}
