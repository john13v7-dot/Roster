package com.creche.roster.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.creche.roster.app.data.AppState
import com.creche.roster.app.pdf.PdfExporter
import com.creche.roster.app.ui.shareFile
import com.creche.roster.engine.CellStyle
import com.creche.roster.engine.COL_WIDTHS_CHARS
import com.creche.roster.engine.GridRow
import com.creche.roster.engine.Roster
import com.creche.roster.engine.STYLES
import com.creche.roster.engine.weekGrid
import java.io.File

private val CHAR_WIDTH = 7.dp
private val ROW_UNIT_HEIGHT = 30.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RosterScreen() {
    val context = LocalContext.current
    val roster = AppState.roster.value
    val problems = AppState.buildProblems.value
    var weekIndex by remember { mutableStateOf(0) }

    Column(modifier = Modifier.fillMaxSize().padding(12.dp)) {
        Row {
            Button(onClick = { AppState.rebuild() }) { Text("Rebuild roster") }
            Spacer(Modifier.width(8.dp))
            if (roster != null) {
                Button(onClick = {
                    val file = File(File(context.cacheDir, "pdf"), "Roster.pdf")
                    PdfExporter.export(roster, file)
                    shareFile(context, file)
                }) { Text("Share PDF") }
            }
        }
        Spacer(Modifier.height(8.dp))

        if (problems.isNotEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                Column(Modifier.padding(12.dp)) {
                    Text("Fix these before the roster can be built:", fontWeight = FontWeight.Bold)
                    problems.forEach { Text("• $it") }
                }
            }
        }

        if (roster != null) {
            val safeIndex = weekIndex.coerceIn(0, roster.weeks.lastIndex)
            ScrollableTabRow(selectedTabIndex = safeIndex) {
                roster.weeks.forEachIndexed { i, _ ->
                    Tab(
                        selected = safeIndex == i,
                        onClick = { weekIndex = i },
                        text = { Text("Week ${i + 1}") },
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            if (roster.breaches.isNotEmpty()) {
                Text(
                    "${roster.breaches.size} hard-rule breach(es) this roster — see Checks.",
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            WeekGridView(roster, safeIndex, modifier = Modifier.weight(1f))
        } else if (problems.isEmpty()) {
            Text("No roster yet. Tap \"Rebuild roster\".")
        }
    }
}

@Composable
private fun WeekGridView(roster: Roster, wi: Int, modifier: Modifier = Modifier) {
    val rows = remember(roster, wi) { weekGrid(roster, wi) }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .verticalScroll(rememberScrollState()),
    ) {
        Column {
            rows.forEach { row -> GridRowView(row) }
        }
    }
}

@Composable
private fun GridRowView(row: GridRow) {
    if (row.merged) {
        val lc = row.cells[0]
        val style = STYLES.getValue(lc.style)
        val totalWidth = COL_WIDTHS_CHARS.sum() * CHAR_WIDTH.value
        CellBox(lc.text, style, width = totalWidth.dp, height = (ROW_UNIT_HEIGHT.value * row.height).dp)
    } else {
        Row {
            row.cells.forEachIndexed { i, lc ->
                val style = STYLES.getValue(lc.style)
                val w = (COL_WIDTHS_CHARS.getOrElse(i) { 10 } * CHAR_WIDTH.value).dp
                CellBox(lc.text, style, width = w, height = (ROW_UNIT_HEIGHT.value * row.height).dp)
            }
        }
    }
}

@Composable
private fun CellBox(text: String, style: CellStyle, width: Dp, height: Dp) {
    val bg = style.fill?.let { hexColor(it) } ?: Color.Transparent
    val fg = hexColor(style.color)
    Box(
        modifier = Modifier
            .width(width)
            .height(height)
            .background(bg)
            .then(if (style.border) Modifier.border(0.5.dp, Color.Gray) else Modifier)
            .padding(horizontal = 3.dp, vertical = 2.dp),
        contentAlignment = if (style.align == "left") Alignment.CenterStart else Alignment.Center,
    ) {
        Text(
            text = text,
            color = fg,
            fontWeight = if (style.bold) FontWeight.Bold else FontWeight.Normal,
            fontStyle = if (style.italic) FontStyle.Italic else FontStyle.Normal,
            fontSize = style.size.sp,
            textAlign = if (style.align == "left") TextAlign.Start else TextAlign.Center,
            maxLines = 4,
        )
    }
}

private fun hexColor(hex: String): Color {
    val clean = hex.removePrefix("#")
    val r = clean.substring(0, 2).toInt(16)
    val g = clean.substring(2, 4).toInt(16)
    val b = clean.substring(4, 6).toInt(16)
    return Color(r, g, b)
}
