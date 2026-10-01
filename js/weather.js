// Weather card on Home: current weather + a caring tip for you and your partner.
// Uses the positions Together already has (no extra location request) and Open-Meteo (free, no API key).
import { state, esc, myName, partnerName, scheduleRender } from "./core.js";
import { myPosition, partnerPosition, sharingOn } from "./together.js";

const REFRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
const cache = {}; // place key → { status: "loading" | "ok" | "error", data, at }

const placeKey = p => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;

async function fetchWeather(p) {
  const key = placeKey(p);
  cache[key] = { ...(cache[key] || {}), status: cache[key]?.data ? "ok" : "loading", loading: true, at: Date.now() };
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lng.toFixed(3)}` +
      "&current=temperature_2m,apparent_temperature,weather_code&timezone=auto";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = (await res.json()).current;
    if (!c) throw new Error("no data");
    cache[key] = { status: "ok", at: Date.now(), data: { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code } };
  } catch (err) {
    console.warn("[asaumi] weather", err);
    cache[key] = { status: cache[key]?.data ? "ok" : "error", data: cache[key]?.data, at: Date.now() - REFRESH_MS + RETRY_MS };
  }
  scheduleRender();
}

function weatherFor(p) {
  const key = placeKey(p);
  const c = cache[key];
  if (!c || (!c.loading && Date.now() - c.at > REFRESH_MS)) fetchWeather(p);
  if (c && !c.loading && Date.now() - c.at <= REFRESH_MS) return c;
  return c?.data ? c : { status: c?.status === "error" ? "error" : "loading" };
}

// WMO weather codes → condition
function condition(code) {
  if (code === 0) return { emoji: "☀️", text: "Clear sky", kind: "clear" };
  if (code === 1 || code === 2) return { emoji: "🌤️", text: "Partly cloudy", kind: "clear" };
  if (code === 3) return { emoji: "☁️", text: "Cloudy", kind: "clear" };
  if (code === 45 || code === 48) return { emoji: "🌫️", text: "Foggy", kind: "fog" };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", text: "Drizzle", kind: "rain" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { emoji: "🌧️", text: "Rain", kind: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { emoji: "❄️", text: "Snow", kind: "snow" };
  if (code >= 95) return { emoji: "⛈️", text: "Thunderstorm", kind: "storm" };
  return { emoji: "🌡️", text: "Weather", kind: "clear" };
}

// Rain / storm / snow / fog come first, then the feels-like temperature
function tip(cond, feels) {
  if (cond.kind === "rain") return "It's raining 🌧️ Stay at home today, have something hot ☕🏠";
  if (cond.kind === "storm") return "Thunderstorm ⛈️ Stay at home, stay safe and cozy 🏠💛";
  if (cond.kind === "snow") return "Snowy ❄️ Stay in, wear heated clothes if you go out 🧤🧣";
  if (cond.kind === "fog") return "Foggy 🌫️ Be careful on the road, go slow 🚗💛";
  if (feels <= 10) return "Very cold 🥶 Wear heated clothes, thermals and a warm cap 🧥🧣🧤";
  if (feels <= 18) return "Chilly 🧥 Wear a jacket or sweater and keep warm 🧣";
  if (feels <= 26) return "Lovely weather 😊 A perfect time to go out 🌳";
  if (feels <= 32) return "Warm 🌤️ Wear light clothes and drink enough water 💧";
  if (feels <= 38) return "Hot 🥵 Drink lots of water, wear cotton, use sunscreen and sunglasses 💧🧴🕶️";
  return "Very hot 🔥 Avoid going out in the afternoon, stay in the shade or AC and keep drinking water 🧊💧";
}

function row(who, p) {
  const w = weatherFor(p);
  if (w.status === "loading" && !w.data) {
    return `<div class="wx-row"><span class="wx-emoji pulse">🌡️</span><div class="wx-main"><b>${esc(who)}</b><small>Checking the weather…</small></div></div>`;
  }
  if (!w.data) {
    return `<div class="wx-row"><span class="wx-emoji">🌥️</span><div class="wx-main"><b>${esc(who)}</b><small>Couldn't get the weather. Will try again soon.</small></div></div>`;
  }
  const { temp, feels, code } = w.data;
  const cond = condition(code);
  return `
    <div class="wx-row">
      <span class="wx-emoji">${cond.emoji}</span>
      <div class="wx-main">
        <b>${esc(who)} · ${Math.round(temp)}°C <span class="wx-cond">${esc(cond.text)}</span></b>
        <small>Feels like ${Math.round(feels)}°C</small>
        <p class="wx-tip">${esc(tip(cond, feels))}</p>
      </div>
    </div>`;
}

export function weatherCard() {
  const mine = myPosition();
  if (!sharingOn() || !mine) return "";
  const theirs = partnerPosition();
  return `
    <article class="glass hcard weather">
      <header class="hcard-head"><span class="hcard-ico">🌤️</span><h3>Weather</h3></header>
      ${row(`${myName()} (you)`, mine)}
      ${theirs ? row(partnerName(), theirs) : ""}
    </article>`;
}
