package com.creche.roster.app.ui.screens

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.creche.roster.app.data.AppState
import com.creche.roster.engine.Check
import com.creche.roster.engine.fmtDay

@Composable
fun ChecksScreen() {
    val roster = AppState.roster.value
    val problems = AppState.buildProblems.value

    if (roster == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(if (problems.isNotEmpty()) "Fix the input problems on the other screens first." else "No roster built yet.")
        }
        return
    }

    val order = mapOf("BREACH" to 0, "WARNING" to 1, "INFO" to 2)
    val items = roster.checks.sortedWith(
        compareBy({ order.getValue(it.level) }, { it.week ?: 0 }, { it.day?.toEpochDay() ?: Long.MIN_VALUE }),
    )

    Column(Modifier.fillMaxSize()) {
        val breachCount = roster.breaches.size
        Text(
            if (breachCount == 0) {
                "Hard-rule breaches: 0. Every opening, closing and pairing rule is met."
            } else {
                "Hard-rule breaches: $breachCount. See the red cards below."
            },
            fontWeight = FontWeight.Bold,
            color = if (breachCount == 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(12.dp),
        )
        if (items.isEmpty()) {
            Text("Nothing to report.", modifier = Modifier.padding(12.dp))
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 8.dp)) {
                items(items) { c -> CheckCard(c) }
            }
        }
    }
}

@Composable
private fun CheckCard(c: Check) {
    val container = when (c.level) {
        "BREACH" -> MaterialTheme.colorScheme.errorContainer
        "WARNING" -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    Card(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = container),
    ) {
        Column(Modifier.padding(12.dp)) {
            val parts = mutableListOf(c.level, c.rule)
            c.week?.let { parts.add("Week ${it + 1}") }
            c.day?.let { parts.add(fmtDay(it)) }
            Text(parts.joinToString(" · "), fontWeight = FontWeight.Bold)
            Text(c.message)
        }
    }
}
