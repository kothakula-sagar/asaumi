import {
  state, uid, esc, ICONS, avatarHtml, presenceDot, statusText, isOnline, isTyping, myName, partnerName,
  shortWhen, fmtDuration, fmtFullDate, fmtTime, whenDate, cld, appName, views
} from "./core.js";
import { unreadMessages } from "./notify.js";
import { memoryTitle } from "./memories.js";
import { movementsSection } from "./movements.js";
import { togetherCard } from "./together.js";
import { weatherCard } from "./weather.js";
import { partnerMealsCard } from "./meals.js";
import { relationshipCard, storyLine } from "./relationship.js";
import { birthdayBanner } from "./birthday.js";
import { wishlistCard } from "./wishlist.js";
import { gamesCard } from "./games.js";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Still awake" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Good night";
}

export function messagePreview(m) {
  if (!m) return "";
  const who = m.from === uid() ? "You: " : "";
  const body = {
    image: "📷 Photo", video: "🎬 Video",
    voice: `🎤 Voice message (${fmtDuration(m.media?.duration)})`,
    sticker: "🎨 Sticker"
  }[m.type] || m.text || "";
  return who + body;
}

function lastCallLine() {
  const c = state.calls.find(x => ["ended", "missed", "declined", "busy", "failed"].includes(x.status));
  if (!c) return "No calls yet — say hello ❤️";
  const out = c.callerId === uid();
  const kind = c.kind === "audio" ? "Audio" : "Video";
  if (c.status === "ended" && c.duration) return `Last ${kind.toLowerCase()} call · ${fmtDuration(c.duration)} · ${shortWhen(c.createdAt)}`;
  if (c.status === "missed" && !out) return `Missed ${kind.toLowerCase()} call · ${shortWhen(c.createdAt)}`;
  return `${kind} call · ${out ? "no answer" : c.status} · ${shortWhen(c.createdAt)}`;
}

function renderHome() {
  const p = state.partner;
  const last = state.messages.at(-1);
  const unread = unreadMessages();
  const typing = p && isTyping(p.uid);
  // the full memory list is only loaded after Memories is unlocked; until then Home uses the newest one + a count
  const mem = state.loaded.memories ? state.memories[0] : state.memLatest;
  const memCount = state.loaded.memories ? state.memories.length : state.memCount;
  const mv = state.movements[0];
  const mvDate = mv && whenDate(mv.when);

  return `
    <section class="home-hero">
      <div class="couple">
        ${avatarHtml(state.me || { name: myName() }, "lg")}
        <span class="couple-heart">❤️</span>
        <span class="avatar-wrap">${avatarHtml(p || { name: "?" }, "lg")}${p ? presenceDot(p.uid) : ""}</span>
      </div>
      <div class="home-hero-text">
        <p class="eyebrow">${esc(greeting())}</p>
        <h1>Hi, ${esc(myName())}</h1>
        <p class="presence-line ${p && isOnline(p.uid) ? "on" : ""}">
          ${p ? `<i></i>${esc(partnerName())} · ${esc(statusText(p.uid))}` : "Waiting for your person to sign in ❤️"}
        </p>
      </div>
    </section>

    ${birthdayBanner()}
    <div class="home-grid">
      ${relationshipCard()}
      ${togetherCard()}
      ${weatherCard()}
      ${partnerMealsCard()}
      <article class="glass hcard">
        <header class="hcard-head">
          <span class="hcard-ico">💬</span>
          <h3>Continue Chat</h3>
          ${unread ? `<span class="count-badge">${unread > 99 ? "99+" : unread}</span>` : ""}
        </header>
        <div class="hcard-row">
          <span class="avatar-wrap">${avatarHtml(p || { name: "?" }, "md")}${p ? presenceDot(p.uid) : ""}</span>
          <div class="hcard-main">
            <b>${esc(partnerName())}</b>
            <small class="${typing ? "typing" : ""}">${typing ? 'typing<span class="tdots sm"><i></i><i></i><i></i></span>'
              : last ? esc(messagePreview(last)) : "Start your conversation ❤️"}</small>
          </div>
          <small class="hcard-time">${last ? esc(shortWhen(last.createdAt)) : ""}</small>
        </div>
        <button class="btn btn-primary btn-block" data-nav="chat">${ICONS.chat} Open Chat</button>
      </article>

      <article class="glass hcard">
        <header class="hcard-head">
          <span class="hcard-ico">🔐</span>
          <h3>Memories</h3>
          ${memCount == null ? "" : `<span class="hcard-count">${memCount} ${memCount === 1 ? "memory" : "memories"}</span>`}
        </header>
        <div class="hcard-row">
          <span class="mem-thumb">${mem ? `<img src="${esc(cld(mem.url, "f_auto,q_auto,c_fill,w_160,h_160,e_blur:600"))}" alt="" />` : ""}<i>${ICONS.lock}</i></span>
          <div class="hcard-main">
            <b>${mem ? esc(memoryTitle(mem)) : "No memories yet"}</b>
            <small>${mem ? `Latest · ${esc(fmtFullDate(mem.createdAt))}` : "Some moments are still waiting to become memories."}</small>
          </div>
        </div>
        <button class="btn btn-ghost btn-block" data-nav="memories">${ICONS.lock} View Memories</button>
      </article>

      ${gamesCard()}

      ${wishlistCard()}

      <article class="glass hcard">
        <header class="hcard-head">
          <span class="hcard-ico">❤️</span>
          <h3>Memorable Movement</h3>
        </header>
        ${mv ? `
          <p class="hcard-quote">“${esc(mv.text)}”</p>
          <div class="hcard-facts">
            <span>${mvDate ? esc(fmtFullDate(mvDate)) : ""}</span>
            <span>${mvDate ? esc(fmtTime(mvDate)) : ""}</span>
            <span>By ${esc(mv.byUid === uid() ? myName() : mv.byName || partnerName())}</span>
          </div>
          <button class="btn btn-ghost btn-block" data-action="openMovement" data-id="${mv.id}">View Details</button>` : `
          <p class="hcard-quote muted">No memorable movements yet.</p>
          <button class="btn btn-ghost btn-block" data-action="addMovement">${ICONS.plus} Add the first one</button>`}
      </article>

      <article class="glass hcard call-card">
        <header class="hcard-head">
          <span class="hcard-ico">📹</span>
          <h3>Video Call</h3>
        </header>
        <p class="call-card-title">Call your person ❤️</p>
        <small class="call-card-sub">${esc(lastCallLine())}</small>
        <div class="call-card-actions">
          <button class="btn btn-primary" data-action="startCall" data-kind="video">${ICONS.video} Video Call</button>
          <button class="btn btn-ghost" data-action="startCall" data-kind="audio">${ICONS.mic} Audio</button>
        </div>
      </article>
    </div>`;
}

function renderAsaumi() {
  const p = state.partner;
  const names = [myName(), p?.name].filter(Boolean);
  return `
    <section class="glass us-hero">
      <div class="us-couple">
        ${avatarHtml(state.me || { name: myName() }, "xl")}
        <span class="us-heart">❤️</span>
        <span class="avatar-wrap">${avatarHtml(p || { name: "?" }, "xl")}${p ? presenceDot(p.uid) : ""}</span>
      </div>
      <h1>❤️ ${esc(appName())}</h1>
      <p class="us-sub">A little world for two.</p>
      <p class="us-names">${esc(names.join(" & "))}</p>
      ${storyLine() ? `<p class="us-story">${esc(storyLine())}</p>` : ""}
      <p class="presence-line center ${p && isOnline(p.uid) ? "on" : ""}">${p ? `<i></i>${esc(partnerName())} · ${esc(statusText(p.uid))}` : "Waiting for your person ❤️"}</p>
      <div class="us-actions">
        <button class="us-act" data-nav="chat"><span>${ICONS.chat}</span>Chat</button>
        <button class="us-act" data-action="startCall" data-kind="video"><span>${ICONS.video}</span>Video</button>
        <button class="us-act" data-action="startCall" data-kind="audio"><span>${ICONS.phone}</span>Call</button>
        <button class="us-act" data-nav="memories"><span>${ICONS.lock}</span>Memories</button>
        <button class="us-act" data-nav="wishlist"><span>🎁</span>Wishes</button>
        <button class="us-act" data-nav="games"><span>🎮</span>Games</button>
      </div>
    </section>
    ${movementsSection()}`;
}

views.home = { render: renderHome };
views.asaumi = { render: renderAsaumi };
