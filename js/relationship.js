// "Our story": the date the relationship started (set by either person in More), a live
// "together for" counter on Home, milestone celebrations and a once-a-day welcome message.
//  • Each full day is counted from the exact start time: started 02-10 1:00 AM → day 1 completes 03-10 1:00 AM.
//  • After the PIN, at most one popup: a milestone (25/50/100/200/300/500/1000 days, every year) or the daily message.
//  • Tapping OK means that day's / milestone's message never shows again. Messages rotate, never the same twice in a row.
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, esc, ICONS, myName, partnerName, toast, openModal, friendlyError, spinner, actions, $
} from "./core.js";

const DAY_MS = 864e5;
const DAY_MILESTONES = [25, 50, 100, 200, 300, 500, 1000, 1500, 2000, 2500, 3000, 5000];
const LATE_WINDOW_DAYS = 3; // a milestone is still celebrated if the app is first opened within 3 days

/* ------------------------------------------------------------------ the start date */
// stored as local "YYYY-MM-DDTHH:mm" in settings/relationship
export function startDate() {
  const s = state.relationship?.startedAt;
  const d = s ? new Date(s) : null;
  return d && !isNaN(d) && d <= new Date() ? d : null;
}

// calendar difference: years, months, days, hours, minutes
export function together(now = new Date()) {
  const s = startDate();
  if (!s) return null;
  let y = now.getFullYear() - s.getFullYear(), mo = now.getMonth() - s.getMonth(), d = now.getDate() - s.getDate();
  let h = now.getHours() - s.getHours(), mi = now.getMinutes() - s.getMinutes();
  if (mi < 0) { mi += 60; h--; }
  if (h < 0) { h += 24; d--; }
  if (d < 0) { d += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); mo--; }
  if (mo < 0) { mo += 12; y--; }
  const totalDays = Math.floor((now - s) / DAY_MS);
  return { y, mo, d, h, mi, totalDays, start: s };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtStart = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

function nextMilestone(t) {
  const nextDay = DAY_MILESTONES.find(n => n > t.totalDays);
  const nextYearDate = new Date(t.start);
  nextYearDate.setFullYear(t.start.getFullYear() + t.y + 1);
  const daysToYear = Math.ceil((nextYearDate - new Date()) / DAY_MS);
  const daysToDay = nextDay ? nextDay - t.totalDays : Infinity;
  return daysToYear <= daysToDay
    ? { label: plural(t.y + 1, "year"), inDays: daysToYear }
    : { label: `${nextDay} days`, inDays: daysToDay };
}

/* ------------------------------------------------------------------ Home card */
export function relationshipCard() {
  const t = together();
  if (!t) {
    return `
      <article class="glass hcard story off">
        <div class="together-row">
          <span class="hcard-ico">💞</span>
          <div class="hcard-main"><b>When did your story begin?</b><small>Set the day you started to see your time together.</small></div>
          <button class="btn btn-ghost btn-sm" data-action="editStory">Set date</button>
        </div>
      </article>`;
  }
  const units = [[t.y, "Years"], [t.mo, "Months"], [t.d, "Days"], [t.h, "Hours"], [t.mi, "Mins"]];
  const next = nextMilestone(t);
  return `
    <article class="glass hcard story">
      <header class="hcard-head"><span class="hcard-ico">💞</span><h3>Together for</h3><span class="hcard-count">${t.totalDays.toLocaleString("en-IN")} days</span></header>
      <div class="story-units">
        ${units.map(([n, w]) => `<div class="story-unit"><b>${n}</b><small>${w}</small></div>`).join("")}
      </div>
      <small class="story-next">Next: ${esc(next.label)} in ${plural(next.inDays, "day")} 🎉</small>
    </article>`;
}

export function storyLine() {
  const t = together();
  return t ? `Together for ${t.totalDays.toLocaleString("en-IN")} days 💞` : "";
}

/* ------------------------------------------------------------------ messages (rotating) */
const DAILY = [
  "Welcome back ❤️ Day {n} of us. Thank you for choosing each other again.",
  "Another beautiful day completed together 🌸 {n} days and counting.",
  "{n} days of little moments, big smiles and the two of you 💞",
  "Hey {me} 💛 One more day with {them} is done. {n} days of love.",
  "Day {n} ✨ Every day with you is my favourite day.",
  "{n} days together and still falling for each other 🥰",
  "Good to see you 🌙 You two just completed day {n} together.",
  "A new day, the same love, maybe even more 💜 Day {n}.",
  "{n} days of us 🫶 Here's to many, many more.",
  "Welcome {me} ❤️ {n} days since your story began.",
  "Day {n}: still the best decision you two ever made 💞",
  "Counting days with {them}: {n} and it never gets old 😊",
  "{n} days of laughter, care and holding on to each other 🤍",
  "One more day written in your story 📖 Day {n} completed.",
  "Every sunrise, a little more love ☀️ {n} days together.",
  "Day {n} done 💫 Thank you for being each other's safe place.",
  "{n} days, countless reasons to smile 😍",
  "Look at you two 🥹 {n} days and still going strong.",
  "Another day, another memory 🌈 Day {n} together.",
  "Welcome home ❤️ It's been {n} days of you and {them}."
];

const MILESTONE = [
  "Completed {label} happily together 🎉 Thank you for every single moment.",
  "🎊 {label} of love! Completed happily, side by side.",
  "Happy {label}, you two 💞 Completed with smiles, care and so much love.",
  "{label} together, completed happily 🥳 Here's to forever.",
  "Wow, {label} 💖 Completed happily together, and the best is yet to come.",
  "Cheers to {label} 🥂 Completed happily together, hand in hand.",
  "🎉 {label} completed happily! Every day with you has been a gift.",
  "{label} of us ✨ Completed happily, and still falling in love every day.",
  "Our {label} 💑 Completed happily together. Thank you for choosing us.",
  "Completed {label} happily 🌹 Many more years of love ahead."
];

function pick(pool, kind) {
  const key = `asaumi.story.${uid()}.last.${kind}`;
  let last = -1;
  try { last = +localStorage.getItem(key); } catch { /* ignore */ }
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === last) i = (i + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
  try { localStorage.setItem(key, String(i)); } catch { /* ignore */ }
  return pool[i];
}
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

/* ------------------------------------------------------------------ the popup after the PIN */
const ackKey = kind => `asaumi.story.${uid()}.${state.relationship?.startedAt || ""}.${kind}`;
const getAck = kind => { try { return JSON.parse(localStorage.getItem(ackKey(kind)) || "null"); } catch { return null; } };
const setAck = (kind, v) => { try { localStorage.setItem(ackKey(kind), JSON.stringify(v)); } catch { /* ignore */ } };

// Which milestone (if any) is due and not yet acknowledged
function dueMilestone(t) {
  const seen = getAck("milestones") || [];
  if (t.y >= 1) {
    const anniversary = new Date(t.start);
    anniversary.setFullYear(t.start.getFullYear() + t.y);
    const id = `y${t.y}`;
    if (!seen.includes(id) && (new Date() - anniversary) / DAY_MS < LATE_WINDOW_DAYS) return { id, label: plural(t.y, "year") };
  }
  const n = [...DAY_MILESTONES].reverse().find(m => m <= t.totalDays);
  if (n && t.totalDays - n < LATE_WINDOW_DAYS && !seen.includes(`d${n}`)) return { id: `d${n}`, label: `${n} days`, days: n };
  return null;
}

let showing = false, waitTimer = null;

export function maybeShowStoryMessage(tries = 0) {
  clearTimeout(waitTimer);
  if (!state.user || state.locked || showing) return;
  const t = together();
  if (!t || t.totalDays < 1) return;
  // wait for the birthday surprise / other popups to finish
  if ($("#modal-root").children.length || !$("#surprise-root")?.hidden) {
    if (tries < 60) waitTimer = setTimeout(() => maybeShowStoryMessage(tries + 1), 2000);
    return;
  }
  const vars = { n: t.totalDays.toLocaleString("en-IN"), me: myName(), them: partnerName() };
  const ms = dueMilestone(t);
  if (ms) {
    show({ big: true, emoji: "🎉", title: `${ms.label} together!`, text: fill(pick(MILESTONE, "milestone"), { ...vars, label: ms.label }), t },
      () => { setAck("milestones", [...(getAck("milestones") || []), ms.id]); setAck("day", t.totalDays); });
    return;
  }
  if ((getAck("day") ?? 0) >= t.totalDays) return;
  show({ big: false, emoji: "💞", title: `Day ${vars.n} together`, text: fill(pick(DAILY, "daily"), vars), t },
    () => setAck("day", t.totalDays));
}

function show({ big, emoji, title, text, t }, onOk) {
  showing = true;
  const hearts = big ? Array.from({ length: 16 }, (_, i) =>
    `<i style="--x:${(i * 6.2 + Math.random() * 4).toFixed(1)}%;--d:${(Math.random() * 2.5).toFixed(2)}s;--t:${(4 + Math.random() * 3).toFixed(2)}s">${["💖", "💗", "💞", "✨", "🎉"][i % 5]}</i>`).join("") : "";
  const m = openModal(`
    ${big ? `<div class="story-hearts" aria-hidden="true">${hearts}</div>` : ""}
    <div class="detail-emoji">${emoji}</div>
    <h2>${esc(title)}</h2>
    <p class="story-msg">${esc(text)}</p>
    <div class="story-mini">${plural(t.y, "year")} · ${plural(t.mo, "month")} · ${plural(t.d, "day")} · ${plural(t.h, "hour")} · ${plural(t.mi, "min")}</div>
    <div class="modal-actions single"><button class="btn btn-primary" data-ok>OK ❤️</button></div>`, { dismissable: false, cls: big ? "story-modal big" : "story-modal" });
  m.onclose = () => { showing = false; };
  $("[data-ok]", m).addEventListener("click", () => { onOk(); m.close(); });
  if (big) navigator.vibrate?.([60, 60, 60, 60, 160]);
}

/* ------------------------------------------------------------------ More → Our story */
export function storySettingsCard() {
  const s = startDate();
  const t = together();
  return `
    <div class="glass card">
      <h3>Our story 💞</h3>
      <p>The day your relationship began. Either of you can set it.</p>
      <div class="set-row"><span class="set-ico">💞</span><span class="set-main"><b>${s ? esc(fmtStart.format(s)) : "Not set yet"}</b><small>${t ? `Together for ${t.totalDays.toLocaleString("en-IN")} days` : "Set it to see your time together"}</small></span></div>
      <button class="set-row" data-action="editStory"><span class="set-ico">${ICONS.pencil}</span><span class="set-main"><b>${s ? "Change start date" : "Set start date"}</b><small>Date and time you started</small></span><span class="chev">›</span></button>
    </div>`;
}

function nowLocal() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

function editStory() {
  const m = openModal(`
    <div class="detail-emoji">💞</div>
    <h2>When did your story begin?</h2>
    <p>Pick the date and time you two started.</p>
    <label class="field"><span>Started on</span><input type="datetime-local" id="story-start" max="${nowLocal()}" value="${esc(state.relationship?.startedAt || "")}" /></label>
    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>Save</button>
    </div>`);
  const input = $("#story-start", m), err = $(".form-error", m), save = $("[data-save]", m);
  save.addEventListener("click", async () => {
    const v = input.value;
    const d = v ? new Date(v) : null;
    if (!d || isNaN(d)) { err.textContent = "Pick a date and time."; return; }
    if (d > new Date()) { err.textContent = "That's in the future. Pick when you started."; return; }
    save.disabled = true;
    save.innerHTML = spinner("sm dark");
    try {
      await setDoc(doc(db, "settings", "relationship"), { startedAt: v, setByUid: uid(), setByName: myName(), updatedAt: serverTimestamp() });
      m.close();
      toast("Saved 💞");
    } catch (e) {
      err.textContent = friendlyError(e, "Couldn't save. Try again.");
      save.disabled = false;
      save.textContent = "Save";
    }
  });
}

actions.editStory = editStory;
