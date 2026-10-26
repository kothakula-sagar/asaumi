// 🗺️ Our Map: both of you on an OpenStreetMap map, how far apart you are, and the road route to your person.
//  • Positions come from "Together" (together.js): no new permissions, nothing new saved in Firebase.
//  • Leaflet is loaded from cdnjs the first time the page opens.
//  • A route is fetched only when you tap "Show route" (OpenStreetMap's free FOSSGIS OSRM service, no key);
//    only then are your two locations sent to it.
//  • app.js re-renders often, so the page HTML stays the same: the map is created once in mounted() and
//    refresh() only updates the pins and the panel under the map.
import { state, uid, esc, toast, toDate, ago, avatarHtml, myName, partnerName, views, actions, $ } from "./core.js";
import { myPosition, sharingOn, fmtDistance } from "./together.js";
import { openInApp } from "./native.js";

const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const INDIA = [22.6, 79.0];
const STALE_MS = 20 * 60 * 1000;      // partner's position older than this → grey "last seen" pin
const REROUTE_METERS = 300;           // a shown route is fetched again when someone moved this far…
const REROUTE_EVERY_MS = 60 * 1000;   // …but at most once a minute
const MODES = {
  car: { label: "🚗 Car", engine: "routed-car", by: "by road", gmaps: "driving" },
  bike: { label: "🚲 Cycle", engine: "routed-bike", by: "by cycle", gmaps: "bicycling" },
  foot: { label: "🚶 Walk", engine: "routed-foot", by: "on foot", gmaps: "walking" }
};

let leafletLoading = null;  // Promise<L> while / after loading
let map = null, mapEl = null, mountSeq = 0, failedEl = null;
let myPin = null, theirPin = null, routeLayer = null;
let userMoved = false;      // the user panned / zoomed by hand → stop auto-fitting
let autoUntil = 0;          // zooms before this time were made by the app itself
let fitKey = "";
let mode = "car";
let route = null;           // { mode, dist, dur, coords, from, to, owner }
let routing = false, routeSeq = 0, lastRouteTry = 0;
let refreshQueued = false, panelHtmlShown = null;

/* ------------------------------------------------------------------ positions */
export function meters(a, b) {
  const R = 6371000, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// partner's last known position (also an old one), only while Together is on for me
function theirSpot() {
  const p = state.partner && sharingOn() && state.locations?.[state.partner.uid];
  const at = toDate(p?.at);
  if (!p || !at || typeof p.lat !== "number") return null;
  return { lat: p.lat, lng: p.lng, at, stale: Date.now() - at.getTime() > STALE_MS };
}

const fmtTripTime = secs => {
  const mins = Math.max(1, Math.round(secs / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/* ------------------------------------------------------------------ Home card */
export function mapCard() {
  if (!state.partner) return "";
  const name = partnerName(), mine = myPosition(), theirs = theirSpot();
  const line = !sharingOn() ? "Turn on Together to see both of you on the map."
    : theirs?.stale ? `${name} was last seen on the map ${ago(theirs.at)}`
    : mine && theirs ? `${fmtDistance(meters(mine, theirs))} apart · see the way to ${name}`
    : `Waiting for ${name}'s location`;
  return `
    <article class="glass hcard map-card">
      <header class="hcard-head">
        <span class="hcard-ico">🗺️</span>
        <h3>Our Map</h3>
      </header>
      <small class="map-card-line">${esc(line)}</small>
      <button class="btn btn-ghost btn-block" data-nav="map">🧭 Open map & route</button>
    </article>`;
}

/* ------------------------------------------------------------------ Leaflet */
function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (leafletLoading) return leafletLoading;
  const add = (tag, attrs) => new Promise((res, rej) => {
    const el = Object.assign(document.createElement(tag), attrs);
    el.dataset.leaflet = "";
    el.onload = res;
    el.onerror = () => { el.remove(); rej(new Error(`couldn't load ${attrs.src || attrs.href}`)); };
    document.head.append(el);
  });
  document.querySelectorAll("[data-leaflet]").forEach(el => el.remove()); // a failed earlier try
  leafletLoading = Promise.all([add("link", { rel: "stylesheet", href: LEAFLET_CSS }), add("script", { src: LEAFLET_JS })])
    .then(() => { if (!window.L?.map) throw new Error("Leaflet missing"); return window.L; })
    .catch(err => { leafletLoading = null; throw err; }); // try again the next time the page opens
  return leafletLoading;
}

async function mount(el) {
  destroy();
  const seq = mountSeq;
  mapEl = el;
  const msg = $("[data-map-msg]", el.parentElement);
  if (msg) { msg.hidden = false; msg.textContent = "Loading map…"; }
  let L;
  try {
    L = await loadLeaflet();
  } catch (err) {
    console.warn("[asaumi] map", err);
    if (seq !== mountSeq) return;
    failedEl = el;
    mapEl = null;
    if (msg) msg.textContent = "The map couldn't load. Check your internet";
    return;
  }
  if (seq !== mountSeq || !el.isConnected) return;
  if (msg) msg.hidden = true;
  map = L.map(el, { zoomControl: true, worldCopyJump: true }).setView(INDIA, 4);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  userMoved = false;
  fitKey = "";
  map.on("dragstart", () => { userMoved = true; });
  map.on("zoomstart", () => { if (Date.now() > autoUntil) userMoved = true; });
  setTimeout(() => map?.invalidateSize(), 350); // after the page's entrance animation
  drawRoute();
  refresh();
}

function destroy() {
  mountSeq++;
  map?.remove();
  map = mapEl = myPin = theirPin = routeLayer = null;
}

/* ------------------------------------------------------------------ pins */
function pinIcon(user, cls) {
  return window.L.divIcon({
    className: "map-pin-wrap",
    html: `<div class="map-pin ${cls}">${avatarHtml(user, "sm")}</div>`,
    iconSize: [46, 56],
    iconAnchor: [23, 56],
    tooltipAnchor: [0, -50]
  });
}

function place(pin, pos, key, user, cls) {
  if (!pos) { pin?.remove(); return null; }
  if (!pin) {
    pin = window.L.marker([pos.lat, pos.lng], { icon: pinIcon(user, cls), keyboard: false }).addTo(map);
  } else {
    pin.setLatLng([pos.lat, pos.lng]);
    if (pin.key !== key) pin.setIcon(pinIcon(user, cls));
  }
  pin.key = key;
  return pin;
}

function updatePins() {
  if (!map) return;
  const mine = myPosition(), theirs = theirSpot();
  const me = state.me || { name: myName() }, p = state.partner || { name: partnerName() };
  myPin = place(myPin, mine, `me|${me.avatar}|${me.name}`, me, "me");
  theirPin = place(theirPin, theirs, `them|${p.avatar}|${p.name}|${theirs?.stale}`, p, theirs?.stale ? "them stale" : "them");
  if (theirPin) {
    const tip = theirs.stale ? `Last seen here ${ago(theirs.at)}` : partnerName();
    if (theirPin.stale !== theirs.stale) {
      theirPin.unbindTooltip();
      theirPin.bindTooltip(esc(tip), { direction: "top", permanent: theirs.stale, className: "map-tip" });
      theirPin.stale = theirs.stale;
    } else theirPin.setTooltipContent(esc(tip));
  }
  if (myPin && !myPin.getTooltip()) myPin.bindTooltip("You", { direction: "top", className: "map-tip" });

  // fit both pins (and the route) whenever something moved, until the user moves the map by hand
  const key = [mine?.lat, mine?.lng, theirs?.lat, theirs?.lng, route?.coords.length].join(",");
  if (key !== fitKey) { fitKey = key; fit(); }
}

function fit(force = false) {
  if (!map || (userMoved && !force)) return;
  const pts = [myPosition(), theirSpot()].filter(Boolean).map(p => [p.lat, p.lng]);
  if (route) pts.push(...route.coords);
  autoUntil = Date.now() + 700; // the zoom this causes isn't the user's
  if (!pts.length) map.setView(INDIA, 4);
  else if (pts.length === 1) map.setView(pts[0], 14);
  else map.fitBounds(window.L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16 });
}

/* ------------------------------------------------------------------ route */
function drawRoute() {
  routeLayer?.remove();
  routeLayer = null;
  if (!map || !route) return;
  const L = window.L;
  routeLayer = L.layerGroup([
    L.polyline(route.coords, { color: "#3b1fb8", weight: 9, opacity: 0.35, interactive: false }),
    L.polyline(route.coords, { color: "#ec4899", weight: 5, opacity: 0.95, interactive: false })
  ]).addTo(map);
}

function clearRoute() {
  routeSeq++;
  route = null;
  routing = false;
  drawRoute();
}

async function fetchRoute({ quiet = false } = {}) {
  const a = myPosition(), b = theirSpot();
  if (!a || !b) { if (!quiet) toast(`Waiting for both locations to find the way to ${partnerName()}.`); return; }
  if (!navigator.onLine) { if (!quiet) toast("You're offline. Connect to the internet to see the route."); return; }
  const m = mode, seq = ++routeSeq, owner = uid();
  routing = true;
  lastRouteTry = Date.now();
  queueRefresh();
  const url = `https://routing.openstreetmap.de/${MODES[m].engine}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout?.(20000) });
    const data = await res.json();
    if (seq !== routeSeq || uid() !== owner) return;
    const best = data?.code === "Ok" && data.routes?.[0];
    if (!res.ok || !best?.geometry?.coordinates?.length) throw new Error(data?.code || res.status);
    route = {
      mode: m, dist: best.distance, dur: best.duration, owner,
      coords: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      from: { lat: a.lat, lng: a.lng }, to: { lat: b.lat, lng: b.lng }
    };
    drawRoute();
    if (!quiet) { userMoved = false; fit(true); }
  } catch (err) {
    if (seq !== routeSeq) return;
    console.warn("[asaumi] route", err);
    if (!quiet) toast(navigator.onLine ? "Couldn't find a route right now. Try again in a minute." : "You're offline. Connect to the internet to see the route.");
  } finally {
    if (seq === routeSeq) { routing = false; queueRefresh(); }
  }
}

// a shown route follows you both: fetched again quietly after a 300 m move, at most once a minute
function maybeReroute() {
  if (!route || routing || Date.now() - lastRouteTry < REROUTE_EVERY_MS) return;
  const a = myPosition(), b = theirSpot();
  if (a && b && (meters(route.from, a) > REROUTE_METERS || meters(route.to, b) > REROUTE_METERS)) fetchRoute({ quiet: true });
}

/* ------------------------------------------------------------------ panel under the map */
function panelHtml() {
  const p = state.partner, on = sharingOn();
  if (!p) return `<p class="map-note">Your person hasn't signed in yet ❤️</p>`;
  const name = partnerName(), mine = myPosition(), theirs = theirSpot();
  const meLine = !on ? "Together is off" : mine ? "On the map now" : "Finding your location…";
  const themLine = !on ? `Turn on Together to see ${name}`
    : !theirs ? "Not sharing location right now"
    : theirs.stale ? `Last seen here ${ago(theirs.at)}` : `Updated ${ago(theirs.at)}`;
  const row = (cls, user, title, sub) => `
    <div class="map-who">
      <i class="map-dot ${cls}"></i>${avatarHtml(user, "sm")}
      <div class="hcard-main"><b>${esc(title)}</b><small>${esc(sub)}</small></div>
    </div>`;
  const both = mine && theirs;
  let html = `
    <div class="map-people">
      ${row("me", state.me || { name: myName() }, "You", meLine)}
      ${row(theirs?.stale ? "them stale" : "them", p, name, themLine)}
    </div>
    ${both ? `<p class="map-dist"><b>${esc(fmtDistance(meters(mine, theirs)))}</b> apart <small>(straight line)</small></p>` : ""}`;
  if (!on) {
    return html + `
      <div class="map-off">
        <p>Turn on Together to see both of you on the map and the way to ${esc(name)}.</p>
        <button class="btn btn-primary btn-block" data-action="toggleTogether">📍 Turn on Together</button>
      </div>`;
  }
  const chip = k => `<button class="ph-chip ${mode === k ? "on" : ""}" data-action="mapMode" data-m="${k}">${MODES[k].label}</button>`;
  const summary = routing ? "Finding the way…"
    : route ? `<b>${esc(fmtDistance(route.dist))}</b> · ${esc(fmtTripTime(route.dur))} ${MODES[route.mode].by}` : "";
  return html + `
    <div class="ph-chips map-modes">${Object.keys(MODES).map(chip).join("")}</div>
    ${summary ? `<p class="map-route">${summary}</p>` : ""}
    <div class="map-actions">
      <button class="btn btn-primary btn-sm" data-action="mapRoute" ${both && !routing ? "" : "disabled"}>🧭 ${route ? "Update route" : "Show route"}</button>
      <button class="btn btn-ghost btn-sm" data-action="mapNavigate" ${both ? "" : "disabled"}>Navigate ↗</button>
      <button class="btn btn-ghost btn-sm" data-action="mapCenter">Center</button>
      ${route ? `<button class="btn btn-ghost btn-sm" data-action="mapHideRoute">Hide route</button>` : ""}
    </div>
    <p class="map-privacy">🔐 Route by OpenStreetMap's free routing service: your two locations are sent to it only when you ask for a route.</p>`;
}

/* ------------------------------------------------------------------ page */
function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(refresh);
}

function refresh() {
  refreshQueued = false;
  if (state.view !== "map") return;
  if (route && (route.owner !== uid() || !sharingOn())) clearRoute(); // someone else signed in / Together off
  const el = $("#our-map");
  if (!el) return;
  // the map was removed (e.g. back from Chat, where the page HTML stayed the same) → build it again
  if (mapEl !== el && failedEl !== el) mount(el);
  const panel = $("[data-map-panel]");
  const html = panelHtml();
  if (panel && (panel !== panelHtmlShown?.el || panelHtmlShown.html !== html)) {
    panel.innerHTML = html;
    panelHtmlShown = { el: panel, html };
  }
  updatePins();
  maybeReroute();
}

views.map = {
  render() {
    queueRefresh();
    return `
      <section class="page-head">
        <div>
          <p class="eyebrow">Wherever you are</p>
          <h1>🗺️ Our Map</h1>
          <p class="page-sub">Both of you, and the way to each other.</p>
        </div>
      </section>
      <div class="glass map-box">
        <div id="our-map" class="map-canvas"></div>
        <div class="map-msg" data-map-msg hidden></div>
      </div>
      <div class="glass map-panel" data-map-panel></div>`;
  },
  mounted(root) {
    const el = $("#our-map", root);
    failedEl = null; // a fresh page: try loading again
    if (el && mapEl !== el) mount(el);
  },
  leave() { destroy(); failedEl = null; panelHtmlShown = null; }
};

Object.assign(actions, {
  mapMode: d => {
    if (!MODES[d.m] || d.m === mode) return;
    mode = d.m;
    if (route) fetchRoute(); else queueRefresh();
  },
  mapRoute: () => fetchRoute(),
  mapHideRoute: () => { clearRoute(); fitKey = ""; queueRefresh(); },
  mapCenter: () => { userMoved = false; fit(true); },
  mapNavigate: () => {
    const a = myPosition(), b = theirSpot();
    if (!a || !b) return;
    openInApp(`https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${MODES[mode].gmaps}`);
  }
});
