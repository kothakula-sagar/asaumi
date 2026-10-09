// 🖼️ Photos: every photo sent in the chat, side by side, newest first, grouped by month.
//  • Built from the chat saved on this phone (chatstore.js) + the live chat, so it costs no Firebase reads.
//  • Only chat photos. A memory's own photos are not shown; a chat photo that was also saved as a memory is.
//  • The same photo sent twice shows once (and is stored once in Cloudinary, see upload() in core.js).
import {
  state, uid, esc, cld, toDate, openModal, downloadFile, realNameOf, partnerName, fmtFullDate, fmtTime,
  scheduleRender, views, actions, $
} from "./core.js";
import { exportArchive } from "./chatstore.js";

const PAGE = 90;
let saved = [];           // photos from the chat saved on this phone
let savedFor = null;      // which account `saved` belongs to
let loading = false;
let shown = PAGE;
let filter = "all";       // all | me | them
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

// all photos of one chat message (single photo or album)
function photosOf(m) {
  if (!m || (m.type !== "image" && m.type !== "video")) return [];
  const at = typeof m.createdAt === "number" ? m.createdAt : toDate(m.createdAt)?.getTime();
  if (!at) return [];
  const items = m.media?.items?.length ? m.media.items : m.type === "image" && m.media?.url ? [{ kind: "image", ...m.media }] : [];
  const caption = m.locked || typeof m.text !== "string" || m.text.startsWith("e1:") ? "" : m.text;
  return items
    .filter(x => (x.kind || "image") === "image" && x.url)
    .map(x => ({ url: x.url, w: x.width || null, h: x.height || null, by: m.from, at, msg: m.id, caption }));
}

async function loadSaved() {
  if (loading || !state.user) return;
  loading = true;
  const me = uid();
  try {
    const list = await exportArchive();
    if (uid() === me) { saved = list.flatMap(photosOf); savedFor = me; }
  } catch (err) {
    console.warn("[asaumi] photos", err);
  }
  loading = false;
  scheduleRender();
}

// saved + live, one entry per picture, newest first
function allPhotos() {
  if (savedFor !== uid()) { saved = []; if (state.user) loadSaved(); }
  const byUrl = new Map();
  for (const p of [...saved, ...state.messages.flatMap(photosOf)]) {
    const old = byUrl.get(p.url);
    if (!old || p.at > old.at) byUrl.set(p.url, p);
  }
  return [...byUrl.values()].sort((a, b) => b.at - a.at);
}

const filtered = () => {
  const all = allPhotos(), me = uid();
  return filter === "me" ? all.filter(p => p.by === me) : filter === "them" ? all.filter(p => p.by !== me) : all;
};

/* ------------------------------------------------------------------ page */
function renderPhotos() {
  const list = filtered(), me = uid();
  const chip = (k, label) => `<button class="ph-chip ${filter === k ? "on" : ""}" data-action="photoFilter" data-f="${k}">${label}</button>`;
  let grid = "", month = "";
  list.slice(0, shown).forEach((p, i) => {
    const mth = monthFmt.format(new Date(p.at));
    if (mth !== month) {
      if (month) grid += "</div>";
      month = mth;
      grid += `<h3 class="ph-month">${esc(mth)}</h3><div class="ph-grid">`;
    }
    grid += `<button class="ph-cell" data-action="openPhoto" data-i="${i}" aria-label="Photo from ${esc(p.by === me ? "you" : partnerName())}">
        <img src="${esc(cld(p.url, "f_auto,q_auto,c_fill,w_320,h_320"))}" alt="" loading="lazy" decoding="async" />
      </button>`;
  });
  if (month) grid += "</div>";
  return `
    <section class="page-head">
      <div>
        <p class="eyebrow">From our chat</p>
        <h1>🖼️ Photos</h1>
        <p class="page-sub">${list.length ? `${list.length} photo${list.length === 1 ? "" : "s"}` : loading ? "Loading…" : "Every photo you send each other shows up here."}</p>
      </div>
    </section>
    <div class="ph-chips">${chip("all", "All")}${chip("me", "Sent by you")}${chip("them", `Sent by ${esc(partnerName())}`)}</div>
    ${list.length ? grid : `
      <div class="glass empty">
        <span class="empty-orb">🖼️</span>
        <b>${loading ? "Loading photos…" : "No photos yet"}</b>
        <p>Photos you send in the chat appear here, side by side.</p>
        <button class="btn btn-primary" data-nav="chat">Open chat</button>
      </div>`}
    ${list.length > shown ? `<button class="btn btn-ghost btn-block ph-more" data-action="photosMore">Show more (${list.length - shown})</button>` : ""}`;
}

/* ------------------------------------------------------------------ full-screen viewer (swipe left / right) */
function openViewer(list, start) {
  if (!list.length) return;
  let i = Math.max(0, Math.min(start, list.length - 1));
  const m = openModal(`
    <div class="gal">
      <button class="gal-nav prev" aria-label="Previous">‹</button>
      <div class="gal-stage"><img class="gal-img" alt="" /></div>
      <button class="gal-nav next" aria-label="Next">›</button>
    </div>
    <div class="gal-info"><b class="gal-who"></b><small class="gal-count"></small></div>
    <p class="gal-cap"></p>
    <div class="viewer-bar">
      <button class="btn btn-ghost btn-sm" data-close>Close</button>
      <button class="btn btn-primary btn-sm" data-dl>Download</button>
    </div>`, { cls: "viewer gallery" });
  const img = $(".gal-img", m), stage = $(".gal-stage", m);
  const show = n => {
    i = (n + list.length) % list.length;
    const p = list[i];
    img.classList.remove("in");
    void img.offsetWidth;
    img.src = cld(p.url, "f_auto,q_auto,w_1600");
    img.classList.add("in");
    const d = new Date(p.at);
    $(".gal-who", m).textContent = `${p.by === uid() ? "You" : realNameOf(p.by, partnerName())} · ${fmtFullDate(d)} · ${fmtTime(d)}`;
    $(".gal-count", m).textContent = `${i + 1} / ${list.length}`;
    $(".gal-cap", m).textContent = p.caption;
    // preload the neighbours so swiping feels instant
    [list[(i + 1) % list.length], list[(i - 1 + list.length) % list.length]].forEach(q => { if (q) new Image().src = cld(q.url, "f_auto,q_auto,w_1600"); });
  };
  show(i);
  $(".prev", m).addEventListener("click", () => show(i - 1));
  $(".next", m).addEventListener("click", () => show(i + 1));
  $("[data-dl]", m).addEventListener("click", async e => {
    const b = e.currentTarget;
    b.disabled = true;
    await downloadFile(list[i].url, `asaumi-photo-${i + 1}`);
    b.disabled = false;
  });
  let x0 = null;
  stage.addEventListener("pointerdown", e => { x0 = e.clientX; });
  stage.addEventListener("pointerup", e => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 45) show(dx < 0 ? i + 1 : i - 1);
  });
  const keys = e => { if (e.key === "ArrowRight") show(i + 1); else if (e.key === "ArrowLeft") show(i - 1); };
  document.addEventListener("keydown", keys);
  m.onclose = () => document.removeEventListener("keydown", keys);
}

/* ------------------------------------------------------------------ Home card */
export function photosCard() {
  const all = allPhotos();
  const thumbs = all.slice(0, 4);
  return `
    <article class="glass hcard photos-card">
      <header class="hcard-head">
        <span class="hcard-ico">🖼️</span>
        <h3>Our Photos</h3>
        ${all.length ? `<span class="hcard-count">${all.length}</span>` : ""}
      </header>
      ${thumbs.length
        ? `<div class="ph-strip">${thumbs.map((p, i) => `<button data-action="openPhoto" data-i="${i}" data-from="home"><img src="${esc(cld(p.url, "f_auto,q_auto,c_fill,w_200,h_200"))}" alt="" loading="lazy" /></button>`).join("")}</div>`
        : `<small class="games-line">Photos you send in the chat collect here.</small>`}
      <button class="btn btn-ghost btn-block" data-nav="photos">🖼️ See all photos</button>
    </article>`;
}

views.photos = {
  render: renderPhotos,
  enter() { shown = PAGE; loadSaved(); }
};

Object.assign(actions, {
  photoFilter: d => { filter = d.f; shown = PAGE; scheduleRender(); },
  photosMore: () => { shown += PAGE; scheduleRender(); },
  // from Home the list is always "all"; on the page it follows the chosen filter
  openPhoto: d => openViewer(d.from === "home" ? allPhotos() : filtered(), Number(d.i) || 0)
});
