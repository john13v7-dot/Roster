package com.creche.roster.app.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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

/** A floor being edited. [id] is a stable identity, independent of the (editable) [name],
 * so a rename in progress doesn't lose track of which floor's min-cover fields belong to it. */
private data class FloorRow(val id: Int, val name: String)

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

    // Floors keep a stable id (their original index) so renaming one while
    // typing doesn't have to juggle moving its min-cover fields to a new map key.
    var floorRows by remember(s) { mutableStateOf(s.floors.mapIndexed { i, f -> FloorRow(i, f) }) }
    var nextFloorId by remember(s) { mutableStateOf(s.floors.size) }
    var minOpenById by remember(s) {
        mutableStateOf(s.floors.mapIndexed { i, f -> i to (s.minOpen[f] ?: 0).toString() }.toMap())
    }
    var minCloseById by remember(s) {
        mutableStateOf(s.floors.mapIndexed { i, f -> i to (s.minClose[f] ?: 0).toString() }.toMap())
    }
    // Which original floor name each id started as (for renamed/removed floors, so staff
    // can be moved onto the right new floor on Save). Ids added this session aren't in here.
    val originalNameById = remember(s) { s.floors.mapIndexed { i, f -> i to f }.toMap() }

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

        Text("Floors", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
        Text(
            "Each floor has its own minimum opening and closing cover. Renaming a floor moves its " +
                "staff with it; removing one moves its staff onto the first remaining floor.",
            style = MaterialTheme.typography.bodySmall,
        )
        val floorNames = floorRows.map { it.name }
        val duplicateNames = floorNames.filter { it.isNotBlank() }.groupingBy { it }.eachCount().filterValues { it > 1 }.keys

        for (row in floorRows) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LabeledTextField(
                            "Floor name",
                            row.name,
                            { v -> floorRows = floorRows.map { if (it.id == row.id) it.copy(name = v) else it } },
                            modifier = Modifier.weight(1f),
                            isError = row.name.isBlank() || row.name in duplicateNames,
                            supportingText = when {
                                row.name.isBlank() -> "Can't be blank"
                                row.name in duplicateNames -> "Another floor already has this name"
                                else -> null
                            },
                        )
                        IconButton(
                            onClick = {
                                floorRows = floorRows.filter { it.id != row.id }
                                minOpenById = minOpenById - row.id
                                minCloseById = minCloseById - row.id
                            },
                            enabled = floorRows.size > 1,
                        ) {
                            Icon(Icons.Filled.Delete, contentDescription = "Remove floor")
                        }
                    }
                    Row {
                        LabeledTextField(
                            "Min opening",
                            minOpenById[row.id] ?: "0",
                            { v -> minOpenById = minOpenById + (row.id to v) },
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        LabeledTextField(
                            "Min closing",
                            minCloseById[row.id] ?: "0",
                            { v -> minCloseById = minCloseById + (row.id to v) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
        OutlinedButton(
            onClick = {
                val id = nextFloorId
                nextFloorId += 1
                floorRows = floorRows + FloorRow(id, "")
                minOpenById = minOpenById + (id to "0")
                minCloseById = minCloseById + (id to "0")
            },
            modifier = Modifier.padding(top = 4.dp),
        ) { Text("Add floor") }

        Spacer(Modifier.height(16.dp))
        val startOk = runCatching { parseDate(rosterStart) }.isSuccess
        val weeksOk = weeks.toIntOrNull()?.let { it in 1..12 } == true
        val shiftsOk = SLOTS.all { sl ->
            runCatching { parseTime(shiftTimes.getValue(sl).first) }.isSuccess &&
                runCatching { parseTime(shiftTimes.getValue(sl).second) }.isSuccess
        }
        val floorsOk = floorRows.isNotEmpty() && floorRows.all { it.name.isNotBlank() } && duplicateNames.isEmpty()
        val coverOk = floorRows.all { row ->
            minOpenById[row.id]?.toIntOrNull() != null && minCloseById[row.id]?.toIntOrNull() != null
        }
        val canSave = title.isNotEmpty() && startOk && weeksOk && shiftsOk && floorsOk && coverOk

        Button(
            onClick = {
                val newShifts = SLOTS.associateWith { sl ->
                    val (a, b) = shiftTimes.getValue(sl)
                    Shift(parseTime(a), parseTime(b))
                }
                val newFloors = floorRows.map { it.name }
                val fallbackFloor = newFloors.first()
                // Old floor name -> new floor name, so staff follow a rename and land
                // somewhere sensible if their floor was removed.
                val floorNameMap: Map<String, String> = originalNameById.entries.associate { (id, oldName) ->
                    oldName to (floorRows.firstOrNull { it.id == id }?.name ?: fallbackFloor)
                }
                val newStaff = inputs.staff.map { st ->
                    val mapped = floorNameMap[st.floor]
                    if (mapped != null && mapped != st.floor) st.copy(floor = mapped) else st
                }
                val newSettings = s.copy(
                    title = title,
                    rosterStart = parseDate(rosterStart),
                    weeks = weeks.toInt(),
                    breakText = breakText,
                    dayHeaders = dayHeaders,
                    shifts = newShifts,
                    floors = newFloors,
                    minOpen = floorRows.associate { it.name to (minOpenById.getValue(it.id).toInt()) },
                    minClose = floorRows.associate { it.name to (minCloseById.getValue(it.id).toInt()) },
                )
                AppState.update { it.copy(settings = newSettings, staff = newStaff) }
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
