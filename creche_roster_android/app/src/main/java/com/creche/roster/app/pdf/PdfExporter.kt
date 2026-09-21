/**
 * Renders the same [com.creche.roster.engine.weekGrid] the roster screen
 * shows into a multi-page PDF (one portrait page per week), using Android's
 * built-in PdfDocument so no extra dependency is needed.
 */
package com.creche.roster.app.pdf

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.pdf.PdfDocument
import com.creche.roster.engine.CellStyle
import com.creche.roster.engine.COL_WIDTHS_CHARS
import com.creche.roster.engine.Roster
import com.creche.roster.engine.STYLES
import com.creche.roster.engine.weekGrid
import java.io.File
import java.io.FileOutputStream

// A4 at 72dpi points, matching the Python tool's reportlab output.
private const val PAGE_WIDTH = 595
private const val PAGE_HEIGHT = 842
private const val MARGIN = 30f
private const val BASE_ROW = 20f

object PdfExporter {
    fun export(roster: Roster, outFile: File) {
        val doc = PdfDocument()
        for (wi in roster.weeks.indices) {
            val page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, wi + 1).create())
            drawWeek(page.canvas, roster, wi)
            doc.finishPage(page)
        }
        outFile.parentFile?.mkdirs()
        FileOutputStream(outFile).use { doc.writeTo(it) }
        doc.close()
    }

    private fun drawWeek(canvas: Canvas, roster: Roster, wi: Int) {
        val rows = weekGrid(roster, wi)
        val availW = PAGE_WIDTH - 2 * MARGIN
        val availH = PAGE_HEIGHT - 2 * MARGIN
        val totalUnits = rows.sumOf { it.height }
        val scale = minOf(1.0, availH / (BASE_ROW * totalUnits) * 0.97).toFloat()
        val totalChars = COL_WIDTHS_CHARS.sum()
        val colUnit = availW / totalChars
        val colWidths = COL_WIDTHS_CHARS.map { it * colUnit }

        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            color = Color.parseColor("#808080")
            strokeWidth = 0.75f
        }
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG)

        var y = MARGIN
        for (row in rows) {
            val rowH = BASE_ROW * row.height.toFloat() * scale
            if (row.merged) {
                val lc = row.cells[0]
                val style = STYLES.getValue(lc.style)
                val rect = RectF(MARGIN, y, MARGIN + availW, y + rowH)
                drawCell(canvas, rect, lc.text, style, fillPaint, borderPaint, textPaint)
            } else {
                var x = MARGIN
                row.cells.forEachIndexed { i, lc ->
                    val w = colWidths.getOrElse(i) { 0f }
                    val style = STYLES.getValue(lc.style)
                    val rect = RectF(x, y, x + w, y + rowH)
                    drawCell(canvas, rect, lc.text, style, fillPaint, borderPaint, textPaint)
                    x += w
                }
            }
            y += rowH
        }
    }

    private fun drawCell(
        canvas: Canvas,
        rect: RectF,
        text: String,
        style: CellStyle,
        fillPaint: Paint,
        borderPaint: Paint,
        textPaint: Paint,
    ) {
        if (style.fill != null) {
            fillPaint.color = Color.parseColor("#${style.fill}")
            canvas.drawRect(rect, fillPaint)
        }
        if (style.border) {
            canvas.drawRect(rect, borderPaint)
        }
        if (text.isNotEmpty()) {
            textPaint.color = Color.parseColor("#${style.color}")
            textPaint.isFakeBoldText = style.bold
            textPaint.textSkewX = if (style.italic) -0.25f else 0f
            textPaint.textSize = style.size.toFloat() * 0.9f
            textPaint.textAlign = if (style.align == "left") Paint.Align.LEFT else Paint.Align.CENTER
            val fm = textPaint.fontMetrics
            val textY = rect.centerY() - (fm.ascent + fm.descent) / 2f
            val textX = if (style.align == "left") rect.left + 3f else rect.centerX()
            canvas.drawText(text, textX, textY, textPaint)
        }
    }
}
