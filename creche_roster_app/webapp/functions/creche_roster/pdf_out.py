"""PDF output: one portrait A4 page per week, rendered from layout.week_grid."""

from __future__ import annotations

from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Table, TableStyle

from .layout import (
    COL_WIDTHS_CHARS,
    DUTY_COL_WIDTHS_CHARS,
    DUTY_NCOLS,
    NCOLS,
    STYLES,
    WEEKLY_SUMMARY_NOTE,
    date_range_text,
    duties_grid,
    ordinal_runs,
    week_grid,
    weekly_summary_rows,
)
from .models import Inputs, Roster

MARGIN = 30
BASE_ROW = 20.0
BODY_SCALE = 0.9  # PDF body text a little smaller than Excel so "Maternity Leave" fits a day column
GRID = colors.HexColor("#808080")


def _font_name(spec) -> str:
    # Every PDF page is printed bold throughout, regardless of a style's own
    # `bold` flag - Excel (which shares STYLES with these PDFs) keeps its
    # normal/bold distinction; only the printed page goes all-bold.
    if spec.get("serif"):
        return "Times-Bold"
    return "Helvetica-BoldOblique" if spec["italic"] else "Helvetica-Bold"


def _hex(h: str):
    return colors.HexColor("#" + h)


def _size(spec) -> float:
    return spec["size"] if spec["size"] >= 12 or not spec["border"] else spec["size"] * BODY_SCALE


def _markup(lc) -> str:
    if lc.style == "subtitle":
        return "".join(
            f"<super>{escape(t)}</super>" if raised else escape(t) for t, raised in ordinal_runs(lc.text)
        )
    return escape(lc.text)


def _week_table(roster: Roster, wi: int, avail_w: float, avail_h: float) -> Table:
    rows = week_grid(roster, wi)
    total = sum(BASE_ROW * r.height for r in rows)
    scale = min(1.0, avail_h / total * 0.97)
    heights = [BASE_ROW * r.height * scale for r in rows]

    data = []
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]
    for ri, row in enumerate(rows):
        if row.merged:
            lc = row.cells[0]
            spec = STYLES[lc.style]
            size = _size(spec)
            para = ParagraphStyle(
                "p",
                fontName=_font_name(spec),
                fontSize=size,
                leading=size + 2,
                textColor=_hex(spec["color"]),
                alignment={"left": 0, "center": 1}[spec["align"]],
            )
            data.append([Paragraph(_markup(lc), para)] + [""] * (NCOLS - 1))
            cmds.append(("SPAN", (0, ri), (NCOLS - 1, ri)))
            if spec["fill"]:
                cmds.append(("BACKGROUND", (0, ri), (NCOLS - 1, ri), _hex(spec["fill"])))
            if spec["border"]:
                cmds.append(("BOX", (0, ri), (NCOLS - 1, ri), 0.5, GRID))
        else:
            data.append([lc.text for lc in row.cells])
            for ci, lc in enumerate(row.cells):
                spec = STYLES[lc.style]
                cmds.append(("FONTNAME", (ci, ri), (ci, ri), _font_name(spec)))
                cmds.append(("FONTSIZE", (ci, ri), (ci, ri), _size(spec)))
                cmds.append(("TEXTCOLOR", (ci, ri), (ci, ri), _hex(spec["color"])))
                cmds.append(("ALIGN", (ci, ri), (ci, ri), spec["align"].upper()))
                if spec["fill"]:
                    cmds.append(("BACKGROUND", (ci, ri), (ci, ri), _hex(spec["fill"])))
                if spec["border"]:
                    cmds.append(("BOX", (ci, ri), (ci, ri), 0.5, GRID))

    unit = avail_w / sum(COL_WIDTHS_CHARS)
    return Table(data, colWidths=[w * unit for w in COL_WIDTHS_CHARS], rowHeights=heights, style=TableStyle(cmds))


def _duties_table(inputs: Inputs, duty_week: dict, avail_w: float, avail_h: float) -> Table:
    rows = duties_grid(inputs, duty_week)
    total = sum(BASE_ROW * r.height for r in rows)
    scale = min(1.0, avail_h / total * 0.97)
    heights = [BASE_ROW * r.height * scale for r in rows]

    data = []
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    for ri, row in enumerate(rows):
        if row.merged:
            lc = row.cells[0]
            spec = STYLES[lc.style]
            size = _size(spec)
            para = ParagraphStyle(
                "p", fontName=_font_name(spec), fontSize=size, leading=size + 2,
                textColor=_hex(spec["color"]), alignment={"left": 0, "center": 1}[spec["align"]],
            )
            data.append([Paragraph(_markup(lc), para)] + [""] * (DUTY_NCOLS - 1))
            cmds.append(("SPAN", (0, ri), (DUTY_NCOLS - 1, ri)))
            if spec["fill"]:
                cmds.append(("BACKGROUND", (0, ri), (DUTY_NCOLS - 1, ri), _hex(spec["fill"])))
            if spec["border"]:
                cmds.append(("BOX", (0, ri), (DUTY_NCOLS - 1, ri), 0.5, GRID))
        else:
            # Every cell (not just titles) wraps here - duty names and
            # multi-person "A / B" lists both run long enough to need it,
            # unlike the roster grid's short, fixed-format times.
            cells = []
            for ci, lc in enumerate(row.cells):
                spec = STYLES[lc.style]
                size = _size(spec)
                para = ParagraphStyle(
                    "p", fontName=_font_name(spec), fontSize=size, leading=size + 2,
                    textColor=_hex(spec["color"]), alignment={"left": 0, "center": 1}[spec["align"]],
                )
                cells.append(Paragraph(_markup(lc), para))
                if spec["fill"]:
                    cmds.append(("BACKGROUND", (ci, ri), (ci, ri), _hex(spec["fill"])))
                if spec["border"]:
                    cmds.append(("BOX", (ci, ri), (ci, ri), 0.5, GRID))
            data.append(cells)

    unit = avail_w / sum(DUTY_COL_WIDTHS_CHARS)
    return Table(data, colWidths=[w * unit for w in DUTY_COL_WIDTHS_CHARS], rowHeights=heights, style=TableStyle(cmds))


def _summary_table(roster: Roster, avail_w: float, avail_h: float) -> Table:
    n_weeks = len(roster.weeks)
    ncols = 1 + n_weeks
    rows_data = weekly_summary_rows(roster)

    rel_heights = [1.6, 1.3, 0.5, 1.8] + [1.25] * len(rows_data)
    total = sum(BASE_ROW * h for h in rel_heights)
    scale = min(1.0, avail_h / total * 0.97)
    heights = [BASE_ROW * h * scale for h in rel_heights]

    def para(text: str, spec, align: int = 1) -> Paragraph:
        size = _size(spec)
        style = ParagraphStyle(
            "p", fontName=_font_name(spec), fontSize=size, leading=size + 2,
            textColor=_hex(spec["color"]), alignment=align,
        )
        return Paragraph(escape(text), style)

    title_spec, note_spec, header_spec, plain_spec = STYLES["title"], STYLES["note"], STYLES["header"], STYLES["plain"]
    data = [
        [para("Weekly Summary", title_spec, align=0)] + [""] * (ncols - 1),
        [para(WEEKLY_SUMMARY_NOTE, note_spec, align=0)] + [""] * (ncols - 1),
        [""] * ncols,
        [para("Name", header_spec)] + [
            para(f"Week {wi + 1} ({date_range_text(week.days[0], week.days[-1])})", header_spec)
            for wi, week in enumerate(roster.weeks)
        ],
    ]
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("SPAN", (0, 0), (ncols - 1, 0)),
        ("SPAN", (0, 1), (ncols - 1, 1)),
        ("SPAN", (0, 2), (ncols - 1, 2)),
        ("BACKGROUND", (0, 3), (ncols - 1, 3), _hex(header_spec["fill"])),
        ("BOX", (0, 3), (ncols - 1, 3), 0.5, GRID),
    ]
    for ri, (label, shifts) in enumerate(rows_data, start=4):
        data.append([para(label, plain_spec, align=0)] + [para(t, plain_spec) for t in shifts])
        for ci in range(ncols):
            cmds.append(("BOX", (ci, ri), (ci, ri), 0.5, GRID))

    return Table(data, colWidths=[avail_w / ncols] * ncols, rowHeights=heights, style=TableStyle(cmds))


def write_duties_pdf(inputs: Inputs, duty_weeks: list, path) -> None:
    page = A4
    avail_w = page[0] - 2 * MARGIN
    avail_h = page[1] - 2 * MARGIN
    doc = SimpleDocTemplate(
        str(path),
        pagesize=page,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title=inputs.settings.title + " - Cleaning Duties",
    )
    story = []
    n = len(duty_weeks)
    for wi, dw in enumerate(duty_weeks):
        story.append(_duties_table(inputs, dw, avail_w, avail_h))
        if wi < n - 1:
            story.append(PageBreak())
    doc.build(story)


def write_pdf(roster: Roster, path) -> None:
    page = A4
    avail_w = page[0] - 2 * MARGIN
    avail_h = page[1] - 2 * MARGIN
    doc = SimpleDocTemplate(
        str(path),
        pagesize=page,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title=roster.inputs.settings.title,
    )
    story = []
    n = len(roster.weeks)
    for wi in range(n):
        story.append(_week_table(roster, wi, avail_w, avail_h))
        story.append(PageBreak())
    story.append(_summary_table(roster, avail_w, avail_h))
    doc.build(story)
