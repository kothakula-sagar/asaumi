// Birthday surprise: either person sets both birthdays in More. On the day:
//  • 12:00 AM: a notification scheduled on the birthday person's own phone ("{app} – You have surprise message")
//  • first open that day (after the PIN): full-screen confetti, balloons, a hug and the other person's wish
//  • a Home banner all day for both of you
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, esc, ICONS, myName, partnerName, appName, toast, openModal, avatarHtml, audioCtx,
  friendlyError, spinner, scheduleRender, actions, $
} from "./core.js";
import { isNative, scheduleBirthday, exactAlarmAllowed, openExactAlarmSettings } from "./native.js";

const DEFAULT_WISH = "Happy birthday, my favourite person. Thank you for every little moment. This little world is better because you're in it. 🎂💖";
const pad = n => String(n).padStart(2, "0");
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtBday = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long" });

export const birthdayOf = id => state.birthdays?.dates?.[id] || "";

function monthDay(s) {
  const m = /(\d{1,2})-(\d{1,2})$/.exec(s || "");
  return m ? { month: +m[1], day: +m[2] } : null;
}

function dayInYear(b, year) {
  const day = b.month === 2 && b.day === 29 && !isLeap(year) ? 28 : b.day; // 29 Feb → 28 Feb in other years
  return new Date(year, b.month - 1, day, 0, 0, 0, 0);
}

export function isBirthdayToday(id) {
  const b = monthDay(birthdayOf(id));
  if (!b) return false;
  const now = new Date(), d = dayInYear(b, now.getFullYear());
  return d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function nextMidnight(b) {
  const now = new Date();
  const thisYear = dayInYear(b, now.getFullYear());
  return thisYear > now ? thisYear : dayInYear(b, now.getFullYear() + 1);
}

const prettyBday = s => { const b = monthDay(s); return b ? fmtBday.format(new Date(2024, b.month - 1, b.day)) : "Not set"; };

/* ------------------------------------------------------------------ 12 AM notification (on this phone) */
let lastScheduled = null;
export async function syncBirthdayNotification(force = false) {
  if (!isNative || !state.user) return;
  const b = monthDay(birthdayOf(uid()));
  const key = `${birthdayOf(uid())}|${appName()}`;
  if (!force && key === lastScheduled) return;
  lastScheduled = key;
  const r = await scheduleBirthday(b ? nextMidnight(b) : null, { title: appName(), body: "You have surprise message" });
  if (!r.ok && r.reason === "permission") toast("Allow notifications so your birthday surprise can reach you 🎂");
}

/* ------------------------------------------------------------------ surprise screen */
const COLORS = ["#7dd3fc", "#c4b5fd", "#f9a8d4", "#fde68a", "#86efac", "#ffffff", "#8b5cf6", "#38bdf8"];
const rnd = (a, b) => a + Math.random() * (b - a);

function confetti(n = 70) {
  return Array.from({ length: n }, () =>
    `<i style="--x:${rnd(0, 100).toFixed(1)}%;--d:${rnd(0, 2.5).toFixed(2)}s;--t:${rnd(3, 6).toFixed(2)}s;--r:${Math.round(rnd(0, 360))}deg;--c:${COLORS[Math.floor(rnd(0, COLORS.length))]};--w:${rnd(6, 11).toFixed(1)}px"></i>`).join("");
}
function balloons(n = 9) {
  const set = ["🎈", "🎈", "🎈", "💜", "🎈", "💙", "🎈", "🎀", "🎈"];
  return Array.from({ length: n }, (_, i) =>
    `<span style="--x:${(5 + i * (90 / n) + rnd(-3, 3)).toFixed(1)}%;--d:${rnd(0, 3).toFixed(2)}s;--t:${rnd(7, 11).toFixed(2)}s;--s:${rnd(1.6, 2.6).toFixed(2)}rem">${set[i % set.length]}</span>`).join("");
}

// "Happy birthday" tune with WebAudio (no files)
function playTune() {
  const ctx = audioCtx();
  if (!ctx) return;
  const N = { G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784 };
  const song = [["G4", .3], ["G4", .15], ["A4", .45], ["G4", .45], ["C5", .45], ["B4", .9],
    ["G4", .3], ["G4", .15], ["A4", .45], ["G4", .45], ["D5", .45], ["C5", .9],
    ["G4", .3], ["G4", .15], ["G5", .45], ["E5", .45], ["C5", .45], ["B4", .45], ["A4", .9],
    ["F5", .3], ["F5", .15], ["E5", .45], ["C5", .45], ["D5", .45], ["C5", 1.1]];
  let t = ctx.currentTime + 0.3;
  for (const [n, d] of song) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = N[n];
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d * 0.95);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + d);
    t += d;
  }
}

export function showSurprise() {
  const root = $("#surprise-root");
  const wish = state.birthdays?.wishes?.[uid()];
  const from = state.partner || { name: partnerName() };
  root.innerHTML = `
    <div class="surprise">
      <div class="sp-confetti">${confetti()}</div>
      <div class="sp-balloons">${balloons()}</div>
      <div class="sp-card">
        <div class="hug" aria-hidden="true">
          <span class="hug-a">${avatarHtml(state.me || { name: myName() }, "xl")}</span>
          <span class="hug-b">${avatarHtml(from, "xl")}</span>
          <span class="hug-arms">🫂</span>
          <span class="hug-heart">💖</span>
        </div>
        <p class="eyebrow">🎂 It's your day</p>
        <h1>Happy Birthday,<br><span>${esc(myName())}</span>!</h1>
        <p class="sp-wish">${esc(wish?.text || DEFAULT_WISH)}</p>
        <small class="sp-from">— with all my love, ${esc(wish?.byName || from.name || partnerName())} ❤️</small>
        <button class="btn btn-primary btn-block" data-open>Open ${esc(appName())} ❤️</button>
      </div>
    </div>`;
  root.hidden = false;
  document.body.classList.add("surprise-open");
  navigator.vibrate?.([80, 60, 80, 60, 200]);
  playTune();
  $("[data-open]", root).addEventListener("click", () => {
    root.firstElementChild.classList.add("leaving");
    setTimeout(() => { root.innerHTML = ""; root.hidden = true; document.body.classList.remove("surprise-open"); }, 450);
  });
}

// First open on the birthday (after the PIN) shows the surprise automatically
export function maybeShowSurprise() {
  if (!state.user || state.locked || !isBirthdayToday(uid())) return;
  const key = `asaumi.bday.${uid()}.${todayKey()}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* ignore */ }
  showSurprise();
}

/* ------------------------------------------------------------------ home banner */
export function birthdayBanner() {
  if (isBirthdayToday(uid())) {
    return `
      <article class="glass bday-banner mine">
        <span class="bday-cake">🎂</span>
        <div class="hcard-main"><b>Happy Birthday, ${esc(myName())}! 🎉</b><small>Your surprise is waiting</small></div>
        <button class="btn btn-primary btn-sm" data-action="openSurprise">Open 🎁</button>
      </article>`;
  }
  if (state.partner && isBirthdayToday(state.partner.uid)) {
    return `
      <article class="glass bday-banner">
        <span class="bday-cake">🎂</span>
        <div class="hcard-main"><b>Today is ${esc(partnerName())}'s birthday!</b><small>Send a wish, or make a call ❤️</small></div>
        <button class="btn btn-primary btn-sm" data-nav="chat">Wish 💌</button>
      </article>`;
  }
  return "";
}

/* ------------------------------------------------------------------ settings */
export function birthdaySettingsCard() {
  const p = state.partner;
  return `
    <div class="glass card">
      <h3>Birthdays 🎂</h3>
      <p>A surprise opens on the birthday, and a notification arrives at 12 AM.</p>
      <div class="set-row"><span class="set-ico">🎂</span><span class="set-main"><b>${esc(myName())}</b><small>${esc(prettyBday(birthdayOf(uid())))}</small></span></div>
      ${p ? `<div class="set-row"><span class="set-ico">🎁</span><span class="set-main"><b>${esc(partnerName())}</b><small>${esc(prettyBday(birthdayOf(p.uid)))}</small></span></div>` : ""}
      <button class="set-row" data-action="editBirthdays"><span class="set-ico">${ICONS.pencil}</span><span class="set-main"><b>Edit birthdays &amp; surprise message</b><small>Either of you can change these</small></span><span class="chev">›</span></button>
    </div>`;
}

async function editBirthdays() {
  const p = state.partner;
  const mineWish = p ? state.birthdays?.wishes?.[p.uid] : null;
  const myText = mineWish?.byUid === uid() ? mineWish.text : "";
  const exactOk = await exactAlarmAllowed();
  const m = openModal(`
    <div class="detail-emoji">🎂</div>
    <h2>Birthdays</h2>
    <label class="field"><span>${esc(myName())}'s birthday</span><input type="date" id="bd-me" value="${esc(birthdayOf(uid()))}" /></label>
    ${p ? `
      <label class="field"><span>${esc(partnerName())}'s birthday</span><input type="date" id="bd-them" value="${esc(birthdayOf(p.uid))}" /></label>
      <label class="field"><span>Your surprise message for ${esc(partnerName())}</span>
        <textarea id="bd-wish" maxlength="600" placeholder="${esc(DEFAULT_WISH)}">${esc(myText)}</textarea></label>
      <small class="muted bd-note">${esc(partnerName())} sees it only on their birthday, inside the surprise.</small>` : ""}
    ${isNative && !exactOk ? `
      <div class="chk bad"><span>⏰</span><div><b>Allow “Alarms &amp; reminders”</b><small>So the 12 AM surprise notification arrives exactly on time.</small></div></div>
      <button class="btn btn-ghost btn-sm" data-exact>Open setting</button>` : ""}
    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>Save</button>
    </div>
    <button class="link-btn" data-preview>Preview the surprise</button>`);
  $("[data-exact]", m)?.addEventListener("click", openExactAlarmSettings);
  $("[data-preview]", m).addEventListener("click", () => { m.close(); showSurprise(); });
  const save = $("[data-save]", m), err = $(".form-error", m);
  save.addEventListener("click", async () => {
    save.disabled = true;
    save.innerHTML = spinner("sm dark");
    try {
      const data = { dates: { [uid()]: $("#bd-me", m).value || "" }, updatedAt: serverTimestamp() };
      if (p) {
        data.dates[p.uid] = $("#bd-them", m).value || "";
        const text = $("#bd-wish", m).value.trim();
        if (text || mineWish?.byUid === uid()) data.wishes = { [p.uid]: { text, byUid: uid(), byName: myName() } };
      }
      await setDoc(doc(db, "settings", "birthdays"), data, { merge: true });
      m.close();
      toast("Birthdays saved 🎂");
    } catch (e) {
      err.textContent = friendlyError(e, "Couldn't save. Try again.");
      save.disabled = false;
      save.textContent = "Save";
    }
  });
}

Object.assign(actions, {
  editBirthdays,
  openSurprise: showSurprise
});

export function onBirthdaysChanged() {
  syncBirthdayNotification();
  maybeShowSurprise();
  scheduleRender();
}
