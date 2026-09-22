The release signing keystore (`roster-release.keystore`) is deliberately
**not** committed here - private signing keys don't belong in source
control, even for a sideload-only app.

Claude generated one for you and sent it to you directly in chat. To wire
it into the automated GitHub Actions build:

1. Base64-encode the keystore file (on the phone/computer where you saved
   it):
   - macOS/Linux: `base64 -i roster-release.keystore | tr -d '\n'`
   - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("roster-release.keystore"))`
2. On GitHub: repo -> **Settings** -> **Secrets and variables** -> **Actions**
   -> **New repository secret**.
   - Name: `ROSTER_KEYSTORE_BASE64`
   - Value: the base64 text from step 1.
3. That's it - `.github/workflows/build-apk.yml` decodes this secret back
   into `keystore/roster-release.keystore` at build time, so every CI run
   signs the APK the same way, and the raw key never touches this repo.

Store the original `.keystore` file somewhere safe yourself too (e.g. a
password manager) - if you ever lose both it and this secret, a future
APK can no longer be signed to match earlier installs, and anyone with
the app already installed would need to uninstall the old one before
installing a new build signed with a different key.
