// 📸 Screen privacy (Android app), like PhonePe / GPay:
//  • Screenshots and screen recordings of Asaumi are BLOCKED (they come out black), and Recent apps shows a
//    blank card instead of your chats. This is done by Android itself (native-android/ScreenGuardPlugin.java).
//  • Android 14+: if someone tries to take a screenshot, the other person is told.
// 🛠️ Developer mode (More → Privacy) allows screenshots for that person. It needs the login password, and the
// other person is told when it's turned on or off, so it can't be used secretly.
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, state, uid, esc, toast, askPassword, partnerName, myName, appName, scheduleRender, actions } from "./core.js";
import { isNative, screenshotSupported, onScreenshot, setScreenSecure } from "./native.js";
import { notifyPartner } from "./notify.js";

let detect = null;     // Android 14+ can report screenshot attempts; null = still checking
let secureNow = null;  // what was last applied to the screen
if (isNative) screenshotSupported().then(s => { detect = s; scheduleRender(); });

// Blocks screenshots unless this person has Developer mode on (called whenever the profile changes)
export function applyScreenPolicy() {
  if (!isNative) return;
  const secure = !(state.user && state.me?.devMode);
  if (secure === secureNow) return;
  secureNow = secure;
  setScreenSecure(secure);
}

const PLACES = {
  home: "Home", chat: "your chat", memories: "Memories", more: "settings", asaumi: "the Asaumi page",
  wishlist: "the Wishlist", games: "Games"
};
let lastShot = 0;

onScreenshot(() => {
  if (!state.user || state.locked) return; // the lock screen shows nothing private
  if (state.me?.devMode) { toast("📸 Screenshot taken (developer mode is on)"); return; }
  if (Date.now() - lastShot < 5000) return; // one alert for a burst of attempts
  lastShot = Date.now();
  notifyPartner("screenshot", `📸 ${myName()} tried to take a screenshot of ${PLACES[state.view] || "the app"}`);
  toast(`🔒 Screenshots are blocked in ${appName()}. ${partnerName()} was told.`);
});

// rows for More → Privacy
export function screenshotRows() {
  const p = state.partner;
  const partnerDev = p?.devMode
    ? `<p class="dev-warn">🛠️ ${esc(partnerName())} has developer mode on, so they can take screenshots.</p>`
    : "";
  if (!isNative) return partnerDev;
  const dev = !!state.me?.devMode;
  const shots = dev
    ? "Allowed for you (developer mode is on)"
    : `Blocked · they come out black, and Recent apps hides your chats${detect ? `. ${partnerName()} is told if you try` : ""}`;
  return `
    <div class="set-row">
      <span class="set-ico">📸</span>
      <span class="set-main"><b>Screenshots</b><small>${esc(shots)}</small></span>
    </div>
    <div class="set-row">
      <span class="set-ico">🛠️</span>
      <span class="set-main"><b>Developer mode</b><small>${dev ? "On · screenshots allowed for you" : "Off · turn on to allow screenshots (for testing)"}</small></span>
      <button class="btn ${dev ? "btn-primary" : "btn-ghost"} btn-sm" data-action="toggleDevMode">${dev ? "Turn off" : "Turn on"}</button>
    </div>
    ${partnerDev}`;
}

actions.toggleDevMode = async () => {
  const on = !state.me?.devMode;
  if (on && !(await askPassword({ title: "Turn on developer mode?", text: `Screenshots will be allowed for you. ${partnerName()} will be told. Enter your login password.` }))) return;
  try {
    await setDoc(doc(db, "users", uid()), { devMode: on }, { merge: true });
    state.me = { ...state.me, devMode: on };
    applyScreenPolicy();
    notifyPartner("devmode", on
      ? `🛠️ ${myName()} turned on developer mode: screenshots are allowed for them`
      : `🛠️ ${myName()} turned off developer mode: screenshots are blocked again`);
    toast(on ? "🛠️ Developer mode on. Screenshots allowed." : "Developer mode off. Screenshots are blocked again.");
    scheduleRender();
  } catch (err) {
    console.warn("[asaumi] dev mode", err);
    toast("Couldn't change this. Try again.");
  }
};
