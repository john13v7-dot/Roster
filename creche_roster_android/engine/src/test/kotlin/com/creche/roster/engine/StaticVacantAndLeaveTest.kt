package com.creche.roster.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class StaticVacantAndLeaveTest {
    @Test
    fun ownHoursAndDayOff() {
        val r = buildRoster(makeInputs(weeks = 1))
        assertEquals(
            listOf("8:30 – 1:30", "8:30 – 1:30", "8:30 – 1:30", "OFF", "8:30 – 1:30"),
            texts(r, 0, "Sue"),
        )
        assertEquals(
            listOf("10:00 – 2:00", "10:00 – 6:00", "10:00 – 6:00", "10:00 – 6:00", "10:00 – 6:00"),
            texts(r, 0, "Priscilla"),
        )
        assertEquals(List(5) { "9:00 – 1:00" }, texts(r, 0, "Laura"))
        assertEquals(List(5) { "" }, texts(r, 0, "Megan"))
    }

    @Test
    fun maternityLeaveTextIsKeptAsTyped() {
        val r = buildRoster(makeInputs(leave = listOf(Leave("Eirini", START, null, "Maternity Leave")), weeks = 1))
        assertEquals(setOf("Maternity Leave"), texts(r, 0, "Eirini").toSet())
    }

    @Test
    fun vacantPostShowsItsHoursButIsNotScheduled() {
        val r = buildRoster(makeInputs(weeks = 1))
        val vacant = r.staffKeys.filter { it.second.role == "vacant" }.map { it.first }
        assertEquals(3, vacant.size)
        assertEquals("8:30 – 5:30", r.weeks[0].cells[(vacant[0] to START)]?.text)
        assertEquals("", r.weeks[0].cells[(vacant[1] to START)]?.text)
    }
}
