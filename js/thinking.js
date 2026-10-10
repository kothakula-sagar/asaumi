// 💭 "Thinking of you": one tap on the ❤️ between your photos (Home / Asaumi page) sends a heart.
//  • App open on the other phone → hearts float up + a soft vibration. App closed → a phone notification.
//  • Stored in your own presence/{uid} document (thought: { n, day, count }), so there's no new collection:
//    one small write per tap, one read on the other phone. Both see today's counts.
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, state, uid, esc, toast, myName, partnerName, actions } from "./core.js";
import { pushPartner } from "./notify.js";

const COOLDOWN_MS = 2500;
let lastSent = 0;
let lastSeen = null; // newest thought from the other person already shown
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

const thoughtOf = id => state.presence?.[id]?.thought;
// how many thoughts that person sent today
export function thoughtsToday(id) {
  const t = thoughtOf(id);
  return t && t.day === today() ? t.count || 0 : 0;
}

async function sendThought(btn) {
  if (!state.partner) { toast("Your person hasn't signed in yet."); return; }
  if (Date.now() - lastSent < COOLDOWN_MS) return;
  lastSent = Date.now();
  const count = thoughtsToday(uid()) + 1;
  btn?.classList.remove("think-pop");
  void btn?.offsetWidth;
  btn?.classList.add("think-pop");
  navigator.vibrate?.(20);
  try {
    await setDoc(doc(db, "presence", uid()), { thought: { n: Date.now(), day: today(), count } }, { merge: true });
    pushPartner({ body: `💭 ${myName()} is thinking of you`, page: "home", tag: "thinking" });
    toast(`💭 Sent to ${partnerName()}${count > 1 ? ` · ${count} today` : ""}`);
  } catch (err) {
    console.warn("[asaumi] thought", err);
    toast("Couldn't send. Check your internet.");
  }
}

// called by app.js whenever presence changes
export function checkThoughts() {
  const p = state.partner;
  if (!p) return;
  const t = thoughtOf(p.uid);
  const n = t?.n || 0;
  if (lastSeen === null) { // first load: only show it if it was sent just now (e.g. opened from the notification)
    lastSeen = Date.now() - n < 20000 ? n - 1 : n;
  }
  if (!n || n <= lastSeen) return;
  lastSeen = n;
  if (state.locked || document.hidden) return;
  showThought(p.name || partnerName());
}
export function resetThoughts() { lastSeen = null; }

function showThought(name) {
  document.querySelector(".think-fx")?.remove();
  const fx = document.createElement("div");
  fx.className = "think-fx";
  fx.innerHTML = `
    ${Array.from({ length: 16 }, (_, i) => `<i style="left:${(i * 53) % 100}%;animation-delay:${(i % 8) * 0.11}s;font-size:${22 + (i % 4) * 8}px">${["❤️", "💖", "💕", "💗"][i % 4]}</i>`).join("")}
    <div class="think-card">💭 <b>${esc(name)}</b> is thinking of you</div>`;
  document.body.append(fx);
  navigator.vibrate?.([80, 60, 80, 60, 200]);
  setTimeout(() => fx.remove(), 3200);
}

actions.thinkOfYou = (d, btn) => sendThought(btn);
