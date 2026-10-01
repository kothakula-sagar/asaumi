import { updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  auth, db, state, uid, esc, ICONS, toast, openModal, confirmDialog, reauth, avatarHtml, cld,
  prepareImage, upload, friendlyError, fmtDate, fmtDuration, shortWhen, realNameOf, spinner,
  scheduleRender, brand, brandIcon, appName, BRAND_DEFAULTS, myName, actions, views, $
} from "./core.js";
import { enableNotifications, notificationStatus } from "./notify.js";
import { LIMITS } from "./config.js";
import { birthdaySettingsCard } from "./birthday.js";
import { sharingOn } from "./together.js";

function callHistory() {
  const list = state.calls.filter(c => c.status !== "ringing").slice(0, 8);
  if (!list.length) return '<p class="muted small">No calls yet.</p>';
  return `<div class="call-log">${list.map(c => {
    const out = c.callerId === uid();
    const missed = !out && c.status === "missed";
    const label = c.status === "ended" && c.duration ? fmtDuration(c.duration)
      : c.status === "missed" ? (out ? "No answer" : "Missed")
      : c.status === "declined" ? "Declined" : c.status === "busy" ? "Busy" : c.status === "failed" ? "Couldn't connect" : c.status;
    return `
      <div class="call-log-row ${missed ? "missed" : ""}">
        <span class="cl-ico">${c.kind === "audio" ? ICONS.phone : ICONS.video}</span>
        <span class="cl-main"><b>${out ? "Outgoing" : "Incoming"} ${c.kind === "audio" ? "audio" : "video"} call</b><small>${esc(shortWhen(c.createdAt))}</small></span>
        <span class="cl-dir">${out ? ICONS.callOut : ICONS.callIn}${esc(label)}</span>
      </div>`;
  }).join("")}</div>`;
}

let notif = { label: "Checking…", btn: false };
function notifState() {
  notificationStatus().then(n => {
    if (n.label !== notif.label || n.btn !== notif.btn) { notif = n; scheduleRender(); }
  });
  return notif;
}

function renderMore() {
  const bg = state.background;
  const n = notifState();
  return `
    <section class="page-head"><div><p class="eyebrow">Settings</p><h1>More</h1></div></section>

    <div class="settings-grid">
      <div class="glass card profile">
        <label class="avatar-edit" aria-label="Change photo">
          ${avatarHtml(state.me || { name: "?" }, "xl")}
          <span class="avatar-cam">${ICONS.pencil}</span>
          <input type="file" accept="image/*" hidden data-avatar-file />
        </label>
        <div class="profile-main">
          <b>${esc(state.me?.name || "")}</b>
          <small>${esc(state.user?.email || "")}</small>
        </div>
        <button class="icon-btn" data-action="editName" aria-label="Edit name">${ICONS.pencil}</button>
      </div>

      <div class="glass card">
        <h3>Account</h3>
        <div class="set-row"><span class="set-ico">${ICONS.user}</span><span class="set-main"><b>Email</b><small>${esc(state.user?.email || "")}</small></span></div>
        <button class="set-row" data-action="changePassword"><span class="set-ico">${ICONS.key}</span><span class="set-main"><b>Change password</b><small>Update your ${esc(appName())} login password</small></span><span class="chev">›</span></button>
        <button class="set-row danger" data-action="signOut"><span class="set-ico">${ICONS.logout}</span><span class="set-main"><b>Logout</b><small>You can sign back in anytime</small></span><span class="chev">›</span></button>
      </div>

      <div class="glass card">
        <h3>Background</h3>
        <p>One shared background for the whole app. Both of you see the same picture.</p>
        <div class="wall">
          <div class="wall-thumb">${bg?.url ? `<img src="${esc(cld(bg.url, "f_auto,q_auto,c_fill,w_216,h_384"))}" alt="" />` : '<span class="wall-default"></span>'}</div>
          <div class="wall-info">
            <div class="size-note">Recommended: <b>1080 × 1920 px</b><br>9:16 portrait · JPG/PNG · under <b>${LIMITS.imageMB} MB</b></div>
            ${bg?.url ? `<small class="muted">Set by ${esc(realNameOf(bg.byUid, bg.byName))} · ${esc(fmtDate(bg.updatedAt))}</small>` : ""}
            <div class="wall-actions">
              <label class="btn btn-primary btn-sm">${bg?.url ? "Replace" : "Upload image"}<input type="file" accept="image/*" hidden data-bg-file /></label>
              ${bg?.url ? '<button class="btn btn-ghost btn-sm" data-action="removeBackground">Remove</button>' : ""}
            </div>
          </div>
        </div>
      </div>

      <div class="glass card">
        <h3>App look &amp; notifications</h3>
        <p>Shared by both of you. Changes show on both phones right away.</p>
        <button class="set-row" data-action="customizeApp">
          <span class="set-ico brand-ico">${brandIcon()}</span>
          <span class="set-main"><b>Customize app</b><small>Name: ${esc(appName())} · icon · notification wording</small></span>
          <span class="chev">›</span>
        </button>
      </div>

      ${birthdaySettingsCard()}

      <div class="glass card">
        <h3>Together 📍</h3>
        <p>See how far apart you are, and a special animation when you're within 1 km. Your location is shared only while the app is open.</p>
        <div class="set-row">
          <span class="set-ico">📍</span>
          <span class="set-main"><b>Show when we're close</b><small>${sharingOn() ? "On · only while the app is open" : "Off"}</small></span>
          <button class="btn ${sharingOn() ? "btn-ghost" : "btn-primary"} btn-sm" data-action="toggleTogether">${sharingOn() ? "Turn off" : "Turn on"}</button>
        </div>
      </div>

      <div class="glass card">
        <h3>Privacy</h3>
        <button class="set-row" data-action="resetPin"><span class="set-ico">${ICONS.lock}</span><span class="set-main"><b>Change app PIN</b><small>Asked when ${esc(appName())} opens and for Memories · verified with your login password</small></span><span class="chev">›</span></button>
        <button class="set-row" data-action="lockNow"><span class="set-ico">${ICONS.lock}</span><span class="set-main"><b>Lock now</b><small>Lock ${esc(appName())} until the PIN is entered</small></span><span class="chev">›</span></button>
        <div class="set-row">
          <span class="set-ico">${ICONS.bell}</span>
          <span class="set-main"><b>Notifications</b><small>${esc(n.label)}</small></span>
          ${n.btn ? '<button class="btn btn-primary btn-sm" data-action="enableNotifications">Turn on</button>' : ""}
        </div>
        <button class="set-row" data-action="checkNotifications"><span class="set-ico">${ICONS.check}</span><span class="set-main"><b>Notification check</b><small>Test that notifications reach both phones</small></span><span class="chev">›</span></button>
      </div>

      <div class="glass card">
        <h3>Recent calls</h3>
        <p>Calls are live only — never recorded or stored.</p>
        ${callHistory()}
      </div>

      <div class="glass card about">
        <div class="about-heart">${brandIcon()}</div>
        <b>${esc(appName())}</b>
        <small>${esc(brand().tagline)}</small>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ name */
function editName(firstTime = false) {
  const m = openModal(`
    <div class="icon-orb">💞</div>
    <h2>${firstTime ? `Welcome to ${esc(appName())}` : "Your name"}</h2>
    <p>${firstTime ? "What should your person see you as?" : "Shown on everything you share."}</p>
    <form class="stack" novalidate>
      <label class="field"><input name="name" maxlength="30" required placeholder="Your name" value="${esc(state.me?.name || "")}" /></label>
      <p class="form-error"></p>
      <div class="modal-actions ${firstTime ? "single" : ""}">
        ${firstTime ? "" : '<button type="button" class="btn btn-ghost" data-close>Cancel</button>'}
        <button class="btn btn-primary" type="submit">Save</button>
      </div>
    </form>`, { dismissable: !firstTime });
  const form = $("form", m);
  setTimeout(() => form.name.focus(), 60);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) { $(".form-error", form).textContent = "Please enter a name."; return; }
    try {
      const data = { name, email: state.user.email, ...(firstTime ? { createdAt: serverTimestamp() } : {}) };
      await setDoc(doc(db, "users", uid()), data, { merge: true });
      state.me = { ...state.me, ...data };
      m.close();
      scheduleRender();
      toast(firstTime ? `Welcome, ${name} ❤️` : "Name updated");
    } catch (err) {
      $(".form-error", form).textContent = friendlyError(err, "Couldn't save. Try again.");
    }
  });
}
export const askName = () => editName(true);

/* ------------------------------------------------------------------ password */
function changePassword() {
  const m = openModal(`
    <div class="icon-orb">${ICONS.key}</div>
    <h2>Change password</h2>
    <form class="stack" novalidate>
      <label class="field"><span>Current password</span><input type="password" name="cur" autocomplete="current-password" /></label>
      <label class="field"><span>New password</span><input type="password" name="next" autocomplete="new-password" minlength="6" /></label>
      <label class="field"><span>Confirm new password</span><input type="password" name="again" autocomplete="new-password" /></label>
      <p class="form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" type="submit">Update</button>
      </div>
    </form>`);
  const form = $("form", m), err = $(".form-error", m), btn = $("[type=submit]", m);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const { cur, next, again } = form;
    if (!cur.value) { err.textContent = "Enter your current password."; return; }
    if (next.value.length < 6) { err.textContent = "New password must be at least 6 characters."; return; }
    if (next.value !== again.value) { err.textContent = "New passwords don't match."; return; }
    btn.disabled = true;
    btn.innerHTML = spinner("sm dark");
    try {
      await reauth(cur.value);
      await updatePassword(auth.currentUser, next.value);
      m.close();
      toast("Password updated 🔑");
    } catch (e2) {
      err.textContent = friendlyError(e2, "Couldn't update the password.");
      btn.disabled = false;
      btn.textContent = "Update";
    }
  });
}

/* ------------------------------------------------------------------ uploads (avatar + background) */
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.matches("[data-avatar-file]")) {
    const f = t.files[0];
    t.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("Please choose an image."); return; }
    toast("Uploading photo…");
    try {
      const up = await upload(await prepareImage(f, 800, 0.9), { sub: "avatars" });
      await setDoc(doc(db, "users", uid()), { avatar: up.secure_url }, { merge: true });
      toast("Profile photo updated ✨");
    } catch (err) {
      toast(friendlyError(err, "Upload failed. Please try again."));
    }
  }
  if (t.matches("[data-bg-file]")) {
    const f = t.files[0];
    t.value = "";
    if (f) previewBackground(f);
  }
});

function previewBackground(file) {
  if (!file.type.startsWith("image/")) { toast("Please choose an image."); return; }
  if (file.size > LIMITS.imageMB * 3 * 1024 * 1024) { toast(`Please choose an image under ${LIMITS.imageMB} MB.`); return; }
  const url = URL.createObjectURL(file);
  const m = openModal(`
    <h2>Preview background</h2>
    <div class="bg-preview"><img src="${url}" alt="" /><div class="bg-preview-overlay"><span class="glass">❤️ Asaumi</span></div></div>
    <p class="file-note" data-dims></p>
    <div class="progress" hidden><span></span></div>
    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>Save background</button>
    </div>`, { dismissable: false });
  m.onclose = () => URL.revokeObjectURL(url);
  const img = $(".bg-preview img", m);
  img.onload = () => {
    const w = img.naturalWidth, h = img.naturalHeight, portrait = h / w > 1.5;
    $("[data-dims]", m).textContent = `${w} × ${h} px${portrait ? " ✓" : " · a portrait (9:16) image fits best"}`;
  };
  const save = $("[data-save]", m), bar = $(".progress", m), err = $(".form-error", m), cancel = $("[data-close]", m);
  save.addEventListener("click", async () => {
    save.disabled = cancel.disabled = true;
    save.innerHTML = `${spinner("sm dark")} Saving…`;
    bar.hidden = false;
    try {
      const up = await upload(await prepareImage(file, 2560, 0.9), { sub: "background", onProgress: p => ($("span", bar).style.width = `${Math.round(p * 100)}%`) });
      await setDoc(doc(db, "settings", "background"), {
        url: up.secure_url, publicId: up.public_id, width: up.width, height: up.height,
        byUid: uid(), byName: state.me?.name || "", updatedAt: serverTimestamp()
      });
      m.close();
      toast("Background updated ✨");
    } catch (e) {
      err.textContent = friendlyError(e, "Upload failed. Please try again.");
      save.disabled = cancel.disabled = false;
      save.textContent = "Try again";
    }
  });
}

/* ------------------------------------------------------------------ customize app (name, icon, notification wording) */
const NOTIF_FIELDS = [
  ["title", "Notification title"],
  ["message", "New message"],
  ["memory", "New memory"],
  ["movement", "New Memorable Movement"],
  ["videoCall", "Video call"],
  ["call", "Audio call"],
  ["missedCall", "Missed call"]
];

function customizeApp() {
  const b = brand();
  let iconUrl = b.iconUrl, iconFile = null, iconPreview = null;
  const m = openModal(`
    <h2>Customize app</h2>
    <p>Shared by both of you. Use <b>{name}</b> for the sender's name and <b>{app}</b> for the app name.</p>

    <div class="cz-icon">
      <span class="cz-icon-img" id="cz-icon">${brandIcon()}</span>
      <div class="cz-icon-actions">
        <label class="btn btn-primary btn-sm">Change icon<input type="file" accept="image/*" hidden id="cz-file" /></label>
        <button type="button" class="btn btn-ghost btn-sm" id="cz-default-icon">Use ❤️</button>
        <small class="muted">Square image works best (e.g. 512 × 512)</small>
      </div>
    </div>

    <label class="field"><span>App name</span><input id="cz-name" maxlength="24" value="${esc(b.name)}" placeholder="${esc(BRAND_DEFAULTS.name)}" /></label>
    <label class="field"><span>Tagline</span><input id="cz-tagline" maxlength="40" value="${esc(b.tagline)}" placeholder="${esc(BRAND_DEFAULTS.tagline)}" /></label>

    <h3 class="cz-sub">Notification wording</h3>
    <div class="cz-preview">
      <span class="cz-preview-ico" id="cz-prev-ico">${brandIcon()}</span>
      <span><b id="cz-prev-title"></b><small id="cz-prev-body"></small></span>
    </div>
    ${NOTIF_FIELDS.map(([k, label]) => `
      <label class="field"><span>${label}</span><input data-notif="${k}" maxlength="80" value="${esc(b.notif[k])}" placeholder="${esc(BRAND_DEFAULTS.notif[k])}" /></label>`).join("")}

    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>Save</button>
    </div>
    <button class="link-btn" data-reset>Reset everything to default</button>`, { cls: "wide" });

  const nameIn = $("#cz-name", m), tagIn = $("#cz-tagline", m), err = $(".form-error", m), save = $("[data-save]", m);
  const iconHtml = () => (iconPreview || iconUrl)
    ? `<img class="brand-img" src="${esc(iconPreview || cld(iconUrl, "f_auto,q_auto,c_fill,w_256,h_256"))}" alt="" />` : "❤️";
  const fill = (t, name) => (t || "").replace(/\{app\}/gi, nameIn.value.trim() || BRAND_DEFAULTS.name).replace(/\{name\}/gi, name);
  const preview = () => {
    const get = k => $(`[data-notif="${k}"]`, m).value.trim() || BRAND_DEFAULTS.notif[k];
    $("#cz-prev-title", m).textContent = fill(get("title"), myName());
    $("#cz-prev-body", m).textContent = fill(get("message"), myName());
    $("#cz-icon", m).innerHTML = iconHtml();
    $("#cz-prev-ico", m).innerHTML = iconHtml();
  };
  m.addEventListener("input", preview);
  preview();
  m.onclose = () => { if (iconPreview) URL.revokeObjectURL(iconPreview); };

  $("#cz-file", m).addEventListener("change", e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { err.textContent = "Please choose an image."; return; }
    iconFile = f;
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    iconPreview = URL.createObjectURL(f);
    preview();
  });
  $("#cz-default-icon", m).addEventListener("click", () => {
    iconFile = null; iconUrl = "";
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    iconPreview = null;
    preview();
  });

  save.addEventListener("click", async () => {
    err.textContent = "";
    save.disabled = true;
    save.innerHTML = `${spinner("sm dark")} Saving…`;
    try {
      if (iconFile) {
        const up = await upload(await prepareImage(iconFile, 512, 0.92), { sub: "brand" });
        iconUrl = up.secure_url;
      }
      const notif = {};
      $$notif(m).forEach(i => { if (i.value.trim()) notif[i.dataset.notif] = i.value.trim(); });
      await setDoc(doc(db, "settings", "app"), {
        name: nameIn.value.trim(), tagline: tagIn.value.trim(), iconUrl, notif,
        updatedByUid: uid(), updatedByName: myName(), updatedAt: serverTimestamp()
      });
      m.close();
      toast("Saved ✨ Both phones are updated.");
    } catch (e) {
      err.textContent = friendlyError(e, "Couldn't save. Try again.");
      save.disabled = false;
      save.textContent = "Save";
    }
  });

  $("[data-reset]", m).addEventListener("click", async () => {
    if (!(await confirmDialog({ icon: "retry", title: "Reset to default?", text: `Name, icon and notification wording go back to “${BRAND_DEFAULTS.name}” for both of you.`, ok: "Reset" }))) return;
    try { await deleteDoc(doc(db, "settings", "app")); m.close(); toast("Back to default"); }
    catch (e) { err.textContent = friendlyError(e, "Couldn't reset. Try again."); }
  });
}
const $$notif = m => [...m.querySelectorAll("[data-notif]")];

/* ------------------------------------------------------------------ wiring */
views.more = { render: renderMore };

Object.assign(actions, {
  editName: () => editName(false),
  customizeApp,
  changePassword,
  enableNotifications,
  removeBackground: async () => {
    if (!(await confirmDialog({ icon: "image", title: "Remove background?", text: "Asaumi will go back to the default purple glow for both of you.", ok: "Remove" }))) return;
    try {
      await setDoc(doc(db, "settings", "background"), { url: null, byUid: uid(), byName: state.me?.name || "", updatedAt: serverTimestamp() });
      toast("Background removed");
    } catch (err) { toast(friendlyError(err)); }
  }
});
