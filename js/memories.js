import {
  doc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, myName, esc, ICONS, toast, openModal, confirmDialog, cld,
  prepareImage, upload, downloadFile, fmtDate, fmtFullDate, fmtTime, realNameOf, friendlyError,
  spinner, viewImage, notifText, actions, views, hooks, $
} from "./core.js";
import { notifyPartner } from "./notify.js";
import { askMemoriesPin, lockMemories } from "./lock.js";
import { LIMITS } from "./config.js";

const PREVIEW_CHARS = 96;

export const memoryTitle = m => m.title || (m.text || "").split("\n")[0].slice(0, 40) || "A memory";
export function previewText(text = "") {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS).trimEnd()}.....` : t;
}

/* ------------------------------------------------------------------ list */
function renderMemories() {
  if (!state.memUnlocked) {
    return `
      <div class="glass empty mem-locked">
        <span class="empty-orb">🔐</span>
        <b>Our Memories are locked</b>
        <p>A private place for moments worth keeping.</p>
        <button class="btn btn-primary" data-action="unlockMemories">${ICONS.unlock} Unlock with PIN</button>
      </div>`;
  }
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
      notifyPartner("memory", notifText("memory"), { refId: ref.id });
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
  enter() { if (!state.memUnlocked) askMemoriesPin(); },
  leave() { lockMemories(); }        // locks again every time you leave Memories
};

Object.assign(actions, {
  addMemory: () => {
    if (state.view !== "memories" || !state.memUnlocked) { hooks.go("memories"); return; }
    addMemoryModal();
  },
  openMemory: d => openMemory(d.id)
});
