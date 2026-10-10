// 🔍 Chat search. Runs only on the chat saved on this phone (chatstore.js), so it costs no Firebase reads
// and works with end-to-end encryption (Firebase only has scrambled text; the phone has the readable copy).
// Searches text messages, photo/video captions; all words must match, upper/lower case doesn't matter.
import { state, uid, esc, ICONS, openModal, partnerName, toDate, fmtTime, dayLabel, actions, hooks, $ } from "./core.js";
import { exportArchive } from "./chatstore.js";
import { isEnc } from "./e2ee.js";

const MAX_RESULTS = 200;
const KIND = { image: "📷 ", video: "🎬 " };

// everything searchable: saved chat + live messages, newest first
async function loadAll() {
  const byId = new Map();
  try { (await exportArchive()).forEach(m => byId.set(m.id, m)); } catch (err) { console.warn("[asaumi] search", err); }
  state.messages.forEach(m => { if (!m.locked) byId.set(m.id, m); });
  return [...byId.values()]
    .filter(m => typeof m.text === "string" && m.text.trim() && !isEnc(m.text) && ["text", "image", "video"].includes(m.type))
    .map(m => ({
      id: m.id, from: m.from, type: m.type, text: m.text,
      low: m.text.toLowerCase(),
      at: typeof m.createdAt === "number" ? m.createdAt : toDate(m.createdAt)?.getTime() || 0
    }))
    .sort((a, b) => b.at - a.at);
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// a short piece of the message around the first match, with every match highlighted
function snippet(text, terms) {
  const low = text.toLowerCase();
  const first = Math.min(...terms.map(t => low.indexOf(t)).filter(i => i >= 0));
  let start = 0, end = text.length;
  if (text.length > 150) {
    start = Math.max(0, first - 50);
    end = Math.min(text.length, start + 150);
  }
  const part = text.slice(start, end);
  const re = new RegExp(terms.map(escRe).sort((a, b) => b.length - a.length).join("|"), "gi");
  let out = "", last = 0, m;
  while ((m = re.exec(part))) {
    if (!m[0]) { re.lastIndex++; continue; }
    out += esc(part.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  out += esc(part.slice(last));
  return `${start > 0 ? "…" : ""}${out}${end < text.length ? "…" : ""}`;
}

function openSearch() {
  let all = null, who = "all", timer = 0;
  const m = openModal(`
    <div class="sr-head">
      <span class="sr-ico">${ICONS.search}</span>
      <input type="search" class="sr-input" placeholder="Search your chat…" autocomplete="off" enterkeyhint="search" />
      <button class="icon-btn sm ghost" data-close aria-label="Close">${ICONS.close}</button>
    </div>
    <div class="ph-chips sr-chips">
      <button class="ph-chip on" data-who="all">All</button>
      <button class="ph-chip" data-who="me">From you</button>
      <button class="ph-chip" data-who="them">From ${esc(partnerName())}</button>
    </div>
    <p class="sr-count small muted"></p>
    <div class="sr-list"><div class="loading-block">Opening your chat…</div></div>`, { cls: "search-sheet" });
  const input = $(".sr-input", m), list = $(".sr-list", m), count = $(".sr-count", m);
  setTimeout(() => input.focus(), 80);

  const run = () => {
    if (!all) return;
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      count.textContent = "";
      list.innerHTML = `<div class="empty-mini"><span class="big">🔍</span><b>Search ${all.length.toLocaleString()} messages</b><p>Only on this phone. Nothing is sent anywhere.</p></div>`;
      return;
    }
    const me = uid();
    const hits = [];
    for (const x of all) {
      if (who === "me" ? x.from !== me : who === "them" ? x.from === me : false) continue;
      if (terms.every(t => x.low.includes(t))) { hits.push(x); if (hits.length >= MAX_RESULTS) break; }
    }
    count.textContent = hits.length ? `${hits.length >= MAX_RESULTS ? `${MAX_RESULTS}+` : hits.length} result${hits.length === 1 ? "" : "s"}` : "";
    list.innerHTML = hits.length ? hits.map(x => {
      const d = new Date(x.at);
      return `
        <button class="sr-row" data-id="${esc(x.id)}">
          <span class="sr-meta"><b>${esc(x.from === me ? "You" : partnerName())}</b><small>${esc(dayLabel(d))} · ${esc(fmtTime(d))}</small></span>
          <span class="sr-text">${KIND[x.type] || ""}${snippet(x.text, terms)}</span>
        </button>`;
    }).join("") : `<div class="empty-mini"><span class="big">🫥</span><b>No messages found</b><p>Try another word.</p></div>`;
  };

  loadAll().then(list => { all = list; run(); });
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 140); });
  m.querySelector(".sr-chips").addEventListener("click", e => {
    const b = e.target.closest("[data-who]");
    if (!b) return;
    who = b.dataset.who;
    m.querySelectorAll("[data-who]").forEach(x => x.classList.toggle("on", x === b));
    run();
  });
  list.addEventListener("click", e => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    m.close();
    if (state.view !== "chat") hooks.go("chat");
    setTimeout(() => actions.revealMessage?.(row.dataset.id), 260);
  });
}

actions.openChatSearch = openSearch;
