package com.creche.roster.app.ui.screens

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.creche.roster.engine.parseDate
import com.creche.roster.engine.parseTime
import java.time.LocalDate
import java.time.LocalTime

@Composable
fun LabeledTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    isError: Boolean = false,
    supportingText: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = singleLine,
        isError = isError,
        supportingText = supportingText?.let { { Text(it) } },
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp),
    )
}

/** A text field for a date, typed as dd/MM/yyyy, validated with the engine's own parser. */
@Composable
fun DateField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    allowBlank: Boolean = false,
) {
    val valid = (allowBlank && value.isBlank()) || runCatching { parseDate(value) }.isSuccess
    LabeledTextField(
        label = label,
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        isError = !valid,
        supportingText = if (!valid) "Use dd/mm/yyyy" else null,
    )
}

/** A text field for a start time, e.g. 07:30, validated with the engine's own parser. */
@Composable
fun TimeField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val valid = runCatching { parseTime(value) }.isSuccess
    LabeledTextField(
        label = label,
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        isError = !valid,
        supportingText = if (!valid) "Use hh:mm" else null,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DropdownField(
    label: String,
    options: List<String>,
    selected: String,
    onSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) {
        OutlinedTextField(
            value = selected,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.menuAnchor().fillMaxWidth(),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    onClick = {
                        onSelected(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

fun fmtTime(t: LocalTime): String = "%02d:%02d".format(t.hour, t.minute)
fun fmtDateField(d: LocalDate): String = "%02d/%02d/%04d".format(d.dayOfMonth, d.monthValue, d.year)
