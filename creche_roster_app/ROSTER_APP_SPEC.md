# Creche Staff Roster & Duty Rota — Full Application Spec

A complete description of the prototype, written so it can be rebuilt in another project: what it does, every scheduling rule, the data model, the screens, the printouts and how to test it.

**How to use this document.** Paste it into the new project and ask for the app to be built to this spec. Sections 1–13 describe the app **as it works today**. Section 14 lists rules that have been **agreed but not built yet**. Section 15 lists open questions. Section 16 is a ready-to-paste build prompt.

Contents: 1 Purpose · 2 Principles · 3 Architecture · 4 Data model · 5 Staff types · 6 Shift rules · 7 Leave & overrides · 8 Duty rota · 9 Protected weeks · 10 Start next week & history · 11 Screens · 12 Printouts · 13 Testing · 14 Agreed, not built · 15 Open questions · 16 Build prompt

---

## 1. Purpose

A phone-friendly app for a creche manager that:

1. Builds a **5-week staff shift roster** (Mon–Fri) from a staff list, leave and manual changes.
2. Builds a **weekly cleaning-duty rota** for the same 5 weeks.
3. Keeps opening and closing cover, same-room rules and fairness correct automatically, and **rebuilds instantly** whenever anything changes.
4. **Never changes weeks that have already been shared with staff** (see section 9).
5. Prints the roster and duties as PDF and Excel.

It is a prototype for one branch, with no logins or roles. Anyone who opens it can edit.

---

## 2. Principles

1. **The manager decides.** The app proposes; manual adjustments always win where physically possible.
2. **Shared weeks never change on their own.** This is the single most important rule.
3. **Warn, don't block.** Problems are shown (on screen, and under the printed week). Only physically impossible picks are dropped.
4. **Never fail silently.** A rule that can't be met is reported as a BREACH or a note, naming the day or week.
5. **Fairness over a fixed pattern.** Where a simple rotation and fairness conflict, fairness wins.
6. **Unfilled is blank.** A duty nobody can take prints as an empty cell. Never write "nobody free".
7. **One engine, two ports.** The same rules run in Python (printing, tests) and JavaScript (the live page). They must give identical results (section 3).

---

## 3. Architecture

| Part | Role |
|---|---|
| `creche_roster/` (Python package) | The reference engine, data models, Excel/PDF writers, tests |
| `mobile/engine.js` | A function-for-function JavaScript port of the Python engine, so the page recomputes instantly in the browser |
| `mobile/roster_preview.html` | The single-page app (Roster, Duties, Fairness, History, Staff & Requests screens). The engine is spliced into it |
| Live database | Collections shown in section 4, read and written by the page |
| `mobile/build_preview.py` | Builds the page from a database export using the real Python engine |

Key points:

- **Every change rebuilds the whole roster from the inputs.** It is never a patch on the previous result — except where protected weeks pin things (section 9).
- **Parity is mandatory.** After any engine change, run the JS and Python engines on the same inputs (including random leave scenarios) and compare the output exactly. Duty planning uses integer costs and a fixed scan order for this reason.
- Printing (PDF/Excel) happens in the browser from what is on screen right now, so a printout always matches the screen.
- Dates are plain `YYYY-MM-DD` strings in JS (they compare correctly as strings and avoid time-zone problems).

---

## 4. Data model

### 4.1 Settings (currently fixed in code; see section 14 for the planned Settings screen)

| Setting | Current value |
|---|---|
| Title | `STAFF ROSTER` |
| Roster start | A Monday (stored in `settings/rosterWindow`) |
| Weeks | 5 (allowed 1–12). 5 because with 4 shifts each of 9 rotating staff needs time to get one opening and one closing |
| Floors | One floor, `All` |
| Shifts (slots) | `early` 07:30–16:30 · `mid1` 08:00–17:00 · `mid2` 08:30–17:30 · `late` 09:00–18:00 |
| Min opening / closing | 3 each (the paired person + 2 more) |
| Break text | `10 MINS` |
| Fallback closer | Priscilla |

Validation: start must be a Monday; weeks 1–12; shift start times strictly increase early < mid1 < mid2 < late; exactly 0 or 2 paired staff; every leave/override name must be in the staff list; end date not before start date.

### 4.2 Staff

```
name, role, room, floor("All"), note, hours[Mon..Fri], number,
startDate, endDate, order
```

- `role`: `rotating` · `fixed` · `paired` · `static` · `vacant` · `blank` (section 5)
- `note`: for `fixed` the slot name; for `static`/`vacant` the usual hours text, e.g. `8:30 – 1:30`
- `hours`: per-weekday own hours for static people (`OFF`, or e.g. `9:00 – 6:00`); empty = use `note`
- `number`: printed row number. Empty = automatic, `-` = no number, `12` = set
- `startDate` / `endDate`: joiner not scheduled before; leaver not scheduled after
- `room`: `Toddlers Room`, `Preschoolers Room`, `ECEC 1`, `ECEC 2`, or empty (no room)
- `order`: position on the printed roster

### 4.3 Other collections

| Collection | Contents |
|---|---|
| `leave` | `{name, start, end (empty = open-ended), kind: Holiday / Sick / Maternity Leave}` |
| `transfers` | Manual shift adjustments (named "transfers" for historical reasons): `{name, start, end, slot}` or, for static staff, `{name, start, end, text}` |
| `dutyOverrides` | A manual duty pick: `{name, week (Monday), duty}` |
| `changelog` | `{request, createdAt, impact, breaches, notes[]}` — what was asked and exactly whose shift changed |
| `rosterHistory/<monday>` | The archived week 1 when "Start next week" is pressed: `{monday, label, people, duties, lastSlot, archivedAt}` |
| `settings/rosterWindow` | `{start}` — the current Monday that is week 1 |
| `settings/startingHistory` | `{history, lastSlot}` — memory from before the window |
| `settings/lockedRoster` | `{slots: {name: {isoDate: slot}}}` — the shared shift roster |
| `settings/lockedDuties` | `{weeks: {mondayIso: {duty: [people]}}, rules: 2}` — the shared duty rota |
| `settings/changeWatermark` | `{staffFingerprint, events[]}` — a snapshot used to find what a new change touches |

---

## 5. Staff types

| Role | Behaviour |
|---|---|
| `rotating` | Moves between the four slots by the rules in section 6. 9 people today |
| `paired` | Two people (Jason and Shehnaz) who are always **complementary**: one opens, the other closes, swapping weekly |
| `fixed` | Always the same slot |
| `static` | Own typed hours, never scheduled by the engine (Sue, Laura, Megan, Priscilla, Eirini). Hours shown as typed. They never count towards opening or closing, **except** the fallback closer (Priscilla) |
| `vacant` | An empty post: shown with its hours, no name, not counted towards cover |
| `blank` | A spacer row on the printed roster |

**Current people** (for reference and testing): rotating — Hanny (Toddlers), Manuel, Irene, Deoshree (Preschoolers), Sandrine, Daniel, Arantza (ECEC 1), David, Usha (ECEC 2); paired — Jason (ECEC 2), Shehnaz (no room); static — Sue 8:30–1:30 (Thursday OFF), Priscilla (Mon/Fri 9:00–6:00, Tue–Thu 10:00–6:00), Laura 9:00–1:00, Megan, Eirini (maternity, open-ended); plus three vacant posts and a spacer.

---

## 6. Shift rules

### 6.1 Hard rules (reported as a BREACH if impossible)

1. **Opening cover:** at least 3 people on the `early` slot every day.
2. **Closing cover:** at least 3 people on the `late` slot every day.
3. **Pairing:** the two paired people are always complementary (one `early`, one `late`).
4. **Same-room:** two people from the same room can never be on the same slot on the same day. Reported as a *Room clash* BREACH if unavoidable (typically a manual override that pins two room-mates together).

The paired person counts as one of the 3. So the rotating pool normally supplies **2 openers and 2 closers**, and the other 5 rotating staff fill `mid1` / `mid2`.

### 6.2 Weekly base (how the week's slots are chosen)

1. **Fixed** staff take their slot.
2. **The pair** is decided together. Whoever has opened less (share of early in history) opens; ties go by last week (whoever just closed opens, whoever just opened closes).
3. **Rotating staff** per floor get opening and closing seats **least-done-first**, then `mid1`/`mid2` the same way from whoever is left.
4. Cost of giving person *n* slot *s*: `10 × (times n has done s ÷ (total shifts + 1))` plus `3` if it is the same slot as last week. Lowest cost wins. Ties are broken in a week-dependent way so the same person doesn't always lose.
5. A swap pass resolves any same-room clash (a three-person room can arithmetically force a clash in the two flexible slots unless someone is swapped with another room).
6. An "avoid immediate repeats" pass removes repeats of last week's slot where possible without breaking anything else.
7. A person's slot for the week is their **base slot**. Fairness history is credited for the whole base slot even if they were away part of the week, so a short leave doesn't distort the following weeks.

### 6.3 Daily pass (leave, overrides, repairs)

1. Apply leave and manual overrides for each day.
2. If a floor is below its opening/closing minimum, **repair** by moving the least disruptive rotating person: a `mid1`/`mid2` person is asked before anyone already covering the other protected slot; lowest fairness cost first; avoid a room clash unless every candidate would cause one. Only as many people move as there are gaps ("one absence, one substitute").
3. Anyone moved to cover is flagged `adjusted` (shown amber) so it is clear who was affected and why.
4. Anything still short is a BREACH.

### 6.4 Fallback closer (Priscilla)

- When **neither paired person is closing** that day (e.g. one is on holiday), the fallback closer covers closing, if she is working. The closing minimum is reduced by 1, so the day still has 2 rotating staff + 1 from management.
- Her displayed hours stay as typed. The roster notes "Closing fallback".
- If the rotating pool would then supply more closers than needed, one is moved back so closing is not over-staffed.

### 6.5 Pair away

- If one of the pair is on leave the pairing is suspended and the other **opens (07:30) automatically**. A manual override on a specific day still wins.
- An override on a paired person is **ignored on days the partner works** (the pairing rule applies).
- Both away at the same time: allowed by the engine but flagged as a warning ("policy says never"). The Add Holiday form blocks overlapping leave for the pair.

### 6.6 Recency

Avoid repeating last week's slot. This is a soft rule; fairness is stronger.

---

## 7. Leave & manual changes

| Action | Effect |
|---|---|
| **Add Holiday / Sick / Maternity Leave** | `{name, start, end or open-ended}`. The person shows `HOLIDAY` / `SICK` / `MATERNITY LEAVE` for those days; colour-coded. Open-ended leave is treated as the team's new normal for that build |
| **Add Staff** | A new person (any role, room, dates) |
| **Transfer** | Moves a person (e.g. a room change) |
| **Adjust Shift** | A one-or-more-day manual slot (or typed hours for static staff). Must still respect the hard rules; otherwise it is dropped |
| **Adjust Duty** | A manual duty pick for one person and one week (section 8.7) |

Leave of part of a week: the person stays in the week's rotation unless away more than half of it (section 8.2).

---

## 8. Duty rota

### 8.1 What a duty week contains

Rows in this order:

1. **Cot Room**, **Changing Area** — filled by whoever works that room; no named person.
2. Ten rotating duties (below).
3. **Dusting** — always Sue.
4. **Laundry** — always Shehnaz and Priscilla (only those present most of the week).

| # | Rotating duty | Ideal finish (slot) |
|---|---|---|
| 1 | Hallway upstairs / Hoover stairs upstairs | 17:00 (`mid1`) |
| 2 | Children's Toilets | 17:30, 18:00 (`mid2`, `late`) |
| 3 | Staff Toilet upstairs | 16:30 (`early`) |
| 4 | Kitchen | 17:30, 18:00 |
| 5 | Staff Room | 16:30, 17:00 |
| 6 | Hallway downstairs / windows / door handles | 17:00, 17:30, 18:00 |
| 7 | Staff Toilet | 16:30 |
| 8 | Back Garden & Bins | 16:30, 17:00 |
| 9 | Front creche | 16:30, 17:00 |
| 10 | Paper & Soap dispensers | 16:30, 17:00 |

Each duty has a **minimum slot** = its earliest ideal slot. A person may take a duty only if their weekly slot is that or later (they must not have gone home before it's done).

### 8.2 Who is in the pool

All `rotating` staff plus **Jason** (he takes a duty even though his shift is on the pair rota). Not Shehnaz, Sue or Priscilla (fixed duties). A person is in a week's pool only if present **more than half the week** (3+ of 5 days, counting start/end dates and leave). Their **weekly slot** is the slot they work most days that week.

Today 10 people for 10 duties, so everyone normally does exactly one a week.

### 8.3 The planning rule (whole-week matching)

Each week is planned **as a whole**, not one duty at a time. Build a cost table (duties × people, plus one "leave blank" option per duty) and pick the minimum-cost assignment with the **Hungarian algorithm** (integer arithmetic, fixed scan order, so Python and JS agree exactly).

Costs, from most to least important (each tier outweighs everything below it):

| Tier | Meaning | Cost |
|---|---|---|
| Forbidden | Person finishes before the duty is done, **or** did this duty in the last 5 weeks | 10¹² |
| Blank | Leaving a duty empty | 10⁹ (+ extra 10⁷ for duties other than the "blank first" ones) |
| Moved | In a shared week being re-planned: moving someone off the duty they were given | 10⁶ |
| Not ideal | Person's slot isn't in the duty's ideal set | 10⁵ |
| Done before | Per time this person has done this duty (in history) | 10³ |
| Recency | `(6 − weeks since they last did it) × 10` | up to 60 |
| Tie-break | Position in a week-rotated list of the pool | small |

### 8.4 The 6-week no-repeat rule (hard)

**Nobody does the same duty twice in any 6 consecutive weeks.** It counts:

- weeks computed in this build,
- **already-shared (locked) weeks**, and
- **archived weeks** (`rosterHistory`), so it carries across "Start next week".

Only a manual pick can break it (section 8.7). Repeats already inside shared or past weeks are left alone and reported, not "fixed".

### 8.5 When short-staffed

If there are fewer people than duties (leave) or the rules leave a duty with nobody:

- Leave it **blank**. Blank-first order: **Paper & Soap dispensers**, then **Front creche**. These are the least important.
- The page shows a small note: "Left blank this week: …". The printout shows an empty cell, not text.
- Staff Room can be done by a 16:30 or 17:00 finisher. Back Garden & Bins by 16:30 or 17:00.

### 8.6 Why a week-wide matching

A greedy pick (duty by duty) can paint itself into a corner and leave a duty blank that a different arrangement would have filled. In testing against the real staff and leave, matching filled every duty it was possible to fill, with zero repeats across random 12-week scenarios.

### 8.7 Manual duty picks (Adjust Duty)

- Choose a person, a week and a duty from the duties that fit that person's shift.
- The pick is applied first; the rest of the week is planned around it.
- If it **breaks the 6-week rule** the app asks: "<name> already did <duty> N week(s) before… Keep this pick anyway?" Cancel leaves nothing behind. Keep saves it and shows a note under that week.
- A pick that no longer fits their shift (they finish too early) is dropped silently.
- Only the duties the pick forces to move will move in an already-shared week.

### 8.8 Duty fairness

Total duties per person is shown on the Fairness screen (duty pool only). History starts at the beginning of the window plus the archived weeks.

---

## 9. Protected weeks (the central design feature)

**Problem:** once the roster has been shared, a later unrelated change (a new holiday elsewhere, a staff edit) must not reshuffle already-shared weeks.

**Mechanism:**

1. After a change is saved, the page stores the whole result as the **lock**: `lockedRoster` (each person's slot per day) and `lockedDuties` (people per duty per week), plus a `changeWatermark` listing every leave, transfer and duty-override as it stood.
2. On the next change, the page diffs the current events against the watermark to find the **touched date ranges**:
   - a new event touches its own start–end (open-ended leave is clamped to the window end);
   - a changed event touches both its old and new range;
   - a removed event touches its old range.
3. Any **day** outside the touched ranges keeps its locked slot (shift roster). Any **week** with no day touched keeps its locked duties exactly.
4. Pinning one day can nudge another day in the same rebuild, so the shift roster runs an **iterative correction loop** (up to 10 rounds) until it stops changing, then clears stale "adjusted" highlights on days that were not touched.
5. A touched week is **re-planned, but keeps everyone on their shared duty where it still works** — a sick day or manual pick moves only what it must.
6. **A staff edit** (hours, room, a new joiner…) reopens only weeks **3 onwards**. Weeks 1–2 (this week and next) are considered shared.
7. If there is no lock yet, the first build is open everywhere and then becomes the lock.
8. When duty rules change, the lock stores a `rules` version. A lock saved under older rules keeps only its shared weeks (1–2); later weeks are re-planned under the new rules.

**Persisting:** after each user action, the new lock merges in only the weeks/days that were open; stale days before the window are dropped.

---

## 10. Start next week & history

- **Start next week** (button, with confirmation): archives week 1 (people, duties, last slot) into `rosterHistory/<monday>`, updates the last-slot memory, and moves `rosterWindow.start` forward 7 days. A new week 5 appears and gets planned. It stays a manual button.
- Fairness history starts empty each build (the window balances itself); the last slot of each person from the archive prevents week 1 repeating last week's slot.
- A **History** screen shows archived weeks (by month) so earlier rosters and duties can be viewed or reprinted.
- Archived duty weeks feed the 6-week no-repeat rule.

---

## 11. Screens (mobile layout, 16 px gutters)

| Screen | Contents |
|---|---|
| **Roster** (home) | Week tabs (5). Per person: Mon–Fri cells with shift times, `HOLIDAY` / `SICK` / `MATERNITY LEAVE`, `OFF`, own hours. Amber = covering for someone else's absence. Breaches shown under the week. Top buttons: Duties, Fairness, History, Staff & Requests, Print, Start next week |
| **Duties** | Week tabs; the ten duties + Dusting + Laundry + Cot Room/Changing Area; blank rows highlighted; notes under the list for blank duties and hand-picked repeats (in-app only, not printed) |
| **Fairness** | Shift counts per rotating person (Opening / 8:00 / 8:30 / Closing) and duty counts per duty-pool person, over the current window |
| **History** | Archived weeks |
| **Staff & Requests** | Buttons: + Add Staff, Transfer, + Add Holiday, + Add Sick, + Add Maternity Leave, Adjust Shift, Adjust Duty. Lists: Current staff, Leave & transfers (each removable with confirmation), Manual adjustments, Change log (with notes), Rules this build enforces |

Rules for the UI:

- Everything rebuilds instantly in the browser on any change, with no waiting.
- A failed build (e.g. an impossible leave) is rolled back and the reason shown.
- No colour for unchanged cells; amber only for "changed to cover".
- Leave kinds are colour-coded: holiday, sick, maternity, off.
- Confirm dialog for removing anything.
- Toasts for success.

---

## 12. Printouts

| Output | Details |
|---|---|
| **Roster PDF / Excel** | One page per chosen week: title, date range, a row per person (number, name, Mon–Fri, break text), spacer rows, breaches printed under the table. Leave cells coloured |
| **Weekly summary** | Everyone's *intended* shift for each week, even if they were away (leave never blanks it) |
| **Duty PDF** | One page per week, two columns (duty, person). Unfilled = blank. Fixed duties included |
| **Duty Summary page** | One page spanning all printed weeks: who did which duty in which week — a quick way to show fairness |
| **Print dialog** | Choose which week(s); built fresh from what's on screen; buttons PDF and Excel; checkbox for the Duty Summary |

Libraries used in the page: jsPDF, jsPDF-AutoTable, ExcelJS.

---

## 13. Testing

- **Python unit tests** (126 at last count): shift cover, pairing, same-room, leave, overrides, protected rosters, duty pool, finish-time safety, 6-week rule, short-staffed blanks, manual repeat warning, protected duties, Hungarian algorithm vs brute force, PDF/Excel writers.
- **Parity tests:** run the JS and Python engines on the live data and on ~40 random scenarios and compare shifts and duties exactly.
- **Stress test:** 12 weeks × 40 random leave scenarios — zero duty repeats; blanks only when headcount genuinely short.
- **Browser tests (Playwright):** seed a mock database with the real staff and locks; check weeks 1–2 unchanged, lock persisted after an unrelated change, blank duty note, repeat-pick confirm/cancel/keep, no page errors. Also regression suites for protected locking (35 checks) and duty locking.
- **Before any release:** compare against the live database to confirm the shared weeks are byte-for-byte unchanged.

---

## 14. Agreed but NOT built yet

Decisions already made with the owner; do not treat these as open.

### 14.1 Cover rule
- When opening is short, the **8:00 (`mid1`) person** covers (comes in at 7:30). When closing is short, the **8:30 (`mid2`) person** covers (stays to 18:00).
- A full-week gap **rotates day by day** across the eligible people.
- Borrowing the other middle shift only as a last resort, with a warning.

### 14.2 Age-group mix
- Younger rooms: Toddlers Room, Preschoolers Room. Older rooms: ECEC 1, ECEC 2. People with no room count for neither.
- **No age-group requirement at 7:30 or 18:00.** Instead the **8:00 group and the 8:30 group must each include a younger-room person and an older-room person.**
- On by default and switchable. It gives way before the minimum of 3 (headcount always wins), and a small warning shows when it can't be met.
- The existing same-room rule stays.
- Tested in an example: with this version the mix is met every week while everyone still ends level.

### 14.3 Fairness window
- Count shifts and duties over a **rolling window of 9 weeks**, carried across months (not restarting each window).
- 9 is the shortest window in which 9 rotating staff can each get exactly 2 openings, 2 closings and 5 middle shifts. In general, with 2 opening and 2 closing places a week and *N* rotating staff, the window is the smallest *w* where `2w ÷ N` is a whole number (so 8 staff → 4 weeks, 9 → 9, 10 → 5).
- The window is worked out from the staff list and shown in Settings, with a manual override.
- **Holiday (Option 2):** fairness is based on the *weeks actually worked*. Someone back from leave doesn't owe extra openings and closings; colleagues who covered get a little less later. Example: Irene is on holiday for weeks 7–8 of 9; she still ends with 2 openings and 2 closings. Tested in an example roster.

#### 14.3a Weeks where Priscilla closes (decided)
When Shehnaz is away, Jason (ECEC 2) opens every day and Priscilla closes. The same-room rule then stops David and Usha (also ECEC 2) from opening that week. Rule:

- **No repayment, no penalty.** Those weeks are treated like a week away for *opening* only: David and Usha's fair share of openings is calculated on the weeks they could actually open (same principle as holiday, 14.3). They are never given extra openings later to make up.
- **Nobody else is affected either:** the openings are shared among the others on the same weeks-eligible basis, so no one owes or is owed anything because of how management cover is arranged.
- Their closings, 8:00 and 8:30 shifts count as normal.

### 14.4 Fixed-hours staff and Priscilla
- Sue, Laura, Megan and Priscilla (and Eirini) **never count towards opening or closing** as part of the rotating headcount.
- Priscilla remains the **fallback closer** whenever neither paired person closes, so closing is always 2 rotating staff + 1 from management. Her hours are not changed by the app.

### 14.5 Settings screen (anyone with edit access)
Shift times · minimum opening/closing · rooms with their age group · age-group mix on/off · cover rule · fairness window (auto/override) · duty no-repeat gap (6) · number of protected weeks (2) · duty list with ideal finishing times and blank-first order · fixed duties (Dusting, Laundry).
A changed setting applies **from week 3 onward**; weeks 1–2 stay as shared.

### 14.6 Explicitly out of scope for the prototype
Logins and roles · approval step · who-made-which-change records · automatic Friday sending · notifications · multiple branches · half-day leave · other leave types (Training, Unpaid) · child-to-staff ratios and child numbers · the CareFlow visual style · showing room or age group on the printout.

---

## 15. Open questions

1. Is a half-hour at 7:30–8:00 and 17:30–18:00 with only one age group acceptable? (Assumed yes.)
2. When a week has fewer younger-room staff than the mix needs (e.g. two of the four away), warn only? (Assumed yes.)
3. ~~Repay David or Usha in the next window~~ — **decided: no repayment.** See section 14.3a.
4. Should Start next week stay manual indefinitely? (Yes for now.)
5. Real figures for each room (ratios, child numbers) if ratios are ever added.

---

## 16. Build prompt (paste into the new project)

> Build a mobile-first single-page app for a creche manager from the attached spec (`ROSTER_APP_SPEC.md`).
>
> Deliver in this order, verifying each step before the next:
> 1. Data models and validation (sections 4–5).
> 2. The Python shift engine: weekly base, daily repair, fallback closer, pair suspension, same-room rule (section 6), with tests.
> 3. Leave, sick, maternity and manual adjustments (section 7).
> 4. The duty planner using whole-week minimum-cost matching with the 6-week no-repeat rule, blank-first priorities and manual picks (section 8), with tests including a brute-force check of the Hungarian algorithm.
> 5. Protected weeks for both shifts and duties (section 9) — implement this early, since everything else must respect it.
> 6. A line-for-line JavaScript port of the engine, with parity tests on real and random inputs.
> 7. The screens (section 11), then the PDF/Excel printouts (section 12).
> 8. Browser tests seeded with realistic data, including a check that shared weeks never move.
> 9. Then the "agreed, not built" rules in section 14, one at a time, each with an example roster to confirm balance.
>
> Do not add logins, approvals, notifications or multi-branch support. Warn rather than block. Leave unfilled duties blank. Never change a week that has already been shared.
