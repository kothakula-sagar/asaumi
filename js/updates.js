// "App updates" in More. Every GitHub build publishes the APK as the release called "latest";
// the app compares that build number with its own and downloads the new APK in Chrome.
// Because every build is signed with the same permanent key, it installs over the old app (no uninstall, nothing lost).
import { esc, ICONS, toast, openModal, scheduleRender, actions, $ } from "./core.js";
import { isNative, openExternal, appInfo } from "./native.js";

const REPO = /*@REPO*/"";   // "owner/repo", filled in by the GitHub build
const TAG = "latest";
const AUTO_EVERY = 6 * 3600e3; // automatic check at most every 6 hours

let info = null;          // installed: { version, build }
let infoAsked = false;
let latest = null;        // newest on GitHub: { build, url, date } or { error }
let checking = false;

const installedBuild = () => Number(info?.build) || 0;
export const updateAvailable = () => !!(latest?.url && latest.build > installedBuild() && installedBuild() > 0);

async function loadInfo() {
  if (!info) info = await appInfo();
  return info;
}

export async function checkForUpdate() {
  if (!isNative || !REPO || checking) return latest;
  checking = true;
  scheduleRender();
  try {
    await loadInfo();
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, {
      headers: { Accept: "application/vnd.github+json" }, cache: "no-store"
    });
    if (r.status === 404) throw new Error("notfound");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const apk = (j.assets || []).find(a => /\.apk$/i.test(a.name));
    latest = { build: Number((j.name || "").match(/build\s+(\d+)/i)?.[1]) || 0, url: apk?.browser_download_url || "", date: j.published_at };
  } catch (err) {
    console.warn("[asaumi] update check", err);
    latest = { error: err.message === "notfound" ? "notfound" : "network" };
  }
  checking = false;
  try { localStorage.setItem("asaumi.updateCheckedAt", String(Date.now())); } catch { /* ignore */ }
  scheduleRender();
  return latest;
}

// After the PIN: quietly check now and then, and mention it if there is something new
export async function autoCheckUpdate() {
  if (!isNative || !REPO) return;
  let last = 0;
  try { last = Number(localStorage.getItem("asaumi.updateCheckedAt")) || 0; } catch { /* ignore */ }
  if (Date.now() - last < AUTO_EVERY) return;
  await checkForUpdate();
  if (updateAvailable()) toast("✨ A new version is ready. More → App updates");
}

function installUpdate() {
  if (!latest?.url) return;
  const m = openModal(`
    <h2>Update ${ICONS.sparkle}</h2>
    <ol class="update-steps">
      <li>The new version downloads in Chrome.</li>
      <li>When it finishes, tap the download (or open it from the notification).</li>
      <li>Tap <b>Update</b>. Your chats, memories and login stay as they are.</li>
    </ol>
    <p class="muted small">The first time, Android may ask you to allow Chrome to install apps. Allow it once.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Later</button>
      <button class="btn btn-primary" data-go>${ICONS.download} Download update</button>
    </div>`);
  $("[data-go]", m).addEventListener("click", () => { m.close(); openExternal(latest.url); });
}

const fmtDay = iso => { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };

export function updatesCard() {
  if (!isNative) return ""; // the web version always loads the newest code by itself
  if (!infoAsked) { infoAsked = true; loadInfo().then(() => scheduleRender()); }
  const have = info ? `Version ${esc(info.version || "")}${info.build ? ` · build ${esc(String(info.build))}` : ""}` : "Version …";
  let status, button;
  if (!REPO) {
    status = "Updates work in the app built by GitHub.";
  } else if (checking) {
    status = "Checking for updates…";
  } else if (updateAvailable()) {
    status = `<b class="update-new">New version ready · build ${latest.build}</b>${latest.date ? ` · ${esc(fmtDay(latest.date))}` : ""}`;
    button = `<button class="btn btn-primary btn-sm" data-action="installUpdate">${ICONS.download} Update</button>`;
  } else if (latest?.error === "notfound") {
    status = "No published version found yet. Run the GitHub build once (the repository must be public).";
  } else if (latest?.error) {
    status = "Couldn't check. Check your internet and try again.";
  } else if (latest) {
    status = "You have the latest version ✓";
  } else {
    status = "Tap Check to look for a new version.";
  }
  return `
    <div class="glass card">
      <h3>App updates</h3>
      <div class="set-row">
        <span class="set-ico">${ICONS.sparkle}</span>
        <span class="set-main"><b>${have}</b><small>${status}</small></span>
        ${button || `<button class="btn btn-ghost btn-sm" data-action="checkUpdate" ${checking || !REPO ? "disabled" : ""}>Check</button>`}
      </div>
    </div>`;
}

Object.assign(actions, {
  checkUpdate: async () => {
    await checkForUpdate();
    if (latest && !latest.error && !updateAvailable()) toast("You have the latest version ✓");
  },
  installUpdate
});
