/**
 * Shared test fixtures, mirroring the helpers at the top of the Python
 * tests/test_roster.py.
 */
package com.creche.roster.engine

import java.time.LocalDate

val START: LocalDate = LocalDate.of(2026, 9, 28) // a Monday
val ROTATING = listOf("Hanny", "Manuel", "Irene", "Deoshree", "Sandrine", "Daniel", "Arantza", "David", "Usha")

/** Starter data with no leave, overrides or history unless given. */
fun makeInputs(
    leave: List<Leave> = emptyList(),
    overrides: List<Override> = emptyList(),
    weeks: Int = 4,
    history: Map<String, Map<String, Int>> = emptyMap(),
    lastSlot: Map<String, String> = emptyMap(),
): Inputs {
    val inp = sampleInputs(START)
    inp.leave = leave
    inp.overrides = overrides
    inp.settings.weeks = weeks
    inp.history = history
    inp.lastSlot = lastSlot
    return inp
}

fun slots(r: Roster, wi: Int, name: String): List<String?> =
    r.weeks[wi].days.map { d -> r.weeks[wi].cells[name to d]?.slot }

fun kinds(r: Roster, wi: Int, name: String): List<String?> =
    r.weeks[wi].days.map { d -> r.weeks[wi].cells[name to d]?.kind }

fun texts(r: Roster, wi: Int, name: String): List<String> =
    r.weeks[wi].days.map { d -> r.weeks[wi].cells[name to d]?.text ?: "" }
