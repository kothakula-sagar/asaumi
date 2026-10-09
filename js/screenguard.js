// 📸 Screenshot alert (Android app, Android 14+): a screenshot of Asaumi locks the app and tells the other person.
// 🛠️ Developer mode (More → Privacy) allows screenshots for that person without alerts. It needs the login
// password, and the other person is told when it's turned on or off, so it can't be used secretly.
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, state, uid, esc, toast, askPassword, partnerName, myName, appName, scheduleRender, actions } from "./core.js";
import { isNative, screenshotSupported, onScreenshot } from "./native.js";
import { notifyPartner } from "./notify.js";
import { lockApp } from "./lock.js";

let supported = null; // null = still checking
if (isNative) screenshotSupported().then(s => { supported = s; scheduleRender(); });

const PLACES = {
  home: "Home", chat: "your chat", memories: "Memories", more: "settings", asaumi: "the Asaumi page",
  wishlist: "the Wishlist", games: "Games"
};
let lastShot = 0;

onScreenshot(() => {
  if (!state.user || state.locked) return; // the lock screen shows nothing private
  if (state.me?.devMode) { toast("📸 Screenshot taken (developer mode is on)"); return; }
  if (Date.now() - lastShot < 3000) return; // one alert for a burst of screenshots
  lastShot = Date.now();
  notifyPartner("screenshot", `📸 ${myName()} took a screenshot of ${PLACES[state.view] || "the app"}`);
  lockApp();
  toast(`📸 Screenshot taken. ${partnerName()} was told and ${appName()} is locked.`);
});

// rows for More → Privacy
export function screenshotRows() {
  const p = state.partner;
  const partnerDev = p?.devMode
    ? `<p class="dev-warn">🛠️ ${esc(partnerName())} has developer mode on, so their screenshots are not reported.</p>`
    : "";
  if (!isNative) return partnerDev;
  const dev = !!state.me?.devMode;
  const alert = supported === null ? "Checking…"
    : !supported ? "Needs Android 14 or newer on this phone"
    : dev ? "Off for you (developer mode is on)"
    : `On · a screenshot locks ${appName()} and tells ${partnerName()}`;
  return `
    <div class="set-row">
      <span class="set-ico">📸</span>
      <span class="set-main"><b>Screenshot alert</b><small>${esc(alert)}</small></span>
    </div>
    <div class="set-row">
      <span class="set-ico">🛠️</span>
      <span class="set-main"><b>Developer mode</b><small>${dev ? "On · your screenshots are allowed and not reported" : "Off · turn on to take screenshots without alerts"}</small></span>
      <button class="btn ${dev ? "btn-primary" : "btn-ghost"} btn-sm" data-action="toggleDevMode">${dev ? "Turn off" : "Turn on"}</button>
    </div>
    ${partnerDev}`;
}

actions.toggleDevMode = async () => {
  const on = !state.me?.devMode;
  if (on && !(await askPassword({ title: "Turn on developer mode?", text: `Screenshots will be allowed without alerts. ${partnerName()} will be told. Enter your login password.` }))) return;
  try {
    await setDoc(doc(db, "users", uid()), { devMode: on }, { merge: true });
    state.me = { ...state.me, devMode: on };
    notifyPartner("devmode", on
      ? `🛠️ ${myName()} turned on developer mode: their screenshots won't be reported`
      : `🛠️ ${myName()} turned off developer mode: screenshot alerts are back on`);
    toast(on ? "🛠️ Developer mode on. Screenshots allowed." : "Developer mode off. Screenshot alerts are back on.");
    scheduleRender();
  } catch (err) {
    console.warn("[asaumi] dev mode", err);
    toast("Couldn't change this. Try again.");
  }
};
