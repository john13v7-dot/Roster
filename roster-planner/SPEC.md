# Creche Roster Planner: Build Spec

Version 1.1 · 21 September 2026 · For Claude Code

**v1.1 adds:** Android phone app for Google Play, copyright, launch screen with logo and credit (see §2, §19–§22).

---

## 0. Working rules for Claude Code

- Build from scratch. Do not reuse earlier code.
- Follow the build order in §15. Finish and test each phase before starting the next.
- If a rule is unclear or two rules conflict, **stop and ask**. Do not guess.
- Do not add features outside §14 (out of scope).
- **This is an Android phone app** that will be published on Google Play. Read §2 and §19–§22 before writing any code.
- **Never ship real staff names in a release build** (§22). The seed data in §16 is for development and tests only.
- Keep creche-specific rules (room names, floors, seat counts, shift patterns, cover numbers, duty list) in a **configuration layer**, not hard-coded, so the app can be adapted for other creches later.
- The users are managers, not developers. Plain-English labels, big buttons, no jargon, confirm before deleting, undo where possible.
- Put the two reference Excel files and the two reference photos in `/reference`. **Match their look exactly** (fonts, colours, borders, column widths).

---

## 1. Purpose

A simple local app for creche management to:

1. Plan the weekly **staff roster** (Mon–Fri).
2. Prepare the matching weekly **cleaning duties** sheet.

It replaces hand-built Excel sheets that keep producing the same errors. **Fairness is the core principle.** Everything prints as **Excel and PDF**, in the current layouts.

---

## 2. Platform and tech

- **Target: Android phones**, installed app, works fully **offline**. Published to **Google Play** later. Tablets should also work.
- **Stack (decided; change only with a written reason):** React Native with **Expo**, **TypeScript**.
- **Storage:** on-device SQLite (`expo-sqlite`). No server, no account, no login.
- **Excel:** `exceljs` (fills, borders, fonts, column widths, A4 page setup).
- **PDF:** `expo-print`, rendered from the **same HTML/CSS template** as the on-screen print preview, so PDF and Excel show identical content and layout.
- **Share / save / print:** system share sheet (`expo-sharing`) and the Android print dialog.
- **Engine:** the fairness and generation logic is a **pure TypeScript module** with no UI code, covered by automated unit tests (Jest). Rules R1–R10 and tests T1–T10 must run automatically.
- **Licences:** every library must allow closed-source commercial distribution (MIT, Apache-2.0, BSD). **No GPL or AGPL.** Keep a `THIRD_PARTY_LICENSES` file and show it in the About screen.
- **Backup:** Export / Import all data (JSON) via the share sheet, plus Android Auto Backup enabled.
- Weeks run Monday to Friday. Timezone Europe/Dublin. Store times in 24h; display as on the current sheet (see §9).
- Build with EAS Build or a local Gradle build. README explains how to run on a real phone and an emulator.

---

## 3. Screens

Bottom navigation bar: **Roster · Duties · Staff · Leave · Fairness**

### Roster (main screen)
- Week picker (◀ ▶, a date picker, and swipe left/right).
- The roster table looks like the printed one. Click any cell to edit it.
- Cell menu: the 4 shift patterns, custom times, Holiday, Maternity Leave, OFF, blank.
- Buttons: **Generate week**, **Lock week**, **Copy last week** (manual rows only), **Export Excel**, **Export PDF**.
- **Warnings panel** listing every broken rule for that week (red = must fix, amber = check).
- **Coverage strip** under the table: for each day, opening count ✓/⚠, closing count ✓/⚠, ground-floor and 1st-floor headcount per shift.

### Staff
- List grouped by room and floor.
- Buttons: **+ Add Staff**, **Transfer**, **Remove Staff (leaver)**.

### Leave
- Buttons: **+ Add Holiday**, **+ Add Maternity Leave**.
- List of all leave entries with edit and delete.

### Duties
- Shell only for now (§10).

### Fairness
- Dashboard (§8).

### Mobile layout (all screens)
- **Portrait phone:** roster table with a **sticky name column** and day columns that scroll sideways. A **Day view** toggle shows one day at a time (swipe between days) with staff, times and that day's coverage.
- **Landscape and tablet:** the full-week table, like the print.
- Touch targets at least 48 dp. Respect Android font-size settings.
- Editing a cell opens a **bottom sheet** with large options.
- **+** floating button for Add Staff, Add Holiday, Add Maternity Leave.
- Warnings show as a badge on the Roster tab. Tap to open the list.
- Native date pickers. No tiny controls, no hover-only actions.
- On-screen only: the four patterns S1–S4 may use the brand colours (§19). **Printed layouts stay exactly as today.**

---

## 4. Staff types

| Type | Who | Behaviour |
|---|---|---|
| **Rotating** | Room staff (rows 2–11) | Generator assigns one of 4 patterns per week. |
| **Paired management** | Jason, Shehnaz | Start times always complementary (§5, R3). Counted together for fairness. |
| **Manager** | Priscilla | Manual hours only. Counts as closing cover (R2). Not in fairness. **Not in payroll.** |
| **Static** | Sue, Laura (cook), Megan (curriculum coordinator) | Fixed weekly hours. Generator never changes them. Any cell can be edited by hand. Not in fairness. Megan is **not in payroll**. |

- Static hours: Sue 08:30–13:30 Mon–Fri. Laura 09:00–13:00 Mon–Fri. Megan blank (manual).
- Priscilla's hours are always typed by hand.
- Add a `payroll_included` flag per person. Default true; false for Priscilla and Megan.

---

## 5. Roster rules (priority order)

Nothing blocks saving. The app **warns**; the manager decides.

### Shift patterns (9-hour span, 8 paid + 1 unpaid lunch)

| Code | Start | End |
|---|---|---|
| S1 | 07:30 | 16:30 |
| S2 | 08:00 | 17:00 |
| S3 | 08:30 | 17:30 |
| S4 | 09:00 | 18:00 |

### Rules

| ID | Rule | Severity |
|---|---|---|
| R1 | **Opening cover:** every day, at least 3 people start at 07:30: one of Jason/Shehnaz plus at least 2 room staff. | Red |
| R2 | **Closing cover:** every day, at least 3 people finish at 18:00: one of Jason/Shehnaz plus at least 2 room staff. **If neither Jason nor Shehnaz closes, Priscilla must close** plus at least 2 room staff. | Red |
| R3 | **Jason and Shehnaz complement each other.** Jason S1 ⇒ Shehnaz S4. Jason S4 ⇒ Shehnaz S1. They only ever take S1 or S4. If one is away, the other is set by hand and the app warns "set manually". | Amber |
| R4 | **Floor balance** (see below). | Red / Amber |
| R5 | **Vacant seats:** a vacant seat has no shifts, is left blank on print, and is not counted as cover. Warn per vacancy. | Amber |
| R6 | **Room capacity:** warn when a room exceeds its seat count. | Amber |
| R7 | **Leave:** nobody on leave is given a shift. | Red |
| R8 | **One pattern per week** for each rotating person. Day-level edits are allowed but flagged as overrides. | Info |
| R9 | **No repeat:** the same pattern two weeks running is flagged unless forced by R1–R4. | Amber |
| R10 | **Fairness outlier:** a person has 2 or more of a pattern than the least-served colleague. | Amber |

### Floors and rooms

| Floor | Room | Seats | Roster rows |
|---|---|---|---|
| Ground | Toddlers | 2 | 2, 3 |
| Ground | Preschoolers | 3 | 4, 5, 6 |
| 1st | ECEC 1 | 3 | 7, 8, 9 |
| 1st | ECEC 2 | 2 + Jason | 10, 11 (+ Jason) |

- Staff help each other across rooms **on the same floor**, so balance is checked **by floor**, not by room.
- Jason belongs to 1st floor (ECEC 2). Shehnaz and Priscilla are floaters: count them on whichever floor has fewer people in that shift.
- **R4 default (configurable, confirm with me):**
  - Red if either floor has **zero** staff at opening (07:30) or closing (18:00).
  - Amber if, within any shift pattern, the two floors differ by more than 1.

---

## 6. Generation (fairness engine)

**Generate week** proposes a draft roster for the chosen week. The manager reviews, edits, then **locks** it. Only locked weeks feed the fairness counts.

### Priority order
1. Hard rules R1, R2, R3, R4 (zero-floor check), R7.
2. **Fairness** across patterns.
3. **Stepping:** each person moves to the next pattern: S1 → S2 → S3 → S4 → S1.

**Fairness beats stepping when they clash.** Hard rules beat both.

### Method
- Inputs: eligible rotating staff (not on leave, not vacant), each person's pattern counts, last pattern, next-in-cycle pointer.
- Step 1: place Jason and Shehnaz (alternate; whoever had S1 last week takes S4).
- Step 2: assign patterns to rotating staff, minimising:
  `cost(person, pattern) = fairness (how often they've had this pattern) + small penalty if not their next-in-cycle pattern + penalty if same as last week`
- Subject to R1, R2, R4 (zero-floor). Backtracking or brute force is fine at this size (about 12 people, 4 patterns).
- **Deterministic:** same inputs give the same output. Ties break by "longest since last S1/S4".
- Make the **smallest change** from pure stepping needed to satisfy the hard rules. Record why any person deviated from stepping (shown in the warnings panel as info).
- Weights are configurable in Settings. Default: all four patterns weighted equally.

### Leave and fairness
- Weeks fully on leave **do not count** for anyone's fairness and **pause** that person's pointer.
- On return, the person gets the pattern they would have had before leave.
- A partly-worked week counts if they worked at least 1 day.
- Leave never penalises or advantages anyone.

### Manual edits
- Manual overrides are recorded and **count** in the ledger, so history stays true.
- Unlocking a week recomputes the ledger from locked weeks.

---

## 7. Staff management

### Add Staff
- Fields: name, room group (Toddlers / Preschoolers / ECEC 1 / ECEC 2), start week.
- The new person **fills a vacant seat in that room first**. If none, a new row is inserted in that room's block and rows renumber.
- Then room headcount and floor balance are rechecked.

### Transfer
- Only entered manually, when a staff member asks to change room.
- Fields: person, new room, **effective week**.
- Applies **from that week onward**. Earlier weeks and their printouts stay unchanged, so store **room history per person**, not just a current room.
- The person's row moves into the new room's block. Shift and manual entries move with them.
- The seat they left shows as vacant.

### Remove Staff (leaver)
- Fields: person, last week. The seat becomes vacant from the next week. (Assumption; confirm.)

### Row numbering
- Row numbers are positions, not IDs, and renumber automatically.
- Layout order (seed): Sue, Toddlers block, Preschoolers block, ECEC 1 block, ECEC 2 block, 2 spare blank rows, long-term-leave row(s), Megan, Jason, Shehnaz, Priscilla, Laura.

---

## 8. Fairness dashboard

- Table: person × pattern (S1–S4) counts, last pattern, next-in-cycle pattern.
- Jason and Shehnaz shown as a pair.
- Highlight outliers (R10).
- Duty counts per person per duty (empty until duties are used, see §10).
- Static staff, Priscilla and Megan are excluded.
- Seeded from the week of 21–25 September 2026, with each rotating person's pattern counted once. Optional CSV import for earlier history.

---

## 9. Print and export

### Roster (`.xlsx` and PDF)
- Title **STAFF ROSTER** (red, serif), then the date range as **21st – 25th September 2026** (bold, with ordinals).
- Columns: No. | Name | Mon | Tue | Wed | Thu | Fri | Break | blank notes column.
- No day-heading row by default. Settings toggle: "Show day headings" (default off).
- Times shown as on the current sheet, e.g. `7:30 – 4:30`, `8:30 – 1:30`, `9:00 – 6:00`. **Standardise** the separator and format (the current sheet mixes `8:00 -5:00`, `9.00 - 6.00`).
- Break column shows `10 MINS` on every staff row. Blank on spare rows. Information only.
- Colours: **Holiday** red, **Maternity Leave** dark green, **OFF** light green.
- Vacant rows print with a blank name and blank cells.
- One week per A4 page, fit to page, printer-ready.

### Duties (`.xlsx` and PDF)
- Title **CLEANING DUTIES**, then the date range.
- Table: **Duties | Staff**.
- Option to print one week or two weeks per page (the current sheet shows two).

### Delivery on Android
- **Export Excel** and **Export PDF** create the file, then open the share sheet (save to Files or Drive, email, WhatsApp).
- **Print** opens the Android print dialog.
- File names: `Roster_2026-09-21.xlsx`, `Roster_2026-09-21.pdf`, `Duties_2026-09-21.xlsx`, `Duties_2026-09-21.pdf`.
- Before sharing, show: "This file contains staff names. Share it carefully."
- Delete temporary export files after sharing.

---

## 10. Duties page (shell only)

Build the page and print layout now. **Assignment logic comes later; I will send the rules.**

### Fixed duty list (in this order)
1. Cot Room
2. Changing Area
3. Hallway upstairs / Hover stairs upstairs
4. Children's Toilets
5. Staff Toilet upstairs
6. Kitchen
7. Staff Room
8. Hallway downstairs / windows / door handles
9. Staff Toilet
10. Back Garden
11. Bins
12. Front creche
13. Paper and Soap dispensers
14. Spare
15. Dusting (check if we had spider webs)
16. Laundry (laundry to be done in the morning and the last one at 2pm)

### Now
- Each duty has a **manual** staff cell.
- Only people **working that week** appear in the picker (linked to the locked roster). Show their hours so the manager can see who is in at the right time (e.g. nobody who has left before the 2pm laundry).
- Defaults: Cot Room and Changing Area = "Staff working in the room". Dusting = Sue. Laundry = Shehnaz/Priscilla.
- Store every assignment per week so duty fairness can be added later without a rebuild.
- One person can hold more than one duty (Back Garden and Bins share a person).

### Later (do not build yet)
Auto-assign with fairness: everyone cycles through all duties before repeating, and nobody gets the same duty two weeks running.

---

## 11. Payroll-ready data (do not build payroll)

- Each day's entry stores: start, end, `unpaid_lunch_minutes`, type (shift / holiday / maternity / off), source (generated / manual).
- The four patterns carry **60 unpaid lunch minutes** (8 paid hours). The 10-minute break is **paid**, so it changes nothing.
- Short static shifts (Sue, Laura) have no lunch deduction.
- Leave types must be easy to extend: **sick leave comes later** (one-day entries), with a **monthly hours report** for payment.
- Priscilla and Megan are excluded via `payroll_included = false`.
- Jason and Shehnaz are included (assumption; confirm).

---

## 12. Leave

- **Add Holiday** and **Add Maternity Leave**: person, From date, To date.
- Dates fill the roster automatically, **Mon–Fri only**, across as many weeks as needed. Weekends are skipped.
- Holiday = red, Maternity Leave = dark green. Maternity To date is optional ("until further notice").
- Entries are editable and deletable, and the roster updates.
- When Jason or Shehnaz is away, warn that the other's start must be set by hand (R3).
- Holidays are full days. A half day is a manual edit.

---

## 13. Data model (suggested)

| Table | Key fields |
|---|---|
| `staff` | id, name, type, payroll_included, active_from, active_to |
| `rooms` | id, name, floor, seats, sort_order |
| `room_history` | staff_id, room_id, from_week, to_week |
| `shift_patterns` | code, start, end, unpaid_lunch_min |
| `static_hours` | staff_id, weekday, start, end |
| `leave` | id, staff_id, type, from_date, to_date (nullable for maternity) |
| `roster_weeks` | week_start, status (draft / locked) |
| `roster_entries` | week_start, staff_id, date, type, start, end, unpaid_lunch_min, source, note |
| `fairness_ledger` | staff_id, week_start, pattern_code |
| `duties` | id, name, sort_order, default_text |
| `duty_assignments` | week_start, duty_id, staff_ids, text |
| `settings` | key, value |

---

## 14. Out of scope (v1)

- Payroll and monthly hours report, sick leave (data is ready, features later).
- Duties auto-assignment.
- Logins, multiple sites, cloud hosting or sync between phones, ads, in-app purchases, analytics.
- iOS. Keep the code portable so it can follow later.
- Closure and bank-holiday logic (managers use OFF or a manual note).

---

## 15. Build order

1. **Foundation:** Expo project, SQLite, staff, rooms, seed data (below), roster grid with phone and tablet layouts matching the print layout.
2. **Export:** `.xlsx` and PDF for the roster, shared from a real Android phone. Compare against `/reference` before moving on.
3. **Leave:** Add Holiday, Add Maternity Leave, auto-fill.
4. **Staff changes:** Add Staff, Transfer, Remove, vacancies, renumbering, room history.
5. **Rules and warnings:** R1–R10, coverage strip.
6. **Generator and fairness:** stepping, fairness ledger, lock/unlock, dashboard.
7. **Duties shell:** page, picker, print.
8. **Polish:** README, backup/restore, plain-English wording, error messages.
9. **Branding:** launch sequence, logo and icons, About screen, copyright (§19, §20).
10. **Release prep:** privacy, release build without real staff data, signed `.aab`, Play listing assets, `RELEASE.md` (§21, §22).

---

## 16. Seed data

### Rooms and staff (as of week 21–25 Sep 2026)

| Row | Name | Type | Room |
|---|---|---|---|
| 1 | Sue | Static | none |
| 2 | Hanny | Rotating | Toddlers |
| 3 | **VACANT** | none | Toddlers |
| 4 | Manuel | Rotating | Preschoolers |
| 5 | Irene | Rotating | Preschoolers |
| 6 | Deoshree | Rotating | Preschoolers |
| 7 | Sandrine | Rotating | ECEC 1 |
| 8 | Daniel | Rotating | ECEC 1 |
| 9 | Arantza | Rotating | ECEC 1 |
| 10 | David | Rotating | ECEC 2 |
| 11 | Usha | Rotating | ECEC 2 |
| 12–13 | spare blank rows | none | none |
| n/a | Eirini | On maternity leave | room to confirm |
| 14 | Megan | Static, off payroll | none |
| 15 | Jason | Paired management | ECEC 2 (1st floor) |
| 16 | Shehnaz | Paired management | none (floater) |
| 17 | Priscilla | Manager, manual | none |
| 18 | Laura | Static (cook) | none |

### Week 21–25 September 2026 (starting point for fairness)

| Person | Mon–Fri |
|---|---|
| Sue | 8:30–1:30 (Thu OFF, manual) |
| Hanny, Deoshree, Jason | S1 7:30–4:30 |
| Manuel, Daniel | S2 8:00–5:00 |
| Sandrine, David | S3 8:30–5:30 |
| Irene, Arantza, Usha | S4 9:00–6:00 |
| Priscilla | Mon 10:00–2:00, Tue–Fri 10:00–6:00 (manual) |
| Laura | 9:00–1:00 |
| Shehnaz | Holiday (all week) |
| Eirini | Maternity Leave (all week) |
| Megan | blank |

(The reference photo also shows shifts on the vacant row 3. The app must **not** reproduce that; see test T1.)

### Duties reference (from the photo; verify before seeding)

| Duty | 21–25 Sep | 28 Sep–2 Oct |
|---|---|---|
| Cot Room / Changing Area | Staff working in the room | Staff working in the room |
| Hallway upstairs | David | Usha |
| Children's Toilets | Usha | David |
| Staff Toilet upstairs | Irene | Daniel |
| Kitchen | Arantza | Deoshree |
| Staff Room | Hanny | Manuel |
| Hallway downstairs | Sandrine | Hanny |
| Staff Toilet | Daniel | Irene |
| Back Garden + Bins | Deoshree | Sandrine |
| Front creche | Manuel | Jason |
| Paper and Soap dispensers | Jason | Arantza |
| Spare | blank | blank |
| Dusting | Sue | Sue |
| Laundry | Shehnaz/Priscilla | Shehnaz/Priscilla |

---

## 17. Acceptance tests

| # | Test | Expected |
|---|---|---|
| T1 | Enter shifts on vacant row 3. | Red/amber warning (R5). Print leaves the row blank. |
| T2 | Load the seed week and export. | `.xlsx` and PDF match the reference layout. |
| T3 | Add Holiday for Hanny, 28 Sep – 2 Oct. | Mon–Fri cells red "Holiday". Her pointer and counts are unchanged on return (next pattern S2). |
| T4 | Add Staff "X" to Toddlers. | X fills row 3. No new row. |
| T5 | Transfer Usha to Toddlers from week of 5 Oct. | Weeks before 5 Oct unchanged, later weeks show the new room, ECEC 2 shows a vacancy. |
| T6 | Add a 4th person to Preschoolers. | Capacity warning (R6), row inserted, rows renumber. |
| T7 | Generate 28 Sep week with Shehnaz back. | Pure stepping would put **Sandrine, David and Jason (all 1st floor)** on the 18:00 close. The generator must swap in at least one ground-floor person and log the deviation. |
| T8 | Jason set to S1 with Shehnaz on holiday. | Warning "set manually". Closing shows Priscilla as management cover. |
| T9 | Lock a week, then edit a cell by hand. | Ledger updates with the manual value. |
| T10 | Export the same week to Excel and PDF. | Identical content. |
| T11 | Cold-start the app. | Native splash, then the intro screen with logo, credit line and copyright line, then the Roster. Tap skips the intro. |
| T12 | Open About. | Shows logo, version, credit line, copyright line, privacy policy link, open-source licences. |
| T13 | Airplane mode. | Every feature works, including exports. |
| T14 | Export and share on a real Android phone. | Share sheet opens and the file opens correctly in Excel and a PDF viewer. |
| T15 | Install the release build (`.aab` via internal test track or `bundletool`). | App opens **empty**, with no real staff names anywhere. |

---

## 18. Open items to confirm

1. **Floor balance rule** (R4): is "at least 1 per floor at opening and closing, and within 1 person across floors in each shift" what you want?
2. **Eirini's room:** needed for seat counts.
3. **Jason and Shehnaz in payroll:** assumed yes.
4. **Leavers:** the Remove Staff behaviour above is an assumption.
5. **Fixed starts:** confirm no rotating staff member has a fixed start time. Only Sue, Laura, Megan and Priscilla are fixed.
6. **Duties rules:** to come from me.
7. **Priscilla's hours:** manual only.
8. **App name:** working title "Creche Roster Planner". Confirm the final name.
9. **Package name:** proposed `com.davidjuste.rosterplanner`. It cannot change after publishing.
10. **Contact email and privacy policy URL** for the About screen and Google Play.
11. **Credit wording:** "Done by David Juste" as written. Easy to change in `branding.ts`.
12. **Logo:** draft supplied in `/assets`. Keep, or replace with a professional one.

---

## 19. Branding, launch screen and logo

- **Working name:** Creche Roster Planner. Keep the name, credit and copyright text in one file, `branding.ts`.

### Launch sequence (every cold start)
1. **Native Android splash:** logo on the brand-colour background. (Android 12+ shows only the icon here, so no text can go on it.)
2. **In-app intro screen**, about 2.5 seconds, **tap to skip**, gentle fade-in:
   - the logo, large and centred
   - the app name
   - **"Done by David Juste"**
   - small: **"© 2026 David Juste. All rights reserved."** and the version number
3. Then open the Roster on the last viewed week.

### Logo
- Draft files: `/assets/logo.svg` (full icon) and `/assets/logo-foreground.svg` (adaptive-icon foreground). Full code in Appendix A.
- Concept: a calendar page with four staggered coloured bars. Each bar is one shift pattern (S1–S4), and the stagger shows the rotation. A small sun keeps it friendly for a creche.
- Colours: brand blue `#1F4E79` (gradient `#2C6FAE` → `#173E66`), S1 `#F6AD55`, S2 `#68D391`, S3 `#63B3ED`, S4 `#F687B3`, sun `#F6C945`.
- Generate from the SVGs:
  - Android **adaptive icon**: foreground on transparent, background solid `#1F4E79`, artwork inside the central safe zone
  - **monochrome** icon for Android 13 themed icons
  - Play Store icon **512 × 512 PNG**
  - Play feature graphic **1024 × 500 PNG** (logo, name, one-line tagline)
  - splash logo PNG
- Font: a clean sans-serif with a free licence (Inter or the system font).

### About screen
Logo, name, version, credit line, copyright line, contact email, **Privacy Policy** link, **Open-source licences**.

---

## 20. Copyright and legal

- Notice everywhere: **© 2026 David Juste. All rights reserved.**
- Put it in:
  - the intro screen and About screen
  - `README.md`
  - a `LICENSE` file: proprietary, all rights reserved, no permission to copy, modify or redistribute, and no open-source licence
  - a header comment in every source file: `// © 2026 David Juste. All rights reserved. Proprietary and confidential.`
  - app metadata (author, developer name)
  - the Google Play listing
- Keep the source repository **private**.
- Third-party libraries keep their own licences and are credited in About.
- This is not legal advice. David should confirm ownership, registration and trademark (app name and logo) with an IP adviser before publishing.

---

## 21. Google Play release

Check Google Play Console's current requirements at release time: they change.

- **Developer account:** David creates it (one-off registration fee, identity verification). Some new accounts must complete a closed-testing period before production.
- **Identifiers:** package `com.davidjuste.rosterplanner` (confirm), `versionName` 1.0.0, `versionCode` increases with every upload.
- **Build:** signed **Android App Bundle (`.aab`)**. Use **Play App Signing**. Create an upload keystore, **back up the keystore and passwords outside the repo** (losing them blocks updates), and never commit them.
- Meet the **target API level** Google Play requires at release time.
- **Permissions:** none beyond the defaults. No internet permission for now.
- **Store listing:**
  - icon 512 × 512, feature graphic 1024 × 500
  - at least 2 phone screenshots, using fictional demo data
  - short description (80 characters) and full description
  - category (Business or Productivity), contact email, privacy policy URL
- **Forms:** content rating questionnaire and Data safety form. Expected answers: no data collected or shared, data stays on the device. Verify at the time.
- **Tracks:** internal test → closed test → production.
- **Before release:** first-run **setup** so another creche can enter its own rooms, floors, seats, shift patterns and duties (this creche's setup available as a template).
- Claude Code writes a `RELEASE.md` checklist covering all of the above.

---

## 22. Privacy and data

- Data stays **on the phone**. No network calls, no analytics, no ads, no crash reporters that send data.
- Staff names, hours and leave are **personal data** (GDPR). The privacy policy must say this plainly.
- **Seed data with real names is development-only.** The release build starts **empty**, with an optional **"Load demo data"** using fictional names. Enforce this with a build flag and test T15.
- Settings: **Delete all data** (with confirmation).
- Optional **app lock** (PIN or biometric) in Settings, using `expo-local-authentication`.
- Exports contain staff names: warn before sharing (§9).
- Claude Code drafts `PRIVACY_POLICY.md`. David publishes it at a public URL and links it in About and the Play listing.
