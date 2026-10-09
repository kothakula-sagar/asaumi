// 🐍 Snake & Ladder. 100 squares; land exactly on 100 to win (a bigger roll bounces back).
// state: { pos: { uid: 0..100 } }   0 = not on the board yet
// last:  { by, roll, from, land, to } → the other phone replays the same walk, ladder or snake
const LADDERS = { 4: 25, 13: 46, 33: 49, 42: 63, 50: 69, 62: 81, 74: 92 };
const SNAKES = { 27: 5, 40: 3, 43: 18, 54: 31, 66: 45, 76: 58, 89: 53, 99: 41 };
const SNAKE_COLORS = [["#34d399", "#059669"], ["#f472b6", "#be185d"], ["#fbbf24", "#d97706"], ["#a78bfa", "#6d28d9"]];
const HEARTS = new Set([7, 19, 36, 58, 71, 85, 97]); // little decorations

// centre of square n in board percent (0-100)
function xy(n) {
  if (n <= 0) return { x: 4, y: 96 };
  const r = Math.floor((n - 1) / 10), c0 = (n - 1) % 10, c = r % 2 ? 9 - c0 : c0;
  return { x: c * 10 + 5, y: (9 - r) * 10 + 5 };
}

function ladderSvg(a, b) {
  const p = xy(a), q = xy(b);
  const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
  const nx = (-dy / len) * 2.1, ny = (dx / len) * 2.1;
  let rungs = "";
  for (let d = 3.5; d < len - 1.5; d += 4.2) {
    const t = d / len, x = p.x + dx * t, y = p.y + dy * t;
    rungs += `<line x1="${(x + nx).toFixed(2)}" y1="${(y + ny).toFixed(2)}" x2="${(x - nx).toFixed(2)}" y2="${(y - ny).toFixed(2)}"/>`;
  }
  return `
    <g class="snl-ladder">
      <line class="rail" x1="${p.x + nx}" y1="${p.y + ny}" x2="${q.x + nx}" y2="${q.y + ny}"/>
      <line class="rail" x1="${p.x - nx}" y1="${p.y - ny}" x2="${q.x - nx}" y2="${q.y - ny}"/>
      <g class="rungs">${rungs}</g>
      <text x="${q.x}" y="${q.y - 2.6}" class="snl-lheart">💗</text>
    </g>`;
}

function snakeSvg(head, tail, i) {
  const h = xy(head), t = xy(tail);
  const dx = t.x - h.x, dy = t.y - h.y, len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len, w = Math.min(7, len / 4);
  const c1 = { x: h.x + dx / 3 + nx * w, y: h.y + dy / 3 + ny * w };
  const c2 = { x: h.x + (dx * 2) / 3 - nx * w, y: h.y + (dy * 2) / 3 - ny * w };
  const d = `M${h.x} ${h.y} C${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${t.x} ${t.y}`;
  const [c, dark] = SNAKE_COLORS[i % SNAKE_COLORS.length];
  const ex = (dx / len) * 1.1, ey = (dy / len) * 1.1;
  return `
    <g class="snl-snake">
      <path d="${d}" stroke="${dark}" stroke-width="3.6"/>
      <path d="${d}" stroke="${c}" stroke-width="2.6"/>
      <path d="${d}" stroke="rgba(255,255,255,.55)" stroke-width=".8" stroke-dasharray=".6 2.2"/>
      <circle cx="${h.x}" cy="${h.y}" r="2.5" fill="${c}" stroke="${dark}" stroke-width=".7"/>
      <circle cx="${h.x - ny * 0.9 - ex * 0.3}" cy="${h.y + nx * 0.9 - ey * 0.3}" r=".55" fill="#fff"/>
      <circle cx="${h.x + ny * 0.9 - ex * 0.3}" cy="${h.y - nx * 0.9 - ey * 0.3}" r=".55" fill="#fff"/>
      <circle cx="${h.x - ny * 0.9 - ex * 0.15}" cy="${h.y + nx * 0.9 - ey * 0.15}" r=".28" fill="#1e1b4b"/>
      <circle cx="${h.x + ny * 0.9 - ex * 0.15}" cy="${h.y - nx * 0.9 - ey * 0.15}" r=".28" fill="#1e1b4b"/>
    </g>`;
}

function boardHtml() {
  let squares = "";
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const r = 9 - y, n = r * 10 + (r % 2 ? 9 - x : x) + 1;
      const cls = n === 100 ? "goal" : (x + y) % 2 ? "b" : "a";
      squares += `<div class="snl-sq ${cls}"><small>${n}</small>${n === 100 ? "<i>👑</i>" : HEARTS.has(n) ? "<i>💗</i>" : ""}</div>`;
    }
  }
  return `
    <div class="snl">
      <div class="snl-grid">${squares}</div>
      <svg class="snl-art" viewBox="0 0 100 100" aria-hidden="true">
        ${Object.entries(LADDERS).map(([a, b]) => ladderSvg(+a, +b)).join("")}
        ${Object.entries(SNAKES).map(([a, b], i) => snakeSvg(+a, +b, i)).join("")}
      </svg>
      <div class="snl-tokens"></div>
    </div>`;
}

export default {
  type: "snake",
  name: "Snake & Ladder",
  emoji: "🐍",
  desc: "Climb the love ladders, dodge the snakes. First to 100 wins 👑",
  init(players, opts, starter) {
    return { state: { pos: { [players[0]]: 0, [players[1]]: 0 } }, turn: starter };
  },
  badge: (g, u) => {
    const n = g.state?.pos?.[u] || 0;
    return n ? `Square ${n}` : "Start";
  },

  mount({ board, controls, ctx }) {
    board.innerHTML = boardHtml();
    controls.innerHTML = `
      <div class="dice-row">
        <button class="dice" data-roll aria-label="Roll the dice" disabled>${ctx.dice.html(1)}</button>
        <p class="gm-hint" data-hint></p>
      </div>`;
    const layer = board.querySelector(".snl-tokens");
    const dice = controls.querySelector("[data-roll]");
    const hint = controls.querySelector("[data-hint]");
    const g0 = ctx.game();
    const toks = {};
    const cur = {};
    for (const u of g0.players) {
      const el = document.createElement("div");
      el.className = `snl-tok c-${ctx.color(u)}`;
      el.innerHTML = ctx.avatar(u, "xs");
      layer.append(el);
      toks[u] = el;
      cur[u] = g0.state.pos[u] || 0;
    }

    // places every token; two on one square sit side by side
    function layout() {
      const [a, b] = g0.players;
      for (const u of g0.players) {
        const p = xy(cur[u]);
        const shared = cur[a] === cur[b];
        const off = shared ? (u === a ? -2.3 : 2.3) : 0;
        toks[u].style.left = `${p.x + off}%`;
        toks[u].style.top = `${p.y + (shared ? 1 : 0)}%`;
        toks[u].classList.toggle("waiting", !cur[u]);
      }
    }
    layout();

    dice.addEventListener("click", () => {
      if (!ctx.canAct()) return;
      const g = ctx.game(), me = ctx.me;
      const roll = ctx.rollValue();
      const from = g.state.pos[me] || 0;
      let land = from + roll;
      if (land > 100) land = 200 - land; // bounce back from 100
      const to = LADDERS[land] || SNAKES[land] || land;
      const win = to === 100;
      ctx.move({
        state: { pos: { ...g.state.pos, [me]: to } },
        turn: win ? me : ctx.other,
        last: { by: me, roll, from, land, to },
        ...(win ? { status: "done", winner: me } : {})
      });
    });

    return {
      async update(g, prev, animate) {
        const last = g.last;
        if (animate && last) {
          const by = last.by, mine = by === ctx.me;
          dice.dataset.c = ctx.color(by);
          await ctx.dice.roll(dice, last.roll);
          // walk square by square (bouncing back from 100 if needed)
          const tok = toks[by];
          tok.classList.add("walking");
          for (let i = 1; i <= last.roll; i++) {
            const s = last.from + i;
            cur[by] = s > 100 ? 200 - s : s;
            layout();
            await ctx.sleep(190);
          }
          tok.classList.remove("walking");
          if (last.from + last.roll > 100) ctx.say("Bounced back! You need the exact number 😅");
          if (last.to !== last.land) {
            const up = last.to > last.land;
            await ctx.sleep(180);
            ctx.say(up
              ? (mine ? "🪜 Love ladder! Up you go 💕" : `🪜 ${ctx.name(by)} climbed a love ladder 💕`)
              : (mine ? "🐍 Oops! The snake got you 😜" : `🐍 ${ctx.name(by)} got bitten 😜`));
            tok.classList.add(up ? "climb" : "slide");
            cur[by] = last.to;
            layout();
            await ctx.sleep(760);
            tok.classList.remove("climb", "slide");
          }
        } else if (last?.roll) {
          dice.querySelector(".dice-face").dataset.v = String(last.roll);
        }
        for (const u of g.players) cur[u] = g.state.pos[u] || 0;
        layout();
        if (animate && g.status === "done") await ctx.sleep(300);
      },
      setEnabled(on) {
        dice.disabled = !on;
        dice.classList.toggle("ready", on);
        if (on) dice.dataset.c = ctx.color(ctx.me);
        const g = ctx.game();
        hint.textContent = g.status !== "active" ? "" : on ? "Your turn! Tap the dice 🎲" : `${ctx.name(ctx.other)} is rolling… 💭`;
      }
    };
  }
};
