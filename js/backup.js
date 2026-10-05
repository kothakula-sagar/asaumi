// More → Chat backup. Firebase keeps only the last 10 days; the full chat lives on the phone (chatstore.js).
// "Back up chat" writes it all to one file (Files app → Documents, or Drive/WhatsApp via the share menu).
// "Restore chat" reads such a file back, e.g. after reinstalling. Either person's backup works:
// it's the same conversation. Free: the file never goes to any server unless you choose to share it.
import { state, uid, esc, ICONS, toast, openModal, spinner, appName, actions, $ } from "./core.js";
import { isNative, saveTextFile, shareFile } from "./native.js";
import { exportArchive, importArchive, syncArchive } from "./chatstore.js";

const FORMAT = "asaumi-chat-backup";
const lastKey = () => `asaumi.lastBackup.${uid()}`;
const lastBackup = () => { try { return Number(localStorage.getItem(lastKey())) || 0; } catch { return 0; } };
const dayFmt = ms => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function backupCard() {
  const last = lastBackup();
  return `
    <div class="glass card">
      <h3>Chat backup</h3>
      <p>Firebase keeps the last 10 days. Your full chat is saved on this phone. Back it up so it survives a reinstall.</p>
      <button class="set-row" data-action="backupChat">
        <span class="set-ico">${ICONS.download}</span>
        <span class="set-main"><b>Back up chat</b><small>${last ? `Last backup: ${esc(dayFmt(last))}` : "Not backed up yet"}</small></span>
        <span class="chev">›</span>
      </button>
      <label class="set-row">
        <span class="set-ico">${ICONS.retry}</span>
        <span class="set-main"><b>Restore chat</b><small>From a backup file (yours or your partner's)</small></span>
        <span class="chev">›</span>
        <input type="file" accept=".json,application/json,text/plain,application/octet-stream" hidden data-restore-file />
      </label>
    </div>`;
}

const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

async function backupChat() {
  const m = openModal(`
    <h2>Back up chat</h2>
    <div class="backup-status">${spinner()}<p>Collecting your messages…</p></div>`);
  const box = $(".backup-status", m);
  try {
    try { await syncArchive(); } catch { /* offline: back up what this phone has */ }
    const messages = await exportArchive();
    if (!messages.length) { box.innerHTML = "<p>There are no messages to back up yet.</p>"; return; }
    const text = JSON.stringify({ format: FORMAT, version: 1, app: appName(), by: uid(), exportedAt: new Date().toISOString(), count: messages.length, messages });
    const name = `asaumi-chat-backup-${stamp()}.json`;
    const from = dayFmt(messages[0].createdAt), to = dayFmt(messages.at(-1).createdAt);
    const sizeMB = (text.length / 1048576).toFixed(1);
    let saved = null;
    if (isNative) saved = await saveTextFile(name, text);
    else {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      saved = { folder: "Downloads" };
    }
    if (!saved) throw new Error("not saved");
    try { localStorage.setItem(lastKey(), String(Date.now())); } catch { /* ignore */ }
    box.innerHTML = `
      <p class="backup-done">✅ <b>${messages.length.toLocaleString()} messages</b> backed up<br><small>${esc(from)} – ${esc(to)} · ${sizeMB} MB</small></p>
      ${saved.folder ? `<p class="small">Saved in <b>${esc(saved.folder)}</b> as<br><code>${esc(name)}</code></p>` : ""}
      <p class="small muted">Keep a copy somewhere safe, like Google Drive. Anyone who has this file can read the chat, so don't share it with others.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-close>Done</button>
        ${isNative && saved.uri ? `<button class="btn btn-primary" data-share>${ICONS.send} Save to Drive…</button>` : ""}
      </div>`;
    $("[data-share]", m)?.addEventListener("click", () => shareFile(saved.uri, "Asaumi chat backup"));
  } catch (err) {
    console.warn("[asaumi] backup", err);
    box.innerHTML = `<p>Couldn't create the backup. Please try again.</p><div class="modal-actions single"><button class="btn btn-primary" data-close>Close</button></div>`;
  }
}

async function restoreChat(file) {
  if (!file) return;
  const m = openModal(`
    <h2>Restore chat</h2>
    <div class="backup-status">${spinner()}<p>Reading the backup…</p></div>`);
  const box = $(".backup-status", m);
  const fail = msg => { box.innerHTML = `<p>${esc(msg)}</p><div class="modal-actions single"><button class="btn btn-primary" data-close>Close</button></div>`; };
  try {
    let data;
    try { data = JSON.parse(await file.text()); } catch { fail("This isn't an Asaumi chat backup file."); return; }
    if (data?.format !== FORMAT || !Array.isArray(data.messages)) { fail("This isn't an Asaumi chat backup file."); return; }
    // only messages of this conversation (sent or received by this account)
    const me = uid();
    const mine = data.messages.filter(x => x && (x.from === me || x.to === me));
    if (!mine.length) { fail("This backup belongs to a different account."); return; }
    const added = await importArchive(mine);
    await actions.reloadLocalChat?.();
    box.innerHTML = `
      <p class="backup-done">✅ ${added
        ? `<b>${added.toLocaleString()} messages</b> restored`
        : "Everything in this backup is already on this phone"}</p>
      <p class="small muted">From a backup made on ${esc(dayFmt(Date.parse(data.exportedAt) || Date.now()))}.</p>
      <div class="modal-actions single"><button class="btn btn-primary" data-close>Done</button></div>`;
  } catch (err) {
    console.warn("[asaumi] restore", err);
    fail("Couldn't restore this backup. Please try again.");
  }
}

// the file picker lives inside the card, which is re-rendered often → listen on the document
document.addEventListener("change", e => {
  const input = e.target.closest?.("[data-restore-file]");
  if (!input || !state.user) return;
  const f = input.files?.[0];
  input.value = "";
  restoreChat(f);
});

actions.backupChat = () => backupChat();
