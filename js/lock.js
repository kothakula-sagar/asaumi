// App lock: Asaumi asks for the PIN every time it opens (and after being in the background for a while).
// Forgot PIN → verify the Firebase login password → create a new PIN → confirm → open.
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, esc, ICONS, toast, askPassword, sha256, friendlyError, spinner, closeAllModals,
  avatarHtml, myName, scheduleRender, actions, hooks, $
} from "./core.js";
import { PIN_LENGTH } from "./config.js";

const RELOCK_AFTER_MS = 60 * 1000; // away longer than this → ask for the PIN again
let failCount = 0, waitUntil = 0, hiddenAt = 0;

export function resetPin() {
  const mode = state.pinHash && !state.pinReset ? "unlock" : "create";
  state.pin = { mode, value: "", first: "", error: "", shake: false, busy: false };
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
  failCount = 0;
  renderLock();
  scheduleRender();
  hooks.onUnlock?.();
}

/* ------------------------------------------------------------------ render */
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
  const copy = {
    unlock: mem
      ? ["Enter your PIN", "Memories stay locked even when Asaumi is open."]
      : ["Enter your PIN", "Asaumi is locked. Only you can open it."],
    create: [state.pinReset ? "Create a new PIN" : "Create your Asaumi PIN", `Choose a ${PIN_LENGTH}-digit PIN. Asaumi will ask for it when it opens and for Memories.`],
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
        ${mem
          ? `<div class="lock-orb">${ICONS.lock}</div>`
          : `<div class="lock-avatar">${avatarHtml(state.me || { name: myName() }, "lg")}<span class="lock-badge">${ICONS.lock}</span></div>`}
        <p class="eyebrow">${mem ? "🔐 Our Memories" : "❤️ Asaumi"}</p>
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
        ${mem
          ? '<button class="link-btn lock-signout" data-action="cancelMemoriesLock">Cancel</button>'
          : '<button class="link-btn lock-signout" data-action="signOut">Not you? Sign out</button>'}
      </section>
    </div>`;
}

/* ------------------------------------------------------------------ keypad */
async function pinKey(key) {
  const p = state.pin;
  if (!p || p.busy || !state.locked) return;
  if (key === "back") { p.value = p.value.slice(0, -1); renderLock(); return; }
  if (p.value.length >= PIN_LENGTH) return;
  if (p.mode === "unlock" && Date.now() < waitUntil) {
    p.error = `Too many tries. Wait ${Math.ceil((waitUntil - Date.now()) / 1000)}s.`;
    renderLock();
    return;
  }
  p.error = "";
  p.value += key;
  renderLock();
  if (p.value.length < PIN_LENGTH) return;

  p.busy = true;
  const hash = await sha256(`${uid()}:${p.value}`);
  await new Promise(r => setTimeout(r, 140)); // let the last dot show
  p.busy = false;

  if (p.mode === "unlock") {
    if (hash === state.pinHash) { unlockApp(); return; }
    failCount += 1;
    if (failCount >= 5) { waitUntil = Date.now() + 30000; failCount = 0; }
    Object.assign(p, { value: "", error: "Incorrect PIN. Please try again.", shake: true });
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
  if (state.user && state.pinLoaded && !state.locked && hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) lockApp();
});

Object.assign(actions, {
  pinKey: d => pinKey(d.key),
  pinRestart: () => { resetPin(); renderLock(); },
  forgotPin: startPinReset,
  resetPin: startPinReset,
  lockNow: lockApp,
  cancelMemoriesLock,
  unlockMemories: askMemoriesPin,
  lockMemories: () => { lockMemories(); scheduleRender(); toast("Memories locked 🔐"); },
  retryPin: () => hooks.loadPin?.()
});
