package com.creche.roster.app.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.creche.roster.app.data.AppState
import com.creche.roster.engine.SLOTS
import com.creche.roster.engine.SLOT_LABELS
import com.creche.roster.engine.Shift
import com.creche.roster.engine.parseDate
import com.creche.roster.engine.parseTime

@Composable
fun SettingsScreen() {
    val inputs = AppState.inputs.value ?: return
    val s = inputs.settings

    var title by remember(s) { mutableStateOf(s.title) }
    var rosterStart by remember(s) { mutableStateOf(fmtDateField(s.rosterStart)) }
    var weeks by remember(s) { mutableStateOf(s.weeks.toString()) }
    var breakText by remember(s) { mutableStateOf(s.breakText) }
    var dayHeaders by remember(s) { mutableStateOf(s.dayHeaders) }
    var shiftTimes by remember(s) {
        mutableStateOf(SLOTS.associateWith { sl -> fmtTime(s.shifts.getValue(sl).start) to fmtTime(s.shifts.getValue(sl).end) })
    }
    var minOpen by remember(s) { mutableStateOf(s.floors.associateWith { f -> (s.minOpen[f] ?: 0).toString() }) }
    var minClose by remember(s) { mutableStateOf(s.floors.associateWith { f -> (s.minClose[f] ?: 0).toString() }) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        LabeledTextField("Title", title, { title = it })
        DateField("First Monday", rosterStart, { rosterStart = it })
        LabeledTextField("Weeks (1-12)", weeks, { weeks = it })
        LabeledTextField("Break text", breakText, { breakText = it })
        Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(checked = dayHeaders, onCheckedChange = { dayHeaders = it })
            Spacer(Modifier.width(8.dp))
            Text("Show Mon..Fri day headings")
        }

        Text("Shift times", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
        for (sl in SLOTS) {
            Row {
                TimeField(
                    "${SLOT_LABELS.getValue(sl)} start",
                    shiftTimes.getValue(sl).first,
                    { v -> shiftTimes = shiftTimes + (sl to (v to shiftTimes.getValue(sl).second)) },
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                TimeField(
                    "${SLOT_LABELS.getValue(sl)} end",
                    shiftTimes.getValue(sl).second,
                    { v -> shiftTimes = shiftTimes + (sl to (shiftTimes.getValue(sl).first to v)) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Text("Minimum cover", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
        for (f in s.floors) {
            Row {
                LabeledTextField(
                    "$f — min opening",
                    minOpen.getValue(f),
                    { v -> minOpen = minOpen + (f to v) },
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                LabeledTextField(
                    "$f — min closing",
                    minClose.getValue(f),
                    { v -> minClose = minClose + (f to v) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        val startOk = runCatching { parseDate(rosterStart) }.isSuccess
        val weeksOk = weeks.toIntOrNull()?.let { it in 1..12 } == true
        val shiftsOk = SLOTS.all { sl ->
            runCatching { parseTime(shiftTimes.getValue(sl).first) }.isSuccess &&
                runCatching { parseTime(shiftTimes.getValue(sl).second) }.isSuccess
        }
        val coverOk = s.floors.all { f -> minOpen.getValue(f).toIntOrNull() != null && minClose.getValue(f).toIntOrNull() != null }
        val canSave = title.isNotEmpty() && startOk && weeksOk && shiftsOk && coverOk

        Button(
            onClick = {
                val newShifts = SLOTS.associateWith { sl ->
                    val (a, b) = shiftTimes.getValue(sl)
                    Shift(parseTime(a), parseTime(b))
                }
                val newSettings = s.copy(
                    title = title,
                    rosterStart = parseDate(rosterStart),
                    weeks = weeks.toInt(),
                    breakText = breakText,
                    dayHeaders = dayHeaders,
                    shifts = newShifts,
                    minOpen = s.floors.associateWith { minOpen.getValue(it).toInt() },
                    minClose = s.floors.associateWith { minClose.getValue(it).toInt() },
                )
                AppState.update { it.copy(settings = newSettings) }
            },
            enabled = canSave,
        ) { Text("Save settings") }

        if (!canSave) {
            Text(
                "Fix the highlighted fields above before saving.",
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}
