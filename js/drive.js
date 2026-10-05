// Chat backup in Google Drive — the Drive of the Google account with the same email as the Asaumi login.
// One file, "asaumi-chat-backup.json", in a Drive folder "Asaumi backup", replaced at every backup.
// Asaumi only gets the "drive.file" permission: it can see the files it created, nothing else in your Drive.
// Free: Drive's API costs nothing and the file uses your normal Google storage (a few MB).
import { state } from "./core.js";
import { driveAuthorize } from "./native.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FILE_NAME = "asaumi-chat-backup.json";
const FOLDER_NAME = "Asaumi backup";

let token = null, tokenAt = 0;
const email = () => state.user?.email || "";

async function getToken(interactive, fresh = false) {
  if (!fresh && token && Date.now() - tokenAt < 45 * 60e3) return token;
  token = await driveAuthorize(email(), interactive);
  tokenAt = Date.now();
  return token;
}

// fetch with the Drive token; signs in again once if the token expired
async function drive(url, opts = {}, interactive = false) {
  let t = await getToken(interactive);
  let r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  if (r.status === 401) {
    t = await getToken(interactive, true);
    r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  }
  if (!r.ok) {
    let msg = `Google Drive answered ${r.status}`;
    try { msg = (await r.json())?.error?.message || msg; } catch { /* ignore */ }
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return r;
}

const q = s => encodeURIComponent(s);

async function findFolder(interactive) {
  const r = await drive(`${API}/files?q=${q(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)&spaces=drive`, {}, interactive);
  return (await r.json()).files?.[0]?.id || null;
}

async function ensureFolder(interactive) {
  const have = await findFolder(interactive);
  if (have) return have;
  const r = await drive(`${API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  }, interactive);
  return (await r.json()).id;
}

// The newest backup file Asaumi made in this Drive: { id, modifiedTime, size } or null
export async function findBackup(interactive = false) {
  const r = await drive(`${API}/files?q=${q(`name='${FILE_NAME}' and trashed=false`)}&orderBy=modifiedTime desc&fields=files(id,modifiedTime,size)&spaces=drive`, {}, interactive);
  return (await r.json()).files?.[0] || null;
}

// Upload (create or replace) the backup text. Returns { id, modifiedTime }.
export async function uploadBackup(text, interactive = false) {
  const existing = await findBackup(interactive);
  if (existing) {
    const r = await drive(`${UPLOAD}/files/${existing.id}?uploadType=media&fields=id,modifiedTime`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: text
    }, interactive);
    return r.json();
  }
  const folder = await ensureFolder(interactive);
  const boundary = `asaumi${Date.now()}`;
  const meta = { name: FILE_NAME, mimeType: "application/json", parents: [folder], description: "Asaumi chat backup. Restore it from Asaumi → More → Chat backup." };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  const r = await drive(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body
  }, interactive);
  return r.json();
}

export async function downloadBackup(id, interactive = false) {
  const r = await drive(`${API}/files/${id}?alt=media`, {}, interactive);
  return r.text();
}

// Friendly text for errors from Google
export function driveError(err) {
  const m = String(err?.message || err || "");
  if (m === "CANCELLED") return "Google sign-in was cancelled.";
  if (m === "UNSUPPORTED") return "Google Drive backup works in the Asaumi app on Android.";
  if (m === "NEEDS_CONSENT") return "Open More → Chat backup and tap Back up to Google Drive once to connect Drive.";
  if (/account|not found|no such/i.test(m)) return `Add the Google account ${email()} to this phone (Settings → Accounts), then try again.`;
  if (/network|failed to fetch|timeout|7:/i.test(m)) return "No internet connection. Try again when you're online.";
  if (/10:|DEVELOPER_ERROR|not registered|unregistered|16:/i.test(m)) return "Google Drive isn't set up for this app yet (Google Cloud → OAuth client). See the setup steps.";
  if (/access_denied|has not completed|not verified|403/i.test(m)) return "Google refused access. Check the app's Google Cloud setup (Drive API on, app published).";
  return `Google Drive: ${m}`;
}
