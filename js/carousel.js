// Carousel used for chat albums and Memories: arrow buttons, swipe (native scroll-snap), counter and dots.
import { esc } from "./core.js";

const CHEV = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

// slides: HTML strings, one per item
export function carouselHtml(slides, { id = "", ratio = "4 / 5", cls = "" } = {}) {
  const n = slides.length;
  return `
    <div class="carousel ${cls}" ${id ? `data-car="${esc(id)}"` : ""} style="aspect-ratio:${ratio}">
      <div class="car-track">${slides.map(s => `<div class="car-slide">${s}</div>`).join("")}</div>
      <button type="button" class="car-arrow prev" data-car-go="-1" aria-label="Previous" hidden>${CHEV("m15 18-6-6 6-6")}</button>
      <button type="button" class="car-arrow next" data-car-go="1" aria-label="Next">${CHEV("m9 18 6-6-6-6")}</button>
      <span class="car-count">1 / ${n}</span>
      <div class="car-dots">${slides.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>
    </div>`;
}

// onChange(i) runs when the slide changes; start = slide to show first
export function wireCarousel(car, onChange, start = 0) {
  if (!car || car.dataset.wired) return;
  car.dataset.wired = "1";
  const track = car.querySelector(".car-track");
  const n = track.children.length;
  let shown = -1, want = null; // want: where a tapped arrow is heading (quick double taps keep going)
  const paint = i => {
    i = Math.max(0, Math.min(n - 1, i));
    if (i === want) want = null;
    if (i === shown) return;
    shown = i;
    car.querySelector(".car-count").textContent = `${i + 1} / ${n}`;
    car.querySelector(".prev").hidden = i === 0;
    car.querySelector(".next").hidden = i === n - 1;
    car.querySelectorAll(".car-dots i").forEach((d, j) => d.classList.toggle("on", j === i));
    car.classList.toggle("on-video", !!track.children[i].querySelector("video")); // dots would cover the video controls
    [...track.children].forEach((s, j) => { if (j !== i) s.querySelector("video")?.pause(); });
    onChange?.(i);
  };
  const go = i => {
    want = Math.max(0, Math.min(n - 1, i));
    track.scrollTo({ left: want * track.clientWidth, behavior: "smooth" });
  };
  track.addEventListener("scroll", () => paint(Math.round(track.scrollLeft / (track.clientWidth || 1))), { passive: true });
  track.addEventListener("scrollend", () => { want = null; });
  car.querySelectorAll("[data-car-go]").forEach(b => b.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    go((want ?? shown) + Number(b.dataset.carGo));
  }));
  if (start) {
    shown = -1;
    requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; paint(start); });
  } else {
    shown = 0;
    car.classList.toggle("on-video", !!track.children[0]?.querySelector("video"));
  }
}
