package com.creche.roster.app.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.creche.roster.app.data.AppState
import com.creche.roster.engine.SLOTS
import com.creche.roster.engine.SLOT_LABELS

@Composable
fun TotalsScreen() {
    val roster = AppState.roster.value
    if (roster == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No roster built yet.")
        }
        return
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text("Days on each start time in this roster", style = MaterialTheme.typography.titleMedium)
        Text(
            "Working days only. Leave is not counted.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        TotalsTable(roster.periodCounts, roster.staffKeys.map { it.second.name }, showLastSlot = false, lastSlot = emptyMap())

        Text(
            "Running totals (history + this roster)",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 24.dp),
        )
        Text(
            "This becomes the History for your next roster, so rotation stays fair.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        TotalsTable(roster.cumulativeCounts, roster.staffKeys.map { it.second.name }, showLastSlot = true, lastSlot = roster.lastSlot)
    }
}

@Composable
private fun TotalsTable(
    data: Map<String, Map<String, Int>>,
    order: List<String>,
    showLastSlot: Boolean,
    lastSlot: Map<String, String>,
) {
    val names = order.filter { it in data }
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth()) {
            Text("Name", Modifier.weight(2f), fontWeight = FontWeight.Bold)
            for (sl in SLOTS) {
                Text(SLOT_LABELS.getValue(sl), Modifier.weight(1f), fontWeight = FontWeight.Bold)
            }
            if (showLastSlot) Text("Last", Modifier.weight(1f), fontWeight = FontWeight.Bold)
        }
        HorizontalDivider(Modifier.padding(vertical = 4.dp))
        for (name in names) {
            val counts = data.getValue(name)
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                Text(name, Modifier.weight(2f))
                for (sl in SLOTS) {
                    Text((counts[sl] ?: 0).toString(), Modifier.weight(1f))
                }
                if (showLastSlot) {
                    Text(lastSlot[name]?.let { SLOT_LABELS.getValue(it) } ?: "", Modifier.weight(1f))
                }
            }
        }
    }
}
