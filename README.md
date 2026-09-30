# ❤️ Asaumi — “A little world for two.”

A private two-person app: real-time chat (text, emoji, photos, videos, voice), live video and audio calls,
PIN-locked Memories, Memorable Movements, notifications, and one shared background.

Plain HTML/CSS/JS, so there's no build step. It uses Firebase (login, database, call signalling) and Cloudinary (media).

```
asaumi/
  index.html  manifest.json  sw.js  icon.svg  firestore.rules
  css/style.css
  js/config.js    ← Firebase + Cloudinary + call (TURN) settings
  js/app.js       ← login, navigation, live data
  js/chat.js  js/call.js  js/memories.js  js/movements.js  js/home.js  js/settings.js  js/notify.js  js/core.js
```

## One-time setup

### 1. Firebase (console.firebase.google.com → project `anu-me`)
1. **Authentication → Sign-in method** → enable **Email/Password**.
2. **Authentication → Users → Add user** → create **both** accounts (email + password).
3. **Authentication → Settings → User actions** → **untick "Enable create (sign-up)"** and **"Enable deletion"**.
   With these off, nobody can create an account from outside, even with the API key.
4. **Firestore Database** → create it in production mode if it doesn't exist yet.
5. **Firestore → Rules** → paste `firestore.rules`, replace the two example emails with the real ones (lowercase), then click **Publish**.
   These rules also keep the older **WE** app working, because it uses the same project.
6. After hosting (below): **Authentication → Settings → Authorized domains → Add** `YOUR-USERNAME.github.io`.

### 2. Cloudinary (cloud `dgeapuy5y`)
The unsigned upload preset **`anu-me`** from the WE app is reused. If it doesn't exist yet:
**Settings → Upload → Upload presets → Add** → name `anu-me`, Signing mode **Unsigned**, folder `anu-me` → Save.
Photos, videos, voice notes, avatars and the background are all uploaded through this preset.

### 3. (Recommended) TURN server for calls
Calls connect directly phone-to-phone. On most Wi-Fi networks that works with the built-in STUN servers.
When both people are on **mobile data** (different carriers), a TURN relay is often needed.
You can get a free one at metered.ca (Open Relay). Add it to `ICE_SERVERS` in `js/config.js`.
The relay only forwards the live stream. It never records it.

## Host on GitHub Pages
1. github.com → **New repository** → name `asaumi` → Create.
2. **Add file → Upload files** → drag everything *inside* this folder → **Commit changes**.
3. **Settings → Pages** → *Deploy from a branch* → `main` / `/ (root)` → Save.
4. Open `https://YOUR-USERNAME.github.io/asaumi/` → Chrome ⋮ → **Add to Home screen**.

Calls, microphone and notifications need **https**. GitHub Pages provides https, but opening `index.html` as a local file won't work.
To test on your computer, run `python -m http.server 8080` inside this folder and open `http://localhost:8080`.

## How things work
- **Only two people.** There's no sign-up screen. Firestore rules only allow the two emails, and the partner is the other person in `users`.
- **First login** asks for your display name. You can change your name and photo in **More**.
- **Chat.** Messages show ✓ when sent, ✓✓ when delivered, and a 🔵 blue ✓✓ once the other person opens the chat.
  To delete one of your own messages, long-press it (right-click on desktop). Photos and videos show a preview with **Cancel / Send** before they upload, and a progress bar while uploading.
- **Voice messages.** Tap 🎤 to record, ■ to stop, ▶ to preview, then send. Voice notes are converted to MP3 on playback, so they play on iPhone and Android.
- **Calls** are live WebRTC only. Firestore stores metadata only: caller, receiver, start and end times, duration, and status. The connection details are deleted after the call.
- **Memories 🔐.** Each person sets their own PIN. For **Forgot PIN**, you enter your login password first, then create a new PIN.
  Memories lock again when you leave the section or the app goes to the background.
  The PIN is a screen lock. The real protection is the Firestore rules.
- **Notifications.** In-app bell and badges, plus phone notifications while Asaumi is open or in the background (turn them on in **More**).
  Notifications when the app is fully closed would need Firebase Cloud Functions and FCM, which require the paid Blaze plan.
- **Background.** Recommended size is 1080 × 1920 px (9:16). You see a preview first, then save. One background is shared by both of you.

## Privacy notes
- Cloudinary media links are long, random URLs that nobody can guess, but anyone who *has* a link can open it. Don't share media links outside Asaumi.
- Deleting a message or memory removes it from Asaumi. The file stays in Cloudinary until you delete it there.
- `firebaseConfig` in `config.js` is a public identifier, not a secret. Access is controlled by the Firestore rules.
