import {
  doc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, myName, esc, ICONS, toast, openModal, confirmDialog, viewImage, avatarHtml, presenceDot,
  statusText, isTyping, toDate, fmtTime, dayLabel, sameDay, fmtDuration, cld, videoPoster, audioUrl,
  prepareImage, upload, friendlyError, partnerName, realNameOf, spinner, audioCtx, ping, notifText, actions, views, $, $$
} from "./core.js";
import { typingPing, typingStop, systemNotify, pushPartner, notifyPartner } from "./notify.js";
import { LIMITS } from "./config.js";
import { stickerPanes, bindStickerPanel, renderOurStickers, saveAsSticker } from "./stickers.js";
export { renderOurStickers };

const EMOJIS = "❤️ 😘 🥰 😍 😊 😂 🤣 😅 😇 🙈 😴 🥺 😢 😭 😤 😡 🤗 🤔 😌 😋 😎 🤍 💜 💙 💕 💖 💞 💫 ✨ 🌙 ⭐ 🌸 🌹 🌈 ☕ 🍫 🍕 🎶 🎉 🎂 🙏 👍 👌 🤞 👏 🫶 💪 🔥 💯".split(" ");
const coarse = matchMedia("(pointer: coarse)").matches;

let els = null;            // cached DOM for the chat view
const rendered = new Map(); // id -> { el, sig, statusSig }
let firstPaint = true;
let lastIds = "";
const pending = [];         // local uploads not yet in Firestore
const deliveredAsked = new Set();
const readAsked = new Set();

/* ------------------------------------------------------------------ mount */
export function mountChat() {
  const root = $("#chat-view");
  root.innerHTML = `
    <div class="chat">
      <header class="chat-head glass">
        <button class="icon-btn ghost chat-back" data-nav="home" aria-label="Back">${ICONS.back}</button>
        <div class="chat-who" id="chat-who"></div>
        <button class="icon-btn" data-action="startCall" data-kind="audio" aria-label="Audio call">${ICONS.phone}</button>
        <button class="icon-btn" data-action="startCall" data-kind="video" aria-label="Video call">${ICONS.video}</button>
      </header>

      <div class="chat-body">
        <div class="chat-scroll" id="chat-scroll">
          <div class="chat-top">
            <button class="chip-btn" id="chat-more" hidden>Load earlier messages</button>
            <div class="chat-loading" id="chat-loading">${spinner()}</div>
          </div>
          <div class="chat-empty" id="chat-empty" hidden>
            <span class="big">❤️</span>
            <b>Start your conversation.</b>
            <p>Everything here stays between the two of you.</p>
          </div>
          <div class="chat-list" id="chat-list"></div>
          <div class="chat-pending" id="chat-pending"></div>
          <div class="typing-row" id="typing-row" hidden>
            <div class="bubble typing-bubble"><span class="tdots"><i></i><i></i><i></i></span></div>
            <small id="typing-name"></small>
          </div>
        </div>
        <button class="new-pill" id="new-pill" hidden>${ICONS.arrowDown} New messages</button>
      </div>

      <div class="composer glass" id="composer" data-mode="text">
        <div class="emoji-panel" id="emoji-panel" hidden>
          <div class="ep-tabs">
            <button type="button" data-tab="emoji" class="on">😊 Emoji</button>
            <button type="button" data-tab="anim">✨ Stickers</button>
            <button type="button" data-tab="ours">⭐ Ours</button>
          </div>
          <div class="ep-pane" data-pane="emoji">
            ${EMOJIS.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}
          </div>
          ${stickerPanes()}
        </div>
        <div class="reply-bar" id="reply-bar" hidden>
          <span class="rb-ico">${ICONS.reply}</span>
          <div class="rb-body"><b id="rb-name"></b><span id="rb-text"></span></div>
          <button class="c-btn" id="rb-close" aria-label="Cancel reply">${ICONS.close}</button>
        </div>
        <div class="c-row c-text">
          <button class="c-btn" id="c-emoji" aria-label="Emoji">${ICONS.smile}</button>
          <label class="c-btn" aria-label="Photo or video from gallery">${ICONS.image}<input type="file" id="c-file" accept="image/*,video/*" hidden /></label>
          <button type="button" class="c-btn c-camera" id="c-camera" aria-label="Camera">${ICONS.camera}</button>
          <input type="file" id="c-cam-photo" accept="image/*" capture="environment" hidden />
          <input type="file" id="c-cam-video" accept="video/*" capture="environment" hidden />
          <textarea id="c-input" rows="1" maxlength="4000" placeholder="Message…"></textarea>
          <button class="c-send" id="c-send" aria-label="Record voice">${ICONS.mic}</button>
        </div>
        <div class="c-row c-rec">
          <button class="c-btn" id="rec-cancel" aria-label="Discard">${ICONS.trash}</button>
          <span class="rec-dot"></span><span class="rec-time" id="rec-time">0:00</span>
          <div class="rec-wave" id="rec-wave"></div>
          <button class="c-send stop" id="rec-stop" aria-label="Stop recording">${ICONS.stop}</button>
        </div>
        <div class="c-row c-preview">
          <button class="c-btn" id="pv-discard" aria-label="Discard">${ICONS.trash}</button>
          <button class="c-btn play" id="pv-play" aria-label="Play">${ICONS.play}</button>
          <div class="rec-wave static" id="pv-wave"></div>
          <span class="rec-time" id="pv-time">0:00</span>
          <button class="c-send" id="pv-send" aria-label="Send voice message">${ICONS.send}</button>
        </div>
      </div>

      <aside class="chat-side glass" id="chat-side"></aside>
    </div>`;

  els = {
    who: $("#chat-who"), scroll: $("#chat-scroll"), list: $("#chat-list"), pending: $("#chat-pending"),
    empty: $("#chat-empty"), loading: $("#chat-loading"), more: $("#chat-more"), typing: $("#typing-row"),
    pill: $("#new-pill"), composer: $("#composer"), input: $("#c-input"), send: $("#c-send"),
    emoji: $("#emoji-panel"), side: $("#chat-side"), replyBar: $("#reply-bar")
  };
  replyTo = null;
  $("#rb-close").addEventListener("click", clearReply);
  rendered.clear();
  firstPaint = true;
  lastIds = "";
  bindComposer();

  els.scroll.addEventListener("scroll", () => { if (nearBottom()) els.pill.hidden = true; }, { passive: true });
  els.pill.addEventListener("click", () => scrollBottom(true));
  els.more.addEventListener("click", () => actions.loadEarlier?.());
  els.list.addEventListener("contextmenu", e => {
    const row = e.target.closest('.msg-row[data-kind="msg"]');
    if (!row || e.target.closest("video, a")) return;
    e.preventDefault();
    openMessageMenu(row.dataset.id);
  });
  bindSwipe();
  els.list.addEventListener("click", e => {
    if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
    const quote = e.target.closest("[data-jump]");
    if (quote) { jumpTo(quote.dataset.jump); return; }
    const toMem = e.target.closest("[data-to-mem]");
    if (toMem) { uploadToMemories(toMem.dataset.toMem); return; }
    const img = e.target.closest("[data-view-img]");
    if (img) viewImage(img.dataset.viewImg, "asaumi-photo");
  }, true);
}

/* ------------------------------------------------------------------ scrolling */
const nearBottom = () => !els || els.scroll.scrollHeight - els.scroll.scrollTop - els.scroll.clientHeight < 160;
function scrollBottom(smooth) {
  if (!els) return;
  els.scroll.scrollTo({ top: els.scroll.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  els.pill.hidden = true;
}

/* ------------------------------------------------------------------ message html */
function statusHtml(m) {
  if (m.pending) return `<span class="st pending" title="Sending">${ICONS.clock}</span>`;
  if (m.readAt) return '<span class="st read" title="Read"><i class="read-dot"></i>✓✓</span>';
  if (m.deliveredAt) return '<span class="st" title="Delivered">✓✓</span>';
  return '<span class="st" title="Sent">✓</span>';
}

const linkify = s => s.replace(/\bhttps?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
const emojiOnly = s => /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,12}$/u.test(s) && !/\d/.test(s);

function waveBars(wave, id) {
  let vals = Array.isArray(wave) && wave.length ? wave : null;
  if (!vals) { // stable pseudo-waveform
    let seed = [...(id || "x")].reduce((a, c) => a + c.charCodeAt(0), 7);
    vals = Array.from({ length: 32 }, () => { seed = (seed * 9301 + 49297) % 233280; return 0.25 + (seed / 233280) * 0.75; });
  }
  return vals.map(v => `<i style="height:${Math.round(18 + Math.min(1, v) * 82)}%"></i>`).join("");
}

function mediaBox(media, inner) {
  const ratio = media?.width && media?.height ? `${media.width} / ${media.height}` : "4 / 3";
  return `<div class="msg-media" style="aspect-ratio:${ratio}">${inner}</div>`;
}

function contentHtml(m) {
  const cap = m.text ? `<p class="msg-text">${linkify(esc(m.text))}</p>` : "";
  switch (m.type) {
    case "image":
      return mediaBox(m.media, `<img src="${esc(cld(m.media?.url, "f_auto,q_auto,w_720"))}" alt="Photo" loading="lazy" data-view-img="${esc(m.media?.url)}" />`) + cap;
    case "video":
      return mediaBox(m.media, `<video src="${esc(m.media?.url)}" poster="${esc(videoPoster(m.media?.url))}" preload="metadata" controls playsinline></video>`) + cap;
    case "voice":
      return `
        <div class="voice" data-voice="${m.id}">
          <button class="v-play" data-action="playVoice" data-id="${m.id}" aria-label="Play voice message">${ICONS.play}</button>
          <div class="v-body">
            <div class="v-wave">${waveBars(m.media?.wave, m.id)}</div>
            <div class="v-info"><span class="v-dur">${fmtDuration(m.media?.duration)}</span><span>🎤 ${esc(m.from === uid() ? "You" : realNameOf(m.from))}</span></div>
          </div>
        </div>`;
    case "sticker":
      return `<img class="sticker-img" src="${esc(m.media?.url)}" alt="Sticker" loading="lazy" />`;
    case "call":
      return "";
    default:
      return `<p class="msg-text ${emojiOnly(m.text || "") ? "jumbo" : ""}">${linkify(esc(m.text || ""))}</p>`;
  }
}

function callRowHtml(c) {
  const out = c.callerId === uid();
  const video = c.kind !== "audio";
  let label;
  if (c.status === "ended" && c.duration) label = `${video ? "Video" : "Audio"} call · ${fmtDuration(c.duration)}`;
  else if (c.status === "declined") label = `${video ? "Video" : "Audio"} call declined`;
  else if (c.status === "busy") label = `${out ? partnerName() : "You"} ${out ? "was" : "were"} busy`;
  else if (c.status === "missed" || c.status === "failed" || c.status === "ended") label = out ? "No answer" : `Missed ${video ? "video" : "audio"} call`;
  else label = `${video ? "Video" : "Audio"} call`;
  const missed = !out && (c.status === "missed");
  return `<div class="call-pill ${missed ? "missed" : ""}">${video ? ICONS.video : ICONS.phone}<span>${esc(label)}</span><small>${fmtTime(c.createdAt)}</small></div>`;
}

function itemHtml(it, showDate) {
  const sep = showDate ? `<div class="day-sep"><span>${esc(dayLabel(toDate(it.createdAt)))}</span></div>` : "";
  if (it.kind === "call") return sep + callRowHtml(it);
  const mine = it.from === uid();
  return `${sep}
    <div class="msg ${mine ? "me" : "them"} t-${it.type}">
      <div class="bubble">
        <span class="swipe-ico">${ICONS.reply}</span>
        ${quoteHtml(it.replyTo)}
        ${contentHtml(it)}
        <div class="meta">${it.editedAt ? '<span class="edited">edited</span>' : ""}<span>${fmtTime(it.createdAt)}</span>${mine ? `<span class="status">${statusHtml(it)}</span>` : ""}</div>
      </div>
      ${it.type === "image" && it.media?.url ? toMemoryButton(it) : ""}
    </div>`;
}

/* ------------------------------------------------------------------ chat photo → Memories */
const inMemories = url => state.memories.some(m => m.url === url);

function toMemoryButton(it) {
  const saved = inMemories(it.media.url);
  return `
    <button type="button" class="to-mem ${saved ? "saved" : ""}" data-to-mem="${it.id}" aria-label="${saved ? "In Memories" : "Upload to Memories"}">
      <span>${saved ? ICONS.check : ICONS.lock}</span><small>${saved ? "Saved" : "Memories"}</small>
    </button>`;
}

function uploadToMemories(id) {
  const msg = state.messages.find(x => x.id === id);
  if (!msg?.media?.url) return;
  if (inMemories(msg.media.url)) { toast("Already in Memories 🔐"); return; }
  const caption = (msg.text || "").trim();
  const m = openModal(`
    <h2>Upload to Memories 🔐</h2>
    <div class="media-preview"><img src="${esc(cld(msg.media.url, "f_auto,q_auto,w_900"))}" alt="" /></div>
    <label class="field"><span>Title</span><input type="text" maxlength="60" placeholder="e.g. Our evening walk" value="${esc(caption.split("\n")[0].slice(0, 60))}" /></label>
    <label class="field"><span>The memory (optional)</span><textarea maxlength="3000" placeholder="Write something about this moment…">${esc(caption)}</textarea></label>
    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>Upload</button>
    </div>`);
  const title = $("input", m), text = $("textarea", m), err = $(".form-error", m), save = $("[data-save]", m);
  setTimeout(() => title.focus(), 60);
  save.addEventListener("click", async () => {
    if (!title.value.trim()) { err.textContent = "Give this memory a title 💭"; title.focus(); return; }
    save.disabled = true;
    save.innerHTML = spinner("sm dark");
    try {
      // same photo, no re-upload; "uploaded by" is whoever tapped the button
      const ref = await addDoc(collection(db, "memories"), {
        url: msg.media.url, publicId: msg.media.publicId || null,
        width: msg.media.width || null, height: msg.media.height || null,
        title: title.value.trim(), text: text.value.trim(),
        byUid: uid(), byName: myName(), createdAt: serverTimestamp(), fromMessage: id
      });
      notifyPartner("memory", notifText("memory"), { refId: ref.id });
      m.close();
      toast("Uploaded to Memories 🔐");
    } catch (e) {
      err.textContent = friendlyError(e, "Couldn't upload. Try again.");
      save.disabled = false;
      save.textContent = "Upload";
    }
  });
}

/* ------------------------------------------------------------------ timeline */
function timeline() {
  const msgs = state.messages.map(m => ({ ...m, kind: "msg" }));
  const oldest = toDate(msgs[0]?.createdAt);
  const full = state.messages.length < state.msgLimit;
  const calls = state.calls
    .filter(c => c.createdAt && ["ended", "missed", "declined", "busy", "failed"].includes(c.status))
    .filter(c => full || !oldest || toDate(c.createdAt) >= oldest)
    .map(c => ({ ...c, id: `call_${c.id}`, kind: "call" }));
  return [...msgs, ...calls].sort((a, b) => (toDate(a.createdAt)?.getTime() ?? Infinity) - (toDate(b.createdAt)?.getTime() ?? Infinity));
}

export function updateChat() {
  if (!els) return;
  renderHeader();
  renderSide();

  const wasNear = nearBottom();
  const items = timeline();
  els.loading.hidden = !!state.loaded.messages;
  els.empty.hidden = !state.loaded.messages || items.length > 0 || pending.length > 0;
  els.more.hidden = state.messages.length < state.msgLimit;

  const seen = new Set();
  let prevDate = null;
  let anchor = null; // last placed element
  const prevHeight = els.scroll.scrollHeight;
  const prevTop = els.scroll.scrollTop;
  const prependedOlder = items.length && rendered.size && !rendered.has(items[0].id) && rendered.has(items.at(-1).id);

  for (const it of items) {
    const d = toDate(it.createdAt) || new Date();
    const showDate = !prevDate || !sameDay(prevDate, d);
    prevDate = d;
    seen.add(it.id);
    const sig = `${showDate}|${it.kind}|${it.type}|${it.text}|${it.media?.url}|${it.status}|${it.duration}|${it.replyTo?.id}|${!!it.editedAt}|${it.type === "image" && inMemories(it.media?.url)}|${Math.floor(d.getTime() / 60000)}`;
    let r = rendered.get(it.id);
    if (!r || r.sig !== sig) {
      const el = document.createElement("div");
      el.className = "msg-row";
      el.dataset.id = it.id;
      el.dataset.kind = it.kind;
      if (it.kind === "msg" && it.from === uid()) el.dataset.mine = "1";
      el.innerHTML = itemHtml(it, showDate);
      if (!r && !firstPaint) el.classList.add("in");
      if (r) r.el.replaceWith(el);
      r = { el, sig, statusSig: "" };
      rendered.set(it.id, r);
    }
    if (it.kind === "msg" && it.from === uid()) {
      const ss = `${it.pending}|${!!it.deliveredAt}|${!!it.readAt}`;
      if (r.statusSig !== ss) {
        const st = r.el.querySelector(".status");
        if (st) st.innerHTML = statusHtml(it);
        r.statusSig = ss;
      }
    }
    // keep DOM order
    const expectedNext = anchor ? anchor.nextSibling : els.list.firstChild;
    if (r.el !== expectedNext) els.list.insertBefore(r.el, expectedNext);
    anchor = r.el;
  }
  for (const [id, r] of rendered) if (!seen.has(id)) { r.el.remove(); rendered.delete(id); }

  renderPending();
  renderTyping();

  const ids = items.map(i => i.id).join();
  const lastItem = items.at(-1);
  if (firstPaint && state.loaded.messages) {
    firstPaint = false;
    requestAnimationFrame(() => scrollBottom(false));
  } else if (prependedOlder) {
    els.scroll.scrollTop = prevTop + (els.scroll.scrollHeight - prevHeight);
  } else if (ids !== lastIds && lastItem) {
    const newFromMe = lastItem.kind === "msg" && lastItem.from === uid();
    if (wasNear || newFromMe) requestAnimationFrame(() => scrollBottom(true));
    else if (lastIds) els.pill.hidden = false;
  }
  lastIds = ids;
  if (state.view === "chat") markRead();
}

function renderHeader() {
  const p = state.partner;
  const typing = p && isTyping(p.uid);
  const html = `
    <span class="avatar-wrap">${avatarHtml(p || { name: "?" }, "md")}${p ? presenceDot(p.uid) : ""}</span>
    <span class="chat-who-text">
      <b>${esc(partnerName())}</b>
      <small class="${typing ? "typing" : ""}">${typing ? 'typing<span class="tdots sm"><i></i><i></i><i></i></span>' : esc(statusText(p?.uid))}</small>
    </span>`;
  if (els.who.dataset.html !== html) { els.who.innerHTML = html; els.who.dataset.html = html; }
}

function renderSide() {
  const p = state.partner;
  const media = state.messages.filter(m => (m.type === "image" || m.type === "video") && m.media?.url).slice(-12).reverse();
  const html = `
    <div class="side-profile">
      <span class="avatar-wrap">${avatarHtml(p || { name: "?" }, "xl")}${p ? presenceDot(p.uid) : ""}</span>
      <b>${esc(partnerName())}</b>
      <small>${esc(statusText(p?.uid))}</small>
      <div class="side-actions">
        <button class="btn btn-ghost btn-sm" data-action="startCall" data-kind="audio">${ICONS.phone} Audio</button>
        <button class="btn btn-primary btn-sm" data-action="startCall" data-kind="video">${ICONS.video} Video</button>
      </div>
    </div>
    <h4>Shared media</h4>
    ${media.length ? `<div class="side-media">${media.map(m => m.type === "image"
      ? `<button data-view-side="${esc(m.media.url)}"><img src="${esc(cld(m.media.url, "f_auto,q_auto,c_fill,w_240,h_240"))}" alt="" loading="lazy" /></button>`
      : `<button data-scroll-to="${m.id}" class="is-video"><img src="${esc(cld(videoPoster(m.media.url), "c_fill,w_240,h_240"))}" alt="" loading="lazy" /><span>${ICONS.play}</span></button>`).join("")}</div>`
      : '<p class="side-empty">Photos and videos you share will appear here.</p>'}`;
  if (els.side.dataset.html === html) return;
  els.side.innerHTML = html;
  els.side.dataset.html = html;
  $$("[data-view-side]", els.side).forEach(b => b.addEventListener("click", () => viewImage(b.dataset.viewSide)));
  $$("[data-scroll-to]", els.side).forEach(b => b.addEventListener("click", () => {
    rendered.get(b.dataset.scrollTo)?.el.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}

function renderTyping() {
  const p = state.partner;
  const on = !!(p && isTyping(p.uid));
  if (els.typing.hidden === !on) return;
  const wasNear = nearBottom();
  els.typing.hidden = !on;
  $("#typing-name").textContent = on ? `${partnerName()} is typing…` : "";
  if (on && wasNear) scrollBottom(true);
}

function renderPending() {
  els.pending.innerHTML = pending.map(p => `
    <div class="msg-row"><div class="msg me t-${p.type} pending-up">
      <div class="bubble">
        ${p.type === "voice"
          ? `<div class="voice"><span class="v-play">${ICONS.mic}</span><div class="v-body"><div class="v-wave">${waveBars(p.wave, p.lid)}</div><div class="v-info"><span class="v-dur">${fmtDuration(p.duration)}</span></div></div></div>`
          : mediaBox(p, p.type === "image" ? `<img src="${p.previewUrl}" alt="" />` : `<video src="${p.previewUrl}" muted playsinline></video>`)}
        ${p.status === "failed"
          ? `<div class="up-fail">${esc(p.error)} <button data-retry="${p.lid}">${ICONS.retry} Retry</button><button data-drop="${p.lid}">Discard</button></div>`
          : `<div class="up-progress"><div class="progress"><span style="width:${Math.round(p.progress * 100)}%"></span></div><small>Uploading ${Math.round(p.progress * 100)}%</small></div>`}
      </div>
    </div></div>`).join("");
  $$("[data-retry]", els.pending).forEach(b => b.addEventListener("click", () => startUpload(pending.find(p => p.lid === b.dataset.retry))));
  $$("[data-drop]", els.pending).forEach(b => b.addEventListener("click", () => dropPending(b.dataset.drop)));
}

function updatePendingProgress(p) {
  const i = pending.indexOf(p);
  const row = els?.pending.children[i];
  if (!row) return;
  const bar = row.querySelector(".progress span"), label = row.querySelector(".up-progress small");
  if (bar) bar.style.width = `${Math.round(p.progress * 100)}%`;
  if (label) label.textContent = `Uploading ${Math.round(p.progress * 100)}%`;
}

function dropPending(lid) {
  const i = pending.findIndex(p => p.lid === lid);
  if (i < 0) return;
  const [p] = pending.splice(i, 1);
  p.abort?.abort();
  if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
  updateChat();
}

/* ------------------------------------------------------------------ receipts */
export function markDelivered() {
  const mine = state.messages.filter(m => m.to === uid() && !m.deliveredAt && !m.pending && !deliveredAsked.has(m.id));
  if (!mine.length) return;
  const b = writeBatch(db);
  mine.forEach(m => { deliveredAsked.add(m.id); b.update(doc(db, "messages", m.id), { deliveredAt: serverTimestamp() }); });
  b.commit().catch(() => mine.forEach(m => deliveredAsked.delete(m.id)));
}

export function markRead() {
  if (state.view !== "chat" || document.hidden || state.locked) return;
  const unread = state.messages.filter(m => m.to === uid() && !m.readAt && !m.pending && !readAsked.has(m.id));
  if (!unread.length) return;
  const b = writeBatch(db);
  unread.forEach(m => {
    readAsked.add(m.id);
    b.update(doc(db, "messages", m.id), { readAt: serverTimestamp(), ...(m.deliveredAt ? {} : { deliveredAt: serverTimestamp() }) });
  });
  b.commit().catch(() => unread.forEach(m => readAsked.delete(m.id)));
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) markRead(); });

// Called by app.js with each new message from the other person (not the first load)
export function onIncomingMessage() {
  const inChat = state.view === "chat" && !document.hidden && !state.locked;
  if (inChat) return;
  const text = notifText("message", { name: partnerName() });
  ping();
  if (!document.hidden) toast(`💬 ${text}`);
  systemNotify(notifText("title", { name: partnerName() }), text, "message");
}

/* ------------------------------------------------------------------ sending */
async function sendMessage(data) {
  if (!state.partner) { toast("Your person hasn't signed in to Asaumi yet."); throw new Error("no partner"); }
  const ref = await addDoc(collection(db, "messages"), {
    ...data, from: uid(), to: state.partner.uid, createdAt: serverTimestamp()
  });
  pushPartner({ body: notifText("message"), page: "chat", tag: "chat" });
  return ref;
}

let keepKeyboard = false;

function sendText() {
  const text = els.input.value.replace(/\s+$/, "");
  if (!text.trim()) return;
  const keep = keepKeyboard || document.activeElement === els.input;
  keepKeyboard = false;
  els.input.value = "";
  autosize();
  syncSendButton();
  if (keep) els.input.focus({ preventScroll: true }); // keyboard stays open until the user closes it
  typingStop();
  const reply = takeReply();
  sendMessage({ type: "text", text, ...(reply ? { replyTo: reply } : {}) }).catch(err => {
    if (err.message !== "no partner") toast(friendlyError(err, "Message couldn't be sent. Please try again."));
    els.input.value = text;
    autosize();
    syncSendButton();
  });
  requestAnimationFrame(() => scrollBottom(true));
}

function sendSticker({ url, kind }) {
  if (!url) return;
  const reply = takeReply();
  sendMessage({ type: "sticker", text: "", media: { url, kind }, ...(reply ? { replyTo: reply } : {}) })
    .catch(err => { if (err.message !== "no partner") toast(friendlyError(err, "Sticker couldn't be sent.")); });
  navigator.vibrate?.(10);
  requestAnimationFrame(() => scrollBottom(true));
}

async function startUpload(p) {
  if (!p) return;
  p.status = "uploading";
  p.progress = 0;
  p.abort = new AbortController();
  updateChat();
  requestAnimationFrame(() => scrollBottom(true));
  try {
    const file = p.type === "image" ? await prepareImage(p.file) : p.file;
    const up = await upload(file, {
      sub: "chat", signal: p.abort.signal,
      onProgress: v => { p.progress = v; updatePendingProgress(p); }
    });
    const media = {
      url: up.secure_url, publicId: up.public_id, resourceType: up.resource_type,
      width: up.width || p.width || null, height: up.height || p.height || null,
      format: up.format || null, bytes: up.bytes || null
    };
    if (p.type === "voice") Object.assign(media, { duration: p.duration, wave: p.wave });
    if (p.type === "video") media.duration = up.duration || null;
    await sendMessage({ type: p.type, text: p.caption || "", media, ...(p.replyTo ? { replyTo: p.replyTo } : {}) });
    dropPending(p.lid);
  } catch (err) {
    if (err.aborted) return;
    p.status = "failed";
    p.error = friendlyError(err, "Upload failed.");
    updateChat();
  }
}

function queueUpload(p) {
  p.lid = `l${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  p.replyTo = takeReply();
  pending.push(p);
  startUpload(p);
}

/* ------------------------------------------------------------------ media preview before send */
function previewMedia(file) {
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  if (!isVideo && !isImage) { toast("Please choose a photo or a video."); return; }
  const maxMB = isVideo ? LIMITS.videoMB : LIMITS.imageMB * 3; // images are compressed before upload
  if (file.size > maxMB * 1024 * 1024) { toast(`That ${isVideo ? "video" : "photo"} is larger than ${maxMB} MB.`); return; }
  const url = URL.createObjectURL(file);
  let sent = false;
  const m = openModal(`
    <h2>Selected media</h2>
    <div class="media-preview">${isVideo ? `<video src="${url}" controls playsinline></video>` : `<img src="${url}" alt="" />`}</div>
    <p class="file-note">${esc(file.name || (isVideo ? "Video" : "Photo"))} · ${(file.size / 1048576).toFixed(1)} MB</p>
    <label class="field"><input type="text" maxlength="500" placeholder="Add a caption (optional)" /></label>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-send>${ICONS.send} Send</button>
    </div>`);
  m.onclose = () => { if (!sent) URL.revokeObjectURL(url); };
  const mediaEl = $(".media-preview > *", m);
  const dims = {};
  mediaEl.addEventListener(isVideo ? "loadedmetadata" : "load", () => {
    dims.width = isVideo ? mediaEl.videoWidth : mediaEl.naturalWidth;
    dims.height = isVideo ? mediaEl.videoHeight : mediaEl.naturalHeight;
  });
  $("[data-send]", m).addEventListener("click", () => {
    if (!state.partner) { toast("Your person hasn't signed in to Asaumi yet."); return; }
    sent = true;
    queueUpload({ type: isVideo ? "video" : "image", file, previewUrl: url, caption: $("input", m).value.trim(), ...dims });
    m.close();
  });
}

/* ------------------------------------------------------------------ voice recording */
const rec = { stream: null, recorder: null, chunks: [], start: 0, timer: 0, levels: [], analyser: null, blob: null, duration: 0, wave: [], audio: null };

function pickMime() {
  const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
  return types.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

async function startRecording() {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) { toast("Voice messages aren't supported in this browser."); return; }
  if (!state.partner) { toast("Your person hasn't signed in to Asaumi yet."); return; }
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    toast(err.name === "NotAllowedError" ? "Microphone permission denied. Allow it in your browser settings." : friendlyError(err, "Couldn't start the microphone."));
    return;
  }
  const mime = pickMime();
  rec.recorder = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined);
  rec.chunks = [];
  rec.levels = [];
  rec.recorder.ondataavailable = e => e.data.size && rec.chunks.push(e.data);
  rec.recorder.onstop = onRecordingStopped;
  rec.recorder.start(250);
  rec.start = Date.now();

  const ctx = audioCtx();
  if (ctx) {
    const src = ctx.createMediaStreamSource(rec.stream);
    rec.analyser = ctx.createAnalyser();
    rec.analyser.fftSize = 512;
    src.connect(rec.analyser);
  }
  const buf = new Uint8Array(512);
  const waveEl = $("#rec-wave");
  waveEl.innerHTML = "";
  rec.timer = setInterval(() => {
    const secs = (Date.now() - rec.start) / 1000;
    $("#rec-time").textContent = fmtDuration(secs);
    let level = 0.3;
    if (rec.analyser) {
      rec.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    }
    rec.levels.push(level);
    waveEl.innerHTML = rec.levels.slice(-40).map(v => `<i style="height:${Math.round(12 + v * 88)}%"></i>`).join("");
    if (secs >= LIMITS.voiceSeconds) stopRecording();
  }, 100);
  setComposerMode("rec");
}

function stopRecording(discard = false) {
  clearInterval(rec.timer);
  rec.discard = discard;
  rec.duration = (Date.now() - rec.start) / 1000;
  if (rec.recorder?.state !== "inactive") rec.recorder?.stop();
  rec.stream?.getTracks().forEach(t => t.stop());
  rec.analyser = null;
  if (discard) setComposerMode("text");
}

function downsample(levels, n = 32) {
  if (!levels.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * levels.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n));
    const slice = levels.slice(a, b);
    out.push(slice.reduce((x, y) => x + y, 0) / slice.length);
  }
  const max = Math.max(...out, 0.01);
  return out.map(v => Math.round((v / max) * 100) / 100);
}

function onRecordingStopped() {
  if (rec.discard || rec.duration < 0.8) {
    if (!rec.discard) toast("Hold on a little longer to record a message.");
    setComposerMode("text");
    return;
  }
  const type = rec.recorder.mimeType || rec.chunks[0]?.type || "audio/webm";
  rec.blob = new Blob(rec.chunks, { type });
  rec.wave = downsample(rec.levels);
  $("#pv-wave").innerHTML = waveBars(rec.wave);
  $("#pv-time").textContent = fmtDuration(rec.duration);
  rec.audio?.pause();
  rec.audio = new Audio(URL.createObjectURL(rec.blob));
  rec.audio.onended = () => { $("#pv-play").innerHTML = ICONS.play; };
  rec.audio.ontimeupdate = () => {
    $("#pv-time").textContent = fmtDuration(rec.audio.currentTime);
    const p = rec.audio.currentTime / (rec.duration || 1);
    $$("#pv-wave i").forEach((b, i, all) => b.classList.toggle("on", i / all.length < p));
  };
  setComposerMode("preview");
}

function clearPreview() {
  rec.audio?.pause();
  if (rec.audio) URL.revokeObjectURL(rec.audio.src);
  rec.audio = null;
  rec.blob = null;
  setComposerMode("text");
}

function sendVoice() {
  if (!rec.blob) return;
  const ext = rec.blob.type.includes("mp4") ? "m4a" : rec.blob.type.includes("ogg") ? "ogg" : "webm";
  const file = new File([rec.blob], `voice-${Date.now()}.${ext}`, { type: rec.blob.type });
  queueUpload({ type: "voice", file, duration: rec.duration, wave: rec.wave });
  rec.blob = null;
  rec.audio?.pause();
  rec.audio = null;
  setComposerMode("text");
}

function setComposerMode(mode) {
  els.composer.dataset.mode = mode;
  if (mode === "text") syncSendButton();
}

/* ------------------------------------------------------------------ voice playback */
const player = { audio: new Audio(), id: null };
player.audio.preload = "none";

function voiceEls(id) { return $$(`[data-voice="${id}"]`); }

function paintVoice() {
  const { audio, id } = player;
  if (!id) return;
  const m = state.messages.find(x => x.id === id);
  const total = m?.media?.duration || audio.duration || 1;
  const p = Math.min(1, audio.currentTime / total);
  voiceEls(id).forEach(el => {
    el.classList.toggle("playing", !audio.paused);
    $(".v-play", el).innerHTML = audio.paused ? ICONS.play : ICONS.pause;
    $$(".v-wave i", el).forEach((b, i, all) => b.classList.toggle("on", i / all.length < p));
    $(".v-dur", el).textContent = fmtDuration(audio.paused && audio.currentTime === 0 ? total : audio.currentTime);
  });
}

["play", "pause", "timeupdate"].forEach(ev => player.audio.addEventListener(ev, paintVoice));
player.audio.addEventListener("ended", () => { player.audio.currentTime = 0; paintVoice(); });
player.audio.addEventListener("error", () => { if (player.id) toast("Couldn't play this voice message."); });

actions.playVoice = d => {
  const m = state.messages.find(x => x.id === d.id);
  if (!m?.media?.url) return;
  const { audio } = player;
  if (player.id === d.id) {
    audio.paused ? audio.play().catch(() => toast("Couldn't play this voice message.")) : audio.pause();
    return;
  }
  if (player.id) { const old = player.id; player.id = null; voiceEls(old).forEach(el => { el.classList.remove("playing"); $(".v-play", el).innerHTML = ICONS.play; $$(".v-wave i", el).forEach(b => b.classList.remove("on")); }); }
  player.id = d.id;
  audio.src = audioUrl(m.media.url);
  audio.play().catch(() => toast("Couldn't play this voice message."));
};

/* ------------------------------------------------------------------ composer wiring */
function autosize() {
  const t = els.input;
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
}

function syncSendButton() {
  const has = !!els.input.value.trim();
  els.send.innerHTML = has ? ICONS.send : ICONS.mic;
  els.send.setAttribute("aria-label", has ? "Send" : "Record voice");
  els.send.classList.toggle("is-send", has);
  els.composer.classList.toggle("typing", has); // hide the camera while typing, like WhatsApp
}

function bindComposer() {
  els.input.addEventListener("input", () => {
    autosize();
    syncSendButton();
    if (els.input.value.trim()) typingPing(); else typingStop();
  });
  els.input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.isComposing) { e.preventDefault(); sendText(); }
  });
  els.input.addEventListener("blur", () => typingStop());
  // Keep the keyboard open after sending: the Send button must not take focus away from the text box
  els.send.addEventListener("pointerdown", () => { keepKeyboard = document.activeElement === els.input; });
  els.send.addEventListener("mousedown", e => { if (els.input.value.trim()) e.preventDefault(); });
  els.send.addEventListener("click", () => (els.input.value.trim() ? sendText() : startRecording()));
  $("#c-emoji").addEventListener("click", () => { els.emoji.hidden = !els.emoji.hidden; });
  els.emoji.addEventListener("click", e => {
    const b = e.target.closest("[data-emoji]");
    if (!b) return;
    const t = els.input, s = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, s) + b.dataset.emoji + t.value.slice(t.selectionEnd ?? s);
    t.selectionStart = t.selectionEnd = s + b.dataset.emoji.length;
    autosize();
    syncSendButton();
    if (!coarse) t.focus();
  });
  bindStickerPanel(els.emoji, sendSticker);

  // Camera: take a photo or record a video, then the usual preview → Send
  $("#c-camera").addEventListener("click", () => {
    const m = openModal(`
      <div class="msg-menu">
        <button data-cam="photo">${ICONS.camera}<span>Take photo</span></button>
        <button data-cam="video">${ICONS.video}<span>Record video</span></button>
      </div>
      <button class="btn btn-ghost btn-block" data-close>Cancel</button>`, { cls: "action-sheet" });
    m.querySelector(".msg-menu").addEventListener("click", e => {
      const b = e.target.closest("[data-cam]");
      if (!b) return;
      $(b.dataset.cam === "video" ? "#c-cam-video" : "#c-cam-photo").click(); // opens the camera app
      m.close();
    });
  });
  ["#c-cam-photo", "#c-cam-video"].forEach(sel => $(sel).addEventListener("change", e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) previewMedia(f);
  }));
  $("#c-file").addEventListener("change", e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) previewMedia(f);
  });
  $("#rec-stop").addEventListener("click", () => stopRecording(false));
  $("#rec-cancel").addEventListener("click", () => stopRecording(true));
  $("#pv-discard").addEventListener("click", clearPreview);
  $("#pv-send").addEventListener("click", sendVoice);
  $("#pv-play").addEventListener("click", () => {
    const a = rec.audio;
    if (!a) return;
    if (a.paused) { a.play(); $("#pv-play").innerHTML = ICONS.pause; } else { a.pause(); $("#pv-play").innerHTML = ICONS.play; }
  });
}

/* ------------------------------------------------------------------ reply (swipe right, or long-press → Reply) */
let replyTo = null;          // { id, from, type, text } of the message being replied to
let suppressClickUntil = 0;  // swallow the click that follows a swipe / long-press
let lastMenuAt = 0;

function previewOf(m) {
  const t = (m.text || "").replace(/\s+/g, " ").trim();
  const s = {
    image: t ? `📷 ${t}` : "📷 Photo",
    video: t ? `🎬 ${t}` : "🎬 Video",
    voice: `🎤 Voice message (${fmtDuration(m.media?.duration)})`,
    sticker: "🎨 Sticker"
  }[m.type] || t;
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

function quoteHtml(r) {
  if (!r) return "";
  return `<button type="button" class="quote" data-jump="${esc(r.id)}">
      <b>${esc(r.from === uid() ? "You" : realNameOf(r.from))}</b><span>${esc(r.text || "Message")}</span>
    </button>`;
}

function setReply(id) {
  const m = state.messages.find(x => x.id === id);
  if (!m || !els) return;
  replyTo = { id: m.id, from: m.from, type: m.type, text: previewOf(m) };
  $("#rb-name").textContent = m.from === uid() ? "Replying to yourself" : `Replying to ${realNameOf(m.from)}`;
  $("#rb-text").textContent = replyTo.text;
  els.replyBar.hidden = false;
  if (els.composer.dataset.mode === "text") els.input.focus();
}

function clearReply() {
  replyTo = null;
  if (els) els.replyBar.hidden = true;
}

function takeReply() {
  const r = replyTo;
  clearReply();
  return r;
}

function jumpTo(id) {
  const r = rendered.get(id);
  if (!r) { toast("That message is further up. Tap “Load earlier messages”."); return; }
  r.el.scrollIntoView({ behavior: "smooth", block: "center" });
  r.el.classList.remove("flash");
  void r.el.offsetWidth;
  r.el.classList.add("flash");
}

// Drag a message to the right to reply; hold it to open the menu.
function bindSwipe() {
  let g = null;
  const list = els.list;
  const reset = () => { if (g) clearTimeout(g.timer); g = null; };

  list.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const row = e.target.closest('.msg-row[data-kind="msg"]');
    if (!row || e.target.closest("video, a, .v-play, .quote, .to-mem")) return;
    g = { row, msg: row.querySelector(".msg"), x: e.clientX, y: e.clientY, dx: 0, horizontal: null, id: e.pointerId };
    g.timer = setTimeout(() => {
      if (!g || g.horizontal) return;
      const id = g.row.dataset.id;
      reset();
      suppressClickUntil = Date.now() + 500;
      navigator.vibrate?.(20);
      openMessageMenu(id);
    }, 550);
  });

  list.addEventListener("pointermove", e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (g.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      clearTimeout(g.timer);
      g.horizontal = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2;
      if (!g.horizontal) { g = null; return; }
      try { g.row.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    g.dx = Math.max(0, dx);
    const shift = g.dx < 70 ? g.dx : 70 + (g.dx - 70) * 0.25;
    g.msg.style.transform = `translateX(${shift}px)`;
    g.msg.style.setProperty("--swipe", Math.min(1, g.dx / 60));
    const ready = g.dx > 60;
    if (ready && !g.buzzed) navigator.vibrate?.(10);
    g.buzzed = ready;
    g.msg.classList.toggle("swipe-ready", ready);
  });

  const end = () => {
    if (!g) return;
    const { msg, row, dx, horizontal } = g;
    reset();
    if (!horizontal) return;
    suppressClickUntil = Date.now() + 300;
    msg.style.transition = "transform .22s ease";
    msg.style.transform = "";
    msg.style.removeProperty("--swipe");
    msg.classList.remove("swipe-ready");
    setTimeout(() => { msg.style.transition = ""; }, 240);
    if (dx > 60) setReply(row.dataset.id);
  };
  list.addEventListener("pointerup", end);
  list.addEventListener("pointercancel", end);
}

function copyText(text) {
  const done = () => toast("Copied");
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(done).catch(fallback); return; }
  fallback();
  function fallback() {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(t);
    t.select();
    try { document.execCommand("copy"); done(); } catch { toast("Couldn't copy."); }
    t.remove();
  }
}

function editMessage(m) {
  const isText = m.type === "text";
  const modal = openModal(`
    <h2>${isText ? "Edit message" : "Edit caption"}</h2>
    <label class="field"><textarea maxlength="4000" placeholder="${isText ? "Message…" : "Caption (optional)"}">${esc(m.text || "")}</textarea></label>
    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>Save</button>
    </div>`);
  const t = $("textarea", modal), err = $(".form-error", modal), save = $("[data-save]", modal);
  setTimeout(() => { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, 60);
  save.addEventListener("click", async () => {
    const text = t.value.replace(/\s+$/, "");
    if (isText && !text.trim()) { err.textContent = "Message can't be empty. Use Delete to remove it."; return; }
    if (text === (m.text || "")) { modal.close(); return; }
    save.disabled = true;
    try {
      await updateDoc(doc(db, "messages", m.id), { text, editedAt: serverTimestamp() });
      modal.close();
    } catch (e) {
      err.textContent = friendlyError(e, "Couldn't edit the message.");
      save.disabled = false;
    }
  });
}

function openMessageMenu(id) {
  if (Date.now() - lastMenuAt < 800) return;
  lastMenuAt = Date.now();
  const m = state.messages.find(x => x.id === id);
  if (!m) return;
  const mine = m.from === uid();
  const modal = openModal(`
    <div class="menu-preview">${esc(previewOf(m) || "Message")}</div>
    <div class="msg-menu">
      <button data-m="reply">${ICONS.reply}<span>Reply</span></button>
      ${(m.type === "image" || m.type === "sticker") && m.media?.url ? `<button data-m="sticker">${ICONS.sparkle}<span>Save as sticker</span></button>` : ""}
      ${mine && m.type !== "voice" && m.type !== "sticker" ? `<button data-m="edit">${ICONS.pencil}<span>${m.type === "text" ? "Edit" : m.text ? "Edit caption" : "Add caption"}</span></button>` : ""}
      ${m.text ? `<button data-m="copy">${ICONS.copy}<span>Copy text</span></button>` : ""}
      ${mine ? `<button data-m="delete" class="danger">${ICONS.trash}<span>Delete for both</span></button>` : ""}
    </div>
    <button class="btn btn-ghost btn-block" data-close>Cancel</button>`, { cls: "action-sheet" });
  modal.querySelector(".msg-menu").addEventListener("click", async e => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    modal.close();
    if (b.dataset.m === "reply") setReply(id);
    else if (b.dataset.m === "edit") editMessage(m);
    else if (b.dataset.m === "sticker") saveAsSticker(m.media.url);
    else if (b.dataset.m === "copy") copyText(m.text);
    else if (b.dataset.m === "delete") {
      const ok = await confirmDialog({ icon: "trash", title: "Delete message?", text: "It will be removed for both of you.", ok: "Delete", danger: true });
      if (ok) deleteDoc(doc(db, "messages", id)).catch(err => toast(friendlyError(err, "Couldn't delete the message.")));
    }
  });
}

/* ------------------------------------------------------------------ view */
views.chat = {
  render: () => updateChat(),
  enter() {
    firstPaint = true;
    lastIds = "";
    updateChat();
    requestAnimationFrame(() => scrollBottom(false));
    markRead();
  },
  leave() {
    typingStop();
    els.emoji.hidden = true;
    if (els.composer.dataset.mode === "rec") stopRecording(true);
  }
};

export function resetChat() {
  pending.splice(0).forEach(p => p.abort?.abort());
  deliveredAsked.clear();
  readAsked.clear();
  player.audio.pause();
  player.id = null;
  rendered.clear();
  els = null;
  $("#chat-view").innerHTML = "";
}
