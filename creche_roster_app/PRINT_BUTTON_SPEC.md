# Print Button — Portable Spec

How the **Print** buttons work in the creche roster app, written so the same function can be rebuilt in another project (for example the Donabate roster). It covers what the user sees, the data the buttons need, the exact output, the code shape, and how to test it. Nothing here depends on the creche's staff.

There are **two print buttons**, sharing one dialog:

| Button | Where | Produces |
|---|---|---|
| **Print** (roster) | Roster home screen | Roster **PDF** or **Excel**, optional Weekly Summary |
| **Print** (duties) | Duties screen | Duty rota **PDF** (no Excel), optional Duty Summary |

---

## 1. What the user sees

1. Press **Print**. A dialog opens: *"Print roster"* (or *"Print duty rota"*), with the note *"Choose which week(s), built fresh from what's on screen right now."*
2. A **checkbox per week**, all ticked by default, each labelled with the week's date range (for example `05 Oct – 09 Oct 2026`).
3. A divider, then **one summary checkbox**, ticked by default:
   - roster dialog: **Weekly Summary** — *"Everyone's shift for each week, even through a holiday, sick day or maternity leave"*
   - duties dialog: **Duty Summary** — *"Who's on each duty, week by week, in one combined table"*
4. Buttons: **Cancel**, **PDF**, and **Excel** (the Excel button is hidden in the duties dialog).
5. Pressing PDF or Excel closes the dialog, disables the Print button while the file is built, saves the file, shows a toast (*"Saved Roster_Planner.pdf."*), and re-enables the button.

Rules:
- The dialog reopens fresh each time (all weeks ticked, summary ticked).
- If no week is ticked: toast *"Choose at least one week."* and nothing is saved.
- Files are **built from what is on screen right now**, so a printout always matches the screen. There is no server step and no "out of date" warning.

---

## 2. Requirements

| Need | Detail |
|---|---|
| **Saving a file** | A `downloads` capability that offers `save({filename, data})` and lets the viewer confirm or decline (in the prototype: `window.claude.use('downloads')`). In a normal website use an `<a download>` link with a Blob URL instead. Keep the call behind one small function, `saveBlob(filename, blob)` |
| **PDF** | jsPDF 2.5.1 and jsPDF-AutoTable 3.8.2 |
| **Excel** | ExcelJS 4.4.0 |
| **Data** | The current build result, in the shape in section 3 |

Load the libraries from a CDN with fixed versions:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js"></script>
```

**Button state.** Both Print buttons start `disabled`. Enable them once saving is available; if it isn't, leave them disabled and set the tooltip *"Printing isn't available in this view."* Clicking with no saving ability, or with no weeks, gives a toast (*"No roster to print yet."* / *"No duty rota to print yet."*).

---

## 3. Data the buttons read

Roster (`data.weeks[]`, one per week):
```
{ label: "05 Oct – 09 Oct 2026",
  day_names: ["Mon","Tue","Wed","Thu","Fri"],
  people: [ { name, role, days: [ { text, kind, adjusted } x5 ] } ] }
```
- `role`: `rotating` · `paired` · `fixed` · `static` · `vacant` (blank spacer rows are left out of `people`)
- `kind`: `shift` · `leave` · `static` · `vacant`
- `adjusted`: true when this person was moved to cover someone (amber)

Duties (`data.duties[]`, one per week):
```
{ label, assignments: [ { duty, people: [names] } ], unfilled: [duty names] }
```

Also needed:
- a way to get each person's **intended shift** for a week even through leave (used by the Weekly Summary): `intendedShiftText(weekIndex, staffMember)`. For a rotating or paired person it is their **base shift** for the week (the shift they would have worked had nobody been away); for a fixed person their fixed shift; for a static or vacant person their usual hours text.
- the list of context-only duty rows (`Cot Room`, `Changing Area`), which print as *"Staff working in the room"*.

---

## 4. Titles and notes

Everything is controlled by **how many weeks are ticked** (`multi = ticked weeks > 1`).

| Page | Single week | Several weeks (the monthly summary) |
|---|---|---|
| Roster week page | `STAFF ROSTER` | **`Weekly Roster`** + note |
| Weekly Summary page | `WEEKLY SUMMARY` | **`Temporary Weekly Roster - Summary`** + note |
| Duty week page | `CLEANING DUTIES` | **`Weekly Duties`** + note |
| Duty Summary page | `DUTY SUMMARY` | **`Temporary Weekly Duties - Summary`** + note |
| Excel week sheet title | `STAFF ROSTER` | `Weekly Roster` + note row |
| Excel summary sheet title | `Weekly Summary` | `Temporary Weekly Roster - Summary` + note row |

The note, printed in small grey text under the title when several weeks are printed:
> *This roster is temporary. Shifts and duties may change because of leave, sickness or cover needed. Please check for updates before each week.*

Keep the note text and the "Temporary" wording in **one place** (a constant), so removing the "Temporary" wording later is a one-line change. In the prototype it stays until the manager decides to remove it.

---

## 5. Layout and styling

### 5.1 PDF (A4 portrait, points)
- One page per ticked week, then (if ticked) the summary page.
- **Title** at x=40, y=42, 16 pt, red `(224,74,50)`.
- Several weeks: the **note** at y=56, 8.5 pt, grey `(64,64,64)`, wrapped to 515 pt wide with `splitTextToSize`; then the week label below it.
- **Week label** 11 pt, dark `(33,28,26)` (y=60 when single; below the note when several).
- **Table** by AutoTable, starting at y=74 (single) or just below the label (several):
  - head: `Name`, then the day names; fill dark `(33,28,26)`, white bold text
  - body: 9 pt, bold, cell padding 5, thin grey lines
  - first column = person name; each day cell = `text` or `—` if empty
  - vacant posts print the name column as `Vacant post  (vacant)`
- The duty page table: columns `Duty` and `Assigned`, 10 pt, padding 6, header fill green `(63,107,82)`.
- **Summary pages** (always a new page): the description line (9 pt grey, wrapped to 515 pt), then a table with the first column the person or duty and **one column per ticked week**, headed `Week N (date range)`. Roster summary head fill dark; duty summary head fill green.
- Fonts: bold throughout (`doc.setFont(undefined, 'bold')`).

### 5.2 Cell colours (PDF and Excel use the same table)

| Cell | Fill | Text |
|---|---|---|
| `OFF` | green `(169,209,142)` | dark green `(44,74,30)` |
| Text contains `holiday` (includes **Bank Holiday**) | orange `(198,91,53)` | `(253,236,227)` |
| Contains `maternity` | green `(46,158,87)` | `(231,247,238)` |
| Contains `sick` | blue `(61,126,166)` | `(230,242,248)` |
| Other leave text (for example `Not yet started`) | green `(169,209,142)` | `(44,74,30)` |
| Shift with `adjusted` | amber `(252,228,160)` | `(127,95,0)` |
| Vacant | none | — |
| Everything else | none | — |

Implemented as `cellFill(kind, text, adjusted)` returning `{bg, ink}` or `null`; applied in AutoTable's `didParseCell` for body cells (not the name column).

### 5.3 Excel
- One **worksheet per ticked week**, named `Week N` (max 31 characters).
- Row 1 title (bold 14, red `FFE04A32`); several weeks: a note row (italic 9, grey); then the week label (bold); a blank row; the header row (bold white on dark `FF211C1A`); then one row per person.
- Same cell colours, as `FF` + hex fills and fonts.
- Column widths: first 20, days 16.
- The summary is an extra sheet, `Weekly Summary`, with the title, the description (italic 9 grey), and a table of person × week.
- Return a `Blob` of type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

---

## 6. File names

| File | Name |
|---|---|
| Roster PDF | `Roster_Planner` + suffix + `.pdf` |
| Roster Excel | `Roster_Planner` + suffix + `.xlsx` |
| Duty PDF | `Duty_Rota` + suffix + `.pdf` |

`suffix` is empty when **every** week is ticked, otherwise `_Week2-Week3` (the ticked week numbers joined with `-`).

---

## 7. Names and labels

Use one function, **`dispName(name)`**, for every printed name, so labels such as `(F.A.R)` after named management staff appear in print exactly as on screen. Apply it to: roster rows (PDF, Excel), Weekly Summary rows, duty people (`dispPeople(arr)` joins with ` / `), and the Duty Summary. It must be **display only** (stored names stay plain) and **self-contained** (no dependence on variables defined later in the page; a first-render crash in the prototype came from exactly that).

Unfilled duties print as an **empty cell** (never "nobody free"). A duty with several people prints them joined with ` / `.

---

## 8. Code shape (so it can be copied)

```js
const TEMP_NOTE = '...';                       // section 4
function printHeader(doc, plainTitle, tempTitle, multi, subText, subSize, subColor, subMaxWidth, defaultSubY){
  doc.setFontSize(16); doc.setTextColor(224,74,50);
  doc.text(multi ? tempTitle : plainTitle, 40, 42);
  let subY = defaultSubY;
  if(multi){
    doc.setFontSize(8.5); doc.setTextColor(64,64,64);
    const lines = doc.splitTextToSize(TEMP_NOTE, 515);
    doc.text(lines, 40, 56);
    subY = 56 + lines.length * 10 + 12;
  }
  doc.setFontSize(subSize); doc.setTextColor(...subColor);
  subMaxWidth ? doc.text(subText, 40, subY, {maxWidth: subMaxWidth}) : doc.text(subText, 40, subY);
  return multi ? subY + 14 + (subMaxWidth && subText.length > 110 ? 12 : 0) : 74;   // table start Y
}

function weekSuffix(idxs, total){ return idxs.length === total ? '' : '_' + idxs.map(i => 'Week' + (i+1)).join('-'); }

function buildRosterPdfBlob(weekIndices, includeSummary){ /* one page per week + optional summary page */ }
async function buildRosterXlsxBlob(weekIndices, includeSummary){ /* one sheet per week + optional summary sheet */ }
function buildDutiesPdfBlob(weekIndices, includeSummary){ /* one page per week + optional Duty Summary page */ }

async function saveBlob(filename, blob){
  try { await saveCapability.save({filename, data: blob}); toast('Saved ' + filename + '.'); }
  catch(e){ toast(e && e.code === 'declined' ? 'Not saved.' : 'Could not save: ' + (e && e.message || 'try again.')); }
}
```

Button handlers (roster PDF shown; Excel and duties are the same pattern):
```js
pdfBtn.onclick = async () => {
  const idxs = selectedWeekIndices();                  // ticked weeks, as numbers
  if(!idxs.length){ toast('Choose at least one week.'); return; }
  const withSummary = summaryTicked();
  dialog.close();
  printBtn.disabled = true;
  const blob = buildRosterPdfBlob(idxs, withSummary);
  await saveBlob('Roster_Planner' + weekSuffix(idxs, data.weeks.length) + '.pdf', blob);
  printBtn.disabled = false;
};
```

Order of work in each build function: loop over the ticked weeks in order, `addPage()` for every page after the first, build the table, then add the summary page last.

---

## 8a. Things that must stay true

- Print always uses **the live, on-screen data**, never a stored copy, so it can't be out of date.
- A single-week print is laid out exactly as it was before any "Temporary" wording was added.
- The summary page is added **only** if its checkbox is ticked, and only when at least one week is ticked.
- The dialog is rebuilt each time it opens (so the summary box is ticked again).
- Print buttons are disabled while a file is being built.

---

## 9. Testing

Use stand-in objects for jsPDF, AutoTable and ExcelJS in the test browser (CDNs may be blocked), recording every `text(...)` call, every table (head and body cells with their styles), and every sheet. Add `splitTextToSize` to the stand-in (it returns `[text]`). Then check:

1. All weeks ticked → every page is headed `Weekly Roster` (roster) or `Weekly Duties` (duties) with the note, and no page says `STAFF ROSTER`.
2. The summary pages are headed `Temporary Weekly Roster - Summary` / `Temporary Weekly Duties - Summary` with the note.
3. Excel: the week sheets carry the new title and note; a `Weekly Summary` sheet exists when ticked and is absent when unticked.
4. One week ticked → plain titles (`STAFF ROSTER`, `CLEANING DUTIES`) and no note.
5. Summary unticked → one page per week only.
6. File names: all weeks → no suffix; two weeks → `_Week2-Week3`.
7. No weeks ticked → toast, nothing saved.
8. Labels such as `(F.A.R)` appear in roster PDF rows, Excel rows, the Weekly Summary, duty cells and the Duty Summary.
9. Leave cells use the colours in section 5.2 (`Bank Holiday` → orange, `OFF` → green, amber for adjusted).
10. No page errors.

The stand-ins only prove the text and structure. **Ask the manager to print one monthly summary and look at it** (the note wrapping, table spacing, page breaks) with the real libraries.

---

## 10. Porting checklist for another project

1. Add the three libraries (section 2) and the `saveBlob` wrapper for the new project's way of saving files.
2. Add the dialog markup, the two Print buttons (disabled until saving works), and the toast.
3. Provide the data in the shapes in section 3.
4. Add `cellFill`, `dispName`/`dispPeople`, `TEMP_NOTE`, `printHeader`, `weekSuffix`.
5. Add the three build functions and the summary builders.
6. Wire the handlers (section 8).
7. Run the tests in section 9, then print one real monthly summary.

## 11. Build prompt (paste into the other project)

> Add a Print function to this roster app from the attached spec (`PRINT_BUTTON_SPEC.md`). Two buttons (roster and duties) share one dialog with a tick box per week and a summary tick box; the roster offers PDF and Excel, the duties PDF only. Files are built from the live on-screen data. When several weeks are printed together, headings become "Weekly Roster" / "Weekly Duties" with the temporary note, and the summary pages are headed "Temporary Weekly Roster - Summary" / "Temporary Weekly Duties - Summary". Use the cell colours, file names and `dispName` labels in the spec. Test with stand-ins for the PDF and Excel libraries, then ask me to print one real monthly summary.
