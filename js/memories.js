import {
  doc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, myName, esc, ICONS, toast, openModal, confirmDialog, cld,
  prepareImage, upload, downloadFile, fmtDate, fmtFullDate, fmtTime, realNameOf, friendlyError,
  spinner, viewImage, notifText, videoPoster, actions, views, hooks, $, $$
} from "./core.js";
import { notifyPartner } from "./notify.js";
import { carouselHtml, wireCarousel } from "./carousel.js";
import { replyToMemory } from "./chat.js";

let openAfterUnlock = null; // memory to open once the PIN is entered (tapped from a chat reply)
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

/* ------------------------------------------------------------------ photos & videos of a memory */
// New memories keep every photo/video in `items`; `url` stays the cover photo (Home, older app versions).
const MAX_ITEMS = 10;
export const itemsOf = m => (m?.items?.length ? m.items : m?.url ? [{ kind: "image", url: m.url, publicId: m.publicId || null, width: m.width || null, height: m.height || null }] : []);
const cardIdx = new Map(); // memory id → slide shown on its card
const ratioOf = x => (x?.width && x?.height ? `${x.width} / ${x.height}` : "4 / 3");
const thumbOf = (x, t) => (x.kind === "video" ? cld(videoPoster(x.url), t) : cld(x.url, `f_auto,q_auto,${t}`));
const playBadge = `<span class="mem-play">${ICONS.play}</span>`;

function memoryMedia(m) {
  const items = itemsOf(m);
  const slide = (x, i) => `
    <button class="mem-slide" data-action="openMemory" data-id="${m.id}" data-i="${i}" aria-label="Open memory">
      <img src="${esc(thumbOf(x, "c_fill,w_800,h_600"))}" alt="" loading="lazy" />${x.kind === "video" ? playBadge : ""}
    </button>`;
  if (items.length > 1) return `<div class="mem-img mem-car">${carouselHtml(items.map(slide), { id: m.id, ratio: "4 / 3" })}</div>`;
  return `<div class="mem-img">${items[0] ? slide(items[0], 0) : ""}</div>`;
}

function memoryCard(m) {
  return `
    <article class="glass mem-card">
      ${memoryMedia(m)}
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
  const editing = !!existing;
  // entries: saved items ({ kind, url, … }) and new picks ({ kind, file, previewUrl })
  const entries = editing ? itemsOf(existing).map(x => ({ ...x })) : [];
  let at = 0;
  const m = openModal(`
    <h2>${editing ? "Edit memory" : "Create a memory"}</h2>
    <div id="pick"></div>
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
  const pick = $("#pick", m), title = $("[name=title]", m), text = $("[name=text]", m);
  const err = $(".form-error", m), bar = $(".progress", m), save = $("[data-save]", m), cancel = $("[data-close]", m);
  const revoke = () => entries.forEach(e => e.previewUrl && URL.revokeObjectURL(e.previewUrl));
  m.onclose = revoke;

  const fileInput = `<input type="file" accept="image/*,video/*" multiple />`;
  function draw() {
    if (!entries.length) {
      pick.innerHTML = `
        <label class="file-pick">
          ${fileInput}
          <span class="big">📷</span><span>Choose photos or videos</span>
          <small>Pick one or more (up to ${MAX_ITEMS}) · photos up to ${LIMITS.imageMB} MB, videos up to ${LIMITS.videoMB} MB</small>
        </label>`;
    } else {
      at = Math.min(at, entries.length - 1);
      const slides = entries.map(e => {
        const src = e.previewUrl || e.url;
        return e.kind === "video"
          ? `<video src="${esc(src)}" ${e.previewUrl ? "" : `poster="${esc(videoPoster(e.url))}"`} controls playsinline preload="metadata"></video>`
          : `<img src="${esc(e.previewUrl || cld(e.url, "f_auto,q_auto,w_900"))}" alt="" />`;
      });
      const photos = entries.filter(e => e.kind === "image").length, videos = entries.length - photos;
      pick.innerHTML = `
        <div class="media-preview album-preview">${entries.length > 1 ? carouselHtml(slides, { ratio: "1 / 1" }) : slides[0]}</div>
        <div class="album-tools">
          <p class="file-note">${[photos && `${photos} photo${photos > 1 ? "s" : ""}`, videos && `${videos} video${videos > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</p>
          <span class="album-btns">
            ${entries.length < MAX_ITEMS ? `<label class="btn btn-ghost btn-sm">${ICONS.plus} Add${fileInput}</label>` : ""}
            <button type="button" class="btn btn-ghost btn-sm" data-remove>${ICONS.trash} Remove</button>
          </span>
        </div>`;
      wireCarousel($(".carousel", pick), i => { at = i; }, at);
      $("[data-remove]", pick).addEventListener("click", () => {
        const [x] = entries.splice(at, 1);
        if (x?.previewUrl) URL.revokeObjectURL(x.previewUrl);
        draw();
      });
    }
    const input = $("input[type=file]", pick);
    if (input) { input.hidden = true; input.addEventListener("change", () => { addFiles([...input.files]); input.value = ""; }); }
  }

  function addFiles(files) {
    err.textContent = "";
    const before = entries.length;
    for (const f of files) {
      const kind = f.type.startsWith("video/") ? "video" : f.type.startsWith("image/") ? "image" : null;
      if (!kind) { err.textContent = "Only photos and videos can be added."; continue; }
      const maxMB = kind === "video" ? LIMITS.videoMB : LIMITS.imageMB * 3; // photos are compressed before upload
      if (f.size > maxMB * 1024 * 1024) { err.textContent = `Skipped a ${kind === "video" ? "video" : "photo"} larger than ${maxMB} MB.`; continue; }
      if (entries.length >= MAX_ITEMS) { err.textContent = `A memory can hold up to ${MAX_ITEMS} photos and videos.`; break; }
      const e = { kind, file: f, previewUrl: URL.createObjectURL(f) };
      // remember the size so the carousel and Home keep the right shape
      const probe = kind === "video" ? document.createElement("video") : new Image();
      probe.addEventListener(kind === "video" ? "loadedmetadata" : "load", () => {
        e.width = probe.videoWidth || probe.naturalWidth;
        e.height = probe.videoHeight || probe.naturalHeight;
      }, { once: true });
      if (kind === "video") probe.preload = "metadata";
      probe.src = e.previewUrl;
      entries.push(e);
    }
    if (entries.length > before) { at = before; draw(); if (!title.value) title.focus(); }
  }
  draw();

  // uploads new picks two at a time; finished ones are kept, so "Try again" only redoes the rest
  async function uploadNew() {
    const todo = entries.filter(e => e.file && !e.url);
    const total = todo.length;
    if (!total) return;
    bar.hidden = false;
    const prog = new Map();
    const tick = () => { $("span", bar).style.width = `${Math.round(([...prog.values()].reduce((a, b) => a + b, 0) / total) * 100)}%`; };
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const e = queue.shift();
        const file = e.kind === "image" ? await prepareImage(e.file) : e.file;
        const up = await upload(file, { sub: "memories", onProgress: p => { prog.set(e, p); tick(); } });
        Object.assign(e, {
          url: up.secure_url, publicId: up.public_id, width: up.width || e.width || null, height: up.height || e.height || null,
          ...(e.kind === "video" ? { duration: up.duration || null } : {})
        });
        prog.set(e, 1);
        tick();
      }
    };
    await Promise.all([worker(), worker()]);
  }

  save.addEventListener("click", async () => {
    if (!entries.length) { err.textContent = "Choose a photo or video first."; return; }
    if (!title.value.trim()) { err.textContent = "Give this memory a title 💭"; title.focus(); return; }
    err.textContent = "";
    save.disabled = cancel.disabled = true;
    const uploading = entries.some(e => !e.url);
    save.innerHTML = `${spinner("sm dark")} ${uploading ? "Uploading…" : "Saving…"}`;
    try {
      await uploadNew();
      const items = entries.map(e => ({
        kind: e.kind, url: e.url, publicId: e.publicId || null, width: e.width || null, height: e.height || null,
        ...(e.kind === "video" ? { duration: e.duration || null } : {})
      }));
      // cover: the first photo (or the first video's preview picture)
      const cover = items.find(x => x.kind === "image") || items[0];
      const coverFields = {
        url: cover.kind === "image" ? cover.url : videoPoster(cover.url),
        publicId: cover.publicId, width: cover.width, height: cover.height
      };
      const data = { ...coverFields, items, title: title.value.trim(), text: text.value.trim() };
      if (editing) {
        await updateDoc(doc(db, "memories", existing.id), { ...data, editedAt: serverTimestamp() });
        m.close();
        toast("Memory updated 💜");
        return;
      }
      const ref = await addDoc(collection(db, "memories"), { ...data, byUid: uid(), byName: myName(), createdAt: serverTimestamp() });
      notifyPartner("memory", notifText("memory"), { refId: ref.id });
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
function openMemory(id, start = 0) {
  const x = state.memories.find(m => m.id === id);
  if (!x) return;
  const mine = x.byUid === uid();
  const items = itemsOf(x);
  let at = Math.min(start, items.length - 1);
  const slide = it => it.kind === "video"
    ? `<video src="${esc(it.url)}" poster="${esc(videoPoster(it.url))}" controls playsinline preload="metadata"></video>`
    : `<img src="${esc(cld(it.url, "f_auto,q_auto,w_1600"))}" alt="" data-full="${esc(it.url)}" />`;
  const m = openModal(`
    <div class="detail-img ${items.length > 1 ? "has-car" : ""}">${items.length > 1 ? carouselHtml(items.map(slide), { ratio: ratioOf(items[0]) }) : slide(items[0])}</div>
    <h2 class="detail-title">❤️ ${esc(memoryTitle(x))}</h2>
    ${x.text ? `<p class="detail-text">${esc(x.text)}</p>` : ""}
    <div class="detail-meta">
      <div><span>Uploaded on</span><b>${esc(fmtFullDate(x.createdAt))}</b></div>
      <div><span>Time</span><b>${esc(fmtTime(x.createdAt))}</b></div>
      <div><span>Created by</span><b>${esc(realNameOf(x.byUid, x.byName))}</b></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Close</button>
      <button class="btn btn-primary" data-dl>${ICONS.download} Download</button>
    </div>
    <button class="btn btn-ghost btn-block mem-reply" data-reply>${ICONS.reply} Reply in chat</button>
    ${mine ? `<div class="detail-links"><button class="edit-link" data-edit>${ICONS.pencil} Edit</button><button class="del-link" data-del>Delete this memory</button></div>` : ""}`, { cls: "wide" });
  wireCarousel($(".carousel", m), i => { at = i; }, at);
  $("[data-edit]", m)?.addEventListener("click", () => { m.close(); addMemoryModal(x); });
  $("[data-reply]", m).addEventListener("click", () => {
    const cover = items.find(it => it.kind === "image") || items[0];
    const thumb = cover && thumbOf(cover, "c_fill,w_120,h_120,e_blur:600");
    m.close();
    replyToMemory(x, { title: memoryTitle(x), thumb });
  });
  // downloads the photo / video on screen
  $("[data-dl]", m).addEventListener("click", async e => {
    const b = e.currentTarget;
    b.disabled = true;
    const name = `asaumi-${memoryTitle(x).replace(/[^\w-]+/g, "-").toLowerCase()}${items.length > 1 ? `-${at + 1}` : ""}`;
    await downloadFile(items[at].url, name);
    b.disabled = false;
  });
  $$(".detail-img img[data-full]", m).forEach(img => img.addEventListener("click", () => viewImage(img.dataset.full, "asaumi-memory")));
  $("[data-del]", m)?.addEventListener("click", async () => {
    if (!(await confirmDialog({ icon: "trash", title: "Delete memory?", text: "It will be removed for both of you.", ok: "Delete", danger: true }))) return;
    try { await deleteDoc(doc(db, "memories", id)); m.close(); toast("Memory deleted"); }
    catch (err) { toast(friendlyError(err, "Couldn't delete. Try again.")); }
  });
}

/* ------------------------------------------------------------------ wiring */
views.memories = {
  render: renderMemories,
  mounted(root) {
    $$(".mem-card .carousel[data-car]", root).forEach(car => {
      const id = car.dataset.car;
      wireCarousel(car, i => cardIdx.set(id, i), cardIdx.get(id) || 0);
    });
    if (state.memUnlocked && openAfterUnlock && state.loaded.memories) {
      const id = openAfterUnlock;
      openAfterUnlock = null;
      if (state.memories.some(x => x.id === id)) setTimeout(() => openMemory(id), 150);
      else toast("That memory was deleted.");
    }
  },
  enter() { if (!state.memUnlocked) askMemoriesPin(); },
  leave() { lockMemories(); openAfterUnlock = null; }        // locks again every time you leave Memories
};

Object.assign(actions, {
  addMemory: () => {
    if (state.view !== "memories" || !state.memUnlocked) { hooks.go("memories"); return; }
    addMemoryModal();
  },
  openMemory: d => openMemory(d.id, Number(d.i) || 0),
  // tapping a memory quoted in the chat: go to Memories (PIN first), then open it
  openMemoryFromChat: id => {
    openAfterUnlock = id;
    hooks.go("memories");
  }
});
