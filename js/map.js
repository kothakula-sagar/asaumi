// 🗺️ Our Map: where both of you are on an OpenStreetMap map, and the road route from you to your person.
//  • Uses the positions "Together" already shares (only while the app is open, encrypted when E2EE is on),
//    so it costs no extra Firebase reads and asks for no extra permission.
//  • Map pictures: OpenStreetMap (free). Leaflet draws the map (loaded from cdnjs the first time Map opens).
//  • Route: OpenStreetMap's free routing service (FOSSGIS). Your two positions are sent to it ONLY when you
//    tap "Show route"; while the route is shown it is updated when one of you moves more than 300 m.
//  • The map lives on its own page (like Games): Home's normal re-render never touches it, so it stays smooth.
import { state, uid, esc, avatarHtml, myName, partnerName, ago, toDate, toast, views, actions, $ } from "./core.js";
import { myPosition, sharingOn, fmtDistance } from "./together.js";
import { openInApp } from "./native.js";

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4";
const INDIA = { center: [22.6, 79.0], zoom: 4 };
const STALE_MS = 20 * 60 * 1000;        // same "fresh" window as Together
const REROUTE_METERS = 300;
const REROUTE_EVERY_MS = 60 * 1000;
const MODES = {
  car: { label: "🚗 Car", engine: "routed-car", google: "driving", verb: "by road" },
  bike: { label: "🚲 Cycle", engine: "routed-bike", google: "bicycling", verb: "by cycle" },
  foot: { label: "🚶 Walk", engine: "routed-foot", google: "walking", verb: "on foot" }
};

let leaflet = null;     // Promise<L>
let map = null, pins = {}, routeLine = null;
let fitted = false;     // false = not yet, true = fitted by the app, "user" = you moved the map yourself
let autoMoving = false; // the app is moving the map (so it doesn't count as "you moved it")
let mode = "car";
let route = null;       // { for, mode, coords, distance, duration, at, from, to }
let routeBusy = false;

/* ------------------------------------------------------------------ positions */
const R = 6371000, rad = x => (x * Math.PI) / 180;
function meters(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// my position (only when I share), and the partner's last known one (marked stale after 20 minutes)
const mine = () => myPosition();
function theirs() {
  const p = state.partner && state.locations?.[state.partner.uid];
  if (!p || typeof p.lat !== "number") return null;
  const at = toDate(p.at);
  return { ...p, at, stale: !at || Date.now() - at.getTime() > STALE_MS };
}

const fmtTrip = s => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};

/* ------------------------------------------------------------------ Leaflet (loaded once, only when needed) */
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leaflet) return leaflet;
  leaflet = new Promise((resolve, reject) => {
    const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: `${LEAFLET}/leaflet.min.css` });
    const js = Object.assign(document.createElement("script"), { src: `${LEAFLET}/leaflet.min.js`, async: true });
    js.onload = () => (window.L ? resolve(window.L) : reject(new Error("Leaflet missing")));
    js.onerror = () => { js.remove(); reject(new Error("Couldn't load the map")); };
    document.head.append(css, js);
  });
  leaflet.catch(() => { leaflet = null; }); // try again next time (e.g. after coming back online)
  return leaflet;
}

/* ------------------------------------------------------------------ the map */
async function mountMap(el) {
  if (!el) return;
  let L;
  try { L = await loadLeaflet(); } catch {
    if (el.isConnected) el.innerHTML = `<div class="map-msg">🗺️<b>The map couldn't load</b><small>Check your internet, then open Map again.</small></div>`;
    return;
  }
  if (!el.isConnected || map) return; // left the page meanwhile, or already mounted
  map = L.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView(INDIA.center, INDIA.zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
  }).addTo(map);
  // once you pan or zoom yourself, the map stops re-centring by itself (until you tap Center)
  map.on("dragstart zoomstart", () => { if (!autoMoving) fitted = "user"; });
  pins = {};
  routeLine = null;
  fitted = false;
  setTimeout(() => map?.invalidateSize(), 60);
  refresh();
}

function unmountMap() {
  map?.remove();
  map = null;
  pins = {};
  routeLine = null;
}

function pinIcon(user, who, stale) {
  return window.L.divIcon({
    className: "map-pin-wrap",
    html: `<span class="map-pin ${who} ${stale ? "stale" : ""}">${avatarHtml(user, "sm")}</span>`,
    iconSize: [48, 56],
    iconAnchor: [24, 54]
  });
}

function placePin(key, pos, user, stale, title) {
  if (!pos) { if (pins[key]) { pins[key].marker.remove(); delete pins[key]; } return; }
  const sig = `${user?.avatar || ""}|${user?.name || ""}|${stale}`;
  const p = pins[key];
  if (!p) {
    pins[key] = { sig, marker: window.L.marker([pos.lat, pos.lng], { icon: pinIcon(user, key, stale), title, keyboard: false }).addTo(map) };
    return;
  }
  p.marker.setLatLng([pos.lat, pos.lng]);
  if (p.sig !== sig) { p.sig = sig; p.marker.setIcon(pinIcon(user, key, stale)); }
}

function fitView(force = false) {
  if (!map || (fitted === "user" && !force)) return;
  const a = mine(), b = theirs();
  const pts = [a, b].filter(Boolean).map(p => [p.lat, p.lng]);
  if (route?.coords?.length) pts.push(...route.coords);
  if (!pts.length && !force) return;
  autoMoving = true;
  clearTimeout(fitView.t);
  fitView.t = setTimeout(() => { autoMoving = false; }, 800); // after the zoom animation
  if (!pts.length) map.setView(INDIA.center, INDIA.zoom);
  else if (pts.length === 1) map.setView(pts[0], 15);
  else map.fitBounds(pts, { padding: [46, 46], maxZoom: 16 });
  if (pts.length) fitted = true;
}

function drawRoute() {
  if (!map) return;
  routeLine?.remove();
  routeLine = null;
  if (!route?.coords?.length) return;
  routeLine = window.L.layerGroup([
    window.L.polyline(route.coords, { color: "#3b1fb8", weight: 9, opacity: .35, lineCap: "round" }),
    window.L.polyline(route.coords, { color: "#ec4899", weight: 5, opacity: .95, lineCap: "round", lineJoin: "round" })
  ]).addTo(map);
}

/* ------------------------------------------------------------------ route (FOSSGIS OSRM, free, no key) */
async function fetchRoute({ quiet = false } = {}) {
  const a = mine(), b = theirs();
  if (!a || !b) { if (!quiet) toast(!a ? "Turn on Together so the map knows where you are." : `Waiting for ${partnerName()}'s location.`); return; }
  if (routeBusy) return;
  routeBusy = true;
  refresh();
  const m = mode;
  try {
    const url = `https://routing.openstreetmap.de/${MODES[m].engine}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.code !== "Ok" || !j.routes?.length) throw new Error(j.message || j.code || `HTTP ${r.status}`);
    const rt = j.routes[0];
    route = {
      for: uid(), mode: m, distance: rt.distance, duration: rt.duration, at: Date.now(),
      coords: rt.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      from: { lat: a.lat, lng: a.lng }, to: { lat: b.lat, lng: b.lng }
    };
    drawRoute();
    if (!quiet) fitView(true);
  } catch (err) {
    console.warn("[asaumi] route", err);
    if (!quiet) toast(navigator.onLine ? "Couldn't find a route right now. Try again in a minute." : "You're offline. Connect to see the route.");
  }
  routeBusy = false;
  refresh();
}

// someone moved a lot while the route is shown → work it out again (at most once a minute)
function maybeReroute() {
  if (!route || routeBusy || Date.now() - route.at < REROUTE_EVERY_MS) return;
  const a = mine(), b = theirs();
  if (!a || !b) return;
  if (meters(a, route.from) > REROUTE_METERS || meters(b, route.to) > REROUTE_METERS) fetchRoute({ quiet: true });
}

/* ------------------------------------------------------------------ panel under the map */
function panelHtml() {
  const p = state.partner;
  if (!sharingOn()) {
    return `
      <div class="map-note">
        <b>📍 Turn on Together</b>
        <small>The map uses Together to show where you both are. Your location is shared only while the app is open.</small>
      </div>
      <button class="btn btn-primary btn-block" data-action="toggleTogether">Turn on Together</button>`;
  }
  const a = mine(), b = theirs();
  const rows = `
    <div class="map-who">
      <div class="map-who-row"><span class="map-dot me"></span>${avatarHtml(state.me || { name: myName() }, "xs")}
        <span><b>You</b><small>${a ? "On the map now" : "Finding your location…"}</small></span></div>
      <div class="map-who-row"><span class="map-dot them"></span>${avatarHtml(p || { name: "?" }, "xs")}
        <span><b>${esc(partnerName())}</b><small>${b ? `${b.stale ? "Last seen here" : "Updated"} ${esc(ago(b.at))}` : "Not sharing location right now"}</small></span></div>
    </div>`;
  const straight = a && b ? `<p class="map-dist">${esc(fmtDistance(meters(a, b)))} apart <small>(straight line)</small></p>` : "";
  const chips = `<div class="ph-chips map-modes">${Object.entries(MODES).map(([k, v]) =>
    `<button class="ph-chip ${mode === k ? "on" : ""}" data-action="mapMode" data-m="${k}">${v.label}</button>`).join("")}</div>`;
  const shown = route && route.for === uid();
  const trip = shown
    ? `<p class="map-trip"><b>${esc(fmtDistance(route.distance))} · ${esc(fmtTrip(route.duration))}</b> ${esc(MODES[route.mode].verb)}${route.mode !== mode ? " <small>(tap Update route)</small>" : ""}</p>`
    : "";
  const can = !!(a && b);
  return `
    ${rows}
    ${straight}
    ${can ? chips : ""}
    ${trip}
    <div class="map-actions">
      <button class="btn btn-primary btn-sm" data-action="mapRoute" ${can && !routeBusy ? "" : "disabled"}>${routeBusy ? "Finding route…" : shown ? "Update route" : "🧭 Show route"}</button>
      ${can ? `<button class="btn btn-ghost btn-sm" data-action="mapNavigate">Navigate ↗</button>` : ""}
      <button class="btn btn-ghost btn-sm" data-action="mapCenter">Center</button>
      ${shown ? `<button class="btn btn-ghost btn-sm" data-action="mapClearRoute">Hide route</button>` : ""}
    </div>
    <small class="map-privacy">🔐 Route by OpenStreetMap's free routing service: your two locations are sent to it only when you ask for a route.</small>`;
}

function refresh() {
  if (route && route.for !== uid()) route = null; // signed in as someone else
  const panel = $("[data-map-panel]");
  if (panel) {
    const html = panelHtml();
    if (panel.dataset.html !== html) { panel.innerHTML = html; panel.dataset.html = html; }
  }
  if (!map || !window.L) return;
  const a = mine(), b = theirs();
  placePin("me", a, state.me || { name: myName() }, false, "You");
  placePin("them", b, state.partner || { name: partnerName() }, !!b?.stale, partnerName());
  if (route && !routeLine) drawRoute();
  if (!route && routeLine) { routeLine.remove(); routeLine = null; }
  if (!fitted || (fitted === true && Object.keys(pins).length === 2 && !route)) fitView();
  maybeReroute();
}

/* ------------------------------------------------------------------ page + Home card */
views.map = {
  // the page itself never changes (Leaflet owns the map); the panel and pins are updated by refresh()
  render() {
    queueMicrotask(refresh);
    return `
      <section class="page-head">
        <div>
          <p class="eyebrow">Together</p>
          <h1>🗺️ Our Map</h1>
          <p class="page-sub">Where you both are, and the way to each other.</p>
        </div>
      </section>
      <div class="map-box glass"><div class="map-canvas" id="our-map"></div></div>
      <div class="glass card map-panel" data-map-panel></div>`;
  },
  mounted(root) { mountMap($("#our-map", root)); },
  leave() { unmountMap(); }
};

export function mapCard() {
  if (!state.partner) return "";
  const a = sharingOn() ? mine() : null, b = theirs();
  const line = !sharingOn() ? "Turn on Together to see both of you on the map."
    : b?.stale ? `${partnerName()} was last seen on the map ${ago(b.at)}`
    : a && b ? `${fmtDistance(meters(a, b))} apart · see the way to ${partnerName()}`
    : b ? `${partnerName()} is on the map · finding you…` : `Waiting for ${partnerName()}'s location`;
  return `
    <article class="glass hcard map-card">
      <header class="hcard-head">
        <span class="hcard-ico">🗺️</span>
        <h3>Our Map</h3>
      </header>
      <small class="games-line">${esc(line)}</small>
      <button class="btn btn-ghost btn-block" data-nav="map">🧭 Open map &amp; route</button>
    </article>`;
}

Object.assign(actions, {
  mapRoute: () => fetchRoute(),
  mapMode: d => {
    if (!MODES[d.m] || d.m === mode) return;
    mode = d.m;
    if (route) fetchRoute(); else refresh();
  },
  mapCenter: () => fitView(true),
  mapClearRoute: () => { route = null; refresh(); fitView(true); },
  // turn-by-turn directions in the phone's maps app
  mapNavigate: () => {
    const a = mine(), b = theirs();
    if (!a || !b) return;
    openInApp(`https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${MODES[mode].google}`);
  }
});
