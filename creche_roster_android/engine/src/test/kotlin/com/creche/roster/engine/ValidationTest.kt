package com.creche.roster.engine

import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ValidationTest {
    @Test
    fun unknownNameAndBadStart() {
        val inp = makeInputs(leave = listOf(Leave("Nobody", START, null)))
        inp.settings.rosterStart = START.plusDays(1)
        val ex = assertThrows(InputError::class.java) { buildRoster(inp) }
        val text = ex.problems.joinToString("\n")
        assertTrue(text.contains("Nobody"))
        assertTrue(text.contains("must be a Monday"))
    }

    @Test
    fun exactlyTwoPaired() {
        val inp = makeInputs()
        for (st in inp.staff) if (st.name == "Shehnaz") st.role = "rotating"
        val ex = assertThrows(InputError::class.java) { buildRoster(inp) }
        assertTrue(ex.problems.joinToString("\n").contains("exactly two"))
    }

    @Test
    fun startTimesMustIncrease() {
        val inp = makeInputs()
        val shifts = inp.settings.shifts.toMutableMap()
        val mid1 = shifts.getValue("mid1")
        val mid2 = shifts.getValue("mid2")
        shifts["mid1"] = mid2
        shifts["mid2"] = mid1
        inp.settings.shifts = shifts
        assertThrows(InputError::class.java) { buildRoster(inp) }
    }
}
