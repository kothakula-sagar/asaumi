import {
  doc, setDoc, addDoc, collection, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, myName, esc, ICONS, openModal, toast, shortWhen, scheduleRender, actions, $
} from "./core.js";

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
  heartbeat = setInterval(() => { if (!document.hidden) setOnline(true); }, 45000);
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
  if (!typingOn || now - lastTypingWrite > 3000) {
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

/* ------------------------------------------------------------------ in-app notifications */
export function notifyPartner(type, text, extra = {}) {
  if (!state.partner) return;
  addDoc(collection(db, "notifications"), {
    to: state.partner.uid, from: uid(), fromName: myName(),
    type, text, read: false, createdAt: serverTimestamp(), ...extra
  }).catch(err => console.warn("[asaumi] notify", err));
}

export const unreadNotifications = () => state.notifications.filter(n => !n.read).length;
export const unreadMessages = () => state.messages.filter(m => m.to === uid() && !m.readAt).length;

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
    msgs ? notifRow({ type: "message", text: `❤️ You received ${msgs === 1 ? "a new message" : `${msgs} new messages`}.`, fromName: state.partner?.name, createdAt: state.messages.at(-1)?.createdAt }) : "",
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
  if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  const opts = { body, tag, icon: "icon.svg", badge: "icon.svg", renotify: true };
  (navigator.serviceWorker?.getRegistration() || Promise.resolve(null))
    .then(reg => (reg ? reg.showNotification(title, opts) : new Notification(title, opts)))
    .catch(() => {});
}

export async function enableNotifications() {
  if (!("Notification" in window)) { toast("This browser doesn't support notifications."); return; }
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "Notifications turned on 🔔" : "Notifications are blocked in your browser settings.");
  scheduleRender();
}

// Called for each new notification doc that arrives while the app is open
export function announceNotification(n) {
  toast(n.text);
  systemNotify("❤️ Asaumi", n.text, n.type);
}
