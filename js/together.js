// "Together": shows how far apart you are, and a hands-coming-together animation within 1 km.
// Each phone shares its location only while the app is open and only if that person turned it on.
import { doc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, state, uid, esc, toast, toDate, ago, partnerName, scheduleRender, actions } from "./core.js";

export const NEAR_METERS = 1000;
const FRESH_MS = 20 * 60 * 1000;       // ignore positions older than 20 minutes
const WRITE_EVERY_MS = 3 * 60 * 1000;  // or when moved more than 40 m
let watchId = null, lastWrite = null, wasNear = false;

export const sharingOn = () => !!state.me?.shareLocation;

function meters(a, b) {
  const R = 6371000, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmtDistance = m => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

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
    setDoc(doc(db, "locations", uid()), {
      lat: Math.round(pos.lat * 1e4) / 1e4, lng: Math.round(pos.lng * 1e4) / 1e4, // ~11 m precision
      acc: Math.round(pos.acc || 0), at: serverTimestamp()
    }).catch(err => console.warn("[asaumi] save location", err));
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

// Little "you're close" moment the first time you come within 1 km
export function checkNearChange() {
  const d = distanceInfo();
  const near = !!d?.near;
  if (near && !wasNear) { navigator.vibrate?.([60, 80, 60]); toast(`❤️ You're close to ${partnerName()}!`); }
  wasNear = near;
}

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
  if (!d || d.waiting) {
    return `
      <article class="glass hcard together waiting">
        <div class="together-row">
          <span class="hcard-ico pulse">📍</span>
          <div class="hcard-main"><b>Together</b><small>${d?.mine === false ? "Finding your location…" : `Waiting for ${esc(partnerName())} to open the app with Together on.`}</small></div>
        </div>
      </article>`;
  }
  if (d.near) {
    return `
      <article class="glass hcard together near">
        <div class="together-anim" aria-hidden="true">
          <span class="t-hand left"><i class="mirror">✋</i></span>
          <span class="t-hand right"><i>✋</i></span>
          <span class="t-heart">❤️</span>
          <i class="t-spark s1">✨</i><i class="t-spark s2">💖</i><i class="t-spark s3">✨</i><i class="t-spark s4">💞</i>
        </div>
        <b class="together-title">You're together ❤️</b>
        <small class="together-sub">${d.meters < 60 ? "Right next to each other" : `Only ${fmtDistance(d.meters)} apart`} · updated ${esc(ago(d.updated))}</small>
      </article>`;
  }
  return `
    <article class="glass hcard together far">
      <div class="together-line" aria-hidden="true">
        <span class="t-dot"><i class="mirror">✋</i></span><i class="t-track"><i class="t-pulse"></i></i><span class="t-dot"><i>✋</i></span>
      </div>
      <b class="together-title">${fmtDistance(d.meters)} apart</b>
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
