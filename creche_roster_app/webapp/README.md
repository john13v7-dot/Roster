# Standalone roster app (no Claude in the loop)

A self-contained, installable web app version of the roster: same real
`creche_roster` scheduling engine, own Firebase-hosted database, and a
Cloud Function that reruns the scheduler automatically whenever staff,
leave or transfers change - so it works entirely on its own once deployed.
See `DEPLOY.md` for the one-time setup.

## Layout

```
webapp/
  public/               the installable web app (PWA)
    index.html           screens/markup, same design as the Claude-hosted version
    app.js                all the app logic: Firebase Auth, live Firestore data, forms
    firebase-config.js     your project's config (fill in during deploy)
    manifest.json, sw.js    PWA installability (Add to Home Screen) + app-shell caching
    icons/
  functions/             the Cloud Function backend
    main.py                Firestore triggers + a daily scheduled rebuild + a manual one
    roster_json.py         builds the same JSON shape mobile/build_preview.py does
    creche_roster/          vendored copy of ../../creche_roster - NOT hand-edited here;
                             see "Keeping this in sync" below
  seed/                  one-time data migration (see DEPLOY.md step 7)
  firebase.json, firestore.rules, firestore.indexes.json, storage.rules
  DEPLOY.md               the actual step-by-step setup guide
```

## How a change flows through

1. Someone taps Add Staff / Add Holiday / Transfer / delete something in
   the app -> a plain write to Firestore (`staff`, `leave` or
   `transfers`).
2. That write fires a Cloud Function (`main.py`), which reads *all*
   current staff/leave/transfers, reruns `engine.build_roster` and
   `duties.build_duty_roster` over the whole thing (never a patch),
   regenerates the Excel/PDF, and writes the result to `roster/current`
   plus a `changelog` entry (computed from a real before/after diff of
   who else's schedule changed).
3. Every open copy of the app is listening to `roster/current` live, so
   it updates itself within a few seconds - no refresh needed, no one to
   ask.
4. A scheduled Function also reruns this once a day, since the roster
   window is always "the current week onward" - it has to move forward
   even on a day nobody touches anything.

## Keeping `functions/creche_roster/` in sync

It's a vendored copy of the real package (`../../creche_roster/`), not a
fork - if the engine changes there (a bug fix, a new rule), re-copy it:

```bash
rm -rf webapp/functions/creche_roster
cp -r creche_roster webapp/functions/creche_roster
```

then redeploy functions (`firebase deploy --only functions` from Cloud
Shell, per DEPLOY.md). `mobile/build_preview.py` (the Claude-hosted path)
and `webapp/functions/` (this one) both call the exact same engine code
either way - nothing about the scheduling rules themselves differs
between the two.
