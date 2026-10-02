// "Share to Asaumi": text, links, photos and videos shared from other apps.
// The PIN comes first, every time; then the chat opens with the shared content ready (nothing is sent automatically).
import { state, hooks, toast } from "./core.js";
import { isNative, takePendingShare, onShareReceived, fileSrc } from "./native.js";
import { prefillComposer, previewMedia } from "./chat.js";
import { lockApp } from "./lock.js";

let pending = null; // { text, subject, files: [{ path, mimeType, name, size }] }

async function fetchNativeShare() {
  const s = await takePendingShare();
  if (s && (s.text || s.subject || s.files?.length)) pending = s;
  return !!s;
}

// Web app (installed from Chrome): manifest share_target sends ?title=&text=&url=
function readWebShare() {
  const p = new URLSearchParams(location.search);
  const parts = [p.get("text"), p.get("url")].filter(Boolean);
  if (!parts.length && !p.get("title")) return;
  pending = { text: [...new Set(parts)].join(" "), subject: p.get("title") || "" };
  history.replaceState(null, "", location.pathname + location.hash);
}

export function initShare() {
  readWebShare();
  if (!isNative) return;
  fetchNativeShare(); // the app was opened by a share (cold start)
  onShareReceived(async () => {
    // shared while Asaumi was already running → always ask for the PIN first
    if (await fetchNativeShare() && state.user && !state.locked) lockApp();
  });
}

// Called after the PIN is entered
export function applyShareIfReady() {
  if (!pending || !state.user || state.locked) return;
  const s = pending;
  pending = null;
  hooks.go("chat");

  // Text and links go into the message box. Apps often send a title as "subject" plus the link as "text".
  const text = (s.text || "").trim();
  const subject = (s.subject || "").trim();
  const full = subject && text && !text.includes(subject) && /^https?:\/\/\S+$/.test(text) ? `${subject} ${text}` : text || subject;
  if (full) prefillComposer(full);

  // Photos / videos open the normal preview (Cancel / Send), one after another
  const files = [...(s.files || [])];
  if (files.length > 1) toast(`${files.length} items shared. Check and send them one by one.`);
  const next = async () => {
    const f = files.shift();
    if (!f) return;
    try {
      const blob = await (await fetch(fileSrc(f.path))).blob();
      previewMedia(new File([blob], f.name || "shared", { type: f.mimeType || blob.type }), next);
    } catch (err) {
      console.warn("[asaumi] shared file", err);
      toast("Couldn't open a shared file.");
      next();
    }
  };
  if (files.length) setTimeout(next, 500);
}
