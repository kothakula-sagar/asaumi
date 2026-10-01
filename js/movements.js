import {
  doc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, myName, esc, ICONS, toast, openModal, confirmDialog, whenDate, nowLocalInput,
  fmtFullDate, fmtLongDate, fmtTime, fmtDateTime, realNameOf, friendlyError, spinner, notifText, actions, $
} from "./core.js";
import { notifyPartner } from "./notify.js";

export function movementCard(m) {
  const d = whenDate(m.when);
  return `
    <article class="glass mv-card">
      <span class="mv-label">❤️ Memorable Movement</span>
      <p class="mv-text">${esc(m.text)}</p>
      <div class="mv-when">
        <span>${d ? esc(fmtFullDate(d)) : ""}</span>
        <span>${d ? esc(fmtTime(d)) : ""}</span>
      </div>
      <div class="mv-foot">
        <small>Created by <b>${esc(realNameOf(m.byUid, m.byName))}</b></small>
        <button class="mv-btn" data-action="openMovement" data-id="${m.id}">View Details</button>
      </div>
    </article>`;
}

export function movementsSection() {
  const list = state.movements;
  return `
    <div class="section-head">
      <div>
        <h2>❤️ Memorable Movement</h2>
        <p>The little things worth remembering.</p>
      </div>
      <button class="btn btn-primary btn-sm" data-action="addMovement">${ICONS.plus} Add</button>
    </div>
    ${!state.loaded.movements ? `<div class="loading-block">${spinner()}</div>`
      : list.length ? `<div class="mv-grid">${list.map(movementCard).join("")}</div>` : `
      <div class="glass empty">
        <span class="empty-orb">✨</span>
        <b>No memorable movements yet.</b>
        <p>A 2 AM conversation, a silly laugh, the day you decided something big — keep it here.</p>
        <button class="btn btn-primary" data-action="addMovement">${ICONS.plus} Add a movement</button>
      </div>`}`;
}

function addMovementModal(existing = null) {
  const m = openModal(`
    <div class="detail-emoji">❤️</div>
    <h2>${existing ? "Edit Memorable Movement" : "New Memorable Movement"}</h2>
    <label class="field">
      <span>The moment</span>
      <textarea maxlength="400" placeholder="e.g. Our first late-night conversation.">${esc(existing?.text || "")}</textarea>
    </label>
    <label class="field">
      <span>Date &amp; time</span>
      <input type="datetime-local" value="${esc(existing?.when || nowLocalInput())}" />
    </label>
    <p class="form-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>Save</button>
    </div>`);
  const text = $("textarea", m), when = $("input", m), err = $(".form-error", m), save = $("[data-save]", m);
  setTimeout(() => text.focus(), 60);
  save.addEventListener("click", async () => {
    if (!text.value.trim()) { err.textContent = "Write the moment first."; text.focus(); return; }
    if (!when.value) { err.textContent = "Pick the date and time."; return; }
    save.disabled = true;
    save.innerHTML = spinner("sm dark");
    try {
      if (existing) {
        await updateDoc(doc(db, "memorableMovements", existing.id), { text: text.value.trim(), when: when.value, editedAt: serverTimestamp() });
        m.close();
        toast("Memorable Movement updated ❤️");
        return;
      }
      const ref = await addDoc(collection(db, "memorableMovements"), {
        text: text.value.trim(), when: when.value,
        byUid: uid(), byName: myName(), createdAt: serverTimestamp()
      });
      notifyPartner("movement", notifText("movement"), { refId: ref.id });
      m.close();
      toast("Memorable Movement saved ❤️");
    } catch (e) {
      err.textContent = friendlyError(e, "Couldn't save. Try again.");
      save.disabled = false;
      save.textContent = "Save";
    }
  });
}

function openMovement(id) {
  const x = state.movements.find(m => m.id === id);
  if (!x) { toast("That movement is no longer here."); return; }
  const d = whenDate(x.when);
  const mine = x.byUid === uid();
  const m = openModal(`
    <div class="detail-emoji">❤️</div>
    <span class="mv-label center">Memorable Movement</span>
    <p class="mv-full">${esc(x.text)}</p>
    <div class="detail-meta">
      <div><span>Date</span><b>${d ? esc(fmtLongDate(d)) : "—"}</b></div>
      <div><span>Time</span><b>${d ? esc(fmtTime(d)) : "—"}</b></div>
      <div><span>Created by</span><b>${esc(realNameOf(x.byUid, x.byName))}</b></div>
      <div><span>Added</span><b>${esc(fmtDateTime(x.createdAt))}</b></div>
    </div>
    <div class="modal-actions single"><button class="btn btn-primary" data-close>Close</button></div>
    ${mine ? `<div class="detail-links"><button class="edit-link" data-edit>${ICONS.pencil} Edit</button><button class="del-link" data-del>Delete this movement</button></div>` : ""}`);
  $("[data-edit]", m)?.addEventListener("click", () => { m.close(); addMovementModal(x); });
  $("[data-del]", m)?.addEventListener("click", async () => {
    if (!(await confirmDialog({ icon: "trash", title: "Delete movement?", text: "It will be removed for both of you.", ok: "Delete", danger: true }))) return;
    try { await deleteDoc(doc(db, "memorableMovements", id)); m.close(); toast("Movement deleted"); }
    catch (err) { toast(friendlyError(err, "Couldn't delete. Try again.")); }
  });
}

Object.assign(actions, {
  addMovement: () => addMovementModal(),
  openMovement: d => openMovement(d.id)
});
