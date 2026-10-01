// Stickers for the chat:
//  ✨ animated pack: Google's free Noto animated emoji (CC BY 4.0), loaded straight from Google's CDN
//  ⭐ "Our stickers": a shared pack the two of you build (gallery pictures, or "Save as sticker" from the chat)
import {
  collection, doc, addDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, state, uid, myName, esc, ICONS, toast, upload, confirmDialog, friendlyError, $, $$ } from "./core.js";

const ANIMATED = [
  "1f970", "1f60d", "1f618", "1f617", "1f917", "1fac2", "1f60a", "1f607",
  "1f602", "1f923", "1f606", "1f61c", "1f929", "1f60e", "1f973", "1f634",
  "1f97a", "1f622", "1f62d", "1f625", "1f633", "1f92d", "1f914", "1f644",
  "1f620", "1f621", "1f971", "1f924", "2764_fe0f", "1f496", "1f495", "1f49e",
  "1f498", "1f48b", "1f339", "1f490", "1f382", "1f389", "1f388", "1f381",
  "2728", "1f525", "1f44d", "1f44f", "1f64f", "1f44b", "1f4af", "2615"
];
export const animatedUrl = code => `https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/512.webp`;
const animatedThumb = code => `https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/emoji.svg`;

/* ------------------------------------------------------------------ panel */
export function stickerPanes() {
  return `
    <div class="ep-pane stickers" data-pane="anim" hidden>
      ${ANIMATED.map(c => `
        <button type="button" class="st-tile" data-sticker="${animatedUrl(c)}" data-kind="animated" aria-label="Sticker">
          <img src="${animatedThumb(c)}" alt="" loading="lazy" onerror="this.closest('button').remove()" />
        </button>`).join("")}
      <small class="st-credit">Animated stickers: Google Noto Emoji (CC BY 4.0)</small>
    </div>
    <div class="ep-pane stickers" data-pane="ours" hidden></div>`;
}

export function renderOurStickers() {
  const pane = $('#emoji-panel [data-pane="ours"]');
  if (!pane) return;
  const list = state.stickers || [];
  const html = `
    <label class="st-tile st-add" aria-label="Add a sticker">${ICONS.plus}<span>Add</span><input type="file" accept="image/*" hidden data-sticker-file /></label>
    ${list.map(s => `
      <button type="button" class="st-tile" data-sticker="${esc(s.url)}" data-kind="custom" data-sid="${esc(s.id)}" aria-label="Sticker">
        <img src="${esc(s.url)}" alt="" loading="lazy" />
      </button>`).join("")}
    ${list.length ? '<small class="st-credit">Hold a sticker to remove it</small>' : '<small class="st-credit">Add pictures from your gallery, or hold a photo in the chat → “Save as sticker”.</small>'}`;
  if (pane.dataset.html !== html) { pane.innerHTML = html; pane.dataset.html = html; }
}

// onPick({ url, kind }) sends the sticker
export function bindStickerPanel(panel, onPick) {
  panel.addEventListener("click", e => {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      $$("[data-tab]", panel).forEach(t => t.classList.toggle("on", t === tab));
      $$("[data-pane]", panel).forEach(p => (p.hidden = p.dataset.pane !== tab.dataset.tab));
      if (tab.dataset.tab === "ours") renderOurStickers();
      return;
    }
    const st = e.target.closest("[data-sticker]");
    if (st && Date.now() > holdUntil) onPick({ url: st.dataset.sticker, kind: st.dataset.kind });
  });

  // hold a custom sticker to delete it
  let timer = null;
  panel.addEventListener("pointerdown", e => {
    const st = e.target.closest('[data-kind="custom"]');
    if (!st) return;
    timer = setTimeout(() => { holdUntil = Date.now() + 600; removeSticker(st.dataset.sid); }, 600);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(ev => panel.addEventListener(ev, () => clearTimeout(timer)));
  panel.addEventListener("contextmenu", e => { if (e.target.closest('[data-kind="custom"]')) e.preventDefault(); });

  panel.addEventListener("change", async e => {
    if (!e.target.matches("[data-sticker-file]")) return;
    const f = e.target.files[0];
    e.target.value = "";
    if (f) addStickerFromFile(f);
  });
}
let holdUntil = 0;

/* ------------------------------------------------------------------ add / remove */
// GIF / WebP keep their animation and transparency; other pictures become a 512 px rounded sticker.
async function toStickerFile(file) {
  if (/image\/(gif|webp)/.test(file.type) && file.size < 3 * 1024 * 1024) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d");
  if (file.type === "image/jpeg") { // photos: rounded corners so they look like a sticker
    const r = Math.min(w, h) * 0.16;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, w, h, r) : ctx.rect(0, 0, w, h);
    ctx.clip();
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, "image/webp", 0.9)) || await new Promise(r => c.toBlob(r, "image/png"));
  return new File([blob], `sticker.${blob.type.includes("webp") ? "webp" : "png"}`, { type: blob.type });
}

export async function addStickerFromFile(file) {
  if (!file.type.startsWith("image/")) { toast("Please choose a picture."); return; }
  toast("Adding sticker…");
  try {
    const up = await upload(await toStickerFile(file), { sub: "stickers" });
    await addDoc(collection(db, "stickers"), { url: up.secure_url, publicId: up.public_id, byUid: uid(), byName: myName(), createdAt: serverTimestamp() });
    toast("Sticker added ⭐");
  } catch (err) {
    toast(friendlyError(err, "Couldn't add the sticker."));
  }
}

// "Save as sticker" from a photo or sticker in the chat (no re-upload)
export async function saveAsSticker(url) {
  if (!url) return;
  if ((state.stickers || []).some(s => s.url === url)) { toast("Already in Our stickers ⭐"); return; }
  try {
    await addDoc(collection(db, "stickers"), { url, byUid: uid(), byName: myName(), createdAt: serverTimestamp() });
    toast("Saved to Our stickers ⭐");
  } catch (err) {
    toast(friendlyError(err, "Couldn't save the sticker."));
  }
}

async function removeSticker(id) {
  if (!id) return;
  navigator.vibrate?.(20);
  if (!(await confirmDialog({ icon: "trash", title: "Remove sticker?", text: "It will be removed from Our stickers for both of you.", ok: "Remove", danger: true }))) return;
  deleteDoc(doc(db, "stickers", id)).catch(err => toast(friendlyError(err, "Couldn't remove it.")));
}
