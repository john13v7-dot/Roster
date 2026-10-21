# Donabate Creche — Staff Roster & Duty Rota App: Build Spec

A complete spec for building a phone-friendly roster and cleaning-duty app for **Donabate creche**. It is based on a working prototype built for another creche, with that creche's names removed and the rules made configurable. **The list of employees will be given in the new chat** — nothing in this document depends on specific people.

**How to use this document.** Paste it into the new project, then paste the Donabate staff list. Start with section 14 (what to ask Donabate) and fill in the Donabate details before building. Section 15 is the ready-to-paste build prompt.

Contents: 1 Purpose · 2 Principles · 3 Architecture · 4 Configuration · 5 Data model · 6 Staff types · 7 Shift rules · 8 Fairness · 9 Leave & manual changes · 10 Duty rota · 11 Protected weeks · 12 Start next week & history · 13 Screens, printouts, testing · 14 Questions for Donabate · 15 Build prompt · 16 Lessons learned

---

## 1. Purpose

An app for a creche manager that:

1. Builds a **5-week staff shift roster** (Mon–Fri) from a staff list, leave and manual changes.
2. Builds a **weekly cleaning-duty rota** for the same 5 weeks.
3. Keeps opening and closing cover, same-room rules, age-group mix and fairness correct automatically, and **rebuilds instantly** on every change.
4. **Never changes weeks already shared with staff** (section 11).
5. Prints the roster and duties as PDF and Excel.

It is a prototype for one branch. **No logins, roles, approvals or notifications**: anyone who opens it can edit.

---

## 2. Principles

1. **The manager decides.** The app proposes; manual adjustments win wherever physically possible.
2. **Shared weeks never change on their own.** The single most important rule.
3. **Warn, don't block.** Problems are shown on screen and under the printed week. Only physically impossible picks are dropped.
4. **Never fail silently.** A rule that can't be met is reported (a BREACH or a warning) naming the day or week.
5. **Fairness over a fixed pattern.** Where a simple rotation and fairness conflict, fairness wins.
6. **Unfilled is blank.** A duty nobody can take prints as an empty cell. Never write "nobody free".
7. **One engine, two ports.** The same rules run in Python (tests, reference) and JavaScript (the live page). They must give identical results.
8. **Management is labelled.** Named management staff show **"(F.A.R)"** after their name everywhere (section 6.4).

---

## 3. Architecture

| Part | Role |
|---|---|
| Python package (`creche_roster/`) | Reference engine, data models, tests |
| `engine.js` | A function-for-function JavaScript port, so the page recomputes instantly in the browser |
| `roster_preview.html` | The single-page app. The engine is spliced into it |
| Live database | Collections in section 5 |
| `build_preview.py` | Builds the page from a database export using the real Python engine |

Key points:

- **Every change rebuilds the whole roster from the inputs**, except where protected weeks pin things (section 11).
- **Parity is mandatory.** After any engine change, run both engines on the same inputs, including random leave scenarios, and compare shifts, duties and warnings exactly. To make this possible use **integer costs, a fixed scan order and the same tie-breaks** in both.
- Printing happens in the browser from what is on screen, so a printout always matches the screen. Libraries: jsPDF, jsPDF-AutoTable, ExcelJS.
- Dates are plain `YYYY-MM-DD` strings in JS.
- **Build the shared logic once and test it in Python first**, then port.

---

## 4. Configuration (to confirm for Donabate — section 14)

Keep every item below as a **setting in code** from day one (a Settings screen is optional and can come later).

| Setting | Default (from the prototype) |
|---|---|
| Title | `STAFF ROSTER` (replace with the Donabate title if wanted) |
| Weeks per roster | 5 (allowed 1–12) |
| Floors | One floor, `All` |
| Shifts (4 slots) | `early` 07:30–16:30 · `mid1` 08:00–17:00 · `mid2` 08:30–17:30 · `late` 09:00–18:00 |
| Min opening / closing | 3 each |
| Break text | `10 MINS` |
| Rooms and age groups | **Donabate to supply** (prototype: Toddlers + Preschoolers = younger; two ECEC rooms = older) |
| Paired staff | **Donabate to confirm** whether there is a pair (two management people who always open/close complementarily). Prototype: 2 people |
| Fallback closer | **Donabate to confirm** (a fixed-hours manager who closes when neither paired person does) |
| Management label | `(F.A.R)` shown after named management staff — **Donabate to say who** |
| Fairness window | Worked out from the staff list (section 8.1); default 9 weeks for 9 rotating staff |
| Duty no-repeat gap | 6 weeks |
| Protected weeks | 2 (this week and next) |
| Duty list | **Donabate to supply** (section 10.1 has the prototype's list as a starting point) |

Validation: start must be a Monday; shift start times strictly increase; exactly 0 or 2 paired staff; every leave/override name must exist; end date not before start date.

---

## 5. Data model

### 5.1 Staff

```
name, role, room, floor("All"), note, hours[Mon..Fri], number,
startDate, endDate, order
```

- `role`: `rotating` · `fixed` · `paired` · `static` · `vacant` · `blank` (section 6)
- `note`: for `fixed` the slot name; for `static`/`vacant` the usual hours text, e.g. `8:30 – 1:30`
- `hours`: per-weekday own hours for static people (`OFF`, or e.g. `9:00 – 6:00`); empty = use `note`
- `number`: printed row number. Empty = automatic, `-` = none, `12` = set
- `startDate` / `endDate`: joiner not scheduled before; leaver not scheduled after
- `room`: a room name, or empty (no room)
- `order`: position on the printed roster

### 5.2 Collections

| Collection | Contents |
|---|---|
| `staff` | As above |
| `leave` | `{name, start, end (empty = open-ended), kind: Holiday / Sick / Maternity Leave}` |
| `transfers` | Manual shift adjustments: `{name, start, end, slot}` or, for static staff, `{name, start, end, text}`; also room-change requests |
| `dutyOverrides` | A manual duty pick: `{name, week (Monday), duty}` |
| `changelog` | `{request, createdAt, impact, breaches, notes[]}` |
| `rosterHistory/<monday>` | The archived week 1 when "Start next week" is pressed: `{monday, label, people, duties, lastSlot, archivedAt}` |
| `settings/rosterWindow` | `{start}` — the Monday that is week 1 |
| `settings/startingHistory` | `{history, lastSlot}` — memory from before the window |
| `settings/lockedRoster` | `{slots: {name: {isoDate: slot}}}` — the shared shift roster |
| `settings/lockedDuties` | `{weeks: {mondayIso: {duty: [people]}}, rules: <version>}` — the shared duty rota |
| `settings/changeWatermark` | `{staffFingerprint, events[]}` — snapshot used to find what a new change touches |

---

## 6. Staff types

| Role | Behaviour |
|---|---|
| `rotating` | Moves between the four slots by the rules in section 7 |
| `paired` | Two people who are always **complementary**: one opens, the other closes, swapping weekly. They count as one of the 3 openers and one of the 3 closers |
| `fixed` | Always the same slot |
| `static` | Own typed hours, never scheduled by the engine. They **never count** towards opening or closing, **except the fallback closer** |
| `vacant` | An empty post: shown with its hours, no name, not counted |
| `blank` | A spacer row on the printed roster |

### 6.1 Duty pool
All `rotating` staff, plus any paired person who also takes a duty. Not static staff who have a fixed duty.

### 6.2 Fixed duties
A fixed duty is always the same person or people every week (prototype: Dusting, Laundry). Donabate to confirm.

### 6.3 Pair
If Donabate has no pair, set the paired count to 0; then the rotating pool supplies all 3 openers and 3 closers and the fairness window changes (section 8.1).

### 6.4 The "(F.A.R)" label
A function `dispName(name)` adds ` (F.A.R)` after each named management person, **everywhere a name is displayed**: roster screen, duty lists, History, roster PDF/Excel, Weekly Summary, duty PDF, Duty Summary. It is **display only**; stored names stay plain. Define the helper so it is safe to call before any other page variable exists (a bug in the prototype came from a helper that depended on a variable defined later).

---

## 7. Shift rules

### 7.1 Hard rules (reported as a BREACH if impossible)

1. **Opening cover:** at least 3 on `early` every day.
2. **Closing cover:** at least 3 on `late` every day.
3. **Pairing:** the two paired people are complementary.
4. **Same-room:** two people from the same room can never be on the same slot on the same day (*Room clash* BREACH if unavoidable, e.g. a manual override).

With a pair, the rotating pool supplies **2 openers and 2 closers a week**; the rest fill `mid1` / `mid2`.

### 7.2 How a week is planned (whole-week matching)

Plan **each week as a whole** (not person by person):

1. **Fixed** staff take their slot. The **pair** is decided together: whoever has opened less opens; ties by last week.
2. **Opening and closing seats** go to whoever is furthest behind over the rolling fairness window (section 8), by a **minimum-cost matching** (Hungarian algorithm). Costs (integers):
   - rate of openings+closings so far: `1000 × (opens + closes) ÷ (weeks present + 1)`
   - plus `600 × opens ÷ (weeks eligible to open + 1)` for an opening seat (same idea for closing)
   - plus a large penalty (10⁵) when someone already has their full share of the window (`cap = ceil(seats × window ÷ pool size)`)
   - plus 300 if it repeats last week's slot
   - plus 10⁶ if a non-rotating room-mate already holds that seat
   - plus a small week-rotating tie-break
   Mid slots cost 0, so seats go to the people who are owed.
3. **Reserve both age groups for the middle shifts:** opening and closing may not use up all but one younger-room (or older-room) person, because both mid groups need one of each. If they would, hold back the least-owed one.
4. **Same-room clash among picks:** add a penalty and re-solve (up to 8 tries).
5. **Split the remaining people into 8:00 and 8:30** by trying every split (sizes ⌊n/2⌋ and ⌈n/2⌉, order alternating weekly), choosing the lowest cost: same-room clashes (10⁶), then a missing age group in a group (10⁵ each), then who has done each of the two slots less (10 per time), then 300 for repeating last week's slot. Ties go to the first split in lexicographic order (so both engines pick the same one).
6. A person's slot for the week is their **base slot**. History is credited for the whole base slot even if they were away for part of the week.

### 7.3 8:00 / 8:30 age-group mix
- **No age-group requirement at 7:30 or 18:00.**
- The **8:00 group and the 8:30 group must each include one younger-room and one older-room person** (if the group has 2 or more people). People with no room count for neither.
- Headcount always wins. If the mix can't be met, show a warning *"The 8:00 group has no younger-room staff on <days>"*; never a BREACH.
- After a leave patch, swap two people between 8:00 and 8:30 if that fixes the mix.

### 7.4 Daily pass (leave, overrides, cover)

1. Apply leave and manual overrides each day.
2. **Strict cover.** When opening is short, the **8:00 person** comes in at 7:30. When closing is short, the **8:30 person** stays to 18:00. Among eligible people, whoever has covered **least so far** goes first, and the order turns over each day, so a whole-week gap is shared out day by day, not given to one person. (So that this works, a whole-week gap is **not** filled by one person in the weekly plan; the daily pass handles it.)
3. Using any other shift is a **last resort** and shows a warning ("Cover (last resort)").
4. A same-room clash is avoided unless every candidate would clash.
5. Anyone moved to cover is flagged `adjusted` (amber).
6. Anything still short is a BREACH.

### 7.5 Fallback closer
When neither paired person is closing, the fallback closer covers closing if she is working. The closing minimum is reduced by 1, so closing is still 2 rotating staff + 1 from management. Her displayed hours stay as typed. If the rotating pool then over-supplies closers, move one back.

### 7.6 Pair away
- If one of the pair is on leave the pairing is suspended and the other **opens (7:30) automatically**.
- An override on a paired person is **ignored on days the partner works**.
- Both away at once: allowed, but warned ("policy says they should never be away together"). The Add Holiday form blocks overlapping leave for the pair.

---

## 8. Fairness

### 8.1 Window
Fairness is counted over a **rolling window** of weeks, **carried across months** (never restarted), looking back at the archived weeks. The window is **the shortest number of weeks in which everyone can get exactly the same number of openings, closings and middle shifts**:

> With *o* opening and *c* closing seats a week from the rotating pool and *N* rotating staff, the window is the smallest *w* such that `o × w` and `c × w` divide evenly by *N*.

With 2 + 2 seats a week: 8 staff → 4 weeks, 9 → 9, 10 → 5, 12 → 6. Work it out from the staff list, show it, and allow a manual override.

### 8.2 Holidays count as weeks worked
Fairness is based on **the weeks someone actually worked**. Someone back from leave does **not** owe extra openings or closings, and nobody is penalised for covering. In the matching, use rates and "weeks eligible", not raw totals.

### 8.3 No repayment for blocked seats
If a non-rotating person (a paired manager) shares someone's **room**, the same-room rule blocks that person from the seat the manager holds that week. That week does **not** count against them for that seat (it is excluded from "weeks eligible"), and they are never given extra seats later to make up for it. Nobody else is affected.

### 8.4 Fixed-hours staff
Static staff never count towards opening or closing (except the fallback closer, 7.5).

### 8.5 Result to expect
With 9 rotating staff over a 9-week window almost everyone ends on exactly 2 openings, 2 closings and 5 middle shifts. People blocked by 8.3 end with fewer openings, by design.

---

## 9. Leave & manual changes

| Action | Effect |
|---|---|
| **Add Holiday / Sick / Maternity Leave** | `{name, start, end or open-ended}`; shown as `HOLIDAY` / `SICK` / `MATERNITY LEAVE`, colour-coded |
| **Add Staff** | A new person (any role, room, dates) |
| **Transfer** | Moves a person (e.g. room change) |
| **Adjust Shift** | A manual slot for one or more days (or typed hours for static staff). Must still respect the hard rules, otherwise dropped |
| **Adjust Duty** | A manual duty pick for one person and one week |

No half-days, no other leave types. A person stays in the week's rotation unless away more than half of it.

---

## 10. Duty rota

### 10.1 What a duty week contains
Rows, in order: **Cot Room**, **Changing Area** (filled by whoever works that room, no named person) → the **rotating duties** → the **fixed duties**.

Prototype rotating duties, as a starting point for **Donabate to confirm or replace** (ideal finishing time by slot):

| Duty | Ideal finish |
|---|---|
| Hallway upstairs / Hoover stairs upstairs | 17:00 |
| Children's Toilets | 17:30, 18:00 |
| Staff Toilet upstairs | 16:30 |
| Kitchen | 17:30, 18:00 |
| Staff Room | 16:30, 17:00 |
| Hallway downstairs / windows / door handles | 17:00, 17:30, 18:00 |
| Staff Toilet | 16:30 |
| Back Garden & Bins | 16:30, 17:00 |
| Front creche | 16:30, 17:00 |
| Paper & Soap dispensers | 16:30, 17:00 |

Each duty's **minimum slot** is its earliest ideal slot: a person may take it only if they finish at or after that (never someone who has gone home). Ideal finish time is a **preference**, not a must.

### 10.2 Pool
Rotating staff (plus any paired person who takes duties), present **more than half the week**. Their weekly slot is the slot they work most days.

### 10.3 Planning (whole-week matching)
Build a cost table (duties × people, plus a "leave blank" option per duty) and solve with the **Hungarian algorithm** (integers, fixed scan order). Costs, each tier outweighing everything below it:

| Tier | Meaning | Cost |
|---|---|---|
| Forbidden | Finishes before the duty is done, or did this duty in the last 5 weeks | 10¹² |
| Blank | Leaving a duty empty (+10⁷ extra for duties not in the blank-first list) | 10⁹ |
| Moved | In a shared week being re-planned: moving someone off the duty they were given | 10⁶ |
| Not ideal | Slot not in the duty's ideal set | 10⁵ |
| Done before | Per time this person has done this duty in history | 10³ |
| Recency | `(6 − weeks since last done) × 10` | up to 60 |
| Tie-break | Position in a week-rotated list | small |

### 10.4 The 6-week no-repeat rule (hard)
Nobody does the same duty twice in any 6 consecutive weeks, counting weeks in this build, **locked weeks**, and **archived weeks** (so it carries across "Start next week"). Only a manual pick can break it. Repeats already inside shared or past weeks are left alone.

### 10.5 Short-staffed weeks
Leave the **least important duties blank first** (prototype: Paper & Soap dispensers, then Front creche — Donabate to choose). The page shows "Left blank this week: …"; the printout shows an empty cell.

### 10.6 Manual duty picks
- Choose a person, week and a duty that fits their shift. The pick is applied first, the rest of the week planned around it.
- If it breaks the 6-week rule the app asks **"<name> already did <duty> N week(s) before… Keep this pick anyway?"** Cancel leaves nothing behind. Keep saves it and shows a note under that week (in-app only; also kept after the week is saved).
- A pick that no longer fits their shift is dropped silently.

### 10.7 Duty fairness
Total duties per person on the Fairness screen. The no-repeat rule plus the cost table spreads duties evenly.

---

## 11. Protected weeks (the central design feature)

Once a roster is shared, a later unrelated change must not reshuffle shared weeks.

1. After a change is saved, store the whole result as the **lock**: `lockedRoster` (each person's slot per day), `lockedDuties` (people per duty per week) and a `changeWatermark` (every leave, transfer and duty-override as it stood, plus a fingerprint of the staff list including hours and note).
2. On the next change, diff the current events against the watermark to find the **touched date ranges**: a new event touches its own range (open-ended leave is clamped to the window end); a changed event touches its old and new range; a removed event touches its old range.
3. Any **day** outside the touched ranges keeps its locked slot. Any **week** with no touched day keeps its locked duties exactly.
4. Pinning one day can nudge another day, so run an **iterative correction loop** (up to 10 rounds) until stable.
5. **Recompute ranges and highlight ranges are separate.** Only days covered by a real leave/shift/duty change keep an amber highlight. (A bug in the prototype coloured whole unchanged weeks because the two were mixed.)
6. A touched week is **re-planned, but keeps everyone on their shared duty where it still works** (cost tier "Moved").
7. **A staff edit** reopens only weeks **3 onwards**. Weeks 1–2 are shared.
8. If there is no lock yet, the first build is open everywhere and becomes the lock.
9. Store a **rules version** on `lockedDuties`. A lock saved under older rules keeps only its shared weeks; later weeks are re-planned. **Whenever the rules change, save the weeks currently on screen as the lock** so a later "Start next week" cannot bring back an old saved plan.
10. A manual duty pick that was saved still shows its warning note.

---

## 12. Start next week & history

- **Start next week** (button, with confirmation, on the History screen): archives week 1 (people, duties, last slot) into `rosterHistory/<monday>`, updates the last-slot memory, moves `rosterWindow.start` forward 7 days. A new week 5 appears and is planned. It stays a manual button.
- The archive feeds: the **fairness window** (each rotating person's weekly slot is read back from the saved shift times), and the **6-week duty no-repeat rule**.
- A **History** screen shows archived weeks by month.
- Test the switch: pressing Start next week must not move any already-planned week.

---

## 13. Screens, printouts and testing

### 13.1 Screens (mobile layout, 16 px gutters)

| Screen | Contents |
|---|---|
| **Roster** (home) | Week tabs. Per person Mon–Fri cells: shift times, `HOLIDAY` / `SICK` / `MATERNITY LEAVE`, `OFF`, own hours. Amber = covering for someone. Breaches and warnings under the week. Top buttons: Duties, Fairness, History, Staff & Requests, Print |
| **Duties** | Week tabs; all duties; blank rows highlighted; notes for blank duties and hand-picked repeats (in-app only) |
| **Fairness** | Shift counts per rotating person and duty counts per duty-pool person |
| **History** | Archived weeks; the **Start next week** button |
| **Staff & Requests** | + Add Staff, Transfer, + Add Holiday, + Add Sick, + Add Maternity Leave, Adjust Shift, Adjust Duty; lists of staff, leave & transfers (removable with confirmation), manual adjustments, change log (with notes), rules enforced |

UI rules: instant rebuild; a failed build is rolled back with the reason shown; **no colour on unchanged cells**; colour-coded leave kinds; confirm dialog before removing; toasts for success; "(F.A.R)" on named management staff.

### 13.2 Printouts

| Output | Details |
|---|---|
| **Roster PDF / Excel** | One page per chosen week: title, date range, a row per person, spacer rows, breaches under the table |
| **Weekly Summary** | Everyone's *intended* shift each week, even if away |
| **Duty PDF** | One page per week (duty, person); unfilled blank |
| **Duty Summary** | One page spanning all printed weeks |
| **Print dialog** | Choose weeks; PDF or Excel; checkbox for the summary page |

**Titles when several weeks are printed together** (the monthly summary): the week pages are headed **"Weekly Roster"** and **"Weekly Duties"**, the summary pages **"Temporary Weekly Roster - Summary"** and **"Temporary Weekly Duties - Summary"**, each with this note under the title:
> *This roster is temporary. Shifts and duties may change because of leave, sickness or cover needed. Please check for updates before each week.*

A single-week print keeps the plain titles (`STAFF ROSTER`, `CLEANING DUTIES`). The "Temporary" wording stays until the manager decides to remove it.

### 13.3 Testing

- **Unit tests (Python):** shift cover, pairing, same-room, leave, overrides, protected rosters, duty pool, finish-time safety, 6-week rule, short-staffed blanks, manual repeat warning, strict cover and rotation, age-group mix, fairness window, Hungarian algorithm vs brute force, writers.
- **Parity tests:** JS vs Python on realistic data and ~40 random scenarios (shifts, duties and warnings).
- **Stress test:** 12 weeks × 40 random leave scenarios: zero duty repeats and no BREACH; blanks only when headcount is genuinely short.
- **Browser tests (Playwright)** with a mock database seeded with real data: shared weeks unchanged, lock saved after an unrelated change, no colour on unchanged weeks, blank-duty note, repeat-pick confirm/cancel/keep, **Start next week** keeps earlier weeks identical, titles and note on multi-week prints, "(F.A.R)" on screen and in print, no page errors.
- Stand-ins for jsPDF/ExcelJS are fine for checking text, not layout; ask the manager to print one monthly summary and look at it.

---

## 14. Questions for Donabate (ask before building)

1. **Staff list**, with for each person: name, role (rotating / paired / fixed / static / vacant), room, usual hours if fixed-hours, start/end date. *(Will be given in the new chat.)*
2. **Rooms and age groups:** room names, and which are younger and which older.
3. **Shifts:** the four start/end times, or are they the same as the prototype's?
4. **Cover:** minimum opening and closing (3 each?).
5. **Pair:** is there a pair of management staff who open/close complementarily? Who? Is there a **fallback closer**?
6. **"(F.A.R)":** which people get the label?
7. **Duties:** the list of duties, which are fixed to a person, which are least important (left blank first), and each duty's ideal finishing time.
8. **Same-room rule:** is it the same (no two room-mates on the same slot)?
9. **Start date:** which Monday is week 1, and is there history before it (who opened/closed recently, and last week's duties)?
10. **Existing leave** to enter on day one.
11. **Printout title** for Donabate.

---

## 15. Build prompt (paste into the new chat with the staff list)

> Build a mobile-first single-page roster and cleaning-duty app for **Donabate creche** from the attached spec (`DONABATE_ROSTER_APP_SPEC.md`), using the staff list I will paste. First ask me the questions in section 14 that the staff list doesn't answer.
>
> Build in this order and verify each step before the next:
> 1. Data models, configuration and validation (sections 4–6).
> 2. The Python shift engine: whole-week planning with the fairness window, age-group mix, strict cover, fallback closer, pair rules, same-room rule (sections 7–8), with tests.
> 3. Leave, sick, maternity and manual adjustments (section 9).
> 4. The duty planner: whole-week matching, 6-week no-repeat, blank-first, manual picks (section 10), with tests.
> 5. **Protected weeks for shifts and duties (section 11) — early**, because everything else must respect it.
> 6. A line-for-line JavaScript port, with parity tests on real and random inputs.
> 7. The screens, the "(F.A.R)" labels and the printouts with the titles and note (section 13).
> 8. Browser tests seeded with the real staff list, including "Start next week" not moving earlier weeks.
>
> Do not add logins, approvals, notifications or multiple branches. Warn rather than block. Leave unfilled duties blank. Never change a week that has already been shared. After each stage, show me a worked example roster for the real staff.

---

## 16. Lessons learned from the prototype (avoid these)

1. **Shared weeks moved after a staff edit.** A staff change that reopened everything redrew weeks already shared. Staff edits must reopen only week 3 onwards.
2. **Amber colour on unchanged weeks.** Keep "free to recompute" and "highlight" as separate ranges.
3. **An old saved duty plan came back** after the window moved forward. Save the on-screen weeks as the lock whenever the rules change, and version the lock.
4. **The fairness window must look back past the roster start**, using the archive; otherwise every "Start next week" forgets who has opened and closed.
5. **A greedy duty pick left duties blank** that another arrangement could fill, and let people repeat duties. Use a whole-week matching.
6. **A whole-week absence given to one person** for the whole week is unfair. Share cover out day by day.
7. **A page helper depending on a later variable** crashed the first render. Make display helpers self-contained.
8. **Greedy week-by-week fairness can't be perfect.** Use caps per window and rates based on weeks worked, and measure balance over rolling windows, not the whole build.
9. **Test old behaviour stays identical** whenever a new rule is added, by comparing against the previous engine on real data.
10. **Parity bugs hide in tie-breaks.** Use integer costs, the same scan order and the same combination order in both engines.


---

## Additions since the first version of this spec (app version 89)

- **Closure days (bank holidays):** a setting `closure_days {date: label}`. On that day everyone shows the label (for example `Bank Holiday`); no cover, pairing or room rule applies, and no breach is raised. The label prints in the same orange as holidays.
- **Joining the rotation on a date (`rotateFrom`, a Monday):** a staff member starts on fixed hours (their `note`, shown as a normal fixed-hours cell) and becomes a full `rotating` member from that Monday. Before it they take no part in the rotation, fairness counts or duties. On the day they join they start at the **team-average** fairness position (not zero) so they are not sent every opening and closing at once. `startDate` still gives "Not yet started" before they arrive.
- **Dated room moves (`roomFrom`, `prevRoom`):** `room` applies from `roomFrom`, `prevRoom` before it, so moving someone never rewrites earlier weeks (and never creates a retroactive room clash).
- **Shared late duty:** when there are more people than duties, one late-finish duty a week (Kitchen, Children's Toilets or Hallway downstairs, rotating by calendar week) is shared by two people. The 6-week no-repeat rule and finishing-time rules apply to both people.
- **Automatic fairness window:** worked out from the number of rotating staff (10 staff -> 5 weeks, 9 -> 9, 8 -> 4); `fairness_weeks = 0` means automatic.
- **A staff edit never reopens the current week:** it reopens only weeks that have not started (and never the first two weeks of the window).
- **Manual shift pins:** a person's manual shift pins (stored as `transfers`) override the planner. When a rule change (such as a room move) conflicts with a pin in a week that has not been shared, release that pin so the person can be re-planned.
- **Management label** `(F.A.R)` after the named management staff everywhere they are shown (Donabate to say who).
