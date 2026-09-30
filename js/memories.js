import {
  doc, collection, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, myName, esc, ICONS, toast, openModal, confirmDialog, askPassword, sha256, cld,
  prepareImage, upload, downloadFile, fmtDate, fmtFullDate, fmtTime, realNameOf, friendlyError,
  spinner, scheduleRender, viewImage, actions, views, hooks, $
} from "./core.js";
import { notifyPartner } from "./notify.js";
import { PIN_LENGTH, LIMITS } from "./config.js";

const PREVIEW_CHARS = 96;
let failCount = 0, lockedUntil = 0;

export const memoryTitle = m => m.title || (m.text || "").split("\n")[0].slice(0, 40) || "A memory";
export function previewText(text = "") {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS).trimEnd()}.....` : t;
}

/* ------------------------------------------------------------------ PIN */
export function resetPin() {
  const mode = state.pinHash && !state.pinReset ? "unlock" : "create";
  state.pin = { mode, value: "", first: "", error: "", shake: false, busy: false };
}

export function lockMemories() {
  state.unlocked = false;
  resetPin();
}

function renderPinPad() {
  const p = state.pin || (resetPin(), state.pin);
  const copy = {
    unlock: ["Enter your Memories PIN", "Only the two of you can open this place."],
    create: [state.pinReset ? "Create a new Memories PIN" : "Create Memories PIN", `Choose a ${PIN_LENGTH}-digit PIN to protect your memories.`],
    confirm: ["Confirm PIN", "Enter the same PIN once more."]
  }[p.mode];
  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => `<i class="${i < p.value.length ? "on" : ""}"></i>`).join("");
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(k => `<button class="key" data-action="pinKey" data-key="${k}">${k}</button>`).join("");
  const left = p.mode === "unlock"
    ? '<button class="key plain" data-action="forgotPin">Forgot<br>PIN?</button>'
    : p.mode === "confirm" ? '<button class="key plain" data-action="pinRestart">Start<br>over</button>' : "<span></span>";
  const shake = p.shake;
  p.shake = false;
  return `
    <section class="lock">
      <div class="lock-orb">${ICONS.lock}</div>
      <p class="eyebrow">🔐 Our Memories</p>
      <h1>${copy[0]}</h1>
      <p class="muted">${copy[1]}</p>
      <div class="pin-dots ${shake ? "shake" : ""}">${dots}</div>
      <p class="pin-error">${esc(p.error)}</p>
      <div class="keypad">
        ${keys}
        ${left}
        <button class="key" data-action="pinKey" data-key="0">0</button>
        <button class="key plain" data-action="pinKey" data-key="back" aria-label="Delete">⌫</button>
      </div>
    </section>`;
}

async function pinKey(key) {
  const p = state.pin;
  if (!p || p.busy) return;
  if (key === "back") { p.value = p.value.slice(0, -1); scheduleRender(); return; }
  if (p.value.length >= PIN_LENGTH) return;
  if (p.mode === "unlock" && Date.now() < lockedUntil) {
    p.error = `Too many tries. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.`;
    scheduleRender();
    return;
  }
  p.error = "";
  p.value += key;
  hooks.render();
  if (p.value.length < PIN_LENGTH) return;

  p.busy = true;
  const hash = await sha256(`${uid()}:${p.value}`);
  await new Promise(r => setTimeout(r, 140)); // let the last dot show
  p.busy = false;

  if (p.mode === "unlock") {
    if (hash === state.pinHash) {
      failCount = 0;
      state.unlocked = true;
    } else {
      failCount += 1;
      if (failCount >= 5) { lockedUntil = Date.now() + 30000; failCount = 0; }
      Object.assign(p, { value: "", error: "Incorrect PIN. Please try again.", shake: true });
    }
  } else if (p.mode === "create") {
    Object.assign(p, { first: p.value, value: "", mode: "confirm" });
  } else if (p.mode === "confirm") {
    if (p.value !== p.first) {
      Object.assign(p, { mode: "create", value: "", first: "", error: "PINs didn't match. Let's start again.", shake: true });
    } else {
      try {
        await setDoc(doc(db, "pins", uid()), { hash, updatedAt: serverTimestamp() });
        state.pinHash = hash;
        state.pinReset = false;
        state.unlocked = true;
        toast("Memories PIN saved 🔐");
      } catch (err) {
        Object.assign(p, { mode: "create", value: "", first: "", error: friendlyError(err, "Couldn't save the PIN. Try again.") });
      }
    }
  }
  scheduleRender();
}

document.addEventListener("keydown", e => {
  if (state.view !== "memories" || state.unlocked || $("#modal-root").children.length || !state.user) return;
  if (/^\d$/.test(e.key)) pinKey(e.key);
  else if (e.key === "Backspace") pinKey("back");
});

// Forgot PIN → verify Firebase password → create new PIN → confirm → open
export async function startPinReset() {
  const ok = await askPassword({ title: "Forgot PIN?", text: "Enter your Asaumi login password to create a new Memories PIN." });
  if (!ok) return;
  state.pinReset = true;
  state.unlocked = false;
  state.pin = null;
  hooks.go("memories");
  toast("Verified ✓ Now create your new PIN");
}

/* ------------------------------------------------------------------ list */
function renderMemories() {
  if (!state.unlocked) return renderPinPad();
  const list = state.memories;
  return `
    <section class="page-head">
      <div>
        <p class="eyebrow">Private · just us</p>
        <h1>🔐 Our Memories</h1>
        <p class="page-sub">A private place for moments worth keeping.</p>
      </div>
      <div class="head-actions">
        <button class="icon-btn" data-action="lockMemories" aria-label="Lock memories" title="Lock">${ICONS.lock}</button>
        <button class="btn btn-primary" data-action="addMemory">${ICONS.plus} Add</button>
      </div>
    </section>
    ${!state.loaded.memories ? `<div class="loading-block">${spinner()}<p>Opening your memories…</p></div>`
      : list.length ? `<div class="mem-grid">${list.map(memoryCard).join("")}</div>` : `
      <div class="glass empty">
        <span class="empty-orb">🔐</span>
        <b>No memories yet.</b>
        <p>Some moments are still waiting to become memories.</p>
        <button class="btn btn-primary" data-action="addMemory">${ICONS.plus} Create Memory</button>
      </div>`}`;
}

function memoryCard(m) {
  return `
    <article class="glass mem-card">
      <button class="mem-img" data-action="openMemory" data-id="${m.id}" aria-label="Open memory">
        <img src="${esc(cld(m.url, "f_auto,q_auto,c_fill,w_800,h_600"))}" alt="" loading="lazy" />
      </button>
      <div class="mem-body">
        <h3>❤️ ${esc(memoryTitle(m))}</h3>
        ${m.title && m.text ? `<p class="mem-text">${esc(previewText(m.text))}</p>` : ""}
        <div class="mem-meta">
          <span>Uploaded: <b>${esc(fmtDate(m.createdAt))}</b></span>
          <span>By: <b>${esc(realNameOf(m.byUid, m.byName))}</b></span>
        </div>
        <button class="btn btn-ghost btn-sm mem-more" data-action="openMemory" data-id="${m.id}">View More</button>
      </div>
    </article>`;
}

/* ------------------------------------------------------------------ add / edit */
function addMemoryModal(existing = null) {
  let file = null;
  const editing = !!existing;
  const m = openModal(`
    <h2>${editing ? "Edit memory" : "Create a memory"}</h2>
    <label class="file-pick" id="pick">
      <input type="file" accept="image/*" />
      ${editing
        ? `<img src="${esc(cld(existing.url, "f_auto,q_auto,w_900"))}" alt="" /><span class="pick-change">Change photo</span>`
        : `<span class="big">📷</span><span>Choose a photo</span><small>JPG or PNG · up to ${LIMITS.imageMB} MB</small>`}
    </label>
    <label class="field">
      <span>Title</span>
      <input type="text" name="title" maxlength="60" placeholder="e.g. Goa Trip" value="${esc(existing?.title || (editing ? memoryTitle(existing) : ""))}" />
    </label>
    <label class="field">
      <span>The memory</span>
      <textarea name="text" maxlength="3000" placeholder="One of those days we will always remember…">${esc(existing?.text || "")}</textarea>
    </label>
    <div class="progress" hidden><span></span></div>
    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>${editing ? "Save changes" : "Save memory"}</button>
    </div>`, { dismissable: false });
  const pick = $("#pick", m), input = $("input", pick), title = $("[name=title]", m), text = $("[name=text]", m);
  const err = $(".form-error", m), bar = $(".progress", m), save = $("[data-save]", m), cancel = $("[data-close]", m);
  let previewUrl;

  input.addEventListener("change", () => {
    const f = input.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { err.textContent = "Please choose an image file."; return; }
    if (f.size > LIMITS.imageMB * 3 * 1024 * 1024) { err.textContent = `That photo is too large. Please pick one under ${LIMITS.imageMB} MB.`; return; }
    file = f;
    err.textContent = "";
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    pick.innerHTML = `<img src="${previewUrl}" alt="" /><span class="pick-change">Change photo</span>`;
    pick.append(input);
    title.focus();
  });

  save.addEventListener("click", async () => {
    if (!file && !editing) { err.textContent = "Choose a photo first."; return; }
    if (!title.value.trim()) { err.textContent = "Give this memory a title 💭"; title.focus(); return; }
    err.textContent = "";
    save.disabled = cancel.disabled = true;
    save.innerHTML = `${spinner("sm dark")} ${file ? "Uploading…" : "Saving…"}`;
    try {
      if (editing) {
        const changes = { title: title.value.trim(), text: text.value.trim(), editedAt: serverTimestamp() };
        if (file) {
          bar.hidden = false;
          const up = await upload(await prepareImage(file), { sub: "memories", onProgress: p => ($("span", bar).style.width = `${Math.round(p * 100)}%`) });
          Object.assign(changes, { url: up.secure_url, publicId: up.public_id, width: up.width, height: up.height });
        }
        await updateDoc(doc(db, "memories", existing.id), changes);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        m.close();
        toast("Memory updated 💜");
        return;
      }
      bar.hidden = false;
      const up = await upload(await prepareImage(file), { sub: "memories", onProgress: p => ($("span", bar).style.width = `${Math.round(p * 100)}%`) });
      const ref = await addDoc(collection(db, "memories"), {
        url: up.secure_url, publicId: up.public_id, width: up.width, height: up.height,
        title: title.value.trim(), text: text.value.trim(),
        byUid: uid(), byName: myName(), createdAt: serverTimestamp()
      });
      notifyPartner("memory", "Asaumi you have new memories", { refId: ref.id });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      m.close();
      toast("Memory saved 💜");
    } catch (e) {
      err.textContent = friendlyError(e, "Upload failed. Please try again.");
      save.disabled = cancel.disabled = false;
      save.textContent = "Try again";
    }
  });
}

/* ------------------------------------------------------------------ detail */
function openMemory(id) {
  const x = state.memories.find(m => m.id === id);
  if (!x) return;
  const mine = x.byUid === uid();
  const m = openModal(`
    <div class="detail-img"><img src="${esc(cld(x.url, "f_auto,q_auto,w_1600"))}" alt="" /></div>
    <h2 class="detail-title">❤️ ${esc(memoryTitle(x))}</h2>
    ${x.text ? `<p class="detail-text">${esc(x.text)}</p>` : ""}
    <div class="detail-meta">
      <div><span>Uploaded on</span><b>${esc(fmtFullDate(x.createdAt))}</b></div>
      <div><span>Time</span><b>${esc(fmtTime(x.createdAt))}</b></div>
      <div><span>Created by</span><b>${esc(realNameOf(x.byUid, x.byName))}</b></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Close</button>
      <button class="btn btn-primary" data-dl>${ICONS.download} Download Image</button>
    </div>
    ${mine ? `<div class="detail-links"><button class="edit-link" data-edit>${ICONS.pencil} Edit</button><button class="del-link" data-del>Delete this memory</button></div>` : ""}`, { cls: "wide" });
  $("[data-edit]", m)?.addEventListener("click", () => { m.close(); addMemoryModal(x); });
  $("[data-dl]", m).addEventListener("click", async e => {
    const b = e.currentTarget;
    b.disabled = true;
    await downloadFile(x.url, `asaumi-${memoryTitle(x).replace(/[^\w-]+/g, "-").toLowerCase()}`);
    b.disabled = false;
  });
  $(".detail-img img", m).addEventListener("click", () => viewImage(x.url, "asaumi-memory"));
  $("[data-del]", m)?.addEventListener("click", async () => {
    if (!(await confirmDialog({ icon: "trash", title: "Delete memory?", text: "It will be removed for both of you.", ok: "Delete", danger: true }))) return;
    try { await deleteDoc(doc(db, "memories", id)); m.close(); toast("Memory deleted"); }
    catch (err) { toast(friendlyError(err, "Couldn't delete. Try again.")); }
  });
}

/* ------------------------------------------------------------------ wiring */
views.memories = {
  render: renderMemories,
  enter() { if (!state.unlocked) resetPin(); },
  leave() { lockMemories(); }
};

Object.assign(actions, {
  pinKey: d => pinKey(d.key),
  pinRestart: () => { resetPin(); scheduleRender(); },
  forgotPin: startPinReset,
  resetPin: startPinReset,
  lockMemories: () => { lockMemories(); scheduleRender(); toast("Memories locked 🔐"); },
  addMemory: () => {
    if (state.view !== "memories" || !state.unlocked) { hooks.go("memories"); return; }
    addMemoryModal();
  },
  openMemory: d => openMemory(d.id)
});

// Re-lock whenever the app goes to the background.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.unlocked) {
    lockMemories();
    if (state.view === "memories") scheduleRender();
  }
});
