import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, CLOUDINARY } from "./config.js";
import { isNative, openExternal } from "./native.js";

/* ------------------------------------------------------------------ firebase */
export const fbApp = initializeApp(firebaseConfig);
export const auth = getAuth(fbApp);
export const db = (() => {
  try {
    // Offline cache: messages typed without internet are sent when the connection returns.
    return initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    return getFirestore(fbApp);
  }
})();

/* ------------------------------------------------------------------ state */
export const state = {
  user: null,
  me: null,               // users/{myUid}
  partner: null,          // users/{partnerUid} (with .uid)
  members: {},            // uid -> user doc
  presence: {},           // uid -> presence doc
  messages: [],
  msgLimit: 60,
  loaded: {},             // which snapshots have arrived
  memories: [],
  movements: [],
  calls: [],
  notifications: [],
  background: null,       // settings/background
  pinHash: null,
  view: "home",
  locked: false,          // PIN screen is showing
  lockScope: "app",       // "app" (on open) or "memories"
  memUnlocked: false,
  pinLoaded: false,
  pinError: "",
  pin: null,
  pinReset: false,
  online: navigator.onLine,
  unsubs: []
};

export const views = {};    // name -> { render(), enter?(), leave?() }
export const actions = {};  // data-action handlers
export const hooks = { render() {} };

let renderQueued = 0;
export function scheduleRender() {
  if (renderQueued) return;
  renderQueued = requestAnimationFrame(() => { renderQueued = 0; hooks.render(); });
}

/* ------------------------------------------------------------------ dom helpers */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const uid = () => state.user?.uid;
export const myName = () => state.me?.name || state.user?.email?.split("@")[0] || "Me";
export const partnerName = () => state.partner?.name || "Your person";
export const nameOf = (id, fallback) => (id === uid() ? "You" : state.members[id]?.name || fallback || "Someone");
export const realNameOf = (id, fallback) => state.members[id]?.name || fallback || "Someone";

/* ------------------------------------------------------------------ time */
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const longDateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fullDateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
const weekdayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long" });

export const toDate = ts => (ts && typeof ts.toDate === "function" ? ts.toDate() : ts instanceof Date ? ts : null);
export const fmtDate = ts => { const d = toDate(ts); return d ? dateFmt.format(d) : "Just now"; };
export const fmtFullDate = ts => { const d = toDate(ts); return d ? fullDateFmt.format(d) : "Today"; };
export const fmtLongDate = ts => { const d = toDate(ts); return d ? longDateFmt.format(d) : ""; };
export const fmtTime = ts => { const d = toDate(ts); return d ? timeFmt.format(d).toUpperCase() : ""; };
export const fmtDateTime = ts => { const d = toDate(ts); return d ? `${dateFmt.format(d)} · ${fmtTime(d)}` : "Just now"; };

export function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayLabel(d) {
  if (!d) return "Today";
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  if (today - d < 6 * 864e5) return weekdayFmt.format(d);
  return fullDateFmt.format(d);
}

// Short, friendly "when" for lists: 10:42 PM / Yesterday / 29 Sep 2026
export function shortWhen(ts) {
  const d = toDate(ts);
  if (!d) return "now";
  if (sameDay(d, new Date())) return fmtTime(d);
  return dayLabel(d) === "Yesterday" ? "Yesterday" : dateFmt.format(d);
}

export function ago(ts) {
  const d = toDate(ts);
  if (!d) return "";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  if (h < 48) return `yesterday at ${fmtTime(d)}`;
  return `${dateFmt.format(d)} at ${fmtTime(d)}`;
}

export const fmtDuration = secs => {
  secs = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

// "YYYY-MM-DDTHH:mm" (datetime-local) is parsed as local time.
export const whenDate = s => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d : null; };
export const nowLocalInput = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/* ------------------------------------------------------------------ presence helpers */
export function isOnline(id) {
  const p = state.presence[id];
  const seen = toDate(p?.lastSeen);
  return !!(p?.state === "online" && seen && Date.now() - seen.getTime() < 2.5 * 60 * 1000);
}

export function isTyping(id) {
  const p = state.presence[id];
  const at = toDate(p?.typingAt);
  return !!(p?.typing && at && Date.now() - at.getTime() < 8000 && isOnline(id));
}

export function statusText(id) {
  if (!id) return "Waiting to join";
  if (isOnline(id)) return "Online";
  const seen = state.presence[id]?.lastSeen;
  return seen ? `Last seen ${ago(seen)}` : "Offline";
}

/* ------------------------------------------------------------------ icons */
const S = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICONS = {
  home: S('<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>'),
  chat: S('<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>'),
  lock: S('<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/>'),
  unlock: S('<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 7.7-1.5"/>'),
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="19" cy="12" r="2.1"/></svg>',
  bell: S('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z"/>'),
  video: S('<rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="m15.5 10.5 6-3.5v10l-6-3.5z"/>'),
  videoOff: S('<path d="M15.5 13.5v1.5a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h1.5M10 6h2.5a3 3 0 0 1 3 3v1.5l6-3.5v10"/><path d="m3 3 18 18"/>'),
  phone: S('<path d="M5 3.5h3.5l1.8 4.6-2.4 1.6a11 11 0 0 0 6.4 6.4l1.6-2.4 4.6 1.8V19a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2z"/>'),
  phoneEnd: S('<path d="M3.3 13.8c5-4.4 12.4-4.4 17.4 0l-1.9 3-3.3-1.2v-2.4a9 9 0 0 0-7 0v2.4l-3.3 1.2z" fill="currentColor"/>'),
  mic: S('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  micOff: S('<path d="M15 10V6a3 3 0 0 0-5.8-1M9 9v2a3 3 0 0 0 5 2.2M5.5 11a6.5 6.5 0 0 0 10.8 4.9M18.5 11a6.4 6.4 0 0 1-.5 2.5M12 17.5V21"/><path d="m3 3 18 18"/>'),
  flip: S('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><path d="M9.5 13.5a2.8 2.8 0 0 0 5 1.2M14.5 12.5a2.8 2.8 0 0 0-5-1.2"/><path d="M14.7 15.5v-1h-1M9.3 10.5v1h1"/>'),
  send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l.1 6.6L15 12 3.5 13.8z"/></svg>',
  plus: S('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.6"'),
  image: S('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  smile: S('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><circle cx="9" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.4"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>',
  trash: S('<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v5M14 11v5"/>'),
  download: S('<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>', 'stroke-width="2.5"'),
  back: S('<path d="M15 5l-7 7 7 7"/>', 'stroke-width="2.6"'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2.6"'),
  check: S('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'stroke-width="2.6"'),
  warn: S('<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>', 'stroke-width="2.4"'),
  pencil: S('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>'),
  clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7zM19 14c.3 2.2 1.1 3 3 3.3-1.9.3-2.7 1.1-3 3.2-.3-2.1-1.1-2.9-3-3.2 1.9-.3 2.7-1.1 3-3.3z"/></svg>',
  logout: S('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>'),
  key: S('<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>'),
  user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  arrowDown: S('<path d="M12 5v14m-6-6 6 6 6-6"/>', 'stroke-width="2.5"'),
  callIn: S('<path d="M17 4 9 12M9 6v6h6"/>', 'stroke-width="2.4"'),
  callOut: S('<path d="m9 15 8-8M17 13V7h-6"/>', 'stroke-width="2.4"'),
  eye: S('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: S('<path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/>'),
  expand: S('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  camera: S('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.6"/>'),
  reply: S('<path d="M10 8 5 12.5 10 17"/><path d="M5.5 12.5H14a5 5 0 0 1 5 5V19"/>', 'stroke-width="2.4"'),
  copy: S('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>'),
  retry: S('<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>')
};

/* ------------------------------------------------------------------ brand (name, icon, notification wording) */
// Changed by either person in More → Customize app; stored in settings/app.
// {app} = the app name, {name} = the sender's name.
export const BRAND_DEFAULTS = {
  name: "Asaumi",
  tagline: "Together, privately.",
  iconUrl: "",
  notif: {
    title: "{app}",
    message: "{app} you have message",
    memory: "{app} you have new memories",
    movement: "{app} you have a new memorable movement",
    call: "{app} you have a call",
    videoCall: "{app} you have a video call",
    missedCall: "{app} you have a missed call"
  }
};

let brandCache = null;
try { brandCache = JSON.parse(localStorage.getItem("asaumi.brand") || "null"); } catch { /* ignore */ }

export function brand() {
  const b = state.brand || brandCache || {};
  const notif = { ...BRAND_DEFAULTS.notif };
  for (const [k, v] of Object.entries(b.notif || {})) if (typeof v === "string" && v.trim()) notif[k] = v.trim();
  return {
    name: (b.name || "").trim() || BRAND_DEFAULTS.name,
    tagline: (b.tagline || "").trim() || BRAND_DEFAULTS.tagline,
    iconUrl: b.iconUrl || "",
    notif
  };
}
export const appName = () => brand().name;

export function notifText(key, vars = {}) {
  const t = brand().notif[key] || BRAND_DEFAULTS.notif[key] || "";
  return t.replace(/\{app\}/gi, appName()).replace(/\{name\}/gi, vars.name ?? myName());
}

// The app icon as HTML: the uploaded picture, or the default ❤️
export function brandIcon() {
  const u = brand().iconUrl;
  return u ? `<img class="brand-img" src="${esc(cld(u, "f_auto,q_auto,c_fill,w_256,h_256"))}" alt="" />` : "❤️";
}

export function setBrand(data) {
  state.brand = data || null;
  brandCache = state.brand;
  try { localStorage.setItem("asaumi.brand", JSON.stringify(state.brand)); } catch { /* ignore */ }
  applyBrandChrome();
}

// Parts of the page outside the views: login, splash, centre button, favicon, page title
export function applyBrandChrome() {
  const b = brand();
  const set = (sel, fn) => { const el = document.querySelector(sel); if (el) fn(el); };
  set("#login-name", el => (el.textContent = b.name));
  set("#splash-name", el => (el.textContent = b.name));
  set("#nav-name", el => (el.textContent = b.name));
  set("#login-icon", el => (el.innerHTML = brandIcon()));
  set("#nav-orb", el => (el.innerHTML = brandIcon()));
  set('meta[name="apple-mobile-web-app-title"]', el => el.setAttribute("content", b.name));
  set("#favicon", el => el.setAttribute("href", b.iconUrl ? cld(b.iconUrl, "c_fill,w_192,h_192") : "icon.svg"));
  if (!state.user) document.title = b.name;
}

/* ------------------------------------------------------------------ avatars */
const AVATAR_GRADS = [
  "linear-gradient(140deg,#38bdf8,#8b5cf6)",
  "linear-gradient(140deg,#c4b5fd,#6c3bff)",
  "linear-gradient(140deg,#7dd3fc,#6c3bff)"
];
export function avatarHtml(user, cls = "") {
  const name = user?.name || user?.email || "?";
  const initial = esc(name.trim().charAt(0).toUpperCase() || "?");
  const grad = AVATAR_GRADS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_GRADS.length];
  return user?.avatar
    ? `<span class="avatar ${cls}"><img src="${esc(cld(user.avatar, "f_auto,q_auto,c_fill,g_face,w_200,h_200"))}" alt="" /></span>`
    : `<span class="avatar ${cls}" style="background:${grad}">${initial}</span>`;
}

export function presenceDot(id) {
  return `<i class="p-dot ${isOnline(id) ? "on" : ""}"></i>`;
}

/* ------------------------------------------------------------------ toast */
let toastTimer;
export function toast(msg, kind = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

export const spinner = (cls = "") => `<span class="spinner ${cls}" aria-label="Loading"></span>`;

/* ------------------------------------------------------------------ friendly errors */
export function friendlyError(err, fallback = "Something went wrong. Please try again.") {
  console.warn("[asaumi]", err);
  const code = err?.code || err?.name || "";
  if (!navigator.onLine || /network|unavailable/i.test(code)) return "You're offline. Please check your internet connection.";
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return "Email or password is incorrect.";
  if (code.includes("invalid-email")) return "Please enter a valid email.";
  if (code.includes("missing-password")) return "Please enter your password.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait a little and try again.";
  if (code.includes("weak-password")) return "Please choose a stronger password (at least 6 characters).";
  if (code.includes("requires-recent-login")) return "Please sign in again, then retry.";
  if (code.includes("permission-denied")) return "This account doesn't have access to Asaumi.";
  if (code === "NotAllowedError") return "Permission was denied. Allow camera and microphone in your browser settings.";
  if (code === "NotFoundError") return "No camera or microphone was found on this device.";
  if (code === "NotReadableError") return "Your camera or microphone is being used by another app.";
  if (err?.friendly) return err.message;
  return fallback;
}

/* ------------------------------------------------------------------ crypto */
export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ cloudinary */
export const cld = (url, t) => (url && t ? url.replace("/upload/", `/upload/${t}/`) : url || "");
export const videoPoster = url => cld(url, "so_0,f_jpg,q_auto,w_720").replace(/\.[a-z0-9]+$/i, ".jpg");
export const audioUrl = url => (url || "").replace(/\.[a-z0-9]+$/i, ".mp3");

// Shrink very large photos in the browser so uploads are quick on mobile data.
export async function prepareImage(file, maxDim = 2400, quality = 0.88) {
  if (file.size < 1.5 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export function upload(file, { sub = "", onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", CLOUDINARY.uploadPreset);
    fd.append("folder", sub ? `${CLOUDINARY.folder}/asaumi/${sub}` : CLOUDINARY.folder);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/auto/upload`);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.secure_url) resolve(data);
      else {
        console.warn("[asaumi] Cloudinary:", data?.error?.message || xhr.status);
        const e = new Error(/size|large/i.test(data?.error?.message || "") ? "That file is too large to upload." : "Upload failed. Please try again.");
        e.friendly = true;
        reject(e);
      }
    };
    xhr.onerror = () => { const e = new Error("Upload interrupted. Check your internet and try again."); e.friendly = true; reject(e); };
    xhr.onabort = () => { const e = new Error("Upload cancelled."); e.friendly = true; e.aborted = true; reject(e); };
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(fd);
  });
}

export async function downloadFile(url, baseName) {
  // In the Android app, hand the file to Chrome, which saves it to Downloads.
  if (isNative) { await openExternal(cld(url, "fl_attachment")); return; }
  const ext = (url.split("?")[0].split(".").pop() || "jpg").toLowerCase();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const href = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href, download: `${baseName}.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
  } catch {
    window.open(cld(url, "fl_attachment"), "_blank", "noopener");
  }
}

/* ------------------------------------------------------------------ modals */
export function openModal(html, { dismissable = true, cls = "" } = {}) {
  const root = $("#modal-root");
  const wrap = document.createElement("div");
  wrap.className = `modal-wrap ${cls}`;
  wrap.innerHTML = `<div class="modal-backdrop"></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.append(wrap);
  document.body.classList.add("modal-open");
  wrap.dismissable = dismissable;
  wrap.close = () => {
    if (wrap.closing) return;
    wrap.closing = true;
    wrap.classList.add("closing");
    setTimeout(() => {
      wrap.remove();
      if (!root.children.length) document.body.classList.remove("modal-open");
    }, 180);
    wrap.onclose?.();
  };
  if (dismissable) wrap.querySelector(".modal-backdrop").addEventListener("click", wrap.close);
  $$("[data-close]", wrap).forEach(b => b.addEventListener("click", wrap.close));
  return wrap;
}

export function closeAllModals() {
  $("#modal-root").innerHTML = "";
  document.body.classList.remove("modal-open");
}

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const top = $("#modal-root").lastElementChild;
  if (top?.dismissable) top.close();
});

export function confirmDialog({ icon = "warn", title, text, ok = "Yes", cancel = "Cancel", danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    const m = openModal(`
      <div class="icon-orb">${ICONS[icon] || icon}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-close>${esc(cancel)}</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(ok)}</button>
      </div>`);
    m.onclose = () => { if (!answered) resolve(false); };
    $("[data-ok]", m).addEventListener("click", () => { answered = true; resolve(true); m.close(); });
  });
}

// Full-screen image viewer with download
export function viewImage(url, name = "asaumi-photo") {
  // Photo takes about 75% of the screen, with Download and Close underneath
  const m = openModal(`
    <div class="viewer-box"><img class="viewer-img" src="${esc(cld(url, "f_auto,q_auto,w_2000"))}" alt="" /></div>
    <div class="viewer-bar">
      <button class="btn btn-ghost btn-sm" data-close>${ICONS.close} Close</button>
      <button class="btn btn-primary btn-sm" data-dl>${ICONS.download} Download</button>
    </div>`, { cls: "viewer" });
  $("[data-dl]", m).addEventListener("click", async e => {
    const b = e.currentTarget;
    b.disabled = true;
    await downloadFile(url, name);
    b.disabled = false;
  });
}

// Re-verify the Firebase password (used for PIN reset and password change)
export function reauth(password) {
  return reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, password));
}

export function askPassword({ title = "Verify it's you", text = "Enter your Asaumi login password." } = {}) {
  return new Promise(resolve => {
    let ok = false;
    const m = openModal(`
      <div class="icon-orb">${ICONS.key}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      <form class="stack" novalidate>
        <label class="field">
          <span>Login password</span>
          <input type="password" name="pw" autocomplete="current-password" required placeholder="••••••••" />
        </label>
        <p class="form-error"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn btn-primary" type="submit">Verify</button>
        </div>
      </form>`);
    m.onclose = () => resolve(ok);
    const form = $("form", m);
    setTimeout(() => form.pw.focus(), 50);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $("[type=submit]", form);
      if (!form.pw.value) { $(".form-error", form).textContent = "Please enter your password."; return; }
      btn.disabled = true;
      btn.innerHTML = spinner("sm dark");
      try {
        await reauth(form.pw.value);
        ok = true;
        m.close();
      } catch (err) {
        $(".form-error", form).textContent = friendlyError(err, "Password is incorrect.");
        btn.disabled = false;
        btn.textContent = "Verify";
      }
    });
  });
}

/* ------------------------------------------------------------------ sounds */
let actx;
export function audioCtx() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (actx.state === "suspended") actx.resume().catch(() => {});
  return actx;
}
// Unlock audio on the first tap so ringtones can play later.
addEventListener("pointerdown", () => audioCtx(), { once: true, capture: true });

export function tone(freqs, dur = 0.14, gap = 0.05, vol = 0.08) {
  const ctx = audioCtx();
  if (!ctx) return;
  let t = ctx.currentTime;
  for (const f of freqs) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
    t += dur + gap;
  }
}
export const ping = () => tone([880, 1320], 0.12, 0.04, 0.05);
