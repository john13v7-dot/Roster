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
import com.creche.roster.engine.Leave
import com.creche.roster.engine.parseDate

@Composable
fun LeaveScreen() {
    val inputs = AppState.inputs.value ?: return
    val staffNames = inputs.staff.filter { it.role != "vacant" && it.role != "blank" && it.name.isNotEmpty() }.map { it.name }
    var editIndex by remember { mutableStateOf<Int?>(null) }
    var draftName by remember { mutableStateOf("") }
    var draftStart by remember { mutableStateOf("") }
    var draftEnd by remember { mutableStateOf("") }
    var draftKind by remember { mutableStateOf("Holiday") }

    val idx = editIndex
    if (idx == null) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f).padding(8.dp)) {
                itemsIndexed(inputs.leave) { i, lv ->
                    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), onClick = {
                        draftName = lv.name
                        draftStart = fmtDateField(lv.start)
                        draftEnd = lv.end?.let { fmtDateField(it) } ?: ""
                        draftKind = lv.kind
                        editIndex = i
                    }) {
                        Column(Modifier.padding(12.dp)) {
                            Text("${lv.name} — ${lv.kind}", fontWeight = FontWeight.Bold)
                            Text(
                                "${fmtDateField(lv.start)} to ${lv.end?.let { fmtDateField(it) } ?: "(until back)"}",
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
                    draftKind = "Holiday"
                    editIndex = -1
                },
                modifier = Modifier.padding(16.dp).fillMaxWidth(),
            ) { Text("Add leave") }
        }
    } else {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            DropdownField("Name", staffNames, draftName, { draftName = it })
            DateField("From", draftStart, { draftStart = it })
            DateField("To (blank = until back)", draftEnd, { draftEnd = it }, allowBlank = true)
            LabeledTextField("Type (Holiday, Sick, Maternity Leave, OFF, ...)", draftKind, { draftKind = it })

            val startOk = runCatching { parseDate(draftStart) }.isSuccess
            val endOk = draftEnd.isBlank() || runCatching { parseDate(draftEnd) }.isSuccess
            val canSave = draftName.isNotEmpty() && startOk && endOk

            Spacer(Modifier.height(16.dp))
            Row {
                Button(onClick = {
                    val lv = Leave(draftName, parseDate(draftStart), draftEnd.ifBlank { null }?.let { parseDate(it) }, draftKind)
                    AppState.update { inp ->
                        val list = inp.leave.toMutableList()
                        if (idx == -1) list.add(lv) else list[idx] = lv
                        inp.copy(leave = list)
                    }
                    editIndex = null
                }, enabled = canSave) { Text("Save") }
                Spacer(Modifier.width(8.dp))
                OutlinedButton(onClick = { editIndex = null }) { Text("Cancel") }
                Spacer(Modifier.width(8.dp))
                if (idx != -1) {
                    TextButton(onClick = {
                        AppState.update { inp ->
                            val list = inp.leave.toMutableList()
                            list.removeAt(idx)
                            inp.copy(leave = list)
                        }
                        editIndex = null
                    }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }
}
