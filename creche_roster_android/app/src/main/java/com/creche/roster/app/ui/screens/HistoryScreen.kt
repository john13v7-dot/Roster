package com.creche.roster.app.ui.screens

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.creche.roster.app.data.AppState
import com.creche.roster.engine.SLOTS
import com.creche.roster.engine.SLOT_LABELS

@Composable
fun HistoryScreen() {
    val inputs = AppState.inputs.value ?: return
    val people = inputs.staff.filter { it.role == "rotating" || it.role == "fixed" || it.role == "paired" }.map { it.name }
    var editingName by remember { mutableStateOf<String?>(null) }
    var draftCounts by remember { mutableStateOf(SLOTS.associateWith { "0" }) }
    var draftLastSlot by remember { mutableStateOf<String?>(null) }

    val editing = editingName
    if (editing == null) {
        Column(Modifier.fillMaxSize()) {
            Text(
                "Days each person has already worked on each start time, so rotation stays fair between runs.",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(12.dp),
            )
            LazyColumn(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                items(people) { name ->
                    val counts = inputs.history[name] ?: emptyMap()
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        onClick = {
                            draftCounts = SLOTS.associateWith { (counts[it] ?: 0).toString() }
                            draftLastSlot = inputs.lastSlot[name]
                            editingName = name
                        },
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Text(name, fontWeight = FontWeight.Bold)
                            Text(
                                SLOTS.joinToString("  ") { sl -> "${SLOT_LABELS.getValue(sl)}: ${counts[sl] ?: 0}" },
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
        }
    } else {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text(editing, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            for (sl in SLOTS) {
                LabeledTextField(
                    "${SLOT_LABELS.getValue(sl)} days",
                    draftCounts.getValue(sl),
                    { v -> draftCounts = draftCounts + (sl to v) },
                )
            }
            DropdownField(
                "Last slot worked",
                listOf("(none)") + SLOTS.map { SLOT_LABELS.getValue(it) },
                draftLastSlot?.let { SLOT_LABELS.getValue(it) } ?: "(none)",
                { label -> draftLastSlot = if (label == "(none)") null else SLOTS.first { SLOT_LABELS.getValue(it) == label } },
            )

            val canSave = SLOTS.all { draftCounts.getValue(it).toIntOrNull() != null }
            Spacer(Modifier.height(16.dp))
            Row {
                Button(
                    onClick = {
                        val counts = SLOTS.associateWith { draftCounts.getValue(it).toInt() }
                        AppState.update { inp ->
                            val hist = inp.history.toMutableMap()
                            hist[editing] = counts
                            val ls = inp.lastSlot.toMutableMap()
                            val chosen = draftLastSlot
                            if (chosen != null) ls[editing] = chosen else ls.remove(editing)
                            inp.copy(history = hist, lastSlot = ls)
                        }
                        editingName = null
                    },
                    enabled = canSave,
                ) { Text("Save") }
                Spacer(Modifier.width(8.dp))
                OutlinedButton(onClick = { editingName = null }) { Text("Cancel") }
            }
        }
    }
}
