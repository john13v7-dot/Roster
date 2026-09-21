package com.creche.roster.app.ui.screens

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.creche.roster.app.data.AppState
import com.creche.roster.engine.Override
import com.creche.roster.engine.SLOTS
import com.creche.roster.engine.SLOT_LABELS
import com.creche.roster.engine.parseDate

@Composable
fun OverridesScreen() {
    val inputs = AppState.inputs.value ?: return
    val staff = inputs.staff.filter { it.role != "vacant" && it.role != "blank" && it.name.isNotEmpty() }
    val staffNames = staff.map { it.name }
    var editIndex by remember { mutableStateOf<Int?>(null) }
    var draftName by remember { mutableStateOf("") }
    var draftStart by remember { mutableStateOf("") }
    var draftEnd by remember { mutableStateOf("") }
    var draftSlot by remember { mutableStateOf(SLOTS.first()) }
    var draftText by remember { mutableStateOf("") }

    val idx = editIndex
    if (idx == null) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f).padding(8.dp)) {
                itemsIndexed(inputs.overrides) { i, ov ->
                    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), onClick = {
                        draftName = ov.name
                        draftStart = fmtDateField(ov.start)
                        draftEnd = ov.end?.let { fmtDateField(it) } ?: ""
                        draftSlot = ov.slot ?: SLOTS.first()
                        draftText = ov.text
                        editIndex = i
                    }) {
                        Column(Modifier.padding(12.dp)) {
                            val what = ov.slot?.let { SLOT_LABELS.getValue(it) } ?: ov.text
                            Text("${ov.name} — $what", fontWeight = FontWeight.Bold)
                            Text(
                                "${fmtDateField(ov.start)} to ${ov.end?.let { fmtDateField(it) } ?: "(until back)"}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
            Button(
                onClick = {
                    draftName = staffNames.firstOrNull() ?: ""
                    draftStart = ""
                    draftEnd = ""
                    draftSlot = SLOTS.first()
                    draftText = ""
                    editIndex = -1
                },
                modifier = Modifier.padding(16.dp).fillMaxWidth(),
            ) { Text("Add override") }
        }
    } else {
        val isStatic = staff.firstOrNull { it.name == draftName }?.role == "static"
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            DropdownField("Name", staffNames, draftName, { draftName = it })
            DateField("From", draftStart, { draftStart = it })
            DateField("To (blank = until back)", draftEnd, { draftEnd = it }, allowBlank = true)
            if (isStatic) {
                LabeledTextField("Hours (e.g. 10:00 - 2:00) or OFF", draftText, { draftText = it })
            } else {
                DropdownField(
                    "Start time",
                    SLOTS.map { SLOT_LABELS.getValue(it) },
                    SLOT_LABELS.getValue(draftSlot),
                    { label -> draftSlot = SLOTS.first { SLOT_LABELS.getValue(it) == label } },
                )
            }

            val startOk = runCatching { parseDate(draftStart) }.isSuccess
            val endOk = draftEnd.isBlank() || runCatching { parseDate(draftEnd) }.isSuccess
            val canSave = draftName.isNotEmpty() && startOk && endOk && (!isStatic || draftText.isNotEmpty())

            Spacer(Modifier.height(16.dp))
            Row {
                Button(onClick = {
                    val ov = Override(
                        name = draftName,
                        start = parseDate(draftStart),
                        end = draftEnd.ifBlank { null }?.let { parseDate(it) },
                        slot = if (isStatic) null else draftSlot,
                        text = if (isStatic) draftText else "",
                    )
                    AppState.update { inp ->
                        val list = inp.overrides.toMutableList()
                        if (idx == -1) list.add(ov) else list[idx] = ov
                        inp.copy(overrides = list)
                    }
                    editIndex = null
                }, enabled = canSave) { Text("Save") }
                Spacer(Modifier.width(8.dp))
                OutlinedButton(onClick = { editIndex = null }) { Text("Cancel") }
                Spacer(Modifier.width(8.dp))
                if (idx != -1) {
                    TextButton(onClick = {
                        AppState.update { inp ->
                            val list = inp.overrides.toMutableList()
                            list.removeAt(idx)
                            inp.copy(overrides = list)
                        }
                        editIndex = null
                    }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }
}
