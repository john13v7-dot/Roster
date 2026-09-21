# Creche Roster — Android app

A native Android port of the `creche_roster_app` Python tool, so the roster can
be built and checked straight from a phone: staff, leave and overrides are
edited on-device, the same scheduling engine builds the roster, and it can be
viewed on-screen or exported as a shareable PDF.

## What was actually verified, and what wasn't

This was written in a sandboxed cloud environment with **no Android SDK
available** (Google's SDK servers are blocked by that environment's network
policy) — only a JDK and Gradle. That splits the project into two very
different confidence levels:

- **`engine/` — verified.** This is a line-for-line Kotlin port of the Python
  tool's `engine.py`, `models.py`, `parsing.py`, `layout.py` and `sample.py`
  (see `engine/src/main/kotlin/com/creche/roster/engine/`). It has no Android
  dependency at all, so it *was* actually compiled and unit-tested in that
  sandbox with a plain `gradle test` — 37 JUnit tests, mirroring 37 of the
  Python suite's 45 (the other 8 were Excel/PDF file-I/O tests specific to
  the desktop tool and don't apply here), **all passing**. That is real
  evidence the scheduling logic — opening/closing cover, the pairing rule,
  fair rotation, leave, overrides — behaves the same as the tested Python
  version, not just a hopeful translation.
- **`app/` — written carefully, not build-verified.** The Compose UI, the
  JSON persistence layer, and the PDF exporter could not be compiled in that
  sandbox (building an Android *application* module needs the actual Android
  SDK platform jars, which are only distributed through Google's SDK
  manager). It was reviewed by hand for type and API correctness, and one
  real bug (a missing `dp` import) was caught this way — but hand review is
  not a substitute for a compiler. **The first thing to do is open this in
  Android Studio and let it build.**

## Opening it

1. Install Android Studio (Koala/2024.1 or newer recommended).
2. `File > Open`, pick the `creche_roster_android/` folder.
3. Let Gradle sync — this downloads the Android SDK platform (34) and build
   tools automatically if they aren't already installed.
4. Run the `:engine` module's tests first (`engine/src/test/kotlin`, right-click
   → Run) — they should still all pass; if anything is red, that's the engine
   port, not the UI, and worth fixing first.
5. Run the `app` configuration on an emulator or a phone over USB (enable
   Developer Options → USB debugging on the phone) to actually see it work.
6. `Build > Generate Signed App Bundle / APK` when you want an installable
   APK to sideload — Android Studio walks you through creating a signing key.

If Compose flags anything in `Widgets.kt`'s `menuAnchor()` call, see the
comment on the `compose-bom` line in `app/build.gradle.kts` — it explains the
version trade-off that was made and how to move to a newer BOM if you want to.

## What it does

- **Staff / Leave / Overrides / Settings / History** — the same five inputs
  as the Excel tool's tabs, editable as simple on-device forms, persisted to
  a JSON file in the app's private storage (no Excel dependency on the phone).
  Settings also lets you add, rename and remove floors, each with its own
  minimum opening/closing cover; renaming a floor moves its staff with it,
  removing one moves its staff onto the first remaining floor (at least one
  floor must always exist). The Staff screen has a "Select" mode (checkboxes
  per row, with Select all/Clear all) for bulk actions: set a floor, or set a
  fixed start time — the latter also switches the selected staff's role to
  "fixed" — across every checked person at once.
- **Roster** — builds the roster with the same engine, shows it as a
  horizontally-scrollable coloured grid (one tab per week, matching the old
  paper roster's look: red title, Holiday/Maternity/OFF colouring), and can
  export + share a PDF of it (one portrait page per week, drawn with
  Android's built-in `PdfDocument` — no extra library).
- **Checks** — the same hard-rule breach / warning / info reporting as the
  Excel tool's Checks tab.
- **Totals** — the same period and cumulative start-time counts as the Excel
  tool's Totals tab, so you can see the numbers you'd otherwise copy into
  History for the next run (here it's the same History screen, so there's
  nothing to copy — saving a roster already updates it).

## Deliberate scope cuts (first pass)

- **No true `.xlsx` export.** Generating richly-styled Excel files from
  Android reliably needs a library like Apache POI, which has known rough
  edges on Android (AWT/StAX dependencies) that would have been unverifiable
  here. The PDF export covers the "hand someone a roster" need instead.
- **minSdk 26** (Android 8.0+, 2017) — chosen so the engine's `java.time`
  types work natively without adding a core-library-desugaring dependency
  that could not be verified here.

## Code map

| Path | Job |
|---|---|
| `engine/.../engine/Models.kt` | data classes (Kotlin port of `models.py`) |
| `engine/.../engine/Parsing.kt` | date/time/hours parsing (`parsing.py`) |
| `engine/.../engine/Engine.kt` | the scheduling engine itself (`engine.py`) |
| `engine/.../engine/Layout.kt` | shared grid layout, used by both the Roster screen and the PDF (`layout.py`) |
| `engine/.../engine/SampleData.kt` | the same starter staff list (`sample.py`) |
| `engine/src/test/...` | 37 JUnit tests ported from `tests/test_roster.py` |
| `app/.../data/Repository.kt` | JSON persistence (`org.json`, no extra dependency) |
| `app/.../data/AppState.kt` | process-wide state + re-running the engine on every change |
| `app/.../pdf/PdfExporter.kt` | multi-page PDF export via `android.graphics.pdf.PdfDocument` |
| `app/.../ui/screens/*.kt` | one file per screen (Staff, Leave, Overrides, Settings, History, Roster, Checks, Totals) |
