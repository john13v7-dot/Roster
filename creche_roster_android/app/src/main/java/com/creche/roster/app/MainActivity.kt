package com.creche.roster.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.creche.roster.app.data.AppState
import com.creche.roster.app.data.Repository
import com.creche.roster.app.ui.AppRoot
import com.creche.roster.app.ui.theme.CrecheRosterTheme
import com.creche.roster.engine.sampleInputs
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (AppState.inputs.value == null) {
            val loaded = Repository.load(this)
            AppState.inputs.value = loaded ?: sampleInputs(nextMonday())
            AppState.rebuild()
        }

        setContent {
            CrecheRosterTheme {
                AppRoot()
            }
        }
    }

    private fun nextMonday(): LocalDate {
        val today = LocalDate.now()
        return if (today.dayOfWeek == DayOfWeek.MONDAY) {
            today
        } else {
            today.with(TemporalAdjusters.next(DayOfWeek.MONDAY))
        }
    }
}
