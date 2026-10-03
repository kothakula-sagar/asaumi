import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, onSnapshot, query, where, orderBy, limit, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  auth, db, state, views, actions, hooks, scheduleRender, $, $$, esc, ICONS, avatarHtml, presenceDot,
  isOnline, statusText, toast, friendlyError, confirmDialog, closeAllModals, cld, spinner, whenDate,
  brand, brandIcon, appName, setBrand, applyBrandChrome
} from "./core.js";
import {
  startPresence, stopPresence, unreadNotifications, unreadMessages, announceNotification, registerPush, unregisterPush
} from "./notify.js";
import { isNative, onNotificationTap, clearDelivered, onBackButton, onResume, minimizeApp, retryPushIfNeeded } from "./native.js";
import { mountChat, updateChat, markDelivered, markRead, onIncomingMessage, resetChat, renderOurStickers } from "./chat.js";
import { watchIncoming, stopWatchingIncoming } from "./call.js";
import "./memories.js";
import { renderLock, resetPin } from "./lock.js";
import "./movements.js";
import "./home.js";
import { askName } from "./settings.js";
import { startLocation, stopLocation, checkNearChange } from "./together.js";
import { onBirthdaysChanged, maybeShowSurprise, syncBirthdayNotification } from "./birthday.js";
import { onLocalNotificationTap } from "./native.js";
import { scheduleMealCheck, sinceKey } from "./meals.js";
import { maybeShowStoryMessage } from "./relationship.js";
import { initShare, applyShareIfReady } from "./share.js";
import { autoCheckUpdate } from "./updates.js";

initShare(); // "Share to Asaumi" from other apps

$$("[data-icon]").forEach(el => (el.innerHTML = ICONS[el.dataset.icon]));
applyBrandChrome(); // last saved name / icon, so the login screen shows them too

/* ------------------------------------------------------------------ auth */
onAuthStateChanged(auth, async user => {
  state.unsubs.forEach(u => u());
  state.unsubs = [];
  state.user = user;
  $("#splash").classList.add("gone");

  if (!user) {
    stopWatchingIncoming();
    resetChat();
    Object.assign(state, {
      me: null, partner: null, members: {}, presence: {}, messages: [], msgLimit: 60, loaded: {},
      memories: [], movements: [], calls: [], notifications: [], background: null, pinHash: null,
      locations: {}, myPos: null, birthdays: null, stickers: [], meals: {}, relationship: undefined,
      view: "home", locked: false, lockScope: "app", memUnlocked: false, pinLoaded: false, pinError: "", pin: null, pinReset: false
    });
    closeAllModals();
    renderLock();
    applyBackground();
    $("#app").hidden = true;
    $("#auth").hidden = false;
    return;
  }

  // Locked until the PIN is entered (or created the first time)
  Object.assign(state, { locked: true, lockScope: "app", memUnlocked: false, pinLoaded: false, pinError: "", pinReset: false });
  renderLock();
  $("#auth").hidden = true;
  $("#app").hidden = false;
  mountChat();
  go(location.hash.slice(1) in views ? location.hash.slice(1) : "home", { replace: true });

  try {
    const meSnap = await getDoc(doc(db, "users", user.uid));
    state.me = meSnap.exists() ? meSnap.data() : null;
  } catch (err) {
    if (err?.code === "permission-denied") {
      toast(`This account doesn't have access to ${appName()}.`, "error");
      await signOut(auth);
      return;
    }
  }
  await loadPin();
  subscribe();
  startPresence();
  watchIncoming();
  scheduleRender();
  if (isNative) {
    registerPush();
    clearDelivered();
    if (pendingPage) { go(pendingPage); pendingPage = null; }
  }
});

async function loadPin() {
  state.pinError = "";
  renderLock();
  try {
    const pinSnap = await getDoc(doc(db, "pins", state.user.uid));
    state.pinHash = pinSnap.exists() ? pinSnap.data().hash : null;
    state.pinLoaded = true;
    resetPin();
  } catch (err) {
    // Never fall back to "create a PIN" when we simply couldn't read it
    state.pinError = friendlyError(err, "Couldn't check your PIN. Check your internet and try again.");
  }
  renderLock();
}
hooks.loadPin = loadPin;

hooks.onUnlock = () => {
  applyShareIfReady(); // something was shared to Asaumi → open the chat with it
  if (!state.me?.name) askName();
  markRead();
  startLocation();
  maybeShowSurprise();
  setTimeout(() => maybeShowStoryMessage(), 600); // milestone / daily "together" message, once
  scheduleMealCheck(1500); // after Home, location and weather have loaded
  setTimeout(autoCheckUpdate, 4000); // "a new version is ready" (Android app only)
};

/* ------------------------------------------------------------------ Android app integration */
let pendingPage = null;
const openPage = page => {
  const view = page in views ? page : "home";
  if (state.user) go(view); else pendingPage = view;
};
onNotificationTap(openPage);
onLocalNotificationTap(openPage);
onResume(() => {
  if (!state.user) return;
  clearDelivered();
  retryPushIfNeeded();
});
addEventListener("online", () => { if (state.user) retryPushIfNeeded(); });
onBackButton(() => {
  const top = $("#modal-root").lastElementChild;
  if (top) { if (top.dismissable) top.close(); return; }
  if (document.body.classList.contains("in-call")) return;
  if (state.locked) { state.lockScope === "memories" ? actions.cancelMemoriesLock() : minimizeApp(); return; }
  if (state.user && state.view !== "home") { go("home", { replace: true }); return; }
  minimizeApp();
});

function onErr(err) {
  console.warn("[asaumi] snapshot", err);
  if (err?.code === "permission-denied") toast("No access — check the Firestore rules emails.", "error");
}

function subscribe() {
  const me = state.user.uid;
  const sub = u => state.unsubs.push(u);

  sub(onSnapshot(collection(db, "users"), snap => {
    state.members = Object.fromEntries(snap.docs.map(d => [d.id, { uid: d.id, ...d.data() }]));
    if (state.members[me]) state.me = state.members[me];
    const others = Object.values(state.members).filter(u => u.uid !== me);
    state.partner = others[0] || null;
    if (state.me?.shareLocation) startLocation(); else stopLocation();
    scheduleRender();
  }, onErr));

  sub(onSnapshot(collection(db, "presence"), snap => {
    state.presence = Object.fromEntries(snap.docs.map(d => [d.id, d.data({ serverTimestamps: "estimate" })]));
    scheduleRender();
  }, onErr));

  subscribeMessages();

  sub(onSnapshot(query(collection(db, "memories"), orderBy("createdAt", "desc")), snap => {
    state.memories = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    state.loaded.memories = true;
    scheduleRender();
  }, onErr));

  sub(onSnapshot(collection(db, "memorableMovements"), snap => {
    state.movements = snap.docs
      .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (whenDate(b.when)?.getTime() || 0) - (whenDate(a.when)?.getTime() || 0));
    state.loaded.movements = true;
    scheduleRender();
  }, onErr));

  sub(onSnapshot(query(collection(db, "calls"), orderBy("createdAt", "desc"), limit(30)), snap => {
    state.calls = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    scheduleRender();
  }, onErr));

  let firstNotif = true;
  sub(onSnapshot(query(collection(db, "notifications"), where("to", "==", me)), snap => {
    state.notifications = snap.docs
      .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    if (!firstNotif) {
      snap.docChanges().filter(c => c.type === "added").forEach(c => announceNotification(c.doc.data()));
    }
    firstNotif = false;
    scheduleRender();
  }, onErr));

  sub(onSnapshot(query(collection(db, "stickers"), orderBy("createdAt", "desc")), snap => {
    state.stickers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOurStickers();
  }, onErr));

  sub(onSnapshot(query(collection(db, "meals"), where("date", ">=", sinceKey(14))), snap => {
    state.meals = Object.fromEntries(snap.docs.map(d => [d.id, d.data({ serverTimestamps: "estimate" })]));
    state.loaded.meals = true;
    scheduleRender();
  }, onErr));

  sub(onSnapshot(collection(db, "locations"), snap => {
    state.locations = Object.fromEntries(snap.docs.map(d => [d.id, d.data({ serverTimestamps: "estimate" })]));
    checkNearChange();
    scheduleRender();
  }, onErr));

  sub(onSnapshot(doc(db, "settings", "relationship"), snap => {
    const first = state.relationship === undefined;
    state.relationship = snap.exists() ? snap.data() : null;
    if (first) maybeShowStoryMessage(); // data may arrive after the PIN was entered
    scheduleRender();
  }, onErr));

  sub(onSnapshot(doc(db, "settings", "birthdays"), snap => {
    state.birthdays = snap.exists() ? snap.data() : null;
    onBirthdaysChanged();
  }, onErr));

  sub(onSnapshot(doc(db, "settings", "app"), snap => {
    setBrand(snap.exists() ? snap.data() : null);
    scheduleRender();
  }, onErr));

  sub(onSnapshot(doc(db, "settings", "background"), snap => {
    state.background = snap.exists() ? snap.data() : null;
    applyBackground();
    scheduleRender();
  }, onErr));

  // refresh "last seen …" / typing timeouts
  // refresh "last seen", distance, and catch midnight on a birthday while the app is open
  const tick = setInterval(() => { scheduleRender(); maybeShowSurprise(); syncBirthdayNotification(); }, 20000);
  sub(() => clearInterval(tick));
}

let msgUnsub = null;
function subscribeMessages() {
  msgUnsub?.();
  let first = true;
  msgUnsub = onSnapshot(
    query(collection(db, "messages"), orderBy("createdAt", "asc"), limitToLast(state.msgLimit)),
    { includeMetadataChanges: true },
    snap => {
      state.messages = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }), pending: d.metadata.hasPendingWrites }));
      state.loaded.messages = true;
      if (!first) {
        snap.docChanges()
          .filter(c => c.type === "added" && !c.doc.metadata.hasPendingWrites && c.doc.data().from !== state.user.uid)
          .forEach(c => onIncomingMessage({ id: c.doc.id, ...c.doc.data() }));
      }
      first = false;
      markDelivered();
      updateChat();
      scheduleRender();
    },
    onErr
  );
  state.unsubs.push(() => { msgUnsub?.(); msgUnsub = null; });
}

actions.loadEarlier = () => {
  state.msgLimit += 60;
  subscribeMessages();
};

/* ------------------------------------------------------------------ login */
$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = $("button[type=submit]", f);
  const errEl = $("#login-error");
  errEl.textContent = "";
  if (!f.email.value.trim() || !f.password.value) { errEl.textContent = "Please enter your email and password."; return; }
  btn.disabled = true;
  btn.innerHTML = `${spinner("sm dark")} Signing in…`;
  try {
    await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
    f.reset();
  } catch (err) {
    errEl.textContent = friendlyError(err, "Couldn't sign in. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Login";
  }
});

$("#forgot-password").addEventListener("click", async () => {
  const email = $("#login-form").email.value.trim();
  const errEl = $("#login-error");
  if (!email) { errEl.textContent = "Type your email above, then tap “Forgot password?”."; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    errEl.textContent = "";
    toast("If this email belongs to Asaumi, a reset link is on its way 📩");
  } catch (err) {
    errEl.textContent = friendlyError(err, "Couldn't send the reset email.");
  }
});

$("#pw-toggle").addEventListener("click", e => {
  const input = $("#login-form").password;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  e.currentTarget.innerHTML = show ? ICONS.eyeOff : ICONS.eye;
});

/* ------------------------------------------------------------------ navigation */
function go(view, { replace = false } = {}) {
  if (!views[view]) view = "home";
  const prev = state.view;
  if (prev !== view) views[prev]?.leave?.();
  state.view = view;
  views[view].enter?.();
  if (location.hash.slice(1) !== view) history[replace ? "replaceState" : "pushState"](null, "", `#${view}`);
  hooks.render();
  const v = $("#view");
  v.classList.remove("enter");
  void v.offsetWidth; // restart the entrance animation
  v.classList.add("enter");
  clearTimeout(go.t);
  go.t = setTimeout(() => v.classList.remove("enter"), 600);
  if (view !== "chat") window.scrollTo({ top: 0 });
}
hooks.go = go;

addEventListener("popstate", () => {
  if (!state.user) return;
  const v = location.hash.slice(1);
  go(v in views ? v : "home", { replace: true });
});

document.addEventListener("click", e => {
  const nav = e.target.closest("[data-nav]");
  if (nav) { go(nav.dataset.nav); return; }
  const act = e.target.closest("[data-action]");
  if (act && actions[act.dataset.action]) actions[act.dataset.action](act.dataset, act);
});

/* ------------------------------------------------------------------ render */
const lastHtml = {};
hooks.render = function render() {
  if (!state.user) return;
  const v = state.view;
  document.body.dataset.view = v;
  const isChat = v === "chat";
  $("#view").hidden = isChat;
  $("#chat-view").hidden = !isChat;
  renderTopbar();
  renderNav();
  if (isChat) { updateChat(); return; }
  updateChat(); // keep the hidden chat in sync so switching is instant
  const html = views[v].render();
  if (lastHtml.view !== v || lastHtml.html !== html) {
    $("#view").innerHTML = html;
    lastHtml.view = v;
    lastHtml.html = html;
    views[v].mounted?.($("#view")); // e.g. Memories wires its carousels
  }
};

function renderTopbar() {
  const p = state.partner;
  const bell = unreadNotifications() + (unreadMessages() ? 1 : 0);
  const html = `
    <button class="brand" data-nav="asaumi">
      <span class="brand-heart">${brandIcon()}</span>
      <span class="brand-text"><b>${esc(appName())}</b><small>${esc(brand().tagline)}</small></span>
    </button>
    <div class="top-actions">
      ${p ? `<button class="partner-pill glass ${isOnline(p.uid) ? "on" : ""}" data-nav="chat" title="${esc(statusText(p.uid))}">
        <span class="avatar-wrap">${avatarHtml(p, "xs")}${presenceDot(p.uid)}</span>
        <span class="pp-text">${isOnline(p.uid) ? "Online" : "Away"}</span>
      </button>` : ""}
      <button class="icon-btn glass-btn" data-action="openNotifications" aria-label="Notifications">
        ${ICONS.bell}${bell ? `<span class="badge">${bell > 9 ? "9+" : bell}</span>` : ""}
      </button>
      <button class="icon-btn glass-btn hide-xs" data-nav="more" aria-label="Settings">${ICONS.gear}</button>
      <button class="me-btn" data-nav="more" aria-label="Your profile">${avatarHtml(state.me || { name: "?" }, "sm")}</button>
    </div>`;
  const top = $("#topbar");
  if (top.dataset.html !== html) { top.innerHTML = html; top.dataset.html = html; }
}

function renderNav() {
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.nav === state.view));
  const n = unreadMessages();
  const badge = $("#chat-badge");
  badge.hidden = !n;
  badge.textContent = n > 99 ? "99+" : n;
  document.title = n ? `(${n}) ${appName()}` : appName();
}

function applyBackground() {
  const url = state.user && state.background?.url;
  const img = $("#bg-img");
  document.body.classList.toggle("has-photo", !!url);
  if (!url) { img.hidden = true; img.removeAttribute("src"); return; }
  const src = cld(url, `f_auto,q_auto,w_${innerWidth > 900 ? 1920 : 1080}`);
  if (img.getAttribute("src") !== src) {
    img.onload = () => (img.hidden = false);
    img.src = src;
  }
}

/* ------------------------------------------------------------------ sign out */
actions.signOut = async () => {
  const ok = await confirmDialog({ title: "Sign out?", text: `Are you sure you want to leave ${appName()}?`, ok: "Sign Out" });
  if (!ok) return;
  stopWatchingIncoming();
  stopLocation();
  await unregisterPush();
  await stopPresence();
  state.unsubs.forEach(u => u());
  state.unsubs = [];
  await signOut(auth);
  toast("Signed out. See you soon ❤️");
};

/* ------------------------------------------------------------------ network */
function syncNet() {
  state.online = navigator.onLine;
  $("#net-banner").hidden = state.online;
}
addEventListener("online", () => { syncNet(); toast("Back online ✨"); });
addEventListener("offline", syncNet);
syncNet();

/* ------------------------------------------------------------------ service worker (install + notifications) */
if (!isNative && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
