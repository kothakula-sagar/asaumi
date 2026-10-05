// More → Chat backup. Firebase keeps only the last 10 days; the full chat lives on the phone (chatstore.js).
//  • Google Drive (main way): "Back up to Google Drive" saves the whole chat into the Drive of the Google
//    account with the same email as the Asaumi login, then again automatically once a day.
//    After reinstalling, "Restore from Google Drive" (also offered right after the first login) brings it back.
//  • A backup file (fallback): saved to Documents / shared anywhere; "Restore from a file" reads it back.
// Either person's backup works for restoring: it's the same conversation.
import { state, uid, esc, ICONS, toast, openModal, spinner, appName, actions, $ } from "./core.js";
import { isNative, saveTextFile, shareFile, driveSupported } from "./native.js";
import { exportArchive, importArchive, syncArchive } from "./chatstore.js";
import { uploadBackup, findBackup, downloadBackup, driveError } from "./drive.js";

const FORMAT = "asaumi-chat-backup";
const AUTO_EVERY = 20 * 3600e3; // automatic Drive backup about once a day
const store = {
  get: k => { try { return localStorage.getItem(`asaumi.${k}.${uid()}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`asaumi.${k}.${uid()}`, String(v)); } catch { /* ignore */ } }
};
const dayFmt = ms => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const whenFmt = ms => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const useDrive = () => isNative && driveSupported();
let working = false;

export function backupCard() {
  const lastDrive = Number(store.get("driveBackupAt")) || 0;
  const lastFile = Number(store.get("lastBackup")) || 0;
  const email = state.user?.email || "";
  return `
    <div class="glass card">
      <h3>Chat backup</h3>
      <p>Firebase keeps the last 10 days. Your full chat is saved on this phone. Back it up so it survives a reinstall.</p>
      ${useDrive() ? `
        <button class="set-row" data-action="backupToDrive">
          <span class="set-ico">☁️</span>
          <span class="set-main"><b>Back up to Google Drive</b><small>${lastDrive
            ? `Last backup: ${esc(whenFmt(lastDrive))} · automatic every day`
            : `Into the Google Drive of ${esc(email)}`}</small></span>
          <span class="chev">›</span>
        </button>
        <button class="set-row" data-action="restoreFromDrive">
          <span class="set-ico">${ICONS.retry}</span>
          <span class="set-main"><b>Restore from Google Drive</b><small>After reinstalling: brings all old chats back</small></span>
          <span class="chev">›</span>
        </button>` : ""}
      <details class="backup-more">
        <summary>Other ways (backup file)</summary>
        <button class="set-row" data-action="backupChat">
          <span class="set-ico">${ICONS.download}</span>
          <span class="set-main"><b>Save a backup file</b><small>${lastFile ? `Last file: ${esc(dayFmt(lastFile))}` : "Saved to Documents on this phone"}</small></span>
          <span class="chev">›</span>
        </button>
        <label class="set-row">
          <span class="set-ico">${ICONS.retry}</span>
          <span class="set-main"><b>Restore from a file</b><small>A backup file (yours or your partner's)</small></span>
          <span class="chev">›</span>
          <input type="file" accept=".json,application/json,text/plain,application/octet-stream" hidden data-restore-file />
        </label>
      </details>
    </div>`;
}

/* ------------------------------------------------------------------ shared */
async function buildBackup() {
  try { await syncArchive(); } catch { /* offline: back up what this phone has */ }
  const messages = await exportArchive();
  const text = JSON.stringify({ format: FORMAT, version: 1, app: appName(), by: uid(), exportedAt: new Date().toISOString(), count: messages.length, messages });
  return { messages, text };
}

// Validates a backup text and adds what's missing. Returns { added } or throws a friendly Error.
async function restoreText(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("This isn't an Asaumi chat backup file."); }
  if (data?.format !== FORMAT || !Array.isArray(data.messages)) throw new Error("This isn't an Asaumi chat backup file.");
  const me = uid();
  const mine = data.messages.filter(x => x && (x.from === me || x.to === me)); // only this conversation
  if (!mine.length) throw new Error("This backup belongs to a different account.");
  const added = await importArchive(mine);
  await actions.reloadLocalChat?.();
  return { added, exportedAt: Date.parse(data.exportedAt) || Date.now() };
}

const restoredHtml = (added, at) => `
  <p class="backup-done">✅ ${added ? `<b>${added.toLocaleString()} messages</b> restored` : "Everything in this backup is already on this phone"}</p>
  <p class="small muted">From the backup of ${esc(whenFmt(at))}.</p>
  <div class="modal-actions single"><button class="btn btn-primary" data-close>Done</button></div>`;

const statusModal = (title, text) => {
  const m = openModal(`<h2>${title}</h2><div class="backup-status">${spinner()}<p>${text}</p></div>`);
  return { m, box: $(".backup-status", m) };
};
const failHtml = msg => `<p>${esc(msg)}</p><div class="modal-actions single"><button class="btn btn-primary" data-close>Close</button></div>`;

/* ------------------------------------------------------------------ Google Drive */
async function backupToDrive({ silent = false } = {}) {
  if (!useDrive() || working) return false;
  working = true;
  const ui = silent ? null : statusModal("Back up to Google Drive", "Saving your chat to Google Drive…");
  try {
    const { messages, text } = await buildBackup();
    if (!messages.length) { if (ui) ui.box.innerHTML = failHtml("There are no messages to back up yet."); return false; }
    await uploadBackup(text, !silent);
    store.set("driveBackupAt", Date.now());
    store.set("driveOn", 1);
    if (ui) {
      ui.box.innerHTML = `
        <p class="backup-done">✅ <b>${messages.length.toLocaleString()} messages</b> backed up</p>
        <p class="small">Saved in the Google Drive of <b>${esc(state.user?.email || "")}</b>, folder <b>Asaumi backup</b>.<br>From now on it backs up by itself once a day.</p>
        <div class="modal-actions single"><button class="btn btn-primary" data-close>Done</button></div>`;
    }
    return true;
  } catch (err) {
    console.warn("[asaumi] drive backup", err);
    if (ui) ui.box.innerHTML = failHtml(driveError(err));
    return false;
  } finally {
    working = false;
  }
}

async function restoreFromDrive() {
  if (!useDrive() || working) return;
  working = true;
  const { box } = statusModal("Restore from Google Drive", "Looking for your backup…");
  try {
    const file = await findBackup(true);
    if (!file) {
      box.innerHTML = `
        <p>No backup found in the Google Drive of <b>${esc(state.user?.email || "")}</b>.</p>
        <p class="small muted">Tap <b>Back up to Google Drive</b> to make one. After that it backs up by itself every day.</p>
        <div class="modal-actions single"><button class="btn btn-primary" data-close>OK</button></div>`;
      store.set("driveOn", 1);
      return;
    }
    box.querySelector("p").textContent = "Downloading your chat…";
    const { added, exportedAt } = await restoreText(await downloadBackup(file.id, true));
    store.set("driveOn", 1);
    box.innerHTML = restoredHtml(added, exportedAt);
  } catch (err) {
    console.warn("[asaumi] drive restore", err);
    box.innerHTML = failHtml(err.message?.startsWith("This ") ? err.message : driveError(err));
  } finally {
    working = false;
  }
}

// After the PIN: daily automatic backup (only once Drive was connected), never shows anything
export async function autoBackup() {
  if (!useDrive() || !store.get("driveOn")) return;
  const last = Number(store.get("driveBackupAt")) || 0;
  if (Date.now() - last < AUTO_EVERY) return;
  await backupToDrive({ silent: true });
}

// First login on this phone (new install / cleared data): offer to bring the old chats back, once
export function offerRestore() {
  if (!useDrive() || store.get("restoreOffered")) return;
  let synced = 0;
  try { synced = Number(localStorage.getItem(`asaumi.chatSyncedTo.${uid()}`)) || 0; } catch { /* ignore */ }
  store.set("restoreOffered", 1);
  if (synced) return; // this phone already has its chat
  const m = openModal(`
    <div class="detail-emoji">☁️</div>
    <h2>Bring back your old chats?</h2>
    <p>If you backed up ${esc(appName())} to Google Drive before, restore it now. Messages older than 10 days come back.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Not now</button>
      <button class="btn btn-primary" data-go>☁️ Restore</button>
    </div>`);
  $("[data-go]", m).addEventListener("click", () => { m.close(); restoreFromDrive(); });
}

/* ------------------------------------------------------------------ backup file (fallback) */
const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

async function backupChat() {
  const { box } = statusModal("Save a backup file", "Collecting your messages…");
  try {
    const { messages, text } = await buildBackup();
    if (!messages.length) { box.innerHTML = failHtml("There are no messages to back up yet."); return; }
    const name = `asaumi-chat-backup-${stamp()}.json`;
    let saved = null;
    if (isNative) saved = await saveTextFile(name, text);
    else {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      saved = { folder: "Downloads" };
    }
    if (!saved) throw new Error("not saved");
    store.set("lastBackup", Date.now());
    box.innerHTML = `
      <p class="backup-done">✅ <b>${messages.length.toLocaleString()} messages</b> saved</p>
      ${saved.folder ? `<p class="small">In <b>${esc(saved.folder)}</b> as<br><code>${esc(name)}</code></p>` : ""}
      <p class="small muted">Anyone who has this file can read the chat. Keep it private.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-close>Done</button>
        ${isNative && saved.uri ? `<button class="btn btn-primary" data-share>${ICONS.send} Share…</button>` : ""}
      </div>`;
    box.querySelector("[data-share]")?.addEventListener("click", () => shareFile(saved.uri, "Asaumi chat backup"));
  } catch (err) {
    console.warn("[asaumi] backup", err);
    box.innerHTML = failHtml("Couldn't create the backup. Please try again.");
  }
}

async function restoreFile(file) {
  if (!file) return;
  const { box } = statusModal("Restore from a file", "Reading the backup…");
  try {
    const { added, exportedAt } = await restoreText(await file.text());
    box.innerHTML = restoredHtml(added, exportedAt);
  } catch (err) {
    console.warn("[asaumi] restore", err);
    box.innerHTML = failHtml(err.message?.startsWith("This ") ? err.message : "Couldn't restore this backup. Please try again.");
  }
}

// the file picker lives inside the card, which is re-rendered often → listen on the document
document.addEventListener("change", e => {
  const input = e.target.closest?.("[data-restore-file]");
  if (!input || !state.user) return;
  const f = input.files?.[0];
  input.value = "";
  restoreFile(f);
});

Object.assign(actions, {
  backupChat: () => backupChat(),
  backupToDrive: () => backupToDrive(),
  restoreFromDrive: () => restoreFromDrive()
});
