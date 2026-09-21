package com.creche.roster.engine

import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/** The printed page must look like the old paper roster. */
class OldLayoutTest {
    private lateinit var r: Roster
    private lateinit var grid: List<GridRow>

    @Before
    fun setUp() {
        r = buildRoster(sampleInputs(START))
        grid = weekGrid(r, 0)
    }

    @Test
    fun titleAndDateThenTableWithoutHeaderRow() {
        assertEquals("STAFF ROSTER", grid[0].cells[0].text)
        assertEquals("28th September – 2nd October 2026", grid[1].cells[0].text)
        val firstTableRow = grid[3]
        assertEquals(NCOLS, firstTableRow.cells.size)
        assertEquals(listOf("1", "Sue"), firstTableRow.cells.take(2).map { it.text })
    }

    @Test
    fun columnsAreNoNameFiveDaysBreakAndEmpty() {
        val sue = grid[3].cells
        assertEquals(9, sue.size)
        assertEquals("10 MINS", sue[7].text)
        assertEquals("", sue[8].text)
    }

    @Test
    fun leaveColours() {
        val byName = grid.drop(3).filter { !it.merged }.associateBy { it.cells[1].text }
        assertEquals("off", byName.getValue("Sue").cells[5].style)
        assertEquals("OFF", byName.getValue("Sue").cells[5].text)
        assertEquals("holiday", byName.getValue("Shehnaz").cells[2].style)
        assertEquals("maternity", byName.getValue("Eirini").cells[2].style)
        assertEquals("plain", byName.getValue("Jason").cells[2].style) // shifts are not coloured
    }

    @Test
    fun numberingAndSpacer() {
        val rows = grid.drop(3).filter { !it.merged }
        val numbers = rows.map { it.cells[0].text }
        assertEquals((1..13).map { it.toString() }, numbers.take(13))
        assertEquals("", numbers[13]) // spacer row
        val eirini = rows.first { it.cells[1].text == "Eirini" }
        assertEquals("", eirini.cells[0].text)
        assertEquals("14", rows.first { it.cells[1].text == "Megan" }.cells[0].text)
    }

    @Test
    fun breakColumnOnlyWhereThereIsSomething() {
        val rows = grid.drop(3).filter { !it.merged }
        assertEquals("", rows[11].cells[7].text) // empty numbered row 12
        assertEquals("10 MINS", rows[2].cells[7].text) // vacant post that has hours
        assertEquals("10 MINS", rows.first { it.cells[1].text == "Megan" }.cells[7].text)
    }

    @Test
    fun dayHeadersAreOptional() {
        val inp = sampleInputs(START)
        inp.settings.dayHeaders = true
        val grid2 = weekGrid(buildRoster(inp), 0)
        assertEquals("Mon 28 Sep", grid2[3].cells[2].text)
    }
}
