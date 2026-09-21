# Creche Roster Planner

An offline Android app for planning a creche's weekly staff roster and
cleaning duties. See `SPEC.md` for the full build spec this app is being
built against, and `reference/` for the Excel/photo layouts it must match.

© 2026 David Juste. All rights reserved.

## Status

Phase 1 (Foundation) is in progress: project scaffold, on-device SQLite
schema, the configuration layer (`src/config/creche.config.ts`), seed data
for the week of 21–25 September 2026, and the Roster screen's phone/tablet
grid. Export, Leave, Staff management, rules/warnings, the fairness
generator, the Duties shell, branding and release prep follow in later
phases (`SPEC.md` §15).

## Requirements

- Node.js 18+ and npm
- The [Expo Go](https://expo.dev/go) app on an Android phone, or an Android
  emulator (Android Studio) — no other account or server is needed
- A macOS machine only if you also want to run the iOS simulator (not a
  target platform for this app, see `SPEC.md` §14)

## Running on a real Android phone

```
npm install
npm run android
```

This starts the Metro bundler and prints a QR code. Scan it with Expo Go
(Android) or the device's camera app. The app runs fully offline once
loaded — no network calls are made by the app itself.

## Running on an Android emulator

1. Install Android Studio and create a virtual device (Android 13+
   recommended) via its Device Manager.
2. Start the emulator.
3. Run `npm run android` — Expo detects the running emulator and installs
   Expo Go automatically if needed.

## Development data

Real staff names from `SPEC.md` §16 are seeded automatically **only in a
development build** (`src/config/buildFlags.ts`, gated on `__DEV__`). A
release build starts with an empty database — see `SPEC.md` §22 and test
T15.

## Scripts

- `npm start` / `npm run android` / `npm run ios` / `npm run web` — Expo dev server
- `npm test` — Jest unit tests for the pure TypeScript domain/engine code
- `npm run typecheck` — TypeScript, no emit
