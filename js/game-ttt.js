// ❌⭕ Tic-Tac-Toe. The round's starter plays ✕ and moves first; the starter alternates every round.
// state: { b: 9 chars "X" / "O" / "-", x: uid playing ✕, w: winning line index or -1 }
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function result(b) {
  for (let i = 0; i < LINES.length; i++) {
    const [a, c, d] = LINES[i];
    if (b[a] !== "-" && b[a] === b[c] && b[a] === b[d]) return { line: i };
  }
  return b.includes("-") ? null : { draw: true };
}

const markSvg = m => (m === "X"
  ? '<svg viewBox="0 0 100 100" class="mk mk-x"><path d="M26 26 74 74"/><path d="M74 26 26 74"/></svg>'
  : '<svg viewBox="0 0 100 100" class="mk mk-o"><circle cx="50" cy="50" r="27"/></svg>');

export default {
  type: "ttt",
  name: "Tic-Tac-Toe",
  emoji: "❌⭕",
  desc: "Quick, cute and fierce. Three in a row wins 😘",
  init(players, opts, starter) {
    return { state: { b: "---------", x: starter, w: -1 }, turn: starter };
  },
  badge: (g, u) => (g.state?.x === u ? "plays ✕" : "plays ◯"),

  mount({ board, controls, ctx }) {
    board.innerHTML = `
      <div class="ttt">
        ${Array.from({ length: 9 }, (_, i) => `<button class="ttt-cell" data-i="${i}" aria-label="Square ${i + 1}"></button>`).join("")}
        <svg class="ttt-line" viewBox="0 0 300 300"><line x1="0" y1="0" x2="0" y2="0"/></svg>
      </div>`;
    controls.innerHTML = '<p class="gm-hint" data-hint></p>';
    const cells = [...board.querySelectorAll(".ttt-cell")];
    const svg = board.querySelector(".ttt-line"), line = svg.querySelector("line");
    const hint = controls.querySelector("[data-hint]");
    let shown = "---------";

    board.addEventListener("click", e => {
      const c = e.target.closest(".ttt-cell");
      if (!c || !ctx.canAct()) return;
      const g = ctx.game(), st = g.state, i = Number(c.dataset.i);
      if (st.b[i] !== "-") return;
      const b = st.b.slice(0, i) + (st.x === ctx.me ? "X" : "O") + st.b.slice(i + 1);
      const r = result(b);
      ctx.move({
        state: { ...st, b, w: r?.line ?? -1 },
        turn: ctx.other,
        last: { by: ctx.me, i },
        ...(r ? { status: "done", winner: r.draw ? "draw" : ctx.me } : {})
      });
    });

    return {
      async update(g, prev, animate) {
        const st = g.state;
        const oUid = g.players.find(u => u !== st.x);
        cells.forEach((c, i) => {
          const m = st.b[i];
          if (m === shown[i]) return;
          if (m === "-") { c.innerHTML = ""; c.className = "ttt-cell"; return; }
          c.className = `ttt-cell filled c-${ctx.color(m === "X" ? st.x : oUid)}${animate ? " anim" : ""}`;
          c.innerHTML = markSvg(m);
        });
        shown = st.b;
        cells.forEach(c => c.classList.remove("win"));
        if (st.w >= 0) {
          const [a, , d] = LINES[st.w];
          const at = k => [(k % 3) * 100 + 50, Math.floor(k / 3) * 100 + 50];
          const [x1, y1] = at(a), [x2, y2] = at(d);
          const dx = Math.sign(x2 - x1) * 30, dy = Math.sign(y2 - y1) * 30;
          Object.entries({ x1: x1 - dx, y1: y1 - dy, x2: x2 + dx, y2: y2 + dy }).forEach(([k, v]) => line.setAttribute(k, v));
          LINES[st.w].forEach(k => cells[k].classList.add("win"));
          svg.classList.add("on");
          svg.classList.toggle("anim", animate);
        } else {
          svg.classList.remove("on", "anim");
        }
        if (animate) await ctx.sleep(st.w >= 0 ? 700 : 260);
      },
      setEnabled(on) {
        board.classList.toggle("my-turn", on);
        const g = ctx.game();
        hint.textContent = g.status !== "active" ? "" : on
          ? `Tap a square. You are ${g.state.x === ctx.me ? "✕" : "◯"} ✨`
          : `${ctx.name(ctx.other)} is thinking… 💭`;
      }
    };
  }
};
