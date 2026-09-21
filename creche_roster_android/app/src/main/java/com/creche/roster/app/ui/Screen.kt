package com.creche.roster.app.ui

sealed class Screen(val title: String) {
    object Roster : Screen("Roster")
    object Staff : Screen("Staff")
    object Leave : Screen("Leave")
    object Overrides : Screen("Overrides")
    object Settings : Screen("Settings")
    object History : Screen("History")
    object Checks : Screen("Checks")
    object Totals : Screen("Totals")

    companion object {
        val ALL = listOf(Roster, Staff, Leave, Overrides, Settings, History, Checks, Totals)
    }
}
