// 🎮 Our Games: Ludo, Snake & Ladder and Tic-Tac-Toe, played live between the two phones.
//  • One Firestore document per game (games/{id}). A move is one small update, so it costs one read per phone.
//    Only the open game is listened to (normally 0 or 1 document). Scores live in settings/games.
//  • Every update carries moveNo + 1; the rules reject a second write made from the same moveNo, so the two
//    phones can never both move at once.
//  • The board is built once when the game opens and then only animated (CSS transforms / transitions);
//    the app's normal re-render never touches it, so it stays smooth.
import {
  doc, collection, onSnapshot, query, where, updateDoc, writeBatch, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, esc, ICONS, toast, openModal, confirmDialog, avatarHtml, myName, partnerName, shortWhen,
  scheduleRender, actions, views, hooks, $, $$
} from "./core.js";
import { notifyPartner } from "./notify.js";
import ludo from "./game-ludo.js";
import snake from "./game-snake.js";
import ttt from "./game-ttt.js";

export const GAMES = { ludo, snake, ttt };
const ORDER = ["ludo", "snake", "ttt"];

const REACTIONS = ["❤️", "😘", "🥰", "😂", "😜", "😤", "🔥", "👏"];
const TAGLINES = [
  "Loser owes a hug 🤗", "Winner gets a kiss 😘", "Let's see who rules this heart ❤️",
  "Play nice… or don't 😜", "Bragging rights on the line 👑"
];
const DARES = [
  "Loser gives a 1-minute hug 🤗",
  "Loser sends a voice note saying “I love you” 🎤",
  "Loser treats the winner to their favourite snack 🍫",
  "Winner picks tonight's movie 🎬",
  "Loser writes 3 things they love about the winner 💌",
  "Loser sends their cutest selfie right now 🤳",
  "Loser owes the winner 10 kisses 😘",
  "Loser sings a little song for the winner 🎶",
  "Loser gives a 5-minute massage 💆",
  "Winner gets breakfast made for them ☕",
  "Loser plans the next date ✨",
  "Loser has to say “You're the best” 5 times 🥹"
];

const G = { open: null, scores: null };
let screen = "lobby";          // "lobby" | "play"
let pendingOpen = null;        // game just created here → open it as soon as it arrives
const prompted = new Set();    // invites already shown as a popup
const closingByMe = new Set(); // games this phone closed (no "they ended it" message)
let inviteModal = null;
let play = null;               // the live game screen

/* ------------------------------------------------------------------ helpers */
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const ms = t => t?.toMillis?.() || 0;
const otherOf = g => g.players.find(u => u !== uid()) || g.players[1];
const colorOf = (g, u) => (g.players[0] === u ? "rose" : "sky");
const winsOf = (u, type) => G.scores?.wins?.[u]?.[type] || 0;
const totalWins = u => ORDER.reduce((s, t) => s + winsOf(u, t), 0);
const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const pName = () => partnerName();

// fair dice: 1-6 from the crypto random generator
export function rollValue() {
  const b = new Uint8Array(1);
  do { crypto.getRandomValues(b); } while (b[0] >= 252);
  return (b[0] % 6) + 1;
}

/* ------------------------------------------------------------------ dice (shared by Ludo + Snake & Ladder) */
const PIPS = '<i></i>'.repeat(9);
export const diceHtml = (v = 1) => `<span class="dice-face" data-v="${v}">${PIPS}</span>`;
export async function rollDice(btn, v) {
  const face = btn.querySelector(".dice-face");
  btn.classList.remove("rolling");
  void btn.offsetWidth;
  btn.classList.add("rolling");
  for (let i = 0; i < 7; i++) { face.dataset.v = String(1 + ((Math.random() * 6) | 0)); await sleep(70); }
  face.dataset.v = String(v);
  await sleep(160);
  btn.classList.remove("rolling");
}

/* ------------------------------------------------------------------ sync */
export function watchGames() {
  G.open = null;
  G.scores = null;
  screen = "lobby";
  prompted.clear();
  unmountPlay();
  return [
    onSnapshot(query(collection(db, "games"), where("open", "==", true)), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
      onGame(list[0] || null);
      // only one open game at a time (e.g. both invited at the same moment): close the older ones
      list.slice(1).forEach(g => closeGame(g, "ended"));
    }, err => console.warn("[asaumi] games", err)),
    onSnapshot(doc(db, "settings", "games"), s => {
      G.scores = s.exists() ? s.data() : {};
      if (play) paintChrome(play);
      scheduleRender();
    }, err => console.warn("[asaumi] game scores", err))
  ];
}

function onGame(game) {
  const me = uid();
  const prev = G.open;
  G.open = game;
  if (game) {
    if (game.id === pendingOpen) {
      pendingOpen = null;
      screen = "play";
      if (state.view !== "games") hooks.go("games");
    }
    if (game.status === "invited" && game.inviter !== me) showInvite(game);
    if (game.status === "declined" && game.inviter === me) {
      toast(`${pName()} can't play right now 💭 Maybe later!`);
      closingByMe.add(game.id);
      closeGame(game, "declined");
    }
    if (prev?.id === game.id && prev.status === "invited" && game.status === "active" && game.inviter === me) onAccepted(game);
  }
  if (inviteModal && (game?.id !== inviteModal.gameId || game?.status !== "invited")) { inviteModal.close(); inviteModal = null; }
  receive(game);
  scheduleRender();
}

// Writes one step of a game. Every write moves moveNo on by one (see the rules).
async function commit(game, fields) {
  const b = writeBatch(db);
  b.update(doc(db, "games", game.id), { ...fields, moveNo: game.moveNo + 1, updatedAt: serverTimestamp() });
  if (fields.status === "done" && fields.winner) {
    const s = G.scores || {};
    const recent = [{ type: game.type, w: fields.winner, at: Date.now() }, ...(s.recent || [])].slice(0, 10);
    b.set(doc(db, "settings", "games"), fields.winner === "draw"
      ? { draws: { [game.type]: increment(1) }, recent }
      : { wins: { [fields.winner]: { [game.type]: increment(1) } }, recent }, { merge: true });
  }
  try { await b.commit(); return true; }
  catch (err) {
    console.warn("[asaumi] game move", err);
    toast(err?.code === "permission-denied" ? "Games need the latest firestore.rules (publish them in Firebase)." : "That move didn't go through. Try again.");
    return false;
  }
}

function closeGame(g, status) {
  updateDoc(doc(db, "games", g.id), { open: false, status, moveNo: g.moveNo + 1, updatedAt: serverTimestamp() })
    .catch(err => console.warn("[asaumi] close game", err));
}

/* ------------------------------------------------------------------ invites */
async function createInvite(type, opts = {}) {
  if (!state.partner) { toast(`${pName()} hasn't signed in yet.`); return; }
  const me = uid(), other = state.partner.uid, mod = GAMES[type];
  const init = mod.init([me, other], opts, me);
  const ref = doc(collection(db, "games"));
  const b = writeBatch(db);
  if (G.open) { // replace the open game
    closingByMe.add(G.open.id);
    b.update(doc(db, "games", G.open.id), { open: false, status: G.open.status === "done" ? "done" : "ended", moveNo: G.open.moveNo + 1, updatedAt: serverTimestamp() });
  }
  b.set(ref, {
    type, opts, players: [me, other], inviter: me, status: "invited", open: true,
    state: init.state, turn: init.turn, starter: me, round: 1, moveNo: 0, winner: null, last: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  pendingOpen = ref.id;
  b.commit().catch(err => {
    console.warn("[asaumi] game invite", err);
    pendingOpen = null;
    toast(err?.code === "permission-denied" ? "Games need the latest firestore.rules (publish them in Firebase)." : "Couldn't send the invite. Try again.");
  });
  notifyPartner("game", `${myName()} invited you to play ${mod.name} ${mod.emoji}`, { refId: ref.id });
}

async function inviteFlow(type) {
  const mod = GAMES[type];
  if (!mod) return;
  if (!state.partner) { toast("Your person hasn't signed in yet."); return; }
  const g = G.open;
  if (g && g.status !== "done") {
    const ok = await confirmDialog({
      icon: "🎮", title: "Start a new game?",
      text: `Your ${GAMES[g.type]?.name || "current"} game will end.`, ok: "Start new"
    });
    if (!ok) return;
  }
  if (type !== "ludo") { createInvite(type); return; }
  // Ludo: classic (4 tokens) or quick (2 tokens)
  const m = openModal(`
    <div class="detail-emoji">🎲</div>
    <h2>Ludo</h2>
    <p>How long do you want to play?</p>
    <div class="gl-modes">
      <button class="gl-mode" data-n="2"><b>⚡ Quick</b><small>2 tokens each · about 10 min</small></button>
      <button class="gl-mode" data-n="4"><b>👑 Classic</b><small>4 tokens each · the real thing</small></button>
    </div>
    <button class="btn btn-ghost btn-block" data-close>Cancel</button>`);
  $$("[data-n]", m).forEach(b => b.addEventListener("click", () => { m.close(); createInvite("ludo", { tokens: Number(b.dataset.n) }); }));
}

function showInvite(game) {
  if (prompted.has(game.id) || inviteModal) return;
  if (state.locked) return; // shown after the PIN (checkGameInvite)
  prompted.add(game.id);
  const mod = GAMES[game.type];
  if (!mod) return;
  const m = openModal(`
    <div class="gi-orb"><span>${mod.emoji}</span><i>💌</i></div>
    <h2>${esc(pName())} wants to play ${esc(mod.name)} with you!</h2>
    <p class="gi-tag">${esc(TAGLINES[hash(game.id) % TAGLINES.length])}</p>
    ${game.type === "ludo" ? `<p class="muted small">${game.opts?.tokens === 2 ? "⚡ Quick game · 2 tokens each" : "👑 Classic · 4 tokens each"}</p>` : ""}
    <div class="modal-actions">
      <button class="btn btn-ghost" data-no>Not now</button>
      <button class="btn btn-primary" data-yes>Let's play ❤️</button>
    </div>`, { cls: "game-invite" });
  m.gameId = game.id;
  inviteModal = m;
  m.onclose = () => { if (inviteModal === m) inviteModal = null; };
  $("[data-yes]", m).addEventListener("click", () => { m.close(); acceptInvite(); });
  $("[data-no]", m).addEventListener("click", () => { m.close(); declineInvite(); });
  navigator.vibrate?.([40, 60, 40]);
}

// after the PIN: show an invite that arrived while locked
export function checkGameInvite() {
  const g = G.open;
  if (g && g.status === "invited" && g.inviter !== uid()) showInvite(g);
}

async function acceptInvite() {
  const g = G.open;
  if (!g || g.status !== "invited") { toast("That invite isn't there anymore."); return; }
  screen = "play";
  hooks.go("games");
  scheduleRender();
  if (!(await commit(g, { status: "active" }))) { screen = "lobby"; scheduleRender(); }
}

function declineInvite() {
  const g = G.open;
  if (g && g.status === "invited") commit(g, { status: "declined" });
}

function onAccepted(game) {
  if (state.view === "games") { screen = "play"; scheduleRender(); return; }
  const mod = GAMES[game.type];
  const m = openModal(`
    <div class="gi-orb"><span>${mod.emoji}</span><i>💞</i></div>
    <h2>${esc(pName())} joined your ${esc(mod.name)}!</h2>
    <p class="gi-tag">Game on ❤️</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Later</button>
      <button class="btn btn-primary" data-go>Play now</button>
    </div>`);
  $("[data-go]", m).addEventListener("click", () => { m.close(); screen = "play"; hooks.go("games"); });
}

/* ------------------------------------------------------------------ lobby */
function scoreBoard() {
  const me = uid(), other = state.partner?.uid;
  const a = totalWins(me), b = other ? totalWins(other) : 0;
  const lead = a === b ? (a ? "Tied, a perfect match 💞" : "No games yet. Who'll win first? 👀")
    : `${a > b ? "You lead" : `${pName()} leads`} by ${Math.abs(a - b)} 👑`;
  return `
    <div class="glass gl-score">
      <div class="gl-side ${a > b ? "lead" : ""}">${a > b ? '<i class="gl-crown">👑</i>' : ""}${avatarHtml(state.me || { name: myName() }, "lg")}<b>You</b><em>${a}</em></div>
      <div class="gl-mid"><span class="gl-heart">❤️</span><small>total wins</small></div>
      <div class="gl-side ${b > a ? "lead" : ""}">${b > a ? '<i class="gl-crown">👑</i>' : ""}${avatarHtml(state.partner || { name: "?" }, "lg")}<b>${esc(pName())}</b><em>${b}</em></div>
      <p class="gl-lead">${esc(lead)}</p>
    </div>`;
}

function openBanner() {
  const g = G.open, me = uid();
  if (!g || !GAMES[g.type]) return "";
  const mod = GAMES[g.type];
  let text, btns;
  if (g.status === "invited" && g.inviter === me) {
    text = `💌 Waiting for ${esc(pName())} to join ${esc(mod.name)}…`;
    btns = `<button class="btn btn-ghost btn-sm" data-action="gameCancel">Cancel</button><button class="btn btn-primary btn-sm" data-action="gameOpen">Open</button>`;
  } else if (g.status === "invited") {
    text = `💌 ${esc(pName())} invited you to ${esc(mod.name)}!`;
    btns = `<button class="btn btn-ghost btn-sm" data-action="gameDecline">Not now</button><button class="btn btn-primary btn-sm" data-action="gameAccept">Let's play ❤️</button>`;
  } else if (g.status === "active") {
    text = g.turn === me ? `✨ Your turn in ${esc(mod.name)}` : `💭 ${esc(pName())}'s turn in ${esc(mod.name)}`;
    btns = `<button class="btn btn-primary btn-sm" data-action="gameOpen">▶ Continue</button>`;
  } else if (g.status === "done") {
    text = g.winner === "draw" ? `🤝 Last ${esc(mod.name)} was a draw` : `🏆 ${g.winner === me ? "You" : esc(pName())} won the last ${esc(mod.name)}`;
    btns = `<button class="btn btn-primary btn-sm" data-action="gameOpen">🔁 Rematch</button>`;
  } else return "";
  return `<div class="glass gl-open ${g.status === "active" && g.turn === me ? "my-turn" : ""}"><span class="gl-open-ico">${mod.emoji}</span><b>${text}</b><div class="gl-open-btns">${btns}</div></div>`;
}

function gameCard(type) {
  const mod = GAMES[type], me = uid(), other = state.partner?.uid;
  const g = G.open;
  const here = g && g.type === type && g.status !== "done";
  const draws = G.scores?.draws?.[type] || 0;
  return `
    <article class="glass gl-card gl-${type}">
      <div class="gl-art"><span>${mod.emoji}</span></div>
      <div class="gl-info">
        <h3>${esc(mod.name)}</h3>
        <p>${esc(mod.desc)}</p>
        <div class="gl-mini"><span>You <b>${winsOf(me, type)}</b></span><span>${esc(pName())} <b>${other ? winsOf(other, type) : 0}</b></span>${draws ? `<span>Draws <b>${draws}</b></span>` : ""}</div>
      </div>
      ${here
        ? `<button class="btn btn-ghost btn-sm" data-action="gameOpen">▶ Open</button>`
        : `<button class="btn btn-primary btn-sm" data-action="gameInvite" data-type="${type}" ${state.partner ? "" : "disabled"}>💌 Invite</button>`}
    </article>`;
}

function recentList() {
  const r = (G.scores?.recent || []).slice(0, 5);
  if (!r.length) return "";
  const me = uid();
  return `
    <div class="section-head"><div><h2>Recent games</h2></div></div>
    <div class="glass gl-recent">${r.map(x => `
      <div class="gl-rec"><span>${GAMES[x.type]?.emoji || "🎮"}</span>
        <b>${x.w === "draw" ? "Draw" : x.w === me ? "You won" : `${esc(pName())} won`}</b>
        <small>${esc(GAMES[x.type]?.name || "")} · ${esc(shortWhen(new Date(x.at)))}</small>
      </div>`).join("")}</div>`;
}

function lobbyHtml() {
  return `
    <section class="page-head">
      <div>
        <p class="eyebrow">Play together</p>
        <h1>🎮 Our Games</h1>
        <p class="page-sub">Little games, big love. Winner gets bragging rights 😘</p>
      </div>
    </section>
    ${openBanner()}
    ${scoreBoard()}
    <div class="gl-grid">${ORDER.map(gameCard).join("")}</div>
    ${recentList()}`;
}

// Home card
export function gamesCard() {
  const g = G.open, me = uid(), mod = g && GAMES[g.type];
  let line = "Ludo · Snake & Ladder · Tic-Tac-Toe", hot = false;
  if (mod && g.status === "invited") { hot = g.inviter !== me; line = hot ? `💌 ${pName()} invited you to ${mod.name}!` : `Waiting for ${pName()} to join ${mod.name}…`; }
  else if (mod && g.status === "active") { hot = g.turn === me; line = hot ? `✨ Your turn in ${mod.name}` : `${pName()}'s turn in ${mod.name}`; }
  return `
    <article class="glass hcard games-card ${hot ? "hot" : ""}">
      <header class="hcard-head">
        <span class="hcard-ico">🎮</span>
        <h3>Our Games</h3>
        ${hot ? '<span class="count-badge">!</span>' : ""}
      </header>
      <div class="games-strip"><span>🎲</span><span>🐍</span><span>❌⭕</span></div>
      <small class="games-line">${esc(line)}</small>
      <button class="btn btn-primary btn-block" data-nav="games">🎮 Play together</button>
    </article>`;
}

/* ------------------------------------------------------------------ game screen */
function mountPlay(el) {
  unmountPlay();
  const game = G.open;
  const mod = game && GAMES[game.type];
  if (!mod) return;
  el.innerHTML = `
    <header class="gm-head">
      <button class="icon-btn sm ghost" data-gm-back aria-label="Back to games">${ICONS.back}</button>
      <div class="gm-title"><b>${mod.emoji} ${esc(mod.name)}</b><small data-gm-round></small></div>
      <button class="icon-btn sm ghost" data-gm-menu aria-label="Game menu">${ICONS.dots}</button>
    </header>
    <div class="gm-players" data-gm-players></div>
    <p class="gm-status" data-gm-status></p>
    <div class="gm-stage">
      <div class="gm-board" data-gm-board></div>
      <div class="gm-fx" data-gm-fx></div>
      <div class="gm-banner" data-gm-banner></div>
      <div class="gm-wait" data-gm-wait hidden></div>
    </div>
    <div class="gm-controls" data-gm-controls></div>
    <div class="gm-react">${REACTIONS.map(e => `<button data-react="${e}" aria-label="Send ${e}">${e}</button>`).join("")}</div>`;

  const p = { el, game, shown: game, queue: [], running: false, busy: false, sending: false, lastReact: game.react?.n || 0, winKey: null, winEl: null };
  const me = uid();
  const ctx = {
    me,
    get other() { return otherOf(p.game); },
    game: () => p.shown,
    color: u => colorOf(p.game, u),
    name: u => (u === me ? "You" : pName()),
    avatar: (u, cls = "") => avatarHtml(u === me ? (state.me || { name: myName() }) : (state.members[u] || { name: pName() }), cls),
    canAct: () => !!(p.shown.status === "active" && p.shown.turn === me && !p.busy && !p.sending && p.shown.moveNo === p.game.moveNo),
    move: fields => {
      if (!ctx.canAct()) return;
      p.sending = true;
      paintChrome(p);
      commit(p.shown, fields).then(ok => { if (!ok) { p.sending = false; paintChrome(p); } });
    },
    rollValue,
    dice: { html: diceHtml, roll: rollDice },
    say: text => banner(p, text),
    sleep
  };
  p.ctx = ctx;
  p.inst = mod.mount({ board: $("[data-gm-board]", el), controls: $("[data-gm-controls]", el), ctx });
  play = p;
  p.inst.update(game, null, false);
  paintChrome(p);
  if (game.status === "done") showWin(p, game, false);

  $("[data-gm-back]", el).addEventListener("click", () => { screen = "lobby"; scheduleRender(); });
  $("[data-gm-menu]", el).addEventListener("click", () => gameMenu(p));
  let lastTap = 0;
  $(".gm-react", el).addEventListener("click", e => {
    const b = e.target.closest("[data-react]");
    if (!b || Date.now() - lastTap < 350) return;
    lastTap = Date.now();
    burst(p, b.dataset.react, true);
    const n = Date.now();
    p.lastReact = n;
    updateDoc(doc(db, "games", p.game.id), { react: { by: me, e: b.dataset.react, n } }).catch(() => {});
  });
}

function unmountPlay() {
  if (!play) return;
  play.inst?.destroy?.();
  play = null;
}

function receive(game) {
  const p = play;
  if (!p) return;
  if (!game || game.id !== p.game.id) {
    // closed → back to the list; replaced by a new game → the screen re-opens with the new one
    if (!game) {
      if (!closingByMe.has(p.game.id)) toast(`${pName()} ended the game 🎮`);
      screen = "lobby";
    }
    unmountPlay();
    scheduleRender();
    return;
  }
  p.game = game;
  p.queue.push(game);
  pump(p);
}

// Plays updates one after another, so animations never overlap
async function pump(p) {
  if (p.running) return;
  p.running = true;
  while (p.queue.length && play === p) {
    const g = p.queue.shift();
    const prev = p.shown;
    if (g.react?.n && g.react.n !== p.lastReact) {
      p.lastReact = g.react.n;
      if (g.react.by !== uid()) { burst(p, g.react.e, false); navigator.vibrate?.(12); }
    }
    const moved = g.moveNo !== prev.moveNo || g.round !== prev.round;
    if (moved) {
      p.sending = false;
      p.busy = true;
      paintChrome(p);
      const animate = g.moveNo === prev.moveNo + 1 && g.round === prev.round && prev.status === "active";
      try { await p.inst.update(g, prev, animate); } catch (err) { console.warn("[asaumi] game update", err); }
      p.busy = false;
    }
    p.shown = g;
    paintChrome(p);
    if (g.status === "done") showWin(p, g, moved && g.moveNo === prev.moveNo + 1);
    else hideWin(p);
  }
  p.running = false;
}

function paintChrome(p) {
  if (play !== p) return;
  const g = p.shown, me = uid(), other = otherOf(g), mod = GAMES[g.type];
  const chip = u => `
    <div class="gm-p c-${colorOf(g, u)} ${g.status === "active" && g.turn === u ? "on" : ""}">
      ${p.ctx.avatar(u, "sm")}
      <span class="gm-p-txt"><b>${esc(u === me ? "You" : pName())}</b><small>${mod.badge?.(g, u) || ""}</small></span>
      <em>${winsOf(u, g.type)}</em>
    </div>`;
  const players = `${chip(me)}<span class="gm-vs">❤️</span>${chip(other)}`;
  const pl = $("[data-gm-players]", p.el);
  if (pl.dataset.html !== players) { pl.innerHTML = players; pl.dataset.html = players; }
  const draws = G.scores?.draws?.[g.type] || 0;
  $("[data-gm-round]", p.el).textContent = `Round ${g.round || 1}${draws ? ` · ${draws} draw${draws > 1 ? "s" : ""}` : ""}`;

  let status;
  if (g.status === "invited") status = g.inviter === me ? `💌 Waiting for ${pName()}…` : `💌 ${pName()} invited you!`;
  else if (g.status === "done") status = g.winner === "draw" ? "🤝 It's a draw!" : g.winner === me ? "🏆 You won!" : `🏆 ${pName()} won!`;
  else if (p.sending) status = "Sending…";
  else status = g.turn === me ? "Your turn, love ❤️" : `${pName()}'s turn… 💭`;
  const st = $("[data-gm-status]", p.el);
  st.textContent = status;
  st.classList.toggle("mine", g.status === "active" && g.turn === me);

  // waiting overlay while the invite is open
  const wait = $("[data-gm-wait]", p.el);
  if (g.status === "invited") {
    const mine = g.inviter === me;
    const html = mine
      ? `<div class="gm-wait-card"><div class="gm-wait-hearts"><i>💌</i></div><b>Invite sent!</b><p>Waiting for ${esc(pName())} to join…</p><button class="btn btn-ghost btn-sm" data-wait-cancel>Cancel invite</button></div>`
      : `<div class="gm-wait-card"><div class="gm-wait-hearts"><i>💌</i></div><b>${esc(pName())} invited you!</b><p>${esc(TAGLINES[hash(g.id) % TAGLINES.length])}</p><button class="btn btn-primary btn-sm" data-wait-accept>Let's play ❤️</button></div>`;
    if (wait.dataset.html !== html) {
      wait.innerHTML = html;
      wait.dataset.html = html;
      $("[data-wait-cancel]", wait)?.addEventListener("click", () => { closingByMe.add(g.id); closeGame(g, "cancelled"); });
      $("[data-wait-accept]", wait)?.addEventListener("click", acceptInvite);
    }
    wait.hidden = false;
  } else {
    wait.hidden = true;
  }
  p.inst.setEnabled?.(p.ctx.canAct());
}

function banner(p, text) {
  const b = $("[data-gm-banner]", p.el);
  if (!b) return;
  b.textContent = text;
  b.classList.remove("show");
  void b.offsetWidth;
  b.classList.add("show");
}

// floating emoji reaction
function burst(p, e, mine) {
  const fx = $("[data-gm-fx]", p.el);
  if (!fx || !REACTIONS.includes(e)) return;
  for (let i = 0; i < 7; i++) {
    const s = document.createElement("span");
    s.className = `fx-pop ${mine ? "mine" : "theirs"}`;
    s.textContent = e;
    s.style.left = `${(mine ? 60 : 12) + Math.random() * 28}%`;
    s.style.animationDelay = `${i * 70}ms`;
    s.style.setProperty("--dx", `${(Math.random() - 0.5) * 60}px`);
    s.style.fontSize = `${22 + Math.random() * 18}px`;
    s.addEventListener("animationend", () => s.remove());
    fx.append(s);
  }
}

function showWin(p, g, celebrate) {
  const key = `${g.id}:${g.round}`;
  if (p.winKey === key) return;
  hideWin(p);
  p.winKey = key;
  const me = uid(), other = otherOf(g), mod = GAMES[g.type];
  const draw = g.winner === "draw", iWon = g.winner === me;
  const dare = draw ? "Send each other a heart sticker 💞" : DARES[hash(key) % DARES.length];
  const confetti = celebrate
    ? Array.from({ length: 28 }, (_, i) => `<i style="left:${(i * 37) % 100}%;animation-delay:${(i % 7) * 0.12}s;animation-duration:${2.2 + (i % 5) * 0.35}s">${["❤️", "💖", "✨", "💕", "🎉", "💜", "⭐"][i % 7]}</i>`).join("")
    : "";
  const w = document.createElement("div");
  w.className = "gm-win";
  w.innerHTML = `
    <div class="gm-confetti">${confetti}</div>
    <div class="gm-win-card">
      <div class="gm-win-emoji">${draw ? "🤝" : "🏆"}</div>
      <h2>${draw ? "It's a draw!" : iWon ? "You won! 🎉" : `${esc(pName())} won!`}</h2>
      <p class="gm-win-sub">${draw ? "A perfect match, just like you two 💞" : iWon ? `Go collect your prize from ${esc(pName())} 😘` : "Don't worry, you still won their heart ❤️"}</p>
      <div class="gm-dare"><small>${draw ? "Both of you" : iWon ? `${esc(pName())}'s love task` : "Your love task"}</small><b>${esc(dare)}</b></div>
      <div class="gm-win-score">
        <span>${p.ctx.avatar(me, "sm")}<b>${winsOf(me, g.type)}</b></span>
        <small>${esc(mod.name)} wins</small>
        <span><b>${winsOf(other, g.type)}</b>${p.ctx.avatar(other, "sm")}</span>
      </div>
      <div class="gm-win-actions">
        <button class="btn btn-ghost" data-win-close>All games</button>
        <button class="btn btn-primary" data-win-again>🔁 Play again</button>
      </div>
    </div>`;
  p.el.append(w);
  p.winEl = w;
  $("[data-win-close]", w).addEventListener("click", () => { screen = "lobby"; scheduleRender(); });
  $("[data-win-again]", w).addEventListener("click", e => {
    e.currentTarget.disabled = true;
    const cur = p.game;
    const starter = cur.starter === me ? other : me; // take turns starting
    const init = mod.init(cur.players, cur.opts || {}, starter);
    commit(cur, { state: init.state, turn: init.turn, status: "active", winner: null, last: null, round: (cur.round || 1) + 1, starter });
  });
  if (celebrate) navigator.vibrate?.(iWon ? [60, 50, 60, 50, 120] : 40);
}

function hideWin(p) {
  p.winEl?.remove();
  p.winEl = null;
  p.winKey = null;
}

function gameMenu(p) {
  const m = openModal(`
    <div class="msg-menu">
      <button data-m="lobby">🎮<span>All games</span></button>
      <button data-m="end" class="danger">${ICONS.close}<span>End this game</span></button>
    </div>
    <button class="btn btn-ghost btn-block" data-close>Cancel</button>`, { cls: "action-sheet" });
  m.querySelector(".msg-menu").addEventListener("click", async e => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    m.close();
    if (b.dataset.m === "lobby") { screen = "lobby"; scheduleRender(); return; }
    const ok = await confirmDialog({ icon: "🎮", title: "End this game?", text: "It closes for both of you. Scores already won stay.", ok: "End game", danger: true });
    if (!ok || !play) return;
    closingByMe.add(p.game.id);
    closeGame(p.game, p.game.status === "done" ? "done" : "ended");
  });
}

/* ------------------------------------------------------------------ view */
views.games = {
  render() {
    if (screen === "play" && !G.open) screen = "lobby";
    return screen === "play" ? `<section class="gm" data-gm="${G.open.id}"></section>` : lobbyHtml();
  },
  mounted(root) {
    const el = $(".gm", root);
    if (el) mountPlay(el); else unmountPlay();
  },
  leave() { unmountPlay(); },
  // Android back button: from a game go back to the list first
  back() {
    if (screen !== "play") return false;
    screen = "lobby";
    scheduleRender();
    return true;
  }
};

Object.assign(actions, {
  gameInvite: d => inviteFlow(d.type),
  gameOpen: () => { if (G.open) { screen = "play"; scheduleRender(); } },
  gameAccept: acceptInvite,
  gameDecline: declineInvite,
  gameCancel: () => { const g = G.open; if (g) { closingByMe.add(g.id); closeGame(g, "cancelled"); } }
});
