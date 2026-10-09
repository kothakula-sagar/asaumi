// Chat history kept ON THIS PHONE, so Firebase only needs the last 10 days.
//  • Every message this phone sees is saved in IndexedDB (photos/videos/voice stay in Cloudinary, only the link is saved).
//  • syncArchive() fetches anything this phone hasn't saved yet (e.g. after days away), then records in
//    users/{uid}.chatArchivedTo how far this phone's copy goes.
//  • pruneFirebase() deletes messages older than 10 days from Firebase, but never past what BOTH phones
//    have saved AND what BOTH Google Drive backups contain (users/{uid}.driveBackupTo, set by backup.js),
//    so nothing is lost even if a phone wasn't opened for a while or is lost later.
// Only messages are ever removed. Memories, movements, wishes etc. stay in Firebase.
import {
  collection, query, where, orderBy, limit, startAfter, getDocs, writeBatch, doc, setDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, state, uid, toDate } from "./core.js";
import { decDoc, MSG_FIELDS } from "./e2ee.js";

export const KEEP_DAYS = 10;
const DAY = 864e5;
const DATE_FIELDS = ["createdAt", "deliveredAt", "readAt", "editedAt"];

/* ------------------------------------------------------------------ IndexedDB */
let dbp = null, dbFor = null;
function open() {
  const me = uid();
  if (!me) return Promise.reject(new Error("signed out"));
  if (dbp && dbFor === me) return dbp;
  dbFor = me;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(`asaumi-chat-${me}`, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("messages", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });

// Firestore message → plain object for storage
function pack(m) {
  const o = { ...m };
  delete o.pending;
  delete o.archived;
  for (const k of DATE_FIELDS) { const d = toDate(o[k]); o[k] = d ? d.getTime() : null; }
  return JSON.parse(JSON.stringify(o)); // drops anything IndexedDB can't store
}
function unpack(o) {
  const m = { ...o, archived: true };
  for (const k of DATE_FIELDS) m[k] = o[k] ? new Date(o[k]) : null;
  return m;
}

export async function loadArchive() {
  try {
    const d = await open();
    const all = await new Promise((res, rej) => {
      const r = d.transaction("messages").objectStore("messages").getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
    return all.map(unpack).sort((a, b) => a.createdAt - b.createdAt);
  } catch (err) {
    console.warn("[asaumi] chat archive load", err);
    return [];
  }
}

export async function saveMessages(list) {
  // stored readable when this phone has the encryption key (otherwise kept encrypted until it gets it)
  const ok = await Promise.all(list.filter(m => m.id && !m.pending && toDate(m.createdAt)).map(m => decDoc(m, MSG_FIELDS, true)));
  if (!ok.length) return;
  try {
    const d = await open();
    const tx = d.transaction("messages", "readwrite");
    const st = tx.objectStore("messages");
    ok.forEach(m => st.put(pack(m)));
    await done(tx);
  } catch (err) {
    console.warn("[asaumi] chat archive save", err);
  }
}

export async function forgetMessages(ids) {
  if (!ids.length) return;
  try {
    const d = await open();
    const tx = d.transaction("messages", "readwrite");
    ids.forEach(id => tx.objectStore("messages").delete(id));
    await done(tx);
  } catch (err) {
    console.warn("[asaumi] chat archive delete", err);
  }
}

/* ------------------------------------------------------------------ backup file */
// Everything saved on this phone, in the stored (plain) form
export async function exportArchive() {
  const d = await open();
  return new Promise((res, rej) => {
    const r = d.transaction("messages").objectStore("messages").getAll();
    r.onsuccess = () => res((r.result || []).sort((a, b) => a.createdAt - b.createdAt));
    r.onerror = () => rej(r.error);
  });
}

// Adds messages from a backup that this phone doesn't have yet. Returns how many were added.
export async function importArchive(list) {
  const d = await open();
  const have = new Set(await new Promise((res, rej) => {
    const r = d.transaction("messages").objectStore("messages").getAllKeys();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  }));
  const add = list.filter(m => m && typeof m.id === "string" && typeof m.createdAt === "number" && !have.has(m.id));
  if (!add.length) return 0;
  const tx = d.transaction("messages", "readwrite");
  add.forEach(m => tx.objectStore("messages").put(m));
  await done(tx);
  return add.length;
}

/* ------------------------------------------------------------------ catch up + clean up */
const syncKey = () => `asaumi.chatSyncedTo.${uid()}`;
const getSynced = () => { try { return Number(localStorage.getItem(syncKey())) || 0; } catch { return 0; } };
const setSynced = ms => { try { localStorage.setItem(syncKey(), String(ms)); } catch { /* ignore */ } };

let running = false;

// Save every message this phone hasn't seen yet, then tell the other phone how far our copy goes.
export async function syncArchive() {
  const me = uid();
  if (!me) return false;
  let since = getSynced();
  let newest = since;
  let last = null;
  for (let page = 0; page < 40; page++) { // up to 20,000 messages in one go
    const parts = [collection(db, "messages"), where("createdAt", ">=", Timestamp.fromMillis(since)), orderBy("createdAt", "asc"), limit(500)];
    if (last) parts.push(startAfter(last));
    const snap = await getDocs(query(...parts));
    if (snap.empty) break;
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await saveMessages(list);
    newest = Math.max(newest, ...list.map(m => toDate(m.createdAt)?.getTime() || 0));
    last = snap.docs.at(-1);
    if (snap.size < 500) break;
  }
  if (newest > getSynced()) setSynced(newest);
  // the other phone waits for this before deleting anything from Firebase
  const reported = toDate(state.me?.chatArchivedTo)?.getTime() || 0;
  if (newest && newest > reported) {
    await setDoc(doc(db, "users", me), { chatArchivedTo: Timestamp.fromMillis(newest) }, { merge: true });
  }
  return true;
}

// Delete from Firebase: messages older than 10 days that BOTH phones have already saved.
export async function pruneFirebase() {
  const mine = toDate(state.me?.chatArchivedTo)?.getTime();
  const theirs = toDate(state.partner?.chatArchivedTo)?.getTime();
  const myDrive = toDate(state.me?.driveBackupTo)?.getTime();
  const theirDrive = toDate(state.partner?.driveBackupTo)?.getTime();
  // nothing is removed until both phones saved it AND both Google Drive backups contain it
  if (!mine || !theirs || !myDrive || !theirDrive) return 0;
  const cutoff = Math.min(Date.now() - KEEP_DAYS * DAY - 3600e3, mine, theirs, myDrive, theirDrive); // 1 h margin for phone clocks
  let removed = 0;
  for (let round = 0; round < 10; round++) {
    const snap = await getDocs(query(collection(db, "messages"), where("createdAt", "<", Timestamp.fromMillis(cutoff)), orderBy("createdAt", "asc"), limit(400)));
    if (snap.empty) break;
    await saveMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))); // make sure this phone has them
    const b = writeBatch(db);
    snap.docs.forEach(d => b.delete(d.ref));
    await b.commit();
    removed += snap.size;
    if (snap.size < 400) break;
  }
  return removed;
}

// After the PIN, at most every 6 hours: catch up the local copy, then clean Firebase.
export async function maintainChat() {
  if (running || !uid()) return;
  const key = `asaumi.chatMaintainedAt.${uid()}`;
  let at = 0;
  try { at = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ }
  if (Date.now() - at < 6 * 3600e3) return;
  running = true;
  try {
    await syncArchive();
    const n = await pruneFirebase();
    if (n) console.info(`[asaumi] removed ${n} chat messages older than ${KEEP_DAYS} days from Firebase (kept on this phone)`);
    try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
  } catch (err) {
    console.warn("[asaumi] chat maintenance", err);
  } finally {
    running = false;
  }
}
