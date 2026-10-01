# Install ❤️ Asaumi on your phone, with notifications (100% free, no Play Store)

This works like Hanuman Disha: GitHub builds the APK for you, and everything stays on the **free Firebase (Spark) plan**.
You don't need a card, Blaze, Cloud Functions or Android Studio.

How the notifications work: when one of you sends a message (or adds a memory, or calls), that phone
sends the notification straight to the other phone through Firebase Cloud Messaging, which is free.

| When | Notification on the other phone |
|---|---|
| Message, photo, video or voice note | **{Name} have send you message** |
| Memory added | **{Name} added memories** |
| Memorable Movement added | **{Name} added a memorable movement** |
| Call | **{Name} is video calling you** / **{Name} is calling you** |
| Unanswered call | **You missed a video call from {Name}** |

These arrive even when the app is closed. Both of you need to use the **installed app**, not the website,
because the sending happens from the app.

---

## PART 1: Firebase (console.firebase.google.com → project **anu-me**)

1. **Authentication → Sign-in method** → **Email/Password** enabled.
2. **Authentication → Users → Add user** → create both accounts.
3. **Authentication → Settings → User actions** → untick **Enable create (sign-up)**.
4. **Firestore rules:** open `firestore.rules` in this folder, put the two real emails in place of
   `person1@example.com` / `person2@example.com`, then in the console go to **Firestore Database → Rules** →
   paste everything → **Publish**.
5. **Add the Android app** (so the phone can *receive* notifications):
   - ⚙️ **Project settings → General → Your apps → Add app → Android**.
   - Package name: **`com.asaumi.app`** (exactly) → nickname `Asaumi` → **Register app**.
   - **Download google-services.json** and put it **in this `asaumi` folder** (next to `index.html`).
   - Click **Next / Continue** until it finishes. Skip the SDK steps.

## PART 2: Create the "send notifications" key (free, about 3 minutes)

This key can **only send notifications**. It can't read or change any of your data.

1. Open **https://console.cloud.google.com/iam-admin/serviceaccounts** and select project **anu-me** at the top.
2. **+ Create service account** → name `asaumi-push` → **Create and continue**.
3. **Select a role** → search **Firebase Cloud Messaging API Admin** → select it → **Continue → Done**.
4. Click the new `asaumi-push@…` account → **Keys** tab → **Add key → Create new key → JSON → Create**.
   A `.json` file downloads. Keep it private: **don't** upload it to GitHub as a file.
5. Check that FCM is on: Firebase console → ⚙️ **Project settings → Cloud Messaging** →
   **Firebase Cloud Messaging API (V1)** should say **Enabled**. If it doesn't, click ⋮ → **Manage API in Google Cloud Console** → **Enable**.

## PART 3: Build the APK on GitHub (about 10 minutes)

1. github.com → **+ → New repository** → name `asaumi` → **Create repository**.
2. Click **uploading an existing file**. Select **everything inside the `asaumi` folder** and drag it in.
   Check that these are included:
   - `.github` folder (contains `workflows/build-apk.yml`). **Without it, nothing builds.**
   - `google-services.json` (from Part 1)
   - `css`, `js`, `scripts`, `assets` folders and all the files
   - **Not** the key file from Part 2.
3. **Commit changes**.
4. Add the key as a **secret** (hidden, only the build can use it):
   - Repo → **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: **`FCM_SERVICE_ACCOUNT`**
   - Secret: open the downloaded `.json` key file in Notepad, **select all → copy → paste** here.
   - **Add secret**.
5. **Actions** tab (enable workflows if asked) → **Build Android APK** → **Run workflow → Run workflow**.
6. Wait for the green tick ✅ (5–10 minutes). Open the run and check the step **"Copy website files into the app"**. It should say:
   ```
   receive notifications: ON
   send notifications:    ON
   ```
   If either says OFF, the line explains what's missing.
7. Scroll to **Artifacts** → download **Asaumi-APK** → unzip it to get `app-debug.apk`.

If you see a red ❌, open the run, copy the red error text and send it to me.

## PART 4: Install on **both** phones

1. Send `app-debug.apk` to each phone (WhatsApp to yourself, Telegram, Drive or USB).
2. Open it → **Settings → Allow from this source** → back → **Install**.
   If Play Protect warns you, tap **More details → Install anyway**.
3. Open **Asaumi**, log in, and tap **Allow** for notifications. Allow camera and microphone at the first call or voice note.

### Make notifications reliable on iQOO / Vivo / Xiaomi / Oppo (do this once per phone)
1. Long-press the Asaumi icon → **App info → Notifications** → turn **everything ON** (including **Calls**).
2. **App info → Battery** → **No restrictions** / **Allow background activity**.
3. Settings → **Battery → Background power consumption management** → Asaumi → **Allow**.
4. Recent apps → Asaumi card → tap the **lock 🔒**.

## PART 5: Test
1. Log in on both phones, then fully close Asaumi on phone A.
2. On phone B, send a message → phone A shows **"{Name} have send you message"**.
3. On phone B, add a memory → phone A shows **"{Name} added memories"**.
4. On phone B, start a call → phone A shows **"{Name} is video calling you"**. Tap it and accept.

---

## Changing the home-screen icon and name (needs a new APK)
Android fixes the icon and the name under it when the APK is built. Inside the app, use **More → Customize app** instead,
which changes instantly for both of you.
- **Icon:** on GitHub open the `assets` folder → **Add file → Upload files** → upload a square picture named exactly
  **`app-icon.png`** (or `.jpg`), at least 512 × 512 → **Commit changes**.
- **Name:** on GitHub open `capacitor.config.json` → ✏️ edit → change `"appName": "Asaumi"` to your name → **Commit changes**.
- Wait for the green build in **Actions**, download the new APK, and **uninstall the old app first**.
  Android only refreshes the icon and name on a fresh install. Your data is safe in Firebase.

## Updating the app later
Upload the changed files to GitHub → the APK builds automatically in **Actions** → download and install it over the old one.
If Android says **"App not installed"**, uninstall the old Asaumi first. Your data is safe in Firebase.

## Good to know
- Everything is on the free Spark plan: Authentication, Firestore, Cloud Messaging. Photos and videos are on Cloudinary's free plan.
- Calls are live only. Nothing is recorded or stored except call time, duration and status.
- The key lives only inside your APK and the GitHub secret, and it can only send notifications.
  Don't share the APK file with anyone else.
