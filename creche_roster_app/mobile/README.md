# Mobile preview

The phone-friendly page (Roster / Duties / Staff & Requests screens, a
Print button that hands over the real Excel + PDF) published as a Claude
Artifact for live, on-the-go review and requests. `roster_preview.html` is
the template; `build_preview.py` fills it in with a real build.

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
through the app yet, so they still come from `sample_inputs()`.

Publish the output HTML with the Artifact tool (`db`, `comments` and
`downloads` capabilities declared) to get a live link; write the returned
`staff`/`leave`/`transfers` documents to the artifact's database with
`ArtifactData` once, the first time, to seed it.
