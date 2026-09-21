/**
 * Starter data: the real staff list from the printed roster of 21st-25th
 * September 2026. Kotlin port of creche_roster.sample.
 *
 * Everything the paper roster does not say is a placeholder: the floor split
 * and the minimum opening / closing cover.
 */
package com.creche.roster.engine

import java.time.LocalDate
import java.time.LocalTime

/** A person with own hours. */
private fun staticStaff(
    name: String,
    hours: String = "",
    number: String = "",
    mon: String = "",
    tue: String = "",
    wed: String = "",
    thu: String = "",
    fri: String = "",
): Staff = Staff(name, "All", "static", hours, null, mutableListOf(mon, tue, wed, thu, fri), number)

fun sampleInputs(start: LocalDate): Inputs {
    val settings = Settings(
        title = "STAFF ROSTER",
        rosterStart = start,
        weeks = 4,
        floors = listOf("All"),
        shifts = mapOf(
            "early" to Shift(LocalTime.of(7, 30), LocalTime.of(16, 30)),
            "mid1" to Shift(LocalTime.of(8, 0), LocalTime.of(17, 0)),
            "mid2" to Shift(LocalTime.of(8, 30), LocalTime.of(17, 30)),
            "late" to Shift(LocalTime.of(9, 0), LocalTime.of(18, 0)),
        ),
        minOpen = mapOf("All" to 2), // PLACEHOLDER
        minClose = mapOf("All" to 2), // PLACEHOLDER
        breakText = "10 MINS",
        dayHeaders = false,
    )
    fun rot(n: String) = Staff(n, "All", "rotating")
    val staff = listOf(
        staticStaff("Sue", hours = "8:30 – 1:30", thu = "OFF"),
        rot("Hanny"),
        Staff("", "All", "vacant", "8:30 – 5:30"), // the empty post on the printed roster
        rot("Manuel"),
        rot("Irene"),
        rot("Deoshree"),
        rot("Sandrine"),
        rot("Daniel"),
        rot("Arantza"),
        rot("David"),
        rot("Usha"),
        Staff("", "All", "vacant"),
        Staff("", "All", "vacant"),
        Staff("", "All", "blank"),
        staticStaff("Eirini", number = "-"),
        staticStaff("Megan"),
        Staff("Jason", "All", "paired"),
        Staff("Shehnaz", "All", "paired"),
        staticStaff("Priscilla", hours = "10:00 – 6:00", mon = "10:00 – 2:00"),
        staticStaff("Laura", hours = "9:00 – 1:00"),
    )
    // Right now: Shehnaz is on holiday until she is back (open ended), Eirini is
    // on maternity leave, and Jason is set to 7:30 until Shehnaz returns.
    val firstWeek = LocalDate.of(2026, 9, 21)
    val leave = listOf(
        Leave("Shehnaz", firstWeek, null, "Holiday"),
        Leave("Eirini", firstWeek, null, "Maternity Leave"),
    )
    val overrides = listOf(Override("Jason", firstWeek, null, "early"))

    // The printed week of 21st-25th September: 5 days on each person's start time.
    val printed = mapOf(
        "Hanny" to "early", "Manuel" to "mid1", "Irene" to "late", "Deoshree" to "early",
        "Sandrine" to "mid2", "Daniel" to "mid1", "Arantza" to "late", "David" to "mid2",
        "Usha" to "late", "Jason" to "early",
    )
    val history: Map<String, Map<String, Int>> = printed.mapValues { (_, sl) -> mapOf(sl to 5) }

    return Inputs(
        settings = settings,
        staff = staff,
        leave = leave,
        overrides = overrides,
        history = history,
        lastSlot = printed,
    )
}
