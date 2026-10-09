import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, getCountFromServer, onSnapshot, query, where, orderBy, limit, limitToLast,
  writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const KEEP_NOTIFICATIONS = 10; // the bell keeps the latest 10; older ones are deleted from Firebase
const LIVE_MESSAGES = 60;      // newest messages kept live from Firebase; older ones come from this phone
import {
  auth, db, state, views, actions, hooks, scheduleRender, $, $$, esc, ICONS, avatarHtml, presenceDot,
  isOnline, statusText, toast, friendlyError, confirmDialog, closeAllModals, cld, spinner, whenDate, toDate,
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
import "./wishlist.js";
import "./home.js";
import { askName } from "./settings.js";
import { startLocation, stopLocation, checkNearChange } from "./together.js";
import { onBirthdaysChanged, maybeShowSurprise, syncBirthdayNotification } from "./birthday.js";
import { onLocalNotificationTap } from "./native.js";
import { scheduleMealCheck, sinceKey } from "./meals.js";
import { maybeShowStoryMessage } from "./relationship.js";
import { initShare, applyShareIfReady } from "./share.js";
import { autoCheckUpdate } from "./updates.js";
import { loadArchive, saveMessages, forgetMessages, maintainChat } from "./chatstore.js";
import { autoBackup, offerRestore } from "./backup.js";
import { watchGames, checkGameInvite } from "./games.js";
import { startE2ee, checkE2eePrompts, decDoc, decLocation, isEnc, LOCKED, MSG_FIELDS } from "./e2ee.js";

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
    live = []; archive = []; archiveFor = null; olderDone = false; // the saved chat stays on the phone for the next login
    Object.assign(state, {
      me: null, partner: null, members: {}, presence: {}, messages: [], msgLimit: LIVE_MESSAGES, loaded: {},
      memories: [], memLatest: null, memCount: null, movements: [], calls: [], notifications: [], background: null, pinHash: null, wishes: [], wishError: null,
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
  setTimeout(checkGameInvite, 400); // a game invite that arrived while locked
  setTimeout(checkE2eePrompts, 1800); // encryption: approve a new phone / this phone needs the key
  markRead();
  startLocation();
  maybeShowSurprise();
  setTimeout(() => maybeShowStoryMessage(), 600); // milestone / daily "together" message, once
  scheduleMealCheck(1500); // after Home, location and weather have loaded
  setTimeout(autoCheckUpdate, 4000); // "a new version is ready" (Android app only)
  setTimeout(offerRestore, 2500);    // first login on this phone: "Bring back your old chats?" (Google Drive)
  setTimeout(async () => {
    await autoBackup();              // daily Google Drive backup (once Drive was connected)
    await maintainChat();            // save chat on this phone; remove old messages from Firebase only if both Drive backups have them
  }, 8000);
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
  if (state.user && views[state.view]?.back?.()) return; // e.g. from a game back to the games list
  if (state.user && state.view !== "home") { go("home", { replace: true }); return; }
  minimizeApp();
});

function onErr(err) {
  console.warn("[asaumi] snapshot", err);
  if (err?.code === "permission-denied") toast("No access — check the Firestore rules emails.", "error");
}

/* End-to-end encryption: snapshots are decrypted before they reach the screen. The latest raw list of each
   listener is kept, so everything is decrypted again once this phone receives the key. */
const rawLists = {}, decSeq = {};
function decrypted(key, list, fn, apply) {
  rawLists[key] = { list, fn, apply };
  const n = (decSeq[key] = (decSeq[key] || 0) + 1);
  Promise.all(list.map(fn)).then(out => { if (decSeq[key] === n) apply(out); });
}
hooks.redecrypt = () => {
  Object.entries(rawLists).forEach(([k, v]) => decrypted(k, v.list, v.fn, v.apply));
  if (liveRaw.length) applyLive(liveRaw, [], true);
  actions.reloadLocalChat?.();
};
const decWith = fields => d => decDoc(d, fields);

function subscribe() {
  const me = state.user.uid;
  const sub = u => state.unsubs.push(u);

  // 🔐 encryption keys first (decrypting waits for them)
  startE2ee().forEach(sub);

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

  // Home needs only the newest memory and a count (1 read + 1 count read). The full list loads after
  // Memories is unlocked (actions.startMemories), so opening the app doesn't read every memory.
  sub(onSnapshot(query(collection(db, "memories"), orderBy("createdAt", "desc"), limit(1)), snap => {
    const list = snap.docs.slice(0, 1).map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    decrypted("memLatest", list, decWith(["title", "text"]), out => { state.memLatest = out[0] || null; scheduleRender(); });
    if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites && !state.loaded.memories) refreshMemCount();
  }, onErr));

  sub(onSnapshot(collection(db, "memorableMovements"), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    decrypted("movements", list, decWith(["text"]), out => {
      state.movements = out.sort((a, b) => (whenDate(b.when)?.getTime() || 0) - (whenDate(a.when)?.getTime() || 0));
      state.loaded.movements = true;
      scheduleRender();
    });
  }, onErr));

  // Wishlist: two listeners, because "personal" wishes are readable only by the person who added them
  const wishParts = { together: [], mine: [] };
  const mergeWishes = () => {
    const all = new Map([...wishParts.together, ...wishParts.mine].map(w => [w.id, w]));
    state.wishes = [...all.values()];
    scheduleRender();
  };
  const wishErr = err => {
    console.warn("[asaumi] wishes", err);
    state.wishError = err?.code === "permission-denied" ? "rules" : "other";
    state.loaded.wishes = true;
    scheduleRender();
  };
  const WISH_FIELDS = ["title", "note", "link"];
  sub(onSnapshot(query(collection(db, "wishes"), where("scope", "==", "together")), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    decrypted("wishesTogether", list, decWith(WISH_FIELDS), out => {
      wishParts.together = out;
      state.loaded.wishes = true;
      state.wishError = null;
      mergeWishes();
    });
  }, wishErr));
  sub(onSnapshot(query(collection(db, "wishes"), where("byUid", "==", me)), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    decrypted("wishesMine", list, decWith(WISH_FIELDS), out => { wishParts.mine = out; mergeWishes(); });
  }, wishErr));

  sub(onSnapshot(query(collection(db, "calls"), orderBy("createdAt", "desc"), limit(30)), snap => {
    state.calls = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    scheduleRender();
  }, onErr));

  let firstNotif = true;
  sub(onSnapshot(query(collection(db, "notifications"), where("to", "==", me)), snap => {
    const all = snap.docs
      .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    // only the latest 10 are kept; older ones are removed from Firebase
    state.notifications = all.slice(0, KEEP_NOTIFICATIONS);
    const extra = all.slice(KEEP_NOTIFICATIONS).filter(n => !snap.metadata.hasPendingWrites && n.createdAt);
    if (extra.length) {
      const b = writeBatch(db);
      extra.forEach(n => b.delete(doc(db, "notifications", n.id)));
      b.commit().catch(err => console.warn("[asaumi] trim notifications", err));
    }
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
    const list = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    decrypted("locations", list, decLocation, out => {
      state.locations = Object.fromEntries(out.filter(d => d && typeof d.lat === "number").map(d => [d.id, d]));
      checkNearChange();
      scheduleRender();
    });
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

  // 🎮 the open game (normally 0 or 1 document) + scores
  watchGames().forEach(sub);

  // refresh "last seen …" / typing timeouts
  // refresh "last seen", distance, and catch midnight on a birthday while the app is open
  const tick = setInterval(() => { scheduleRender(); maybeShowSurprise(); syncBirthdayNotification(); }, 20000);
  sub(() => clearInterval(tick));
}

/* ------------------------------------------------------------------ memories (loaded only once unlocked) */
let memUnsub = null;

function refreshMemCount() {
  getCountFromServer(collection(db, "memories"))
    .then(s => { if (!state.loaded.memories) { state.memCount = s.data().count; scheduleRender(); } })
    .catch(err => console.warn("[asaumi] memory count", err));
}

// Called by memories.js when Memories is unlocked; keeps listening until sign-out (only changes cost reads)
actions.startMemories = () => {
  if (memUnsub || !state.user) return;
  memUnsub = onSnapshot(query(collection(db, "memories"), orderBy("createdAt", "desc")), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    decrypted("memories", list, decWith(["title", "text"]), out => {
      state.memories = out;
      state.memCount = out.length;
      state.loaded.memories = true;
      scheduleRender();
    });
  }, onErr);
  state.unsubs.push(() => { memUnsub?.(); memUnsub = null; });
};

/* Chat = messages saved on this phone (older than what Firebase keeps) + the live ones from Firebase.
   state.messages is the merged list (newest msgLimit), so the chat screen works the same as before. */
let msgUnsub = null;
let live = [];          // from Firebase
let archive = [];       // from this phone (chatstore.js), each has archived: true
let archiveFor = null;

// a message this phone can't decrypt (yet) shows "🔒 Encrypted" and can't be edited
const showable = m => (isEnc(m.text) || isEnc(m.replyTo?.text)
  ? { ...m, text: isEnc(m.text) ? LOCKED : m.text, replyTo: m.replyTo && isEnc(m.replyTo.text) ? { ...m.replyTo, text: LOCKED } : m.replyTo, locked: true }
  : m);

function mergeMessages() {
  const liveIds = new Set(live.map(m => m.id));
  const oldestLive = live.length ? toDate(live[0].createdAt)?.getTime() ?? Infinity : Infinity;
  const older = archive.filter(m => !liveIds.has(m.id) && m.createdAt.getTime() < oldestLive);
  state.messages = [...older, ...live].slice(-state.msgLimit).map(showable);
}

async function loadLocalChat() {
  const me = state.user?.uid;
  if (!me || archiveFor === me) return;
  archiveFor = me;
  const saved = await loadArchive();
  // messages saved while this phone had no key are decrypted now (and saved again readable)
  archive = await Promise.all(saved.map(m => decDoc(m, MSG_FIELDS, true)));
  const opened = archive.filter((m, i) => m !== saved[i]);
  if (opened.length) saveMessages(opened);
  if (state.user?.uid !== me) return;
  mergeMessages();
  if (archive.length) state.loaded.messages = true; // show the saved chat at once, even offline
  updateChat();
  scheduleRender();
}

function subscribeMessages() {
  msgUnsub?.();
  let first = true;
  loadLocalChat();
  msgUnsub = onSnapshot(
    query(collection(db, "messages"), orderBy("createdAt", "asc"), limitToLast(LIVE_MESSAGES)),
    { includeMetadataChanges: true },
    snap => {
      const raw = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }), pending: d.metadata.hasPendingWrites }));
      const added = first ? [] : snap.docChanges()
        .filter(c => c.type === "added" && !c.doc.metadata.hasPendingWrites && c.doc.data().from !== state.user.uid)
        .map(c => ({ id: c.doc.id, ...c.doc.data() }));
      first = false;
      liveRaw = raw;
      applyLive(raw, added, snap.metadata.fromCache);
    },
    onErr
  );
  state.unsubs.push(() => { msgUnsub?.(); msgUnsub = null; liveRaw = []; });
}

let liveRaw = [], liveSeq = 0;
async function applyLive(raw, added = [], fromCache = true) {
  const n = ++liveSeq;
  const list = await Promise.all(raw.map(m => decDoc(m, MSG_FIELDS, true)));
  if (n !== liveSeq || !state.user) return; // a newer snapshot arrived meanwhile
  live = list;
  // keep a copy on this phone
  saveMessages(live);
  if (!fromCache && live.length) {
    // a saved message inside the live range that Firebase no longer has was deleted ("Delete for both")
    const ids = new Set(live.map(m => m.id));
    const from = toDate(live[0].createdAt)?.getTime() ?? Infinity;
    const gone = archive.filter(m => !ids.has(m.id) && m.createdAt.getTime() >= from).map(m => m.id);
    if (gone.length) { archive = archive.filter(m => !gone.includes(m.id)); forgetMessages(gone); }
  }
  // newly seen messages join the local list too, so they stay after Firebase removes them
  // (and edits replace the saved copy)
  const byId = new Map(archive.map(m => [m.id, m]));
  live.filter(m => !m.pending && toDate(m.createdAt))
    .forEach(m => byId.set(m.id, { ...m, createdAt: toDate(m.createdAt), archived: true }));
  archive = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  mergeMessages();
  state.loaded.messages = true;
  added.forEach(m => onIncomingMessage(m));
  markDelivered();
  updateChat();
  scheduleRender();
}

// after "Restore chat": read the phone's saved chat again
actions.reloadLocalChat = async () => {
  archiveFor = null;
  await loadLocalChat();
};

// "Delete from this phone" for an old message that only exists in the phone's saved chat
actions.forgetLocalMessage = id => {
  archive = archive.filter(m => m.id !== id);
  forgetMessages([id]);
  mergeMessages();
  updateChat();
  scheduleRender();
};

// After "Edit" / "Delete for both" on an older message that is outside the live 60
actions.patchLocalMessage = (id, changes) => {
  const m = archive.find(x => x.id === id);
  if (!m) return;
  Object.assign(m, changes);
  saveMessages([m]);
  mergeMessages();
  updateChat();
  scheduleRender();
};

/* "Load earlier messages": shown from the chat saved on this phone (no Firebase reads).
   Only if the phone doesn't have them (e.g. a new browser) are the missing ones read from Firebase, once. */
let olderDone = false; // Firebase has nothing older than what this phone shows

async function fetchOlder(n) {
  const oldest = toDate(state.messages[0]?.createdAt);
  if (!oldest) { olderDone = true; return; }
  const snap = await getDocs(query(collection(db, "messages"),
    where("createdAt", "<", Timestamp.fromDate(oldest)), orderBy("createdAt", "desc"), limit(n)));
  if (snap.size < n) olderDone = true;
  const list = await Promise.all(snap.docs.map(d => decDoc({ id: d.id, ...d.data() }, MSG_FIELDS, true)));
  if (!list.length) return;
  await saveMessages(list);
  const byId = new Map(archive.map(m => [m.id, m]));
  list.forEach(m => byId.set(m.id, { ...m, createdAt: toDate(m.createdAt), archived: true }));
  archive = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  mergeMessages();
}

actions.loadEarlier = async () => {
  state.msgLimit += 60;
  mergeMessages();
  if (state.messages.length < state.msgLimit && !olderDone) {
    try { await fetchOlder(state.msgLimit - state.messages.length); }
    catch (err) { console.warn("[asaumi] older messages", err); }
  }
  updateChat();
  scheduleRender();
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
