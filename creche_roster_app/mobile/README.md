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

Settings aren't editable through the app yet, so they still come from
`sample_inputs()`. Fairness history and the last-slot memory start empty
on every build, on purpose: the roster's own 4 weeks are balanced fairly
among themselves, not against whatever was worked before the window -
matching the Fairness screen, which likewise only ever shows those same 4
weeks (see "Duties and fairness" below for why). `db_import.py`'s
new-joiner seeding (team average rather than zero) still exists and is
still exercised directly in `tests/test_db_import.py` for whoever calls it
with real history of their own; `build_preview.py` itself just doesn't
pass any, so in practice everyone starts level.

Every build re-runs the real engine over the *whole* roster from these
inputs - it's never a patch applied to the previous result - so
opening/closing cover and fairness are readjusted across everyone
automatically on every request (a leave change, a staff change, anything),
not just for the person the request was about.

Publish the output HTML with the Artifact tool (`db`, `comments` and
`downloads` capabilities declared) to get a live link; write the returned
`staff`/`leave`/`transfers` documents to the artifact's database with
`ArtifactData` once, the first time, to seed it.

## Duties and fairness

`creche_roster/duties.py` generates the weekly cleaning-duty rota (Cot
Room / Changing Area filled by whoever's already working that room; Sue
always Dusting; Shehnaz/Priscilla always Laundry). Everyone else - the
rotating shift staff, plus Jason, who takes a duty even though his own
shift follows the separate pairing rota with Shehnaz - gets exactly one of
the ten remaining duties a week, matched to their actual finish time that
week (`DUTY_ELIGIBLE_SLOTS`): Kitchen / Hallway downstairs / Children's
Toilets go to whoever's on 8:00pm or 5:30pm close (they take longer);
Bins / both Staff Toilets go to the 4:30pm finishers (quick jobs); the
rest go to the 5:00pm finishers. `build_duty_roster` needs the already-
built shift `Roster` for this (not just `Inputs`), since that's what says
who's on which shift each week. When a week's actual headcount doesn't
split cleanly across those three groups (someone on leave, an uneven
shift mix), whatever's left over - a duty its group came up short for, a
person whose group had no duty left - is paired up the same fair,
least-done-first way rather than left undone or left without a turn.

`build_preview.py` runs it alongside the shift engine and adds two more
fields to the page's data: `duties` (the Duties screen's per-week table)
and `fairness` (the Fairness screen's two tallies - shift-slot counts for
the rotating staff, and duty counts for the duty pool, both over the
current 4-week build). Nobody in management, Priscilla, the cook (Laura)
or Sue is part of the shift-fairness count, matching how they don't
rotate shifts in the first place; Sue and Shehnaz/Priscilla are likewise
left off the duty-fairness count, since their duty never rotates.

Like the roster itself, both are recomputed from scratch on every build -
never a patch - so they stay consistent with whatever leave/staff changes
triggered the rebuild.

## Rooms

`Staff.room` (Toddlers Room, Preschoolers Room, ECEC 1, ECEC 2 - set on
the Add Staff form, or via `db_import.py`'s `room` field on a staff doc)
drives a hard rule enforced in `engine.py`: two staff in the same room
can never be on the same shift slot. The weekly base assignment
(`_assign_weekly_base`) actively avoids it, including a swap-based
cleanup pass (`_resolve_room_clashes`) for the case a 3-person room's
members all land in the two flexible 8:00/8:30 slots the same week (only
2 slots for 3 people, so a clash there is arithmetically forced, not a
bad pick, unless one of them gets swapped into a different slot with
someone from another room). The daily repair pass is room-aware the same
way. Whatever's still genuinely unavoidable (typically a manual Override
pinning two room-mates to the same slot) is reported as a "Room clash"
breach, not silently allowed - same as opening/closing cover. Eirini has
no room yet (unknown - she's on maternity leave), so she isn't part of
the rule until one's set.
