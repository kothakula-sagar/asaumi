// 🔐 End-to-end encryption, free: everything uses the phone's built-in Web Crypto.
//
//  • One random "couple key" (AES-256-GCM) encrypts message text, captions, replies, memories, movements,
//    wishes, locations and chat backups. Firebase only ever stores "e1:…" ciphertext.
//  • Each phone/browser has its own ECDH P-256 key pair; the private half never leaves the device
//    (stored non-extractable in IndexedDB). Public halves are listed in e2eeDevices/{deviceId}.
//  • The first phone to turn encryption on creates the couple key. Any other device must be approved by a
//    device that already has it: the couple key is wrapped with an ECDH key only the new device can derive.
//    Both screens show the same 6-digit device code, so a device slipped in by someone else is spotted.
//  • Optional recovery key (written on paper, never stored online) restores access if every phone is lost.
//  • "Safety code" = fingerprint of the couple key; it must be the same on both phones.
// Who-sent-to-whom, times, read ticks and message types stay visible to Firebase (the app needs them).
import {
  doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, runTransaction, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, esc, ICONS, toast, openModal, confirmDialog, askPassword, scheduleRender, partnerName,
  shortWhen, actions, hooks, $
} from "./core.js";
import { isNative } from "./native.js";

const PREFIX = "e1:";
export const LOCKED = "🔒 Encrypted";
export const MSG_FIELDS = ["text", "replyTo.text", "reactions.*"];
export const isEnc = s => typeof s === "string" && s.startsWith(PREFIX);

export const E = {
  loaded: false, devicesLoaded: false,
  enabled: false, keyId: null, by: null,   // settings/e2ee
  key: null, localKeyId: null,             // the couple key on this device
  ready: false,                            // encryption on and this device can read/write
  device: null,                            // { id, priv, pub } this device
  devices: []                              // e2eeDevices
};

/* ------------------------------------------------------------------ bytes */
const te = new TextEncoder(), td = new TextDecoder();
function b64(buf) {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const friendly = msg => Object.assign(new Error(msg), { friendly: true });

/* ------------------------------------------------------------------ keys stored on this device only */
let kdb = null;
function keyDb() {
  if (!kdb) {
    kdb = new Promise((res, rej) => {
      const r = indexedDB.open("asaumi-keys", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("keys");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    kdb.catch(() => { kdb = null; });
  }
  return kdb;
}
async function kget(k) {
  const d = await keyDb();
  return new Promise((res, rej) => { const r = d.transaction("keys").objectStore("keys").get(k); r.onsuccess = () => res(r.result ?? null); r.onerror = () => rej(r.error); });
}
async function kput(k, v) {
  const d = await keyDb();
  return new Promise((res, rej) => { const tx = d.transaction("keys", "readwrite"); tx.objectStore("keys").put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function kdel(k) {
  const d = await keyDb();
  return new Promise(res => { const tx = d.transaction("keys", "readwrite"); tx.objectStore("keys").delete(k); tx.oncomplete = res; tx.onerror = res; });
}

/* ------------------------------------------------------------------ couple key, device keys, codes */
const importCouple = raw => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
async function fingerprint(key) {
  return hex(await crypto.subtle.digest("SHA-256", await crypto.subtle.exportKey("raw", key))).slice(0, 24);
}
// 12-digit safety code from the key fingerprint, e.g. "4821 0937 5512"
export const safetyCode = id => (id ? id.slice(0, 12).match(/.{4}/g).map(h => String(parseInt(h, 16) % 10000).padStart(4, "0")).join(" ") : "");

const codes = new Map(); // public key → "482 913"
async function deviceCode(pub) {
  if (codes.has(pub)) return codes.get(pub);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(pub)));
  const s = String(((h[0] << 16) | (h[1] << 8) | h[2]) % 1000000).padStart(6, "0");
  const c = `${s.slice(0, 3)} ${s.slice(3)}`;
  codes.set(pub, c);
  return c;
}
const codeOf = pub => codes.get(pub) || "… …";

async function loadDevice(me) {
  let d = await kget(`${me}:device`);
  if (!d) {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
    d = {
      id: `d${Date.now().toString(36)}${hex(crypto.getRandomValues(new Uint8Array(5)))}`,
      priv: kp.privateKey,
      pub: b64(await crypto.subtle.exportKey("spki", kp.publicKey))
    };
    await kput(`${me}:device`, d);
  }
  await deviceCode(d.pub);
  return d;
}

async function sharedKey(priv, pubB64) {
  const pub = await crypto.subtle.importKey("spki", unb64(pubB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: pub }, priv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// the couple key, wrapped so only `dev` can open it
async function grantFor(dev) {
  const k = await sharedKey(E.device.priv, dev.pub);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, await crypto.subtle.exportKey("raw", E.key));
  return { from: E.device.id, fromPub: E.device.pub, iv: b64(iv), ct: b64(ct), keyId: E.keyId };
}
async function openGrant(g) {
  const k = await sharedKey(E.device.priv, g.fromPub);
  return importCouple(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(g.iv) }, k, unb64(g.ct)));
}

/* ------------------------------------------------------------------ encrypt / decrypt */
const cache = new Map(); // ciphertext → text (so the same value is decrypted once)
function remember(ct, pt) {
  if (cache.size > 6000) cache.delete(cache.keys().next().value);
  cache.set(ct, pt);
}

async function sealBytes(bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, E.key, bytes));
  const all = new Uint8Array(12 + ct.length);
  all.set(iv);
  all.set(ct, 12);
  return PREFIX + b64(all);
}
async function openBytes(s) {
  const all = unb64(s.slice(PREFIX.length));
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: all.subarray(0, 12) }, E.key, all.subarray(12));
}

// Text → "e1:…" when encryption is on. Throws a friendly error if this device can't encrypt yet.
export async function enc(s, { big = false } = {}) {
  if (typeof s !== "string" || !s || !E.enabled) return s;
  if (s.startsWith(LOCKED)) throw friendly("This item is still locked on this phone, so it can't be saved.");
  if (!E.key) throw friendly("This phone doesn't have the encryption key yet. Open More → Encryption.");
  const out = await sealBytes(te.encode(s));
  if (!big) remember(out, s);
  return out;
}

// "e1:…" → text; plain text passes through; null when this device can't decrypt it
export async function dec(s, { big = false } = {}) {
  if (!isEnc(s)) return s;
  if (cache.has(s)) return cache.get(s);
  if (!E.key) return null;
  try {
    const t = td.decode(await openBytes(s));
    if (!big) remember(s, t);
    return t;
  } catch { return null; }
}

// Decrypts some fields of a document ("replyTo.text" = one level down).
// keep = leave unreadable fields encrypted (for storing); otherwise they show LOCKED.
export async function decDoc(d, fields, keep = false) {
  if (!d) return d;
  let out = d;
  for (const f of fields) {
    const [a, b] = f.split(".");
    if (b === "*") { // every value of a map, e.g. reactions: { uid: emoji }
      const map = d[a];
      if (!map || typeof map !== "object" || !Object.values(map).some(isEnc)) continue;
      const next = {};
      for (const [k, v] of Object.entries(map)) next[k] = isEnc(v) ? (await dec(v)) ?? (keep ? v : null) : v;
      if (out === d) out = { ...d };
      out[a] = Object.fromEntries(Object.entries(next).filter(([, v]) => v != null));
      continue;
    }
    const v = b ? d[a]?.[b] : d[a];
    if (!isEnc(v)) continue;
    const p = await dec(v);
    const val = p ?? (keep ? v : LOCKED);
    if (out === d) out = { ...d };
    if (b) out[a] = { ...out[a], [b]: val }; else out[a] = val;
    if (p == null && !keep) out.locked = true;
  }
  return out;
}

export async function encDoc(d, fields) {
  const out = { ...d };
  for (const f of fields) {
    const [a, b] = f.split(".");
    if (b === "*") {
      if (out[a] && typeof out[a] === "object") {
        const next = {};
        for (const [k, v] of Object.entries(out[a])) next[k] = typeof v === "string" ? await enc(v) : v;
        out[a] = next;
      }
    } else if (b) { if (out[a] && typeof out[a][b] === "string") out[a] = { ...out[a], [b]: await enc(out[a][b]) }; }
    else if (typeof out[a] === "string") out[a] = await enc(out[a]);
  }
  return out;
}

// locations/{uid}: { enc: "e1:{lat,lng,acc}", at }
export async function decLocation(d) {
  if (!d?.enc) return d;
  const p = await dec(d.enc);
  if (p == null) return null;
  try { return { ...d, ...JSON.parse(p) }; } catch { return null; }
}
export async function encLocation(pos) {
  if (!E.enabled) return pos;
  if (!E.key) return null; // can't share safely yet
  return { enc: await enc(JSON.stringify(pos)) };
}

// chat backup files / Google Drive
export async function sealBackup(obj) {
  const json = JSON.stringify(obj);
  if (!E.enabled) return json;
  if (!E.key) throw friendly("This phone doesn't have the encryption key yet, so it can't make a backup.");
  return JSON.stringify({ format: obj.format, version: 2, encrypted: true, enc: await enc(json, { big: true }) });
}
export async function openBackup(data) {
  if (!data?.encrypted) return data;
  const p = await dec(data.enc, { big: true });
  if (p == null) throw friendly("This backup is encrypted with a key this phone doesn't have.");
  return JSON.parse(p);
}

/* ------------------------------------------------------------------ sync */
const approved = d => !!(d?.grant || d?.approvedBy);
const deviceLabel = () => (isNative ? "Android app" : /Android|iPhone|iPad/i.test(navigator.userAgent) ? "Phone browser" : "Computer browser");
let settling = Promise.resolve();
let boot = null;

export function startE2ee() {
  Object.assign(E, { loaded: false, devicesLoaded: false, enabled: false, keyId: null, by: null, key: null, localKeyId: null, ready: false, device: null, devices: [] });
  asked.clear();
  askedSelf = false;
  const me = uid();
  boot = (async () => {
    E.device = await loadDevice(me);
    const k = await kget(`${me}:couple`);
    if (k) { E.key = k; E.localKeyId = await fingerprint(k); }
  })().catch(err => console.warn("[asaumi] e2ee boot", err));
  return [
    onSnapshot(doc(db, "settings", "e2ee"), async s => {
      await boot;
      const d = s.exists() ? s.data() : null;
      Object.assign(E, { enabled: !!d?.keyId, keyId: d?.keyId || null, by: d?.by || null, loaded: true });
      settle();
    }, err => console.warn("[asaumi] e2ee settings", err)),
    onSnapshot(collection(db, "e2eeDevices"), async s => {
      await boot;
      E.devices = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
      E.devicesLoaded = true;
      for (const d of E.devices) await deviceCode(d.pub);
      settle();
    }, err => console.warn("[asaumi] e2ee devices", err))
  ];
}

function settle() {
  settling = settling.then(doSettle).catch(err => console.warn("[asaumi] e2ee", err));
  return settling;
}

async function doSettle() {
  if (!E.loaded || !E.devicesLoaded || !E.device || !state.user) return;
  const me = uid();
  const wasReady = E.ready;
  // a key from an earlier setup is useless now
  if (E.key && E.enabled && E.localKeyId !== E.keyId) {
    E.key = null;
    E.localKeyId = null;
    await kdel(`${me}:couple`);
  }
  const mine = E.devices.find(d => d.id === E.device.id);
  // approved by another device → open the key it left for us
  if (E.enabled && !E.key && mine?.grant?.keyId === E.keyId) {
    try {
      const k = await openGrant(mine.grant);
      const id = await fingerprint(k);
      if (id === E.keyId) { E.key = k; E.localKeyId = id; await kput(`${me}:couple`, k); }
    } catch (err) { console.warn("[asaumi] e2ee grant", err); }
  }
  E.ready = E.enabled && !!E.key;
  if (E.enabled && !mine) {
    // list this device so the other phone can approve it
    try {
      await setDoc(doc(db, "e2eeDevices", E.device.id), { uid: me, pub: E.device.pub, label: deviceLabel(), createdAt: serverTimestamp() });
      if (E.ready) await updateDoc(doc(db, "e2eeDevices", E.device.id), { approvedBy: E.device.id, approvedAt: serverTimestamp() });
      E.regError = "";
    } catch (err) {
      console.warn("[asaumi] e2ee register", err);
      E.regError = err?.code === "permission-denied"
        ? "This phone couldn't send its request: publish the latest firestore.rules in Firebase (it needs the e2eeDevices section), then reopen the app."
        : "This phone couldn't send its request yet. Check the internet and reopen the app.";
    }
  } else if (mine) {
    E.regError = "";
  }
  if (E.ready && mine && !approved(mine)) {
    await updateDoc(doc(db, "e2eeDevices", E.device.id), { approvedBy: E.device.id, approvedAt: serverTimestamp() });
  }
  if (!wasReady && E.ready) {
    hooks.redecrypt?.();
    if (mine?.grant) toast("🔐 Encryption is ready on this phone");
  }
  scheduleRender();
  maybePrompt();
}

/* ------------------------------------------------------------------ turn on */
async function enableE2ee() {
  if (E.enabled || !E.device) return;
  const ok = await confirmDialog({
    icon: "🔐", title: "Turn on end-to-end encryption?",
    text: `New messages, memories, wishes and locations will be readable only on your phones. ${partnerName()}'s phone must be approved once, with a 6-digit code.`,
    ok: "Turn on"
  });
  if (!ok) return;
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const keyId = await fingerprint(key);
    const ref = doc(db, "settings", "e2ee");
    const won = await runTransaction(db, async tx => {
      const s = await tx.get(ref);
      if (s.exists() && s.data().keyId) return false;
      tx.set(ref, { v: 1, keyId, by: uid(), byDevice: E.device.id, at: serverTimestamp() });
      return true;
    });
    if (!won) { toast(`${partnerName()} just turned it on. Approve this phone from theirs.`); return; }
    await kput(`${uid()}:couple`, key);
    E.key = key;
    E.localKeyId = keyId;
    await settle();
    toast("🔐 End-to-end encryption is on");
    setTimeout(() => recoveryOffer(), 600);
  } catch (err) {
    console.warn("[asaumi] e2ee enable", err);
    toast(err?.code === "permission-denied" ? "Publish the latest firestore.rules first." : "Couldn't turn on encryption. Try again.");
  }
}

/* ------------------------------------------------------------------ approve other devices */
const asked = new Set();
let askedSelf = false;

function maybePrompt() {
  if (state.locked || !state.user || document.querySelector(".e2-modal")) return;
  if (E.ready) {
    const p = E.devices.find(d => !approved(d) && d.id !== E.device?.id && !asked.has(d.id));
    if (p) { asked.add(p.id); showApproval(p); }
  } else if (E.enabled && !askedSelf) {
    askedSelf = true;
    showNeedsKey();
  }
}

// after the PIN: pending approvals, or the one-time "turn on?" offer
export function checkE2eePrompts() {
  maybePrompt();
  if (!E.loaded || E.enabled || document.querySelector(".e2-modal")) return;
  const k = `asaumi.e2eeOffered.${uid()}`;
  try { if (localStorage.getItem(k)) return; localStorage.setItem(k, "1"); } catch { return; }
  const m = openModal(`
    <div class="detail-emoji">🔐</div>
    <h2>Make Asaumi end-to-end encrypted?</h2>
    <p>Only your two phones will be able to read your messages, memories, wishes and locations. Not Firebase, not Google, not anyone else.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Later</button>
      <button class="btn btn-primary" data-on>Turn on</button>
    </div>`, { cls: "e2-modal" });
  $("[data-on]", m).addEventListener("click", () => { m.close(); enableE2ee(); });
}

const whoOf = d => (d.uid === uid() ? `Your ${d.label || "device"}` : `${partnerName()}'s ${d.label || "phone"}`);

function showApproval(dev) {
  const m = openModal(`
    <div class="detail-emoji">🔐</div>
    <h2>${esc(whoOf(dev))} wants to read your chats</h2>
    <p>Approve only if ${dev.uid === uid() ? "you're setting it up right now" : `${esc(partnerName())} is setting it up right now`} and it shows this same code:</p>
    <div class="e2-code">${esc(codeOf(dev.pub))}</div>
    <p class="muted small">Compare the codes in person or on a call. Different code = don't approve.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Not now</button>
      <button class="btn btn-primary" data-ok>Approve</button>
    </div>`, { cls: "e2-modal" });
  $("[data-ok]", m).addEventListener("click", () => { m.close(); approveDevice(dev.id); });
}

async function approveDevice(id) {
  const dev = E.devices.find(d => d.id === id);
  if (!dev || !E.ready) return;
  try {
    await updateDoc(doc(db, "e2eeDevices", id), { grant: await grantFor(dev), approvedBy: E.device.id, approvedAt: serverTimestamp() });
    toast("Approved ✓ That phone can read your chats now");
  } catch (err) {
    console.warn("[asaumi] e2ee approve", err);
    toast("Couldn't approve. Try again.");
  }
}

function showNeedsKey() {
  const m = openModal(`
    <div class="detail-emoji">🔐</div>
    <h2>This phone needs the encryption key</h2>
    <p>Your chats are end-to-end encrypted. Open ${esc(partnerName())}'s Asaumi (or your other device): a request will appear. Approve it if it shows this code:</p>
    <div class="e2-code">${esc(codeOf(E.device.pub))}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>OK</button>
      <button class="btn btn-ghost" data-rec>Use recovery key</button>
    </div>`, { cls: "e2-modal" });
  $("[data-rec]", m).addEventListener("click", () => { m.close(); useRecoveryKey(); });
}

/* ------------------------------------------------------------------ recovery key (paper backup) */
const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
function toB32(bytes) {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    val &= (1 << bits) - 1;
  }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function fromB32(s) {
  let bits = 0, val = 0;
  const out = [];
  for (const c of s.toUpperCase().replace(/[^A-Z0-9]/g, "")) {
    const i = B32.indexOf(c);
    if (i < 0) throw friendly("That recovery key has a wrong character.");
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    val &= (1 << bits) - 1;
  }
  if (out.length < 32) throw friendly("That recovery key is too short.");
  return new Uint8Array(out.slice(0, 32));
}

function recoveryOffer() {
  const m = openModal(`
    <div class="detail-emoji">📝</div>
    <h2>Save a recovery key?</h2>
    <p>If both phones are ever lost or reset at the same time, the recovery key is the only way to read your encrypted chats again. Write it on paper and keep it safe.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Later</button>
      <button class="btn btn-primary" data-show>Show it</button>
    </div>`, { cls: "e2-modal" });
  $("[data-show]", m).addEventListener("click", () => { m.close(); showRecoveryKey(true); });
}

async function showRecoveryKey(skipPassword = false) {
  if (!E.ready) return;
  if (!skipPassword && !(await askPassword({ title: "Show recovery key", text: "Enter your login password first." }))) return;
  const key = toB32(new Uint8Array(await crypto.subtle.exportKey("raw", E.key))).match(/.{1,4}/g).join("-");
  openModal(`
    <div class="detail-emoji">📝</div>
    <h2>Your recovery key</h2>
    <div class="e2-key">${esc(key)}</div>
    <p class="small">Write it on paper. Don't screenshot it or send it in any app: anyone with this key and access to your Firebase could read your chats.</p>
    <div class="modal-actions single"><button class="btn btn-primary" data-close>I wrote it down</button></div>`, { cls: "e2-modal" });
}

function useRecoveryKey() {
  const m = openModal(`
    <div class="detail-emoji">📝</div>
    <h2>Use recovery key</h2>
    <label class="field"><span>Recovery key</span><textarea rows="3" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH-…"></textarea></label>
    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-ok>Unlock</button>
    </div>`, { cls: "e2-modal" });
  const t = $("textarea", m), err = $(".form-error", m);
  $("[data-ok]", m).addEventListener("click", async () => {
    try {
      const k = await importCouple(fromB32(t.value));
      const id = await fingerprint(k);
      if (id !== E.keyId) throw friendly("That isn't the key for these chats.");
      await kput(`${uid()}:couple`, k);
      E.key = k;
      E.localKeyId = id;
      m.close();
      await settle();
      toast("🔐 Unlocked. This phone can read your chats now");
    } catch (e) {
      err.textContent = e.friendly ? e.message : "That recovery key didn't work.";
    }
  });
}

/* ------------------------------------------------------------------ encrypt older items */
async function encryptOld() {
  if (!E.ready) return;
  const jobs = [["memories", ["title", "text"]], ["memorableMovements", ["text"]], ["wishes", ["title", "note", "link"]]];
  toast("Encrypting your older items…");
  let n = 0;
  try {
    for (const [col, fields] of jobs) {
      const snap = await getDocs(query(collection(db, col), where("byUid", "==", uid())));
      for (const d of snap.docs) {
        const data = d.data(), changes = {};
        for (const f of fields) if (typeof data[f] === "string" && data[f] && !isEnc(data[f])) changes[f] = await enc(data[f]);
        if (Object.keys(changes).length) { await updateDoc(d.ref, changes); n += 1; }
      }
    }
    toast(n ? `🔐 ${n} older item${n > 1 ? "s" : ""} encrypted` : "Everything you added is already encrypted ✓");
  } catch (err) {
    console.warn("[asaumi] e2ee migrate", err);
    toast(err?.code === "permission-denied" ? "Publish the latest firestore.rules first." : "Couldn't finish. Try again.");
  }
}

/* ------------------------------------------------------------------ More → Encryption */
export function e2eeCard() {
  if (!E.loaded || !E.device) {
    return `<div class="glass card"><h3>🔐 End-to-end encryption</h3><p class="muted small">Checking…</p></div>`;
  }
  if (!E.enabled) {
    return `
      <div class="glass card">
        <h3>🔐 End-to-end encryption</h3>
        <p>Off. Turn it on so only your two phones can read your messages, memories, wishes and locations. Not Firebase, not Google, not anyone else.</p>
        <button class="btn btn-primary btn-sm" data-action="e2Enable">Turn on</button>
      </div>`;
  }
  if (!E.ready) {
    return `
      <div class="glass card e2-card">
        <h3>🔐 End-to-end encryption</h3>
        <p>On, but <b>this device doesn't have the key yet</b>. Open Asaumi on ${esc(partnerName())}'s phone (or your other approved device) and approve the request with this code:</p>
        <div class="e2-code">${esc(codeOf(E.device.pub))}</div>
        ${E.regError ? `<p class="dev-warn">⚠️ ${esc(E.regError)}</p>`
          : E.devices.some(d => d.id === E.device.id) ? `<p class="small muted">✓ Request sent. Waiting for ${esc(partnerName())} to approve it in More → End-to-end encryption.</p>` : ""}
        <button class="btn btn-ghost btn-sm" data-action="e2Recovery">Use recovery key instead</button>
      </div>`;
  }
  const rows = E.devices
    .slice()
    .sort((a, b) => (a.uid === uid() ? -1 : 1) - (b.uid === uid() ? -1 : 1))
    .map(d => {
      const self = d.id === E.device.id;
      return `
        <div class="e2-dev">
          <span class="e2-dev-ico">${d.label === "Android app" ? "📱" : "💻"}</span>
          <span class="e2-dev-main"><b>${esc(self ? "This device" : whoOf(d))}</b>
            <small>${approved(d) ? "✓ Can read" : "⏳ Waiting for approval"} · code ${esc(codeOf(d.pub))} · ${esc(shortWhen(d.createdAt))}</small></span>
          ${!approved(d) ? `<button class="btn btn-primary btn-sm" data-action="e2Approve" data-id="${esc(d.id)}">Approve</button>` : ""}
          ${!self ? `<button class="icon-btn sm ghost" data-action="e2Remove" data-id="${esc(d.id)}" aria-label="Remove device">${ICONS.trash}</button>` : ""}
        </div>`;
    }).join("");
  return `
    <div class="glass card e2-card">
      <h3>🔐 End-to-end encryption</h3>
      <p>On ✓ New messages, memories, wishes and locations can be read only on the approved devices below.</p>
      <div class="e2-safety"><small>Safety code (must be the same on both phones)</small><b>${esc(safetyCode(E.keyId))}</b></div>
      <div class="e2-devs">${rows}</div>
      <div class="e2-actions">
        <button class="btn btn-ghost btn-sm" data-action="e2ShowKey">📝 Recovery key</button>
        <button class="btn btn-ghost btn-sm" data-action="e2Migrate">Encrypt my older items</button>
      </div>
    </div>`;
}

Object.assign(actions, {
  e2Enable: enableE2ee,
  e2Approve: d => approveDevice(d.id),
  e2Remove: async d => {
    const dev = E.devices.find(x => x.id === d.id);
    if (!dev) return;
    const ok = await confirmDialog({
      icon: "trash", title: "Remove this device?",
      text: "It won't get the key again. If it already has it, it can still read what it saved; to fully lock it out, reset that phone.",
      ok: "Remove", danger: true
    });
    if (ok) deleteDoc(doc(db, "e2eeDevices", d.id)).catch(() => toast("Couldn't remove it."));
  },
  e2ShowKey: () => showRecoveryKey(false),
  e2Recovery: useRecoveryKey,
  e2Migrate: encryptOld
});
