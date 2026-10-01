// Meal check-in: after unlocking during a meal window, asks "Have you had breakfast/lunch/dinner?".
// "No" tells the other person (in-app + phone push). Their answers show on your Home.
// Stored as meals/{uid}_{YYYY-MM-DD} → { uid, date, breakfast: { answer, at }, lunch, dinner }
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, state, uid, esc, myName, partnerName, toast, openModal, fmtTime, friendlyError, $ } from "./core.js";
import { notifyPartner } from "./notify.js";

export const MEALS = [
  { key: "breakfast", label: "Breakfast", emoji: "🍳", from: 8, to: 10 },   // 8:00–10:00 AM
  { key: "lunch", label: "Lunch", emoji: "🍛", from: 12, to: 14 },          // 12:00–2:00 PM
  { key: "dinner", label: "Dinner", emoji: "🍽️", from: 20, to: 22 }         // 8:00–10:00 PM
];

const pad = n => String(n).padStart(2, "0");
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function sinceKey(days = 14) { const d = new Date(); d.setDate(d.getDate() - days); return dayKey(d); }

const currentMeal = () => { const h = new Date().getHours(); return MEALS.find(m => h >= m.from && h < m.to) || null; };
const mealsOf = (id, day = dayKey()) => state.meals?.[`${id}_${day}`] || {};

/* ------------------------------------------------------------------ asking */
let asking = null, waitTimer = null, waitTries = 0; // asking = the open question popup

export function scheduleMealCheck(delay = 1500) {
  clearTimeout(waitTimer);
  waitTries = 0;
  waitTimer = setTimeout(maybeAskMeal, delay);
}

function maybeAskMeal() {
  clearTimeout(waitTimer);
  if (asking && !document.contains(asking)) asking = null; // popup was cleared by the lock screen
  if (!state.user || state.locked || asking) return;
  const meal = currentMeal();
  if (!meal) return;
  // wait for: name set, no other popup, meal data loaded
  const busy = !state.me?.name || $("#modal-root").children.length || !state.loaded?.meals || !$("#surprise-root")?.hidden;
  if (busy) {
    if (++waitTries < 90) waitTimer = setTimeout(maybeAskMeal, 2000);
    return;
  }
  if (mealsOf(uid())[meal.key]?.answer === "yes") return;
  ask(meal);
}

function ask(meal) {
  const m = openModal(`
    <div class="detail-emoji">${meal.emoji}</div>
    <h2>Have you had ${meal.label.toLowerCase()}?</h2>
    <p>Hi ${esc(myName())} 💛 Just checking on you.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-no>No 😕</button>
      <button class="btn btn-primary" data-yes>Yes 😋</button>
    </div>`, { dismissable: false });
  asking = m;
  m.onclose = () => { asking = null; };
  const save = async answer => {
    $$btns(m).forEach(b => (b.disabled = true));
    try {
      await setDoc(doc(db, "meals", `${uid()}_${dayKey()}`), {
        uid: uid(), date: dayKey(), [meal.key]: { answer, at: serverTimestamp() }, updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      toast(friendlyError(err, "Couldn't save. Try again."));
      $$btns(m).forEach(b => (b.disabled = false));
      return false;
    }
    m.close();
    return true;
  };
  $("[data-yes]", m).addEventListener("click", async () => {
    if (await save("yes")) toast(`${meal.label} done ✅ Good!`);
  });
  $("[data-no]", m).addEventListener("click", async () => {
    if (!(await save("no"))) return;
    notifyPartner("meal", `${myName()} hasn't had ${meal.label.toLowerCase()} yet 🥺 Remind them 💛`);
    openModal(`
      <div class="detail-emoji">🍽️</div>
      <h2>Have food maga 🍽️</h2>
      <p>For our future 💛 Please eat ${meal.label.toLowerCase()} soon and take care of yourself.</p>
      <div class="modal-actions single"><button class="btn btn-primary" data-close>Open the app ❤️</button></div>`, { dismissable: false });
  });
}
const $$btns = m => [...m.querySelectorAll("[data-yes],[data-no]")];

/* ------------------------------------------------------------------ partner's meals on Home */
export function partnerMealsCard() {
  const p = state.partner;
  if (!p || !state.loaded?.meals) return "";
  const today = mealsOf(p.uid);
  const tile = meal => {
    const a = today[meal.key];
    const [icon, text, cls] = a?.answer === "yes" ? ["✅", fmtTime(a.at) || "Done", "yes"]
      : a?.answer === "no" ? ["⏳", "Not yet", "no"] : ["—", "Not answered", ""];
    return `
      <div class="meal-tile ${cls}">
        <span class="meal-emoji">${meal.emoji}</span>
        <b>${meal.label}</b>
        <span class="meal-state">${icon}</span>
        <small>${esc(text)}</small>
      </div>`;
  };
  return `
    <article class="glass hcard meals">
      <header class="hcard-head"><span class="hcard-ico">🍽️</span><h3>${esc(partnerName())}'s meals today</h3></header>
      <div class="meal-tiles">${MEALS.map(tile).join("")}</div>
    </article>`;
}
