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
import com.creche.roster.engine.DAY_NAMES
import com.creche.roster.engine.NDAYS
import com.creche.roster.engine.ROLES
import com.creche.roster.engine.SLOTS
import com.creche.roster.engine.SLOT_LABELS
import com.creche.roster.engine.Staff

@Composable
fun StaffScreen() {
    val inputs = AppState.inputs.value ?: return
    var editIndex by remember { mutableStateOf<Int?>(null) } // null = list, -1 = new, >=0 = edit existing index
    var draft by remember { mutableStateOf<Staff?>(null) }

    val idx = editIndex
    if (idx == null) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f).padding(8.dp)) {
                itemsIndexed(inputs.staff) { i, st ->
                    StaffRow(
                        st,
                        onClick = {
                            draft = st.copy(hours = st.hours.toMutableList())
                            editIndex = i
                        },
                    )
                }
            }
            Button(
                onClick = {
                    draft = Staff(name = "", floor = inputs.settings.floors.firstOrNull() ?: "All", role = "rotating")
                    editIndex = -1
                },
                modifier = Modifier.padding(16.dp).fillMaxWidth(),
            ) { Text("Add staff") }
        }
    } else {
        val d = draft ?: return
        StaffEditor(
            staff = d,
            floors = inputs.settings.floors,
            onChange = { draft = it },
            onSave = {
                AppState.update { inp ->
                    val list = inp.staff.toMutableList()
                    if (idx == -1) list.add(d) else list[idx] = d
                    inp.copy(staff = list)
                }
                editIndex = null
            },
            onDelete = if (idx != -1) {
                {
                    AppState.update { inp ->
                        val list = inp.staff.toMutableList()
                        list.removeAt(idx)
                        inp.copy(staff = list)
                    }
                    editIndex = null
                }
            } else {
                null
            },
            onCancel = { editIndex = null },
        )
    }
}

@Composable
private fun StaffRow(st: Staff, onClick: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), onClick = onClick) {
        Column(Modifier.padding(12.dp)) {
            Text(
                st.name.ifEmpty { "(${st.role})" },
                fontWeight = FontWeight.Bold,
            )
            Text("${st.role} · ${st.floor}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun StaffEditor(
    staff: Staff,
    floors: List<String>,
    onChange: (Staff) -> Unit,
    onSave: () -> Unit,
    onDelete: (() -> Unit)?,
    onCancel: () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        if (staff.role != "vacant" && staff.role != "blank") {
            LabeledTextField("Name", staff.name, { onChange(staff.copy(name = it)) })
        }
        DropdownField("Role", ROLES, staff.role, {
            onChange(
                staff.copy(
                    role = it,
                    fixedSlot = if (it == "fixed") (staff.fixedSlot ?: "early") else null,
                ),
            )
        })
        if (staff.role != "static" && staff.role != "vacant" && staff.role != "blank") {
            DropdownField("Floor", floors, staff.floor, { onChange(staff.copy(floor = it)) })
        }

        when (staff.role) {
            "fixed" -> {
                DropdownField(
                    "Fixed start time",
                    SLOTS.map { SLOT_LABELS.getValue(it) },
                    SLOT_LABELS.getValue(staff.fixedSlot ?: "early"),
                    { label ->
                        val key = SLOTS.first { SLOT_LABELS.getValue(it) == label }
                        onChange(staff.copy(fixedSlot = key, note = key))
                    },
                )
            }
            "static", "vacant" -> {
                LabeledTextField(
                    "Default hours (e.g. 8:30 - 1:30, or OFF)",
                    staff.note,
                    { onChange(staff.copy(note = it)) },
                )
                Text("Per-day override (leave blank to use the default above):", style = MaterialTheme.typography.bodySmall)
                for (i in 0 until NDAYS) {
                    LabeledTextField(
                        DAY_NAMES[i],
                        staff.hours.getOrElse(i) { "" },
                        { v ->
                            val h = staff.hours.toMutableList()
                            while (h.size < NDAYS) h.add("")
                            h[i] = v
                            onChange(staff.copy(hours = h))
                        },
                    )
                }
            }
            else -> {}
        }

        LabeledTextField(
            "Print no. (blank = automatic, - = none)",
            staff.number,
            { onChange(staff.copy(number = it)) },
        )

        Spacer(Modifier.height(16.dp))
        Row {
            Button(onClick = onSave) { Text("Save") }
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = onCancel) { Text("Cancel") }
            Spacer(Modifier.width(8.dp))
            if (onDelete != null) {
                TextButton(onClick = onDelete) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}
