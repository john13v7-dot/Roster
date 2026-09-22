# Creche Roster - native Android app

A thin native wrapper (a "Trusted Web Activity") around the standalone web
app in `../webapp/`. It opens that web app full-screen, with its own icon
and no browser address bar - same live data, same automatic rebuilds,
just installed like a normal app instead of "Add to Home screen".

It is built automatically on GitHub's servers (not locally) by
`.github/workflows/build-apk.yml` at the repo root: every push that
touches this folder builds a signed `.apk` and publishes it as a GitHub
Release, ready to download straight to a phone.

## One thing you must set after deploying the web app

`app/src/main/res/values/strings.xml` currently points at a placeholder
URL (`https://REPLACE-ME.web.app/`). Once you've deployed `../webapp/`
(see `../webapp/DEPLOY.md`) and have your real Hosting URL:

1. On GitHub's website, open `creche_roster_app/android/app/src/main/res/values/strings.xml`.
2. Edit the three placeholder values (`launch_url`, `host_name`, the
   `site` inside `asset_statements`) to your real domain, e.g.
   `creche-roster-xxxxx.web.app`.
3. Commit the change directly on GitHub (the pencil/edit icon, then
   "Commit changes"). That push automatically triggers a new build; a
   new APK appears as a GitHub Release a few minutes later.
4. Also make sure `../webapp/public/.well-known/assetlinks.json` has the
   right `package_name` (already set to `com.crecheroster.app`, matching
   this project) - it's already deployed as part of `firebase deploy` in
   DEPLOY.md, so no separate step is needed there.

Until step 3 is done, the APK still installs and runs fine - it just
opens the placeholder URL, which won't resolve.

## Installing the APK on an Android phone

1. Open the repo's **Releases** page on the phone (or tap the link
   Claude sent you) and download the `.apk` file.
2. Android will likely ask you to allow installs from that source
   (Chrome/Files) the first time - allow it, then open the downloaded
   file to install.
3. This is a self-signed, sideloaded app (not from the Play Store), so
   Android may show a warning the first time; that's expected for any
   app installed this way.

## Signing

Signed with a self-generated release keystore (password
`roster-sideload-2026`, alias `roster`) - Claude sent this file to you
directly rather than committing it to the repo, since a private signing
key doesn't belong in source control. See `keystore/README.md` for the
one-time step to wire it into the GitHub Actions build via a repository
secret.

Until you've added that secret, CI generates a throwaway keystore on the
fly so builds still succeed (you'll see a warning in the build log) - but
each such build is signed differently, so Android will treat every one as
a different app and you'd need to uninstall the old one before installing
a new one. Add the real secret once and every future build is signed
consistently, so updates just install over each other.

## Why a GitHub Actions build instead of a local one

The Android SDK's package servers aren't reachable from the environment
this project was built in, so the build runs on GitHub's own runners
(which have the SDK and full internet access) instead - see the workflow
file for the exact steps it runs.
