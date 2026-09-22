# Mobile preview

The phone-friendly page (Roster / Duties / Fairness / Staff & Requests
screens, a Print button that hands over the real Excel + PDF) published as
a Claude Artifact for live, on-the-go review and requests.
`roster_preview.html` is the template; `build_preview.py` fills it in with
a real build.

```
python mobile/build_preview.py --db-export db_export.json --start 2026-09-28 --out-dir out/
```

`db_export.json` is `{"staff": [...], "leave": [...], "transfers": [...]}` -
the same shape the page's own Add Staff / Transfer / Add Holiday / Add
Maternity Leave buttons write to its live database (fetch it with the
ArtifactData tool's `list` action on each collection). `db_import.py` in
the main package turns that into a real `Inputs` and `build_preview.py`
runs the actual engine on it - nothing here is hand-typed.

Settings, fairness history and the last-slot memory aren't editable
through the app yet, so they still come from `sample_inputs()`. Every
build re-runs the real engine over the *whole* roster from these inputs -
it's never a patch applied to the previous result - so opening/closing
cover and fairness are readjusted across everyone automatically on every
request (a leave change, a staff change, anything), not just for the
person the request was about. A brand-new staff doc with no entry in
`history` is seeded at the team's rounded average per slot rather than
zero, so they're folded into the fair rotation from day one instead of
looking artificially "owed" every slot at once.

Publish the output HTML with the Artifact tool (`db`, `comments` and
`downloads` capabilities declared) to get a live link; write the returned
`staff`/`leave`/`transfers` documents to the artifact's database with
`ArtifactData` once, the first time, to seed it.

## Duties and fairness

`creche_roster/duties.py` generates the weekly cleaning-duty rota (Cot
Room / Changing Area filled by whoever's already working that room; Sue
always Dusting; Shehnaz/Priscilla always Laundry; everyone else - the
rotating shift staff, plus Jason, who takes a duty even though his own
shift follows the separate pairing rota with Shehnaz - gets exactly one of
the ten remaining duties a week, chosen to keep both duty-type variety and
total load fair over time). `build_preview.py` runs it alongside the shift
engine and adds two more fields to the page's data: `duties` (the Duties
screen's per-week table) and `fairness` (the Fairness screen's two tallies
- shift-slot counts for the rotating staff, and duty counts for the duty
pool, both over the current 4-week build). Nobody in management, Priscilla,
the cook (Laura) or Sue is part of the shift-fairness count, matching how
they don't rotate shifts in the first place; Sue and Shehnaz/Priscilla are
likewise left off the duty-fairness count, since their duty never rotates.

Like the roster itself, both are recomputed from scratch on every build -
never a patch - so they stay consistent with whatever leave/staff changes
triggered the rebuild.
