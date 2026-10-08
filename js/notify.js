import {
  doc, getDoc, setDoc, addDoc, collection, serverTimestamp, writeBatch, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, myName, esc, ICONS, openModal, toast, shortWhen, scheduleRender, notifText, appName, actions, $
} from "./core.js";
import {
  isNative, initPush, getPushToken, pushPermission, canSendPush, sendPush, CHANNELS, buildInfo, lastPushError
} from "./native.js";

/* ------------------------------------------------------------------ presence */
let heartbeat;

function writePresence(data) {
  if (!uid()) return Promise.resolve();
  return setDoc(doc(db, "presence", uid()), data, { merge: true }).catch(() => {});
}

export function setOnline(on) {
  return writePresence({ state: on ? "online" : "offline", lastSeen: serverTimestamp(), ...(on ? {} : { typing: false }) });
}

export function startPresence() {
  clearInterval(heartbeat);
  setOnline(!document.hidden);
  // every 2 minutes: each heartbeat is one write here and one read on the other phone
  heartbeat = setInterval(() => { if (!document.hidden) setOnline(true); }, 120000);
}

export async function stopPresence() {
  clearInterval(heartbeat);
  await setOnline(false);
}

document.addEventListener("visibilitychange", () => { if (uid()) setOnline(!document.hidden); });
addEventListener("pagehide", () => { if (uid()) setOnline(false); });

/* ------------------------------------------------------------------ typing */
let typingOn = false, typingTimer, lastTypingWrite = 0;

export function typingPing() {
  const now = Date.now();
  if (!typingOn || now - lastTypingWrite > 5000) { // the other phone shows "typing" for 8 s after each update
    typingOn = true;
    lastTypingWrite = now;
    writePresence({ typing: true, typingAt: serverTimestamp() });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(typingStop, 3500);
}

export function typingStop() {
  clearTimeout(typingTimer);
  if (!typingOn) return;
  typingOn = false;
  writePresence({ typing: false });
}

/* ------------------------------------------------------------------ phone push to the other person */
// Sends a phone notification to the other person's Asaumi app (only from the Android app).
export async function pushPartner(opts) {
  if (!canSendPush() || !state.partner) return;
  try {
    const snap = await getDoc(doc(db, "pushTokens", state.partner.uid));
    await sendPush(snap.data()?.tokens || [], { title: notifText("title"), ...opts });
  } catch (err) {
    console.warn("[asaumi] push partner", err);
  }
}

const PUSH_FOR = {
  memory: { page: "memories", tag: "memories" },
  movement: { page: "asaumi", tag: "movement" },
  missed_call: { page: "home", tag: "call", channel: CHANNELS.calls },
  meal: { page: "home", tag: "meal" },
  wish: { page: "wishlist", tag: "wishlist" }
};

/* ------------------------------------------------------------------ in-app notifications */
export function notifyPartner(type, text, extra = {}) {
  if (!state.partner) return;
  if (PUSH_FOR[type]) pushPartner({ body: text, ...PUSH_FOR[type] });
  addDoc(collection(db, "notifications"), {
    to: state.partner.uid, from: uid(), fromName: myName(),
    type, text, read: false, createdAt: serverTimestamp(), ...extra
  }).catch(err => console.warn("[asaumi] notify", err));
}

export const unreadNotifications = () => state.notifications.filter(n => !n.read).length;
export const unreadMessages = () => state.messages.filter(m => m.to === uid() && !m.readAt && !m.archived).length;

async function markAllRead() {
  const unread = state.notifications.filter(n => !n.read);
  if (!unread.length) return;
  const b = writeBatch(db);
  unread.forEach(n => b.update(doc(db, "notifications", n.id), { read: true }));
  await b.commit().catch(() => {});
}

async function clearAll() {
  const b = writeBatch(db);
  state.notifications.forEach(n => b.delete(doc(db, "notifications", n.id)));
  await b.commit().catch(() => toast("Couldn't clear notifications."));
}

const NOTIF_META = {
  memory: { icon: "🔐", nav: "memories" },
  movement: { icon: "❤️", nav: "asaumi" },
  missed_call: { icon: "📹", nav: "home" },
  meal: { icon: "🍽️", nav: "home" },
  wish: { icon: "🎁", nav: "wishlist" },
  message: { icon: "💬", nav: "chat" }
};

function notifRow(n) {
  const meta = NOTIF_META[n.type] || { icon: "✨", nav: "home" };
  const attrs = n.type === "movement" && n.refId
    ? `data-action="openMovement" data-id="${esc(n.refId)}"`
    : `data-nav="${meta.nav}"`;
  return `
    <button class="notif ${n.read ? "" : "unread"}" ${attrs} data-close>
      <span class="notif-ico">${meta.icon}</span>
      <span class="notif-main"><b>${esc(n.text)}</b><small>${esc(n.fromName || "")} · ${esc(shortWhen(n.createdAt))}</small></span>
    </button>`;
}

actions.openNotifications = () => {
  const msgs = unreadMessages();
  const rows = [
    msgs ? notifRow({ type: "message", text: `${notifText("message", { name: state.partner?.name || "" })}${msgs > 1 ? ` (${msgs})` : ""}`, fromName: state.partner?.name, createdAt: state.messages.at(-1)?.createdAt }) : "",
    ...state.notifications.slice(0, 40).map(notifRow)
  ].join("");
  const m = openModal(`
    <div class="sheet-head">
      <h2>Notifications</h2>
      <button class="icon-btn sm" data-close aria-label="Close">${ICONS.close}</button>
    </div>
    ${rows ? `<div class="notif-list">${rows}</div>` : `
      <div class="empty-mini"><span class="big">🔔</span><b>All caught up</b><p>Little updates from your person will appear here.</p></div>`}
    ${state.notifications.length ? '<button class="link-btn" data-clear>Clear all</button>' : ""}`, { cls: "sheet" });
  $("[data-clear]", m)?.addEventListener("click", async () => { await clearAll(); m.close(); });
  markAllRead();
};

/* ------------------------------------------------------------------ system notifications */
export function systemNotify(title, body, tag = "asaumi") {
  if (isNative) return; // the Android app gets real push notifications instead
  if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  const opts = { body, tag, icon: "icon.svg", badge: "icon.svg", renotify: true };
  (navigator.serviceWorker?.getRegistration() || Promise.resolve(null))
    .then(reg => (reg ? reg.showNotification(title, opts) : new Notification(title, opts)))
    .catch(() => {});
}

/* ------------------------------------------------------------------ push (Android app) */
// Saves this phone's Firebase Cloud Messaging token so the Cloud Function can reach it.
export const pushSave = { saved: null, error: "" };
export function registerPush() {
  return initPush(token => {
    if (!uid()) return;
    setDoc(doc(db, "pushTokens", uid()), { tokens: arrayUnion(token), updatedAt: serverTimestamp() }, { merge: true })
      .then(() => { pushSave.saved = true; pushSave.error = ""; })
      .catch(err => {
        console.warn("[asaumi] save push token", err);
        pushSave.saved = false;
        pushSave.error = err?.code === "permission-denied"
          ? "Firestore rules block it: publish the latest firestore.rules (it needs the pushTokens section)."
          : (err?.code || err?.message || String(err));
      });
  });
}

// Called before sign-out so a signed-out phone stops receiving notifications.
export async function unregisterPush() {
  const t = getPushToken();
  if (!t || !uid()) return;
  await setDoc(doc(db, "pushTokens", uid()), { tokens: arrayRemove(t) }, { merge: true }).catch(() => {});
}

export async function notificationStatus() {
  if (isNative) {
    const p = await pushPermission();
    if (p === "unsupported") return { label: "Not set up in this build", btn: false };
    return p === "granted" ? { label: "On", btn: false } : { label: "Off", btn: true };
  }
  if (!("Notification" in window)) return { label: "Not supported", btn: false };
  if (Notification.permission === "granted") return { label: "On", btn: false };
  if (Notification.permission === "denied") return { label: "Blocked in browser settings", btn: false };
  return { label: "Off", btn: true };
}

export async function enableNotifications() {
  if (isNative) {
    const ok = await registerPush();
    toast(ok ? "Notifications turned on 🔔" : "Allow notifications for Asaumi in your phone's settings.");
    scheduleRender();
    return;
  }
  if (!("Notification" in window)) { toast("This browser doesn't support notifications."); return; }
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "Notifications turned on 🔔" : "Notifications are blocked in your browser settings.");
  scheduleRender();
}

/* ------------------------------------------------------------------ notification check (More → Notification check) */
actions.checkNotifications = async () => {
  const info = buildInfo();
  const perm = await pushPermission();
  let partnerTokens = null, partnerErr = "";
  if (state.partner) {
    try { partnerTokens = (await getDoc(doc(db, "pushTokens", state.partner.uid))).data()?.tokens || []; }
    catch (err) { partnerErr = err?.code === "permission-denied" ? "Blocked by Firestore rules: publish the latest firestore.rules." : (err?.code || err?.message); }
  }
  const pName = esc(state.partner?.name || "Your person");
  const row = (ok, label, detail = "") => `
    <div class="chk ${ok ? "ok" : "bad"}"><span>${ok ? "✅" : "❌"}</span><div><b>${label}</b>${detail ? `<small>${esc(detail)}</small>` : ""}</div></div>`;
  const rows = [
    row(info.isNative, "Running as the installed app", info.isNative ? "" : "Notifications only work in the Android app."),
    row(info.canReceive, "Built with google-services.json", info.canReceive ? "" : "Upload google-services.json to GitHub and rebuild."),
    row(info.hasKey && info.httpPlugin, "Built with the sending key", info.hasKey ? "" : "GitHub secret FCM_SERVICE_ACCOUNT was missing when this APK was built."),
    row(perm === "granted", "Notification permission", perm === "granted" ? "" : `Status: ${perm}. Turn on notifications for Asaumi in App info.`),
    row(!!getPushToken(), "This phone registered with Firebase", getPushToken() ? "" : lastPushError() || "Not registered yet. Tap “Register again”."),
    row(pushSave.saved === true, "This phone saved to Firebase", pushSave.saved === true ? "" : pushSave.error || "Not saved yet."),
    row(!!partnerTokens?.length, `${pName}'s phone registered`, partnerErr || (partnerTokens?.length ? `${partnerTokens.length} device(s)` : `${pName} must open the new app once and allow notifications.`))
  ].join("");
  const m = openModal(`
    <div class="sheet-head"><h2>Notification check</h2><button class="icon-btn sm" data-close aria-label="Close">${ICONS.close}</button></div>
    <div class="chk-list">${rows}</div>
    <div class="chk-result" id="chk-result"></div>
    <div class="chk-actions">
      <button class="btn btn-ghost btn-sm" data-reg>Register again</button>
      <button class="btn btn-ghost btn-sm" data-self>Test on this phone</button>
      <button class="btn btn-primary btn-sm" data-partner>Test on ${pName}'s phone</button>
    </div>`, { cls: "sheet" });
  const out = $("#chk-result", m);
  const show = (results, label) => {
    out.innerHTML = results.map(r => `<div class="chk ${r.ok ? "ok" : "bad"}"><span>${r.ok ? "✅" : "❌"}</span><div><b>${esc(label)}: ${r.ok ? "sent" : "failed"}</b>${r.ok ? "" : `<small>${esc(`${r.status ? `${r.status} · ` : ""}${r.error || ""}`)}</small>`}</div></div>`).join("");
  };
  $("[data-reg]", m).addEventListener("click", async () => {
    out.textContent = "Registering…";
    await registerPush();
    setTimeout(() => { m.close(); actions.checkNotifications(); }, 2500);
  });
  $("[data-self]", m).addEventListener("click", () => {
    const t = getPushToken();
    if (!t) { show([{ ok: false, error: "This phone isn't registered yet." }], "Test"); return; }
    out.textContent = "Sending in 5 seconds. Press the Home button now, because notifications don't pop up while Asaumi is open.";
    setTimeout(async () => show(await sendPush([t], { title: notifText("title"), body: `Test notification ✓ ${appName()} can reach this phone.`, page: "more", tag: "test" }), "Test on this phone"), 5000);
  });
  $("[data-partner]", m).addEventListener("click", async () => {
    out.textContent = "Sending…";
    show(await sendPush(partnerTokens || [], { title: notifText("title"), body: notifText("message"), page: "chat", tag: "test" }), `Test on ${state.partner?.name || "partner"}'s phone`);
  });
};

// Called for each new notification doc that arrives while the app is open
export function announceNotification(n) {
  toast(n.text);
  systemNotify(notifText("title", { name: n.fromName || "" }), n.text, n.type);
}
