// Wishlist: two lists.
//  • Together 💞 — both of you see it, both can tick it off
//  • Personal 🔒 — only the person who added it can see it (enforced by the Firestore rules, not just hidden)
// The list is chosen when the wish is added and can't be changed afterwards.
import {
  doc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, myName, esc, ICONS, toast, openModal, confirmDialog, fmtDate, realNameOf, partnerName,
  friendlyError, spinner, appName, scheduleRender, actions, views, $
} from "./core.js";
import { notifyPartner } from "./notify.js";
import { openLink } from "./linkpreview.js";

const CATS = [
  { k: "gift", e: "🎁", l: "Gift" },
  { k: "trip", e: "✈️", l: "Trip" },
  { k: "food", e: "🍕", l: "Food" },
  { k: "watch", e: "🎬", l: "Watch" },
  { k: "shop", e: "🛍️", l: "Shopping" },
  { k: "do", e: "🎡", l: "Experience" },
  { k: "other", e: "💫", l: "Other" }
];
const catOf = w => CATS.find(c => c.k === w.cat) || CATS.at(-1);
const SCOPES = {
  together: { e: "💞", l: "Together", hint: () => "Both of you can see these, and either of you can tick one off." },
  personal: { e: "🔒", l: "Personal", hint: () => `Only you can see these. ${partnerName()} can't.` }
};

let tab = "together";
try { tab = localStorage.getItem("asaumi.wishTab") === "personal" ? "personal" : "together"; } catch { /* ignore */ }

const time = ts => ts?.toMillis?.() ?? (ts?.seconds ? ts.seconds * 1000 : 0);
export const wishesIn = scope => state.wishes.filter(w => w.scope === scope && (scope === "together" || w.byUid === uid()));

function normalizeLink(s) {
  s = (s || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { const u = new URL(s); return /\./.test(u.hostname) ? u.href : null; } catch { return null; }
}

/* ------------------------------------------------------------------ page */
function wishRow(w) {
  const c = catOf(w);
  const sub = w.done
    ? `Done${w.doneBy ? ` by ${esc(w.doneBy === uid() ? "you" : realNameOf(w.doneBy, w.doneByName))}` : ""} · ${esc(fmtDate(w.doneAt))}`
    : `${w.scope === "together" ? `Added by ${esc(w.byUid === uid() ? "you" : realNameOf(w.byUid, w.byName))} · ` : ""}${esc(fmtDate(w.createdAt))}`;
  return `
    <article class="glass wish ${w.done ? "done" : ""}">
      <button class="wish-check" data-action="toggleWish" data-id="${w.id}" aria-label="${w.done ? "Mark as not done" : "Mark as done"}">${ICONS.check}</button>
      <button class="wish-body" data-action="openWish" data-id="${w.id}">
        <span class="wish-emoji">${c.e}</span>
        <span class="wish-main">
          <b>${esc(w.title)}</b>
          ${w.note ? `<small class="wish-note">${esc(w.note)}</small>` : ""}
          <small class="wish-meta">${sub}</small>
        </span>
      </button>
      ${w.link ? `<button class="wish-link" data-action="openWishLink" data-id="${w.id}" aria-label="Open link">↗</button>` : ""}
    </article>`;
}

function renderWishlist() {
  const list = wishesIn(tab);
  const open = list.filter(w => !w.done).sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const done = list.filter(w => w.done).sort((a, b) => time(b.doneAt) - time(a.doneAt));
  const count = s => wishesIn(s).filter(w => !w.done).length;
  const s = SCOPES[tab];
  let body;
  if (state.wishError === "rules") {
    body = `
      <div class="glass empty">
        <span class="empty-orb">🔧</span>
        <b>Wishlist needs the new Firebase rules</b>
        <p>Paste the updated rules in Firebase → Firestore → Rules → Publish, then reopen the app.</p>
      </div>`;
  } else if (!state.loaded.wishes) {
    body = `<div class="loading-block">${spinner()}</div>`;
  } else if (!list.length) {
    body = `
      <div class="glass empty">
        <span class="empty-orb">${s.e}</span>
        <b>${tab === "together" ? "No wishes together yet." : "Your personal list is empty."}</b>
        <p>${tab === "together" ? "Places to go, things to do, gifts to give: dream them up together." : "Things you'd love someday. Only you can see this list."}</p>
        <button class="btn btn-primary" data-action="addWish">${ICONS.plus} Add a wish</button>
      </div>`;
  } else {
    body = `
      ${open.length ? `<div class="wish-list">${open.map(wishRow).join("")}</div>` : `<p class="wish-alldone">Every wish here has come true 🎉</p>`}
      ${done.length ? `
        <details class="wish-done-group" ${open.length ? "" : "open"}>
          <summary>Came true · ${done.length}</summary>
          <div class="wish-list">${done.map(wishRow).join("")}</div>
        </details>` : ""}`;
  }
  return `
    <section class="page-head">
      <div>
        <p class="eyebrow">Dreams &amp; little wants</p>
        <h1>🎁 Wishlist</h1>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" data-action="addWish">${ICONS.plus} Add</button>
      </div>
    </section>
    <div class="wish-tabs glass" role="tablist">
      ${["together", "personal"].map(k => `
        <button role="tab" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" data-action="wishTab" data-tab="${k}">
          ${SCOPES[k].e} ${SCOPES[k].l}<span class="wish-count">${count(k)}</span>
        </button>`).join("")}
    </div>
    <p class="wish-hint">${esc(s.hint())}</p>
    ${body}`;
}

/* ------------------------------------------------------------------ Home card */
export function wishlistCard() {
  if (state.wishError === "rules") return "";
  const together = wishesIn("together").filter(w => !w.done).sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const personal = wishesIn("personal").filter(w => !w.done).length;
  return `
    <article class="glass hcard wish-card">
      <header class="hcard-head">
        <span class="hcard-ico">🎁</span>
        <h3>Wishlist</h3>
        <span class="hcard-count">${together.length} together · ${personal} personal</span>
      </header>
      ${together.length
        ? `<ul class="wish-peek">${together.slice(0, 3).map(w => `<li><span>${catOf(w).e}</span>${esc(w.title)}</li>`).join("")}</ul>`
        : '<p class="hcard-quote muted">Dream something up together 💞</p>'}
      <button class="btn btn-ghost btn-block" data-nav="wishlist">🎁 Open Wishlist</button>
    </article>`;
}

/* ------------------------------------------------------------------ add / edit */
function wishModal(existing = null) {
  const editing = !!existing;
  let scope = existing?.scope || tab;
  const m = openModal(`
    <h2>${editing ? "Edit wish" : "New wish"}</h2>
    ${editing ? `
      <p class="wish-scope-fixed">${SCOPES[scope].e} On your <b>${SCOPES[scope].l}</b> list</p>` : `
      <div class="field"><span>Which list?</span></div>
      <div class="wish-scope" role="radiogroup">
        ${["together", "personal"].map(k => `
          <label class="wish-scope-opt">
            <input type="radio" name="scope" value="${k}" ${scope === k ? "checked" : ""} />
            <span><b>${SCOPES[k].e} ${SCOPES[k].l}</b><small>${k === "together" ? "Both of you can see it" : "Only you can see it"}</small></span>
          </label>`).join("")}
      </div>
      <p class="wish-scope-note">You choose this now. It can't be moved to the other list later.</p>`}
    <div class="wish-cats" role="radiogroup" aria-label="Kind of wish">
      ${CATS.map(c => `<label class="wish-cat"><input type="radio" name="cat" value="${c.k}" ${(existing?.cat || "gift") === c.k ? "checked" : ""} /><span>${c.e} ${c.l}</span></label>`).join("")}
    </div>
    <label class="field"><span>Wish</span><input type="text" name="title" maxlength="120" placeholder="e.g. Watch the sunrise in Goa" value="${esc(existing?.title || "")}" /></label>
    <label class="field"><span>Details (optional)</span><textarea name="note" maxlength="1000" placeholder="Size, colour, when, why it matters…">${esc(existing?.note || "")}</textarea></label>
    <label class="field"><span>Link (optional)</span><input type="url" name="link" inputmode="url" maxlength="500" placeholder="https://…" value="${esc(existing?.link || "")}" /></label>
    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>${editing ? "Save" : "Add wish"}</button>
    </div>`);
  const title = $("[name=title]", m), note = $("[name=note]", m), link = $("[name=link]", m);
  const err = $(".form-error", m), save = $("[data-save]", m);
  m.querySelectorAll("[name=scope]").forEach(r => r.addEventListener("change", () => { scope = r.value; }));
  setTimeout(() => title.focus(), 60);

  save.addEventListener("click", async () => {
    const t = title.value.trim();
    if (!t) { err.textContent = "Write the wish first ✨"; title.focus(); return; }
    const url = normalizeLink(link.value);
    if (url === null) { err.textContent = "That link doesn't look right. Leave it empty or paste a full link."; link.focus(); return; }
    const data = { title: t, note: note.value.trim(), link: url, cat: $("[name=cat]:checked", m)?.value || "other" };
    save.disabled = true;
    save.innerHTML = spinner("sm dark");
    try {
      if (editing) {
        await updateDoc(doc(db, "wishes", existing.id), { ...data, editedAt: serverTimestamp() });
        m.close();
        toast("Wish updated ✨");
        return;
      }
      const ref = await addDoc(collection(db, "wishes"), {
        ...data, scope, done: false, byUid: uid(), byName: myName(), createdAt: serverTimestamp()
      });
      if (scope === "together") notifyPartner("wish", `${appName()} you have a new wish 🎁`, { refId: ref.id });
      if (tab !== scope) setTab(scope);
      m.close();
      toast(scope === "together" ? "Added to your Together list 💞" : "Added to your Personal list 🔒");
    } catch (e) {
      err.textContent = friendlyError(e, "Couldn't save the wish. Try again.");
      save.disabled = false;
      save.textContent = editing ? "Save" : "Add wish";
    }
  });
}

/* ------------------------------------------------------------------ detail */
function openWish(id) {
  const w = state.wishes.find(x => x.id === id);
  if (!w) { toast("That wish is no longer here."); return; }
  const mine = w.byUid === uid();
  const c = catOf(w);
  const m = openModal(`
    <div class="detail-emoji">${c.e}</div>
    <span class="mv-label center">${SCOPES[w.scope].e} ${SCOPES[w.scope].l} wish · ${c.l}</span>
    <h2 class="wish-detail-title ${w.done ? "done" : ""}">${esc(w.title)}</h2>
    ${w.note ? `<p class="detail-text">${esc(w.note)}</p>` : ""}
    ${w.link ? `<button class="btn btn-ghost btn-block wish-open-link" data-link>↗ ${esc(w.link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48))}</button>` : ""}
    <div class="detail-meta">
      <div><span>Added by</span><b>${esc(mine ? myName() : realNameOf(w.byUid, w.byName))}</b></div>
      <div><span>Added on</span><b>${esc(fmtDate(w.createdAt))}</b></div>
      ${w.done ? `<div><span>Came true</span><b>${esc(fmtDate(w.doneAt))}${w.doneBy ? ` · ${esc(w.doneBy === uid() ? myName() : realNameOf(w.doneBy, w.doneByName))}` : ""}</b></div>` : ""}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Close</button>
      <button class="btn btn-primary" data-toggle>${w.done ? "Not done yet" : `${ICONS.check} It came true`}</button>
    </div>
    ${mine ? `<div class="detail-links"><button class="edit-link" data-edit>${ICONS.pencil} Edit</button><button class="del-link" data-del>Delete this wish</button></div>` : ""}`);
  $("[data-link]", m)?.addEventListener("click", () => openLink(w.link));
  $("[data-toggle]", m).addEventListener("click", () => { m.close(); toggleWish(id); });
  $("[data-edit]", m)?.addEventListener("click", () => { m.close(); wishModal(w); });
  $("[data-del]", m)?.addEventListener("click", async () => {
    const text = w.scope === "together" ? "It will be removed for both of you." : "It will be removed from your personal list.";
    if (!(await confirmDialog({ icon: "trash", title: "Delete wish?", text, ok: "Delete", danger: true }))) return;
    try { await deleteDoc(doc(db, "wishes", id)); m.close(); toast("Wish deleted"); }
    catch (e) { toast(friendlyError(e, "Couldn't delete. Try again.")); }
  });
}

async function toggleWish(id) {
  const w = state.wishes.find(x => x.id === id);
  if (!w) return;
  const done = !w.done;
  try {
    await updateDoc(doc(db, "wishes", id), done
      ? { done: true, doneAt: serverTimestamp(), doneBy: uid(), doneByName: myName() }
      : { done: false, doneAt: null, doneBy: null, doneByName: null });
    if (done) {
      navigator.vibrate?.(15);
      toast("A wish came true 🎉");
      if (w.scope === "together") notifyPartner("wish", `${appName()} – a wish came true 🎉`, { refId: id });
    }
  } catch (e) {
    toast(friendlyError(e, "Couldn't update the wish."));
  }
}

function setTab(t) {
  tab = t === "personal" ? "personal" : "together";
  try { localStorage.setItem("asaumi.wishTab", tab); } catch { /* ignore */ }
  scheduleRender();
}

/* ------------------------------------------------------------------ wiring */
views.wishlist = { render: renderWishlist };

Object.assign(actions, {
  addWish: () => wishModal(),
  openWish: d => openWish(d.id),
  toggleWish: d => toggleWish(d.id),
  wishTab: d => setTab(d.tab),
  openWishLink: d => { const w = state.wishes.find(x => x.id === d.id); if (w?.link) openLink(w.link); }
});
