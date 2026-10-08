// App lock: Asaumi asks for the PIN every time it opens (and after being in the background for a while).
// In the Android app the phone's fingerprint / screen lock opens it instead (like PhonePe / GPay).
// If that is cancelled or fails, the PIN pad is right there. The same applies to the Memories lock.
// 3 wrong PINs → locked for 30 seconds (saved on the phone, so closing the app doesn't skip the wait).
// Forgot PIN → verify the Firebase login password → create a new PIN → confirm → open.
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, esc, ICONS, toast, askPassword, sha256, friendlyError, spinner, closeAllModals,
  avatarHtml, myName, scheduleRender, appName, fmtDuration, actions, hooks, $
} from "./core.js";
import { PIN_LENGTH } from "./config.js";
import { isNative, biometricAvailable, biometricUnlock } from "./native.js";

const RELOCK_AFTER_MS = 60 * 1000; // away longer than this → ask for the PIN again
const MAX_TRIES = 3;               // wrong PINs in a row before the wait
const LOCKOUT_MS = 30 * 1000;
let hiddenAt = 0;

/* ------------------------------------------------------------------ wrong-PIN lockout */
const lockKey = () => `asaumi.pinLock.${uid()}`;
function readLockout() {
  try {
    const v = JSON.parse(localStorage.getItem(lockKey()) || "null");
    return { fails: Number(v?.fails) || 0, until: Number(v?.until) || 0 };
  } catch { return { fails: 0, until: 0 }; }
}
function writeLockout(v) { try { localStorage.setItem(lockKey(), JSON.stringify(v)); } catch { /* ignore */ } }
const clearLockout = () => writeLockout({ fails: 0, until: 0 });
const lockoutLeft = () => Math.max(0, readLockout().until - Date.now());

let countdown = 0;
function startCountdown() {
  if (countdown) return;
  const tick = () => {
    const left = lockoutLeft();
    const el = $("#lock-timer");
    if (el) el.textContent = fmtDuration(Math.ceil(left / 1000));
    if (!left || !state.locked) {
      clearInterval(countdown);
      countdown = 0;
      renderLock();
    }
  };
  countdown = setInterval(tick, 250);
  tick();
}

/* ------------------------------------------------------------------ fingerprint / screen lock */
let bioAvail = null;   // null = not checked yet
let bioCode = null;    // why it isn't available (Android BiometricManager code)
let bioBusy = false;
let lockSeq = 0;       // +1 every time a lock screen starts
let bioTriedFor = -1;  // the lock screen the automatic prompt was already shown for

const bioPrefKey = () => `asaumi.bio.${uid()}`;
const bioPref = () => { try { return localStorage.getItem(bioPrefKey()) !== "0"; } catch { return true; } }; // on by default
const setBioPref = on => { try { localStorage.setItem(bioPrefKey(), on ? "1" : "0"); } catch { /* ignore */ } };
const bioReady = () => !!bioAvail && bioPref();

async function checkBio() {
  if (!isNative) { bioAvail = false; return false; }
  const r = await biometricAvailable();
  bioAvail = r.available;
  bioCode = r.code;
  return bioAvail;
}

// auto = shown by itself when the lock screen appears (once per lock); otherwise the button was tapped
async function tryBiometric(auto = false) {
  const p = state.pin;
  if (!state.user || !state.locked || !state.pinLoaded || p?.mode !== "unlock" || bioBusy) return;
  if (auto && (document.hidden || bioTriedFor === lockSeq)) return;
  if (bioAvail === null) await checkBio();
  if (!bioReady()) return;
  bioTriedFor = lockSeq;
  const seq = lockSeq;
  const mem = state.lockScope === "memories";
  bioBusy = true;
  const r = await biometricUnlock({
    title: mem ? "Unlock Memories" : `Unlock ${appName()}`,
    subtitle: "Use your fingerprint or phone screen lock"
  });
  bioBusy = false;
  if (seq !== lockSeq || !state.locked) return;
  if (r.ok) { clearLockout(); unlockApp(); return; }
  // cancelled or failed → the PIN pad is already on screen
  if (r.lockedOut && state.pin) state.pin.error = "Fingerprint is paused after too many tries. Use your PIN.";
  renderLock();
}

if (isNative) checkBio().then(() => renderLock());

/* ------------------------------------------------------------------ lock / unlock */
export function resetPin() {
  const mode = state.pinHash && !state.pinReset ? "unlock" : "create";
  state.pin = { mode, value: "", first: "", error: "", shake: false, busy: false };
  lockSeq += 1;
}

export function lockApp() {
  if (!state.user) return;
  state.locked = true;
  state.lockScope = "app";
  state.memUnlocked = false;
  closeAllModals();
  resetPin();
  renderLock();
}

/* ---- Memories has its own lock (same PIN), asked each time Memories is opened ---- */
export function lockMemories() {
  state.memUnlocked = false;
}

export function askMemoriesPin() {
  if (!state.user || !state.pinLoaded || state.locked) return; // the app lock is showing already
  state.locked = true;
  state.lockScope = "memories";
  resetPin();
  renderLock();
}

function cancelMemoriesLock() {
  state.locked = false;
  state.lockScope = "app";
  renderLock();
  hooks.go("home");
}

function unlockApp() {
  // Typing the PIN while on Memories opens Memories too, so the PIN isn't asked twice.
  if (state.lockScope === "memories" || state.view === "memories") state.memUnlocked = true;
  state.locked = false;
  state.lockScope = "app";
  renderLock();
  scheduleRender();
  hooks.onUnlock?.();
}

/* ------------------------------------------------------------------ render */
const bioButton = () => (bioReady()
  ? `<button class="bio-btn" data-action="bioUnlock">${ICONS.fingerprint}<span>Use fingerprint / screen lock</span></button>`
  : "");

export function renderLock() {
  const root = $("#lock-root");
  const show = !!(state.user && state.locked);
  document.body.classList.toggle("app-locked", show);
  if (!show) { root.hidden = true; root.innerHTML = ""; return; }
  root.hidden = false;

  if (!state.pinLoaded) {
    root.innerHTML = `
      <div class="lock-screen">
        <div class="lock">
          ${state.pinError
            ? `<div class="lock-orb">${ICONS.lock}</div>
               <h1>Couldn't open Asaumi</h1>
               <p class="muted">${esc(state.pinError)}</p>
               <button class="btn btn-primary" data-action="retryPin">Try again</button>`
            : spinner()}
        </div>
      </div>`;
    return;
  }

  const p = state.pin || (resetPin(), state.pin);
  const mem = state.lockScope === "memories";
  const top = mem
    ? `<div class="lock-orb">${ICONS.lock}</div>`
    : `<div class="lock-avatar">${avatarHtml(state.me || { name: myName() }, "lg")}<span class="lock-badge">${ICONS.lock}</span></div>`;
  const eyebrow = `<p class="eyebrow">${mem ? "🔐 Our Memories" : `❤️ ${esc(appName())}`}</p>`;
  const bottom = mem
    ? '<button class="link-btn lock-signout" data-action="cancelMemoriesLock">Cancel</button>'
    : '<button class="link-btn lock-signout" data-action="signOut">Not you? Sign out</button>';

  // 3 wrong PINs: wait screen with a countdown (fingerprint still works)
  if (p.mode === "unlock" && lockoutLeft()) {
    root.innerHTML = `
      <div class="lock-screen">
        <section class="lock">
          ${top}
          ${eyebrow}
          <h1>Too many wrong PINs</h1>
          <p class="muted">For your safety, wait before trying again.</p>
          <div class="lock-timer" id="lock-timer">${fmtDuration(Math.ceil(lockoutLeft() / 1000))}</div>
          ${bioButton()}
          <button class="link-btn" data-action="forgotPin">Forgot PIN?</button>
          ${bottom}
        </section>
      </div>`;
    startCountdown();
    queueMicrotask(() => tryBiometric(true));
    return;
  }

  const copy = {
    unlock: mem
      ? ["Enter your PIN", `Memories stay locked even when ${appName()} is open.`]
      : ["Enter your PIN", `${appName()} is locked. Only you can open it.`],
    create: [state.pinReset ? "Create a new PIN" : `Create your ${appName()} PIN`, `Choose a ${PIN_LENGTH}-digit PIN. ${appName()} will ask for it when it opens and for Memories.`],
    confirm: ["Confirm PIN", "Enter the same PIN once more."]
  }[p.mode];
  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => `<i class="${i < p.value.length ? "on" : ""}"></i>`).join("");
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(k => `<button class="key" data-action="pinKey" data-key="${k}">${k}</button>`).join("");
  const left = p.mode === "unlock"
    ? '<button class="key plain" data-action="forgotPin">Forgot<br>PIN?</button>'
    : p.mode === "confirm" ? '<button class="key plain" data-action="pinRestart">Start<br>over</button>' : "<span></span>";
  const shake = p.shake;
  p.shake = false;

  root.innerHTML = `
    <div class="lock-screen">
      <section class="lock">
        ${top}
        ${eyebrow}
        <h1>${copy[0]}</h1>
        <p class="muted">${copy[1]}</p>
        <div class="pin-dots ${shake ? "shake" : ""}">${dots}</div>
        <p class="pin-error">${esc(p.error)}</p>
        <div class="keypad">
          ${keys}
          ${left}
          <button class="key" data-action="pinKey" data-key="0">0</button>
          <button class="key plain" data-action="pinKey" data-key="back" aria-label="Delete">⌫</button>
        </div>
        ${p.mode === "unlock" ? bioButton() : ""}
        ${bottom}
      </section>
    </div>`;
  if (p.mode === "unlock") queueMicrotask(() => tryBiometric(true));
}

/* ------------------------------------------------------------------ keypad */
async function pinKey(key) {
  const p = state.pin;
  if (!p || p.busy || !state.locked) return;
  if (p.mode === "unlock" && lockoutLeft()) { renderLock(); return; }
  if (key === "back") { p.value = p.value.slice(0, -1); renderLock(); return; }
  if (p.value.length >= PIN_LENGTH) return;
  p.error = "";
  p.value += key;
  renderLock();
  if (p.value.length < PIN_LENGTH) return;

  p.busy = true;
  const hash = await sha256(`${uid()}:${p.value}`);
  await new Promise(r => setTimeout(r, 140)); // let the last dot show
  p.busy = false;

  if (p.mode === "unlock") {
    if (hash === state.pinHash) { clearLockout(); unlockApp(); return; }
    const fails = readLockout().fails + 1;
    if (fails >= MAX_TRIES) {
      writeLockout({ fails: 0, until: Date.now() + LOCKOUT_MS });
      Object.assign(p, { value: "", error: "" });
      navigator.vibrate?.(200);
    } else {
      writeLockout({ fails, until: 0 });
      const n = MAX_TRIES - fails;
      Object.assign(p, { value: "", error: `Incorrect PIN. ${n} ${n === 1 ? "try" : "tries"} left.`, shake: true });
    }
  } else if (p.mode === "create") {
    Object.assign(p, { first: p.value, value: "", mode: "confirm" });
  } else if (p.mode === "confirm") {
    if (p.value !== p.first) {
      Object.assign(p, { mode: "create", value: "", first: "", error: "PINs didn't match. Let's start again.", shake: true });
    } else {
      try {
        await setDoc(doc(db, "pins", uid()), { hash, updatedAt: serverTimestamp() });
        state.pinHash = hash;
        state.pinReset = false;
        clearLockout();
        toast("PIN saved 🔐");
        unlockApp();
        return;
      } catch (err) {
        Object.assign(p, { mode: "create", value: "", first: "", error: friendlyError(err, "Couldn't save the PIN. Try again.") });
      }
    }
  }
  renderLock();
}

document.addEventListener("keydown", e => {
  if (!state.user || !state.locked || $("#modal-root").children.length) return;
  if (/^\d$/.test(e.key)) pinKey(e.key);
  else if (e.key === "Backspace") pinKey("back");
});

// Forgot PIN (on the lock screen) or Reset PIN (in More): password first, then a new PIN.
export async function startPinReset() {
  const ok = await askPassword({ title: "Forgot PIN?", text: "Enter your Asaumi login password to create a new PIN." });
  if (!ok) return;
  state.pinReset = true;
  state.locked = true;
  closeAllModals();
  resetPin();
  renderLock();
  toast("Verified ✓ Now create your new PIN");
}

// Lock again when coming back after a while in the background.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (isNative && !bioBusy) checkBio(); // a fingerprint may have been added in the phone's settings
  if (state.user && state.pinLoaded && !state.locked && hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) lockApp();
  else if (state.user && state.locked) tryBiometric(true);
});

/* ------------------------------------------------------------------ settings (More → Privacy) */
export function biometricSettingsRow() {
  if (!isNative) return "";
  if (bioAvail === null) checkBio().then(scheduleRender);
  const on = bioReady();
  const why = bioCode === 11
    ? "Add a fingerprint or screen lock in your phone's Settings first."
    : "Not available on this phone.";
  const small = bioAvail === null ? "Checking…"
    : !bioAvail ? why
    : on ? "On · opens the app and Memories without the PIN" : "Off · the app PIN is used";
  return `
    <div class="set-row">
      <span class="set-ico">${ICONS.fingerprint}</span>
      <span class="set-main"><b>Fingerprint / screen lock</b><small>${esc(small)}</small></span>
      ${bioAvail ? `<button class="btn ${on ? "btn-ghost" : "btn-primary"} btn-sm" data-action="toggleBiometric">${on ? "Turn off" : "Turn on"}</button>` : ""}
    </div>`;
}

async function toggleBiometric() {
  if (bioReady()) {
    setBioPref(false);
    toast("Fingerprint unlock is off. The app PIN will be used.");
    scheduleRender();
    return;
  }
  if (!(await checkBio())) { scheduleRender(); return; }
  bioBusy = true;
  const r = await biometricUnlock({ title: "Turn on fingerprint unlock", subtitle: "Confirm it's you" });
  bioBusy = false;
  if (!r.ok) { if (!r.cancelled) toast("Couldn't confirm. Try again."); return; }
  setBioPref(true);
  toast("Fingerprint / screen lock is on 🔐");
  scheduleRender();
}

Object.assign(actions, {
  pinKey: d => pinKey(d.key),
  pinRestart: () => { resetPin(); renderLock(); },
  forgotPin: startPinReset,
  resetPin: startPinReset,
  lockNow: lockApp,
  cancelMemoriesLock,
  unlockMemories: askMemoriesPin,
  lockMemories: () => { lockMemories(); scheduleRender(); toast("Memories locked 🔐"); },
  retryPin: () => hooks.loadPin?.(),
  bioUnlock: () => tryBiometric(false),
  toggleBiometric
});
