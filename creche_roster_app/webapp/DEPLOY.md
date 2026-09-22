# Deploying the standalone roster app

Everything in this folder is built and tested already. This is the one-time
setup to get it live on your own Firebase project, so the app runs itself
with no Claude involved. It takes about 10-15 minutes, almost all clicking
through the Firebase console, plus a handful of copy-paste commands in
Google's browser-based Cloud Shell (no installs on your phone or computer).

**Cost**: Firebase Hosting, Firestore and Storage are free at this scale.
Cloud Functions (what reruns the scheduler automatically) requires
upgrading to the "Blaze" pay-as-you-go plan even to use its free quota -
for a small daycare's usage this should be $0/month, but Google will ask
for a card on file. Consider setting a budget alert (step 2) so you'd be
notified long before anything was ever charged.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with the Google
   account that should own this (`john13v7@gmail.com` is already set as
   the one allowed to use the app - see step 5 to add more people).
2. Click **Add project**. Name it something like `creche-roster`. You can
   decline Google Analytics (not needed).
3. Once created, you'll land on the project's console (its URL looks like
   `console.firebase.google.com/project/creche-roster-xxxxx`). Note the
   **project ID** shown there (e.g. `creche-roster-xxxxx`) - you'll need it
   below.

## 2. Turn on billing (Blaze plan)

1. In the left sidebar, click the gear icon -> **Usage and billing**.
2. Click **Modify plan** -> choose **Blaze**. Link a billing account
   (Google will ask for a card).
3. Optional but recommended: under **Budgets & alerts** (in Google Cloud
   Console, linked from the same page), set a small budget alert, e.g. $5,
   so you'd get an email long before anything meaningful was ever charged.

## 3. Turn on the services this app uses

Still in the Firebase console, left sidebar:

1. **Build -> Firestore Database** -> **Create database** -> Production
   mode -> pick a location close to you -> Enable.
2. **Build -> Authentication** -> **Get started** -> under **Sign-in
   method**, enable **Google**.
3. **Build -> Storage** -> **Get started** -> Production mode -> same
   location as Firestore -> Done.
4. **Build -> Hosting** -> **Get started** (you can skip its CLI
   instructions here - the deploy below handles it).

## 4. Register a web app and get your config

1. In the Firebase console, click the gear icon -> **Project settings**.
2. Under **Your apps**, click the **</>** (web) icon to add a web app.
   Nickname it anything (e.g. "Roster web"). You don't need Firebase
   Hosting checked at this step. Click **Register app**.
3. You'll see a `firebaseConfig` object with values like `apiKey`,
   `authDomain`, `projectId`, etc. Copy the whole block.
4. Open `webapp/public/firebase-config.js` in this project and replace the
   placeholder values with your real ones. (These values aren't secret -
   Firebase's own docs confirm this; what actually protects your data is
   `firestore.rules` and `storage.rules`, step 5.)

## 5. Confirm who's allowed to use it

`webapp/firestore.rules` and `webapp/storage.rules` already restrict
everything to `john13v7@gmail.com`. To let another manager in (their own
Google account's email), add a line to **both** files:

```
function isAllowed() {
  return request.auth != null && request.auth.token.email in [
    "john13v7@gmail.com",
    "another-manager@gmail.com"
  ];
}
```

(There's a commented example line in each file already - just uncomment
and edit it, keeping both files in sync.)

## 6. Deploy, using Firebase/Google Cloud's browser Cloud Shell

No installs needed on your phone or computer for this part - Cloud Shell
is a terminal that runs entirely in your browser, already signed in to
your Google account.

1. Go to <https://console.cloud.google.com>, make sure the project
   selector (top bar) shows your new project, then click the **Activate
   Cloud Shell** icon (`>_`) near the top right.
2. Once it opens, paste this (replace the URL if you're not using this
   repo directly):

   ```bash
   git clone https://github.com/john13v7-dot/Roster.git
   cd Roster/creche_roster_app/webapp
   npm install -g firebase-tools
   firebase login --no-localhost
   ```

   `firebase login` prints a URL - open it (in the same browser tab is
   fine), approve access, copy the code it gives you back into Cloud
   Shell.
3. Point the CLI at your project and deploy everything:

   ```bash
   firebase use --add
   # pick your project from the list, alias it "default"
   firebase deploy
   ```

   This deploys Hosting (the app itself), Firestore rules, Storage rules,
   and all the Cloud Functions in one go. It takes a few minutes the first
   time. If the Functions deploy step complains about the Python runtime
   version, open `firebase.json` and change `"python312"` to `"python311"`,
   then run `firebase deploy` again.
4. When it finishes, it prints your **Hosting URL** - something like
   `https://creche-roster-xxxxx.web.app`. That's the app.

## 7. Load your current staff/leave/transfers in (once)

Still in the same Cloud Shell session:

```bash
pip install --quiet --break-system-packages firebase-admin
cd seed
python3 seed_firestore.py YOUR-PROJECT-ID
```

(Replace `YOUR-PROJECT-ID` with your real project ID from step 1.) This
pushes your current staff list, Shehnaz's and Eirini's leave, Daniel's
holiday, and Jason's override into the new database - the same data the
Claude-hosted version has right now. Writing it triggers the Cloud
Function automatically, so the roster builds itself within a few seconds
- no separate "build" step needed.

## 8. Open it and sign in

1. Visit your Hosting URL from step 6.
2. Tap **Sign in with Google**, use the allowed account.
3. Within a few seconds of the seed script finishing, the roster should
   appear. If it's still empty after a minute, tap **Rebuild now** on the
   Staff & Requests screen.

## 9. Install it on your Android phone

1. Open the Hosting URL in Chrome on your phone.
2. Tap the **⋮** menu (top right) -> **Add to Home screen** / **Install
   app**.
3. It now opens like a normal app - its own icon, no browser bar around
   it - and stays live: any change anyone with access makes rebuilds the
   roster for everyone within a few seconds, automatically.

---

## If something goes wrong

- **A rebuild doesn't seem to happen**: tap **Rebuild now** on the Staff &
  Requests screen. If that also does nothing, check the Cloud Function's
  logs: Firebase console -> **Build -> Functions** -> click a function ->
  **Logs**, or from Cloud Shell: `firebase functions:log`.
- **"Your account isn't allowed to use this roster yet"**: your Google
  account's email isn't in the allow-list yet - see step 5, then
  `firebase deploy --only firestore:rules,storage:rules`.
- **The roster shows an error banner** (e.g. an impossible cover
  requirement): that mirrors exactly what the Claude-hosted version would
  have shown - the underlying `creche_roster` engine is the same, unedited
  package either way.
- Since I (Claude) can't reach Firebase's servers from where I ran this
  build, this deploy step is the first time the actual Cloud Functions
  code runs for real. I tested it thoroughly against a faithful mock of
  the Firebase SDKs and the real scheduling engine locally, but a small
  fix might still be needed here - if you hit an error you can't puzzle
  out, paste it back to me in this chat and I'll help from there.
