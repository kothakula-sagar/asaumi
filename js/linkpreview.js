// Link previews in chat. The first link in a message gets a card under the text.
//  • YouTube / Vimeo: thumbnail + title + play button → plays inside the card when tapped
//  • Instagram, Spotify, TikTok, Facebook video: embedded player, loaded only when tapped
//  • Direct .mp4 / .jpg links: the video or picture itself
//  • Anything else: title, picture, site and description from Microlink (free), tap to open
// Each phone builds its own card; nothing extra is stored in Firestore.
import { esc } from "./core.js";
import { openInApp, openExternal } from "./native.js";

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;
const meta = new Map();     // url → { title, description, image, site }
const loading = new Set();

export function firstUrl(text = "") {
  const m = URL_RE.exec(text);
  return m ? m[0].replace(/[),.!?;:'"\]]+$/, "") : null;
}

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\.|^m\./, ""); } catch { return ""; } };
const keyOf = u => { let h = 7; for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) | 0; return `lp${(h >>> 0).toString(36)}`; };

/* ------------------------------------------------------------------ what kind of link is it? */
export function classify(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const path = u.pathname;
  let m;
  if (host === "youtu.be" && (m = path.match(/^\/([\w-]{6,})/))) return { kind: "youtube", id: m[1] };
  if (/(^|\.)youtube\.com$/.test(host)) {
    if (u.searchParams.get("v")) return { kind: "youtube", id: u.searchParams.get("v") };
    if ((m = path.match(/^\/(shorts|embed|live)\/([\w-]{6,})/))) return { kind: "youtube", id: m[2], vertical: m[1] === "shorts" };
  }
  if (host === "instagram.com" && (m = path.match(/^\/(p|reel|reels|tv)\/([\w-]+)/))) return { kind: "instagram", type: m[1] === "reels" ? "reel" : m[1], id: m[2] };
  if (host === "vimeo.com" && (m = path.match(/^\/(\d+)/))) return { kind: "vimeo", id: m[1] };
  if (host === "open.spotify.com" && (m = path.match(/^\/(?:intl-\w+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/))) return { kind: "spotify", type: m[1], id: m[2] };
  if (/(^|\.)tiktok\.com$/.test(host) && (m = path.match(/\/video\/(\d+)/))) return { kind: "tiktok", id: m[1] };
  if ((host === "facebook.com" && /\/(videos|watch|reel)/.test(path + u.search)) || host === "fb.watch") return { kind: "facebook" };
  if (/\.(mp4|webm|mov|m4v)$/i.test(path)) return { kind: "video" };
  if (/\.(jpe?g|png|gif|webp|avif)$/i.test(path)) return { kind: "image" };
  return { kind: "web" };
}

/* ------------------------------------------------------------------ the card */
const PLAY = '<span class="lp-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg></span>';
const LABELS = { youtube: "YouTube", instagram: "Instagram", vimeo: "Vimeo", spotify: "Spotify", tiktok: "TikTok", facebook: "Facebook" };

export function linkPreviewHtml(text) {
  const url = firstUrl(text);
  if (!url) return "";
  const c = classify(url);
  if (!c) return "";
  const key = keyOf(url);
  const md = meta.get(url);
  const site = hostOf(url);
  const open = `<button type="button" class="lp-open" data-lp-open="${esc(url)}">Open ↗</button>`;
  const info = (title, sub) => `
    <div class="lp-info">
      <b class="lp-title" data-lp-title>${esc(title)}</b>
      <small class="lp-site">${esc(sub)}</small>
    </div>`;

  if (c.kind === "video") {
    return `<div class="lp lp-file" data-lp="${key}"><video src="${esc(url)}" controls playsinline preload="none"></video>${info(site, "Video")}${open}</div>`;
  }
  if (c.kind === "image") {
    return `<div class="lp lp-file" data-lp="${key}"><img src="${esc(url)}" alt="" loading="lazy" data-view-img="${esc(url)}" />${open}</div>`;
  }
  if (c.kind === "web") {
    if (!md) fetchMeta(url, c);
    return `
      <div class="lp lp-web" data-lp="${key}" data-lp-link="${esc(url)}">
        <div class="lp-thumb" data-lp-img ${md?.image ? "" : "hidden"}>${md?.image ? `<img src="${esc(md.image)}" alt="" loading="lazy" />` : ""}</div>
        <div class="lp-info">
          <b class="lp-title" data-lp-title>${esc(md?.title || site)}</b>
          <small class="lp-desc" data-lp-desc>${esc(md?.description || "")}</small>
          <small class="lp-site">${esc(md?.site || site)}</small>
        </div>
      </div>`;
  }

  // players: YouTube / Vimeo have a thumbnail, the rest a branded placeholder. Nothing loads until tapped.
  if ((c.kind === "youtube" || c.kind === "vimeo") && !md) fetchMeta(url, c);
  const thumb = c.kind === "youtube" ? `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg` : md?.image || "";
  const media = thumb
    ? `<img src="${esc(thumb)}" alt="" loading="lazy" data-lp-thumb />`
    : `<span class="lp-brand">${{ instagram: "📸", spotify: "🎧", tiktok: "🎵", facebook: "📘", vimeo: "🎬" }[c.kind] || "▶"}<small>Tap to view</small></span>`;
  return `
    <div class="lp lp-player lp-${c.kind} ${c.vertical ? "vertical" : ""}" data-lp="${key}">
      <button type="button" class="lp-media" data-lp-play="${esc(url)}">${media}${PLAY}</button>
      ${info(md?.title || LABELS[c.kind], site)}
      ${open}
    </div>`;
}

/* ------------------------------------------------------------------ metadata (free services) */
function cacheGet(url) {
  try { const v = JSON.parse(localStorage.getItem(`asaumi.lp.${url}`) || "null"); return v && Date.now() - v.at < 7 * 864e5 ? v.md : null; } catch { return null; }
}
function cacheSet(url, md) {
  try { localStorage.setItem(`asaumi.lp.${url}`, JSON.stringify({ at: Date.now(), md })); } catch { /* storage full: ignore */ }
}

async function fetchMeta(url, c) {
  if (meta.has(url) || loading.has(url)) return;
  const cached = cacheGet(url);
  if (cached) { meta.set(url, cached); queueMicrotask(() => paint(url)); return; }
  loading.add(url);
  let md = null;
  try {
    if (c.kind === "youtube") {
      const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${c.id}`)}`);
      const j = await r.json();
      if (j?.title) md = { title: j.title, site: j.author_name ? `YouTube · ${j.author_name}` : "YouTube" };
    } else if (c.kind === "vimeo") {
      const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (j?.title) md = { title: j.title, image: j.thumbnail_url, site: "Vimeo" };
    } else {
      const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      const d = j?.status === "success" ? j.data : null;
      if (d) md = { title: d.title || hostOf(url), description: d.description || "", image: d.image?.url || d.logo?.url || "", site: d.publisher || hostOf(url) };
    }
  } catch (err) {
    console.warn("[asaumi] link preview", err);
  }
  loading.delete(url);
  md = md || { title: hostOf(url), site: hostOf(url) };
  meta.set(url, md);
  cacheSet(url, md);
  paint(url);
}

// fill in cards that are already on screen
function paint(url) {
  const md = meta.get(url);
  document.querySelectorAll(`[data-lp="${keyOf(url)}"]`).forEach(card => {
    const t = card.querySelector("[data-lp-title]");
    if (t && md.title) t.textContent = md.title;
    const d = card.querySelector("[data-lp-desc]");
    if (d) d.textContent = md.description || "";
    const site = card.querySelector(".lp-site");
    if (site && md.site) site.textContent = md.site;
    const box = card.querySelector("[data-lp-img]");
    if (box && md.image) { box.hidden = false; box.innerHTML = `<img src="${esc(md.image)}" alt="" loading="lazy" />`; }
    const btn = card.querySelector(".lp-media");
    if (btn && md.image && !btn.querySelector("img")) btn.innerHTML = `<img src="${esc(md.image)}" alt="" loading="lazy" data-lp-thumb />${PLAY}`;
  });
}

/* ------------------------------------------------------------------ tap to play */
function embedSrc(url) {
  const c = classify(url);
  const origin = encodeURIComponent(location.origin);
  switch (c?.kind) {
    // origin + referrer policy: avoids YouTube's "error 153" inside app WebViews
    case "youtube": return { src: `https://www.youtube.com/embed/${c.id}?autoplay=1&playsinline=1&rel=0&modestbranding=1&origin=${origin}&widget_referrer=${origin}`, ratio: c.vertical ? "9 / 16" : "16 / 9" };
    case "vimeo": return { src: `https://player.vimeo.com/video/${c.id}?autoplay=1&playsinline=1`, ratio: "16 / 9" };
    case "instagram": return { src: `https://www.instagram.com/${c.type === "reel" ? "reel" : c.type}/${c.id}/embed/`, height: 560 };
    case "spotify": return { src: `https://open.spotify.com/embed/${c.type}/${c.id}`, height: ["track", "episode"].includes(c.type) ? 152 : 352 };
    case "tiktok": return { src: `https://www.tiktok.com/embed/v2/${c.id}`, height: 580 };
    case "facebook": return { src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false`, ratio: "16 / 9" };
    default: return null;
  }
}

function play(btn, url) {
  const e = embedSrc(url);
  if (!e) { openLink(url); return; }
  const frame = document.createElement("div");
  frame.className = "lp-frame";
  if (e.ratio) frame.style.aspectRatio = e.ratio; else frame.style.height = `${e.height}px`;
  frame.innerHTML = `<iframe src="${esc(e.src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="eager"></iframe>`;
  btn.replaceWith(frame);
}

function openLink(url) {
  if (/youtu\.?be|instagram\.com|spotify\.com|tiktok\.com|facebook\.com|fb\.watch/.test(url)) openInApp(url);
  else openExternal(url);
}

// Called from the chat's click handler. Returns true if it handled the click.
export function handleLinkClick(e) {
  const playBtn = e.target.closest("[data-lp-play]");
  if (playBtn) { play(playBtn, playBtn.dataset.lpPlay); return true; }
  const open = e.target.closest("[data-lp-open]");
  if (open) { openLink(open.dataset.lpOpen); return true; }
  const card = e.target.closest("[data-lp-link]");
  if (card) { openLink(card.dataset.lpLink); return true; }
  const a = e.target.closest(".msg-text a[href]");
  if (a) { e.preventDefault(); openLink(a.href); return true; }
  return false;
}
