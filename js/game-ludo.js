// 🎲 Ludo for two (opposite corners). Classic rules:
//  • a 6 brings a token out; 6, a capture or reaching home = roll again
//  • landing on the other's token sends it back to the yard, except on the ♥ safe squares
//  • land exactly in the centre to bring a token home; all tokens home wins
// state: { t: { uid: [r, …] }, dice, phase: "roll" | "move" }
//   r = -1 yard · 0-50 main track (counted from that player's start) · 51-55 home lane · 56 home
// last:  { kind: "roll", by, roll, pass? } or { kind: "move", by, k, from, to, roll, cap: [token indexes] }

// the 52 squares of the main track as [row, col] on a 15×15 board, clockwise from the rose start
const TRACK = [
  ...[1, 2, 3, 4, 5].map(c => [6, c]),
  ...[5, 4, 3, 2, 1, 0].map(r => [r, 6]),
  [0, 7], [0, 8],
  ...[1, 2, 3, 4, 5].map(r => [r, 8]),
  ...[9, 10, 11, 12, 13, 14].map(c => [6, c]),
  [7, 14], [8, 14],
  ...[13, 12, 11, 10, 9].map(c => [8, c]),
  ...[9, 10, 11, 12, 13, 14].map(r => [r, 8]),
  [14, 7], [14, 6],
  ...[13, 12, 11, 10, 9].map(r => [r, 6]),
  ...[5, 4, 3, 2, 1, 0].map(c => [8, c]),
  [7, 0], [6, 0]
];
const START = [0, 13, 26, 39];                       // track index where each corner enters
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // ♥ squares: no captures
const HOME_LANE = [
  [1, 2, 3, 4, 5].map(c => [7, c]),
  [1, 2, 3, 4, 5].map(r => [r, 7]),
  [13, 12, 11, 10, 9].map(c => [7, c]),
  [13, 12, 11, 10, 9].map(r => [r, 7])
];
const YARD = [[3, 3], [3, 12], [12, 12], [12, 3]];   // yard centres (in cell units)
const FINISH = [[7.5, 6.55], [6.55, 7.5], [7.5, 8.45], [8.45, 7.5]];
const SEAT_COLOR = ["rose", "violet", "sky", "mint"]; // seats 1 and 3 are decoration (2 players)
const STACK = [[-0.2, -0.2], [0.2, 0.2], [0.2, -0.2], [-0.2, 0.2], [0, 0], [0, -0.28], [0, 0.28], [-0.28, 0]];

const pct = v => `${(v / 15) * 100}%`;
const cellCenter = ([r, c]) => [r + 0.5, c + 0.5];
const spotsFor = n => (n === 2 ? [[-1, -1], [1, 1]] : [[-1, -1], [-1, 1], [1, -1], [1, 1]]);

export function movable(st, u, v) {
  return (st.t[u] || []).map((r, k) => ((r === -1 ? v === 6 : r < 56 && r + v <= 56) ? k : -1)).filter(k => k >= 0);
}

function boardHtml() {
  let cells = "";
  TRACK.forEach(([r, c], i) => {
    const seat = START.indexOf(i);
    cells += `<div class="ld-cell ${seat >= 0 ? `start s${seat}` : ""} ${SAFE.has(i) ? "safe" : ""}" style="grid-row:${r + 1};grid-column:${c + 1}">${SAFE.has(i) ? "<i>♥</i>" : ""}</div>`;
  });
  HOME_LANE.forEach((lane, s) => lane.forEach(([r, c]) => {
    cells += `<div class="ld-cell lane s${s}" style="grid-row:${r + 1};grid-column:${c + 1}"></div>`;
  }));
  const yards = YARD.map(([r, c], s) => `
    <div class="ld-yard s${s}" style="grid-row:${r - 2} / span 6;grid-column:${c - 2} / span 6">
      <div class="ld-yard-in">${s % 2 ? `<span class="ld-decor">${s === 1 ? "🌸" : "🌙"}</span>` : ""}</div>
    </div>`).join("");
  return `
    <div class="ld">
      <div class="ld-grid">${yards}${cells}<div class="ld-center"><span>❤️</span></div></div>
      <div class="ld-layer"></div>
    </div>`;
}

export default {
  type: "ludo",
  name: "Ludo",
  emoji: "🎲",
  desc: "The classic. Roll, race and send your love back home 😈",
  init(players, opts, starter) {
    const n = opts?.tokens === 2 ? 2 : 4;
    return {
      state: { t: { [players[0]]: Array(n).fill(-1), [players[1]]: Array(n).fill(-1) }, dice: 0, phase: "roll" },
      turn: starter
    };
  },
  badge: (g, u) => {
    const t = g.state?.t?.[u] || [];
    return `🏠 ${t.filter(r => r === 56).length}/${t.length}`;
  },

  mount({ board, controls, ctx }) {
    const g0 = ctx.game();
    const players = g0.players;
    const seatOf = u => (u === players[0] ? 0 : 2);
    const n = g0.state.t[players[0]].length;

    board.innerHTML = boardHtml();
    controls.innerHTML = `
      <div class="dice-row">
        <button class="dice" data-roll aria-label="Roll the dice" disabled>${ctx.dice.html(1)}</button>
        <p class="gm-hint" data-hint></p>
      </div>`;
    const layer = board.querySelector(".ld-layer");
    const dice = controls.querySelector("[data-roll]");
    const hint = controls.querySelector("[data-hint]");

    // position of token k of player u at progress r, in cell units [row, col]
    function posOf(u, k, r) {
      const s = seatOf(u);
      if (r < 0) { const [yr, yc] = YARD[s], [dr, dc] = spotsFor(n)[k]; return [yr + dr * 1.05, yc + dc * 1.05]; }
      if (r <= 50) return cellCenter(TRACK[(START[s] + r) % 52]);
      if (r <= 55) return cellCenter(HOME_LANE[s][r - 51]);
      return FINISH[s];
    }
    const keyOf = (u, r) => (r < 0 ? null : r <= 50 ? `t${(START[seatOf(u)] + r) % 52}` : r <= 55 ? `l${seatOf(u)}${r}` : `h${seatOf(u)}`);

    // yard spots, then the tokens
    for (const u of players) {
      for (let k = 0; k < n; k++) {
        const [r, c] = posOf(u, k, -1);
        const s = document.createElement("i");
        s.className = `ld-spot c-${ctx.color(u)}`;
        s.style.top = pct(r);
        s.style.left = pct(c);
        layer.append(s);
      }
    }
    const toks = {};
    for (const u of players) {
      toks[u] = [];
      for (let k = 0; k < n; k++) {
        const b = document.createElement("button");
        b.className = `ld-tok c-${ctx.color(u)}`;
        b.dataset.u = u;
        b.dataset.k = k;
        b.setAttribute("aria-label", `${u === ctx.me ? "Your" : "Their"} token ${k + 1}`);
        b.innerHTML = "<i>♥</i>";
        layer.append(b);
        toks[u].push(b);
      }
    }
    const place = (el, [r, c], sc = 1) => {
      el.style.top = pct(r);
      el.style.left = pct(c);
      el.style.setProperty("--sc", sc);
    };

    // final positions; tokens sharing a square shrink and spread out
    function layout(t) {
      const groups = new Map();
      for (const u of players) t[u].forEach((r, k) => {
        const key = keyOf(u, r);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push([u, k]);
      });
      for (const u of players) t[u].forEach((r, k) => {
        const key = keyOf(u, r), grp = key ? groups.get(key) : null;
        const [pr, pc] = posOf(u, k, r);
        if (grp && grp.length > 1) {
          const [dr, dc] = STACK[grp.findIndex(([gu, gk]) => gu === u && gk === k) % STACK.length];
          place(toks[u][k], [pr + dr, pc + dc], 0.78);
        } else {
          place(toks[u][k], [pr, pc]);
        }
        toks[u][k].classList.toggle("home", r === 56);
      });
    }
    layout(g0.state.t);

    function doMove(k) {
      if (!ctx.canAct()) return;
      const g = ctx.game(), st = g.state, me = ctx.me, other = ctx.other;
      if (st.phase !== "move" || !movable(st, me, st.dice).includes(k)) return;
      const v = st.dice, from = st.t[me][k], to = from === -1 ? 0 : from + v;
      const t = { [me]: [...st.t[me]], [other]: [...st.t[other]] };
      t[me][k] = to;
      const cap = [];
      if (to <= 50) {
        const cell = (START[seatOf(me)] + to) % 52;
        if (!SAFE.has(cell)) {
          t[other].forEach((r, ok) => {
            if (r >= 0 && r <= 50 && (START[seatOf(other)] + r) % 52 === cell) { t[other][ok] = -1; cap.push(ok); }
          });
        }
      }
      const win = t[me].every(r => r === 56);
      const again = v === 6 || cap.length > 0 || to === 56;
      ctx.move({
        state: { ...st, t, phase: "roll" },
        turn: win || again ? me : other,
        last: { kind: "move", by: me, k, from, to, roll: v, cap },
        ...(win ? { status: "done", winner: me } : {})
      });
    }

    dice.addEventListener("click", () => {
      if (!ctx.canAct()) return;
      const g = ctx.game(), st = g.state, me = ctx.me;
      if (st.phase !== "roll") return;
      const v = ctx.rollValue();
      const can = movable(st, me, v);
      ctx.move(can.length
        ? { state: { ...st, dice: v, phase: "move" }, turn: me, last: { kind: "roll", by: me, roll: v } }
        : { state: { ...st, dice: v, phase: "roll" }, turn: ctx.other, last: { kind: "roll", by: me, roll: v, pass: true } });
    });

    layer.addEventListener("click", e => {
      const b = e.target.closest(".ld-tok");
      if (b && b.dataset.u === ctx.me) doMove(Number(b.dataset.k));
    });

    let autoTimer = 0;
    return {
      async update(g, prev, animate) {
        clearTimeout(autoTimer);
        const st = g.state, last = g.last;
        if (animate && last) {
          const by = last.by, mine = by === ctx.me, who = ctx.name(by);
          dice.dataset.c = ctx.color(by);
          if (last.kind === "roll") {
            await ctx.dice.roll(dice, last.roll);
            if (last.pass) { ctx.say(mine ? "No moves this time 😅" : `${who} has no moves 😅`); await ctx.sleep(450); }
          } else if (last.kind === "move") {
            const el = toks[by][last.k];
            el.classList.add("walking");
            if (last.from === -1) {
              place(el, posOf(by, last.k, 0));
              await ctx.sleep(300);
            } else {
              for (let r = last.from + 1; r <= last.to; r++) { place(el, posOf(by, last.k, r)); await ctx.sleep(150); }
            }
            el.classList.remove("walking");
            if (last.cap?.length) {
              const o = players.find(u => u !== by);
              last.cap.forEach(ok => { toks[o][ok].classList.add("ko"); place(toks[o][ok], posOf(o, ok, -1)); });
              ctx.say(mine ? "💥 Sent them home! Sorry not sorry 😈" : `💥 ${who} sent you home! Revenge time 😤`);
              await ctx.sleep(600);
              last.cap.forEach(ok => toks[o][ok].classList.remove("ko"));
            } else if (last.to === 56) {
              ctx.say(mine ? "🏠 Token home! 💖" : `🏠 ${who} brought a token home 💖`);
            }
          }
        }
        if (st.dice) dice.querySelector(".dice-face").dataset.v = String(st.dice);
        layout(st.t);

        // only one real choice (or all choices are the same square) → move it automatically
        if (g.status === "active" && g.turn === ctx.me && st.phase === "move") {
          const can = movable(st, ctx.me, st.dice);
          if (can.length && can.every(k => st.t[ctx.me][k] === st.t[ctx.me][can[0]])) {
            autoTimer = setTimeout(() => { if (ctx.game().moveNo === g.moveNo) doMove(can[0]); }, 450);
          }
        }
      },
      setEnabled(on) {
        const g = ctx.game(), st = g.state, me = ctx.me;
        const rolling = on && st.phase === "roll", choosing = on && st.phase === "move";
        dice.disabled = !rolling;
        dice.classList.toggle("ready", rolling);
        if (on) dice.dataset.c = ctx.color(me);
        const can = choosing ? movable(st, me, st.dice) : [];
        toks[me].forEach((b, k) => b.classList.toggle("can", can.includes(k)));
        hint.textContent = g.status !== "active" ? ""
          : rolling ? "Your turn! Roll the dice 🎲"
          : choosing ? "Tap a glowing token ✨"
          : g.turn === me ? "" : `${ctx.name(ctx.other)} is playing… 💭`;
      },
      destroy() { clearTimeout(autoTimer); }
    };
  }
};
