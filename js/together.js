// "Together": shows how far apart you are, and a hands-coming-together animation within 1 km.
// Each phone shares its location only while the app is open and only if that person turned it on.
// settings/together keeps when you were last within 1 km and the day you meet next (either of you can set it).
import { doc, setDoc, deleteDoc, onSnapshot, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, esc, toast, toDate, ago, fmtTime, avatarHtml, myName, partnerName, openModal, friendlyError,
  scheduleRender, actions, $
} from "./core.js";
import { encLocation } from "./e2ee.js";

export const NEAR_METERS = 1000;
const FRESH_MS = 20 * 60 * 1000;       // ignore positions older than 20 minutes
const WRITE_EVERY_MS = 3 * 60 * 1000;  // or when moved more than 40 m
let watchId = null, lastWrite = null, wasNear = false;

export const sharingOn = () => !!state.me?.shareLocation;

// Positions reused by the weather card (no second location request)
export const myPosition = () => (sharingOn() ? state.myPos || state.locations?.[uid()] || null : null);
export function partnerPosition() {
  const p = state.partner && state.locations?.[state.partner.uid];
  const at = toDate(p?.at);
  return p && at && Date.now() - at.getTime() <= FRESH_MS ? p : null;
}

function meters(a, b) {
  const R = 6371000, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Always kilometres: 5 m → 0.01 km, 450 m → 0.45 km, 3.2 km → 3.2 km, 12.4 km → 12 km, 1250 km → 1,250 km
export function fmtDistance(m) {
  const km = m / 1000;
  if (km < 1) return `${Math.max(0.01, Math.round(km * 100) / 100).toFixed(2)} km`;
  if (km < 10) return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-IN")} km`;
}

/* ------------------------------------------------------------------ my position */
export function startLocation() {
  if (!sharingOn() || !navigator.geolocation || watchId != null || document.hidden || state.locked) return;
  watchId = navigator.geolocation.watchPosition(onPosition, err => {
    console.warn("[asaumi] location", err);
    if (err.code === 1) toast("Location is blocked. Allow it for the app to see when you're close.");
    stopLocation();
  }, { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 });
}

export function stopLocation() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function onPosition(p) {
  const pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() };
  state.myPos = pos;
  scheduleRender();
  const moved = lastWrite ? meters(lastWrite, pos) : Infinity;
  if (!lastWrite || moved > 40 || Date.now() - lastWrite.at > WRITE_EVERY_MS) {
    lastWrite = pos;
    const spot = {
      lat: Math.round(pos.lat * 1e4) / 1e4, lng: Math.round(pos.lng * 1e4) / 1e4, // ~11 m precision
      acc: Math.round(pos.acc || 0)
    };
    // 🔐 encrypted when encryption is on; not shared at all while this phone has no key
    encLocation(spot)
      .then(body => body && setDoc(doc(db, "locations", uid()), { ...body, at: serverTimestamp() }))
      .catch(err => console.warn("[asaumi] save location", err));
  }
}

document.addEventListener("visibilitychange", () => { if (document.hidden) stopLocation(); else startLocation(); });

/* ------------------------------------------------------------------ distance */
export function distanceInfo() {
  const p = state.partner;
  if (!p || !sharingOn()) return null;
  const theirs = state.locations?.[p.uid];
  const theirAt = toDate(theirs?.at);
  if (!theirs || !theirAt || Date.now() - theirAt.getTime() > FRESH_MS) return { waiting: true };
  const mine = state.myPos || state.locations?.[uid()];
  if (!mine) return { waiting: true, mine: false };
  const m = meters(mine, theirs);
  return { meters: m, near: m <= NEAR_METERS, updated: theirAt };
}

/* ------------------------------------------------------------------ last together + next meeting */
const DAY = 864e5;
const NOTE_EVERY_MS = 10 * 60 * 1000;   // while close, "last together" is refreshed every 10 minutes
const NEW_MEETING_MS = 60 * 60 * 1000;  // apart for more than an hour → the next time close is a new meeting

export function watchTogether() {
  return onSnapshot(doc(db, "settings", "together"), snap => {
    state.together = snap.exists() ? snap.data({ serverTimestamps: "estimate" }) : {};
    scheduleRender();
  }, err => console.warn("[asaumi] together", err));
}

const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
const meetFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" });

// { lastAt, since, apartDays, meet, meetDays } — meet only when it's today or later
function meetingInfo() {
  const t = state.together || {};
  const lastAt = toDate(t.lastTogetherAt), since = toDate(t.togetherSince);
  const today = midnight(new Date());
  const meet = parseDay(t.nextMeetOn);
  const meetDays = meet ? Math.round((meet.getTime() - today) / DAY) : null;
  return {
    lastAt, since,
    apartDays: lastAt ? Math.max(0, Math.round((today - midnight(lastAt)) / DAY)) : null,
    meet: meetDays != null && meetDays >= 0 ? meet : null,
    meetDays: meetDays != null && meetDays >= 0 ? meetDays : null
  };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function apartLine(i) {
  if (i.apartDays == null) return "";
  return i.apartDays === 0 ? "🕰️ Together earlier today" : i.apartDays === 1 ? "🕰️ Apart since yesterday" : `🕰️ Apart for ${plural(i.apartDays, "day")}`;
}
function meetLine(i) {
  if (i.meetDays == null) return "";
  const when = i.meetDays === 0 ? "Meeting today ❤️" : i.meetDays === 1 ? "Meeting tomorrow" : `Meeting in ${plural(i.meetDays, "day")}`;
  return `📅 ${when} · ${meetFmt.format(i.meet)}`;
}
// how far along the wait is: 0 = just said goodbye, 1 = meeting day
function waitProgress(i) {
  if (i.apartDays == null || i.meetDays == null) return null;
  const total = i.apartDays + i.meetDays;
  return total ? i.apartDays / total : 1;
}

function factsHtml(i) {
  const apart = apartLine(i), meet = meetLine(i);
  return `
    <div class="tg-facts">
      ${apart ? `<span>${esc(apart)}</span>` : ""}
      ${meet ? `<button class="tg-chip" data-action="setNextMeet">${esc(meet)}</button>`
        : `<button class="tg-chip add" data-action="setNextMeet">📅 When do you meet next?</button>`}
    </div>`;
}

// remembered on both phones, so "Apart for … days" also works when one phone wasn't open
function noteTogether() {
  const last = toDate(state.together?.lastTogetherAt)?.getTime() || 0;
  if (state.together == null || Date.now() - last < NOTE_EVERY_MS) return;
  const data = { lastTogetherAt: serverTimestamp() };
  if (Date.now() - last > NEW_MEETING_MS) data.togetherSince = serverTimestamp();
  state.together = { ...state.together, lastTogetherAt: new Date(), ...(data.togetherSince ? { togetherSince: new Date() } : {}) };
  setDoc(doc(db, "settings", "together"), data, { merge: true }).catch(err => console.warn("[asaumi] note together", err));
}

// Little "you're close" moment the first time you come within 1 km
export function checkNearChange() {
  const d = distanceInfo();
  const near = !!d?.near;
  if (near && !wasNear) { navigator.vibrate?.([60, 80, 60]); toast(`❤️ You're close to ${partnerName()}!`); }
  if (near) noteTogether();
  wasNear = near;
}

actions.setNextMeet = () => {
  const cur = state.together?.nextMeetOn || "";
  const m = openModal(`
    <h2>📅 Next time you meet</h2>
    <p>Both of you see the countdown on Home.</p>
    <label class="field"><span>Date</span><input type="date" name="meet" min="${dayKey(new Date())}" value="${esc(cur)}" /></label>
    <p class="form-error"></p>
    <div class="modal-actions">
      ${cur ? `<button class="btn btn-ghost" data-clear>Remove</button>` : `<button class="btn btn-ghost" data-close>Cancel</button>`}
      <button class="btn btn-primary" data-save>Save</button>
    </div>`);
  const input = $("input", m), err = $(".form-error", m);
  const save = async value => {
    try {
      await setDoc(doc(db, "settings", "together"), value
        ? { nextMeetOn: value, nextMeetBy: uid() }
        : { nextMeetOn: deleteField(), nextMeetBy: deleteField() }, { merge: true });
      m.close();
      toast(value ? "Countdown set ❤️" : "Removed");
    } catch (e) { err.textContent = friendlyError(e, "Couldn't save. Try again."); }
  };
  $("[data-save]", m).addEventListener("click", () => {
    const d = parseDay(input.value);
    if (!d || d.getTime() < midnight(new Date())) { err.textContent = "Pick today or a day after."; return; }
    save(input.value);
  });
  $("[data-clear]", m)?.addEventListener("click", () => save(null));
};

/* ------------------------------------------------------------------ Home card */
export function togetherCard() {
  if (!state.partner) return "";
  if (!sharingOn()) {
    return `
      <article class="glass hcard together off">
        <div class="together-row">
          <span class="hcard-ico">📍</span>
          <div class="hcard-main"><b>See when you're close</b><small>Turn on “Together” to see how far apart you are.</small></div>
          <button class="btn btn-ghost btn-sm" data-action="toggleTogether">Turn on</button>
        </div>
      </article>`;
  }
  const d = distanceInfo();
  const info = meetingInfo();
  const me = avatarHtml(state.me || { name: myName() }, "md"), them = avatarHtml(state.partner, "md");
  if (!d || d.waiting) {
    return `
      <article class="glass hcard together waiting">
        <div class="together-row">
          <span class="hcard-ico pulse">📍</span>
          <div class="hcard-main"><b>Together</b><small>${d?.mine === false ? "Finding your location…" : `Waiting for ${esc(partnerName())} to open the app with Together on.`}</small></div>
        </div>
        ${factsHtml(info)}
      </article>`;
  }
  if (d.near) {
    // the two of you stand as far apart as you really are (1 km = the whole width), and hug when very close
    const hug = d.meters < 60;
    const gap = hug ? 0 : Math.round(14 + Math.min(1, d.meters / NEAR_METERS) * 96);
    const since = info.since && Date.now() - info.since.getTime() < 24 * 3600e3 ? `together since ${fmtTime(info.since)}` : "";
    return `
      <article class="glass hcard together near ${hug ? "tg-hug" : ""}">
        <div class="tg-meet" style="--gap:${gap}px" aria-hidden="true">
          <i class="tg-ring r1"></i><i class="tg-ring r2"></i>
          <span class="tg-person left">${me}</span>
          <span class="tg-person right">${them}</span>
          <span class="tg-heart">❤️</span>
          <i class="t-spark s1">✨</i><i class="t-spark s2">💖</i><i class="t-spark s3">✨</i><i class="t-spark s4">💞</i>
        </div>
        <b class="together-title">${hug ? "Right here with you ❤️" : "You're together ❤️"}</b>
        <small class="together-sub">${esc([hug ? "Right next to each other" : `Only ${fmtDistance(d.meters)} apart`, since].filter(Boolean).join(" · "))} · updated ${esc(ago(d.updated))}</small>
      </article>`;
  }
  // far: the dot travels along the road as the meeting day comes closer
  const prog = waitProgress(info);
  return `
    <article class="glass hcard together far">
      <div class="tg-road ${prog == null ? "idle" : ""}" style="--p:${prog == null ? 0 : Math.round(prog * 100)}%" aria-hidden="true">
        <span class="tg-end">${me}</span>
        <i class="tg-track"><i class="tg-fill"></i><i class="tg-dot">❤️</i></i>
        <span class="tg-end">${them}</span>
      </div>
      <b class="together-title">${fmtDistance(d.meters)} apart</b>
      ${factsHtml(info)}
      <small class="together-sub">Come within 1 km to see something special ❤️ · updated ${esc(ago(d.updated))}</small>
    </article>`;
}

/* ------------------------------------------------------------------ settings toggle */
actions.toggleTogether = async () => {
  const on = !sharingOn();
  if (on) {
    if (!navigator.geolocation) { toast("Location isn't available on this device."); return; }
    // ask for permission first
    const ok = await new Promise(res => navigator.geolocation.getCurrentPosition(p => { onPosition(p); res(true); }, () => res(false), { timeout: 20000, maximumAge: 60000 }));
    if (!ok) { toast("Please allow location for the app, then try again."); return; }
  }
  try {
    await setDoc(doc(db, "users", uid()), { shareLocation: on }, { merge: true });
    state.me = { ...state.me, shareLocation: on };
    if (on) { startLocation(); toast("Together is on 📍"); }
    else {
      stopLocation();
      state.myPos = null;
      lastWrite = null;
      await deleteDoc(doc(db, "locations", uid())).catch(() => {});
      toast("Together is off");
    }
    scheduleRender();
  } catch (err) {
    console.warn(err);
    toast("Couldn't change this. Try again.");
  }
};
