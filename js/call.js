// One-to-one live calls over WebRTC. Firestore is used only for signalling and
// call metadata (caller, receiver, times, duration, status). Nothing is recorded or uploaded.
import {
  doc, collection, setDoc, updateDoc, addDoc, getDoc, getDocs, deleteDoc, onSnapshot, query, where,
  serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, uid, myName, esc, ICONS, toast, avatarHtml, toDate, fmtDuration, friendlyError,
  realNameOf, partnerName, audioCtx, actions, $
} from "./core.js";
import { notifyPartner, systemNotify } from "./notify.js";
import { ICE_SERVERS } from "./config.js";

const RING_TIMEOUT = 45000;       // caller gives up after this
const CONNECT_TIMEOUT = 35000;    // accepted but never connected
const RECONNECT_GIVEUP = 30000;

let call = null;       // active call
let incoming = null;   // { id, data } ringing for me
let ringer = null;     // ringtone interval
let incomingUnsub = null;

const isVideo = () => call?.kind === "video";

/* ------------------------------------------------------------------ UI */
function root() { return $("#call-root"); }

function statusLabel(s) {
  return {
    calling: "Calling…", ringing: "Ringing…", connecting: "Connecting…", connected: "",
    reconnecting: "Reconnecting…", ended: "Call ended", declined: "Call declined",
    missed: "No answer", busy: "Busy on another call", failed: "Couldn't connect"
  }[s] ?? "";
}

function renderCallScreen() {
  const other = state.members[call.otherUid] || { name: partnerName() };
  root().innerHTML = `
    <div class="call-screen ${call.kind}" data-state="${call.state}">
      <div class="call-bg"></div>
      <video class="remote-video" autoplay playsinline></video>
      <div class="call-stage">
        <div class="call-rings">${avatarHtml(other, "xxl")}</div>
      </div>
      <div class="call-top">
        <span class="call-kind">${isVideo() ? ICONS.video : ICONS.phone} ${isVideo() ? "Video" : "Audio"} call · private</span>
        <b>${esc(other.name || "Your person")}</b>
        <span class="call-status" id="call-status"></span>
      </div>
      <video class="local-video" autoplay playsinline muted></video>
      <div class="call-controls glass">
        <button class="cc-btn" data-cc="mic" aria-label="Microphone">${ICONS.mic}</button>
        ${isVideo() ? `<button class="cc-btn" data-cc="cam" aria-label="Camera">${ICONS.video}</button>` : ""}
        ${isVideo() ? `<button class="cc-btn" data-cc="flip" aria-label="Switch camera" hidden>${ICONS.flip}</button>` : ""}
        <button class="cc-btn end" data-cc="end" aria-label="End call">${ICONS.phoneEnd}</button>
      </div>
    </div>`;
  document.body.classList.add("in-call");
  const scr = $(".call-screen", root());
  call.els = {
    screen: scr, remote: $(".remote-video", scr), local: $(".local-video", scr),
    status: $("#call-status"), mic: $('[data-cc="mic"]', scr), cam: $('[data-cc="cam"]', scr), flip: $('[data-cc="flip"]', scr)
  };
  call.els.local.srcObject = call.local;
  call.els.local.classList.toggle("mirror", call.facing === "user");
  if (call.remote) attachRemote();
  scr.addEventListener("click", e => {
    const b = e.target.closest("[data-cc]");
    if (!b) return;
    ({ mic: toggleMic, cam: toggleCam, flip: flipCamera, end: () => hangup() })[b.dataset.cc]?.();
  });
  navigator.mediaDevices?.enumerateDevices?.().then(ds => {
    if (call?.els?.flip && ds.filter(d => d.kind === "videoinput").length > 1) call.els.flip.hidden = false;
  }).catch(() => {});
  paintState();
}

function paintState() {
  if (!call?.els) return;
  const { screen, status } = call.els;
  screen.dataset.state = call.state;
  screen.classList.toggle("remote-cam-off", !!call.remoteCamOff);
  screen.classList.toggle("has-remote", !!call.remoteVideoLive);
  if (call.state === "connected") {
    status.textContent = fmtDuration((Date.now() - call.connectedAt) / 1000) + (call.remoteMuted ? " · 🔇 muted" : "");
  } else {
    status.textContent = statusLabel(call.state);
  }
  call.els.mic.classList.toggle("off", !call.micOn);
  call.els.mic.innerHTML = call.micOn ? ICONS.mic : ICONS.micOff;
  if (call.els.cam) {
    call.els.cam.classList.toggle("off", !call.camOn);
    call.els.cam.innerHTML = call.camOn ? ICONS.video : ICONS.videoOff;
    call.els.local.classList.toggle("off", !call.camOn);
  }
}

function setState(s) {
  if (!call) return;
  call.state = s;
  paintState();
}

function attachRemote() {
  const v = call.els?.remote;
  if (!v || !call.remote) return;
  if (v.srcObject !== call.remote) v.srcObject = call.remote;
  v.play().catch(() => {});
  const track = call.remote.getVideoTracks()[0];
  call.remoteVideoLive = !!track && !track.muted;
  if (track) {
    track.onmute = () => { call && (call.remoteVideoLive = false, paintState()); };
    track.onunmute = () => { call && (call.remoteVideoLive = true, paintState()); };
  }
  paintState();
}

function showEnded(title, detail) {
  root().innerHTML = `
    <div class="call-screen ended-screen">
      <div class="call-bg"></div>
      <div class="ended-card glass">
        <div class="icon-orb">${ICONS.phone}</div>
        <h2>${esc(title)}</h2>
        ${detail ? `<p>${esc(detail)}</p>` : ""}
        <button class="btn btn-primary" data-dismiss>Close</button>
      </div>
    </div>`;
  document.body.classList.add("in-call");
  const close = () => { root().innerHTML = ""; document.body.classList.remove("in-call"); };
  $("[data-dismiss]", root()).addEventListener("click", close);
  setTimeout(() => { if ($(".ended-screen", root())) close(); }, 3500);
}

/* ------------------------------------------------------------------ media */
async function getMedia(kind, facing = "user") {
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error("Calls need a secure (https) page and a modern browser.");
    e.friendly = true;
    throw e;
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: kind === "video" ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false
  });
}

function toggleMic() {
  call.micOn = !call.micOn;
  call.local.getAudioTracks().forEach(t => (t.enabled = call.micOn));
  updateDoc(call.ref, { [`mic_${uid()}`]: call.micOn }).catch(() => {});
  paintState();
}

function toggleCam() {
  call.camOn = !call.camOn;
  call.local.getVideoTracks().forEach(t => (t.enabled = call.camOn));
  updateDoc(call.ref, { [`cam_${uid()}`]: call.camOn }).catch(() => {});
  paintState();
}

async function flipCamera() {
  const facing = call.facing === "user" ? "environment" : "user";
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } } });
    const track = s.getVideoTracks()[0];
    const sender = call.pc.getSenders().find(x => x.track?.kind === "video");
    await sender?.replaceTrack(track);
    call.local.getVideoTracks().forEach(t => { t.stop(); call.local.removeTrack(t); });
    call.local.addTrack(track);
    track.enabled = call.camOn;
    call.facing = facing;
    call.els.local.srcObject = call.local;
    call.els.local.classList.toggle("mirror", facing === "user");
  } catch {
    toast("Couldn't switch the camera.");
  }
}

/* ------------------------------------------------------------------ peer connection */
function createPeer(mySide, otherSide) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  call.pc = pc;
  call.queue = [];
  call.local.getTracks().forEach(t => pc.addTrack(t, call.local));
  pc.onicecandidate = e => {
    if (e.candidate) addDoc(collection(call.ref, mySide), e.candidate.toJSON()).catch(() => {});
  };
  pc.ontrack = e => {
    call.remote = e.streams[0] || new MediaStream([e.track]);
    attachRemote();
  };
  const onConn = () => {
    const s = pc.connectionState || pc.iceConnectionState;
    if (s === "connected" || s === "completed") onConnected();
    else if (s === "disconnected") onDisconnected(false);
    else if (s === "failed") onDisconnected(true);
  };
  pc.onconnectionstatechange = onConn;
  pc.oniceconnectionstatechange = () => { if (!("connectionState" in pc)) onConn(); };
  call.unsubs.push(onSnapshot(collection(call.ref, otherSide), snap => {
    snap.docChanges().forEach(ch => { if (ch.type === "added") addRemoteCandidate(ch.doc.data()); });
  }));
  return pc;
}

async function addRemoteCandidate(c) {
  if (!call?.pc) return;
  if (!call.pc.remoteDescription) { call.queue.push(c); return; }
  try { await call.pc.addIceCandidate(c); } catch { /* stale candidate */ }
}

async function flushCandidates() {
  const q = call.queue.splice(0);
  for (const c of q) { try { await call.pc.addIceCandidate(c); } catch { /* ignore */ } }
}

function onConnected() {
  clearTimeout(call.connectTimer);
  clearTimeout(call.reconnectTimer);
  clearTimeout(call.giveUpTimer);
  call.reconnectTimer = call.giveUpTimer = null;
  if (!call.connectedAt) {
    call.connectedAt = Date.now();
    if (call.role === "caller") updateDoc(call.ref, { status: "connected", startedAt: serverTimestamp() }).catch(() => {});
    call.tick = setInterval(paintState, 1000);
    navigator.wakeLock?.request?.("screen").then(l => (call && (call.wakeLock = l))).catch(() => {});
  }
  setState("connected");
}

function onDisconnected(failed) {
  if (!call || ["ended"].includes(call.state)) return;
  if (!call.connectedAt) { if (failed) finish("failed"); return; }
  setState("reconnecting");
  if (!call.giveUpTimer) call.giveUpTimer = setTimeout(() => finish("ended"), RECONNECT_GIVEUP);
  // The caller drives an ICE restart; the callee answers the new offer.
  if (call.role === "caller") {
    clearTimeout(call.reconnectTimer);
    call.reconnectTimer = setTimeout(restartIce, failed ? 0 : 4000);
  }
}

async function restartIce() {
  if (!call || call.role !== "caller" || call.state === "connected") return;
  try {
    const offer = await call.pc.createOffer({ iceRestart: true });
    await call.pc.setLocalDescription(offer);
    call.offerRev += 1;
    await updateDoc(call.ref, { offer: { type: offer.type, sdp: offer.sdp, rev: call.offerRev } });
  } catch (err) {
    console.warn("[asaumi] ice restart", err);
  }
}

/* ------------------------------------------------------------------ outgoing */
async function startCall(kind = "video") {
  if (call) { toast("You're already on a call."); return; }
  const other = state.partner;
  if (!other) { toast("Your person hasn't signed in to Asaumi yet."); return; }
  if (!navigator.onLine) { toast("You're offline. Connect to the internet to call."); return; }
  if (!window.RTCPeerConnection) { toast("Calls aren't supported in this browser."); return; }

  call = { kind, role: "caller", otherUid: other.uid, state: "calling", micOn: true, camOn: kind === "video", facing: "user", unsubs: [], offerRev: 0, answerRev: -1 };
  try {
    call.local = await getMedia(kind);
  } catch (err) {
    call = null;
    toast(friendlyError(err, "Couldn't start your camera or microphone."));
    return;
  }
  call.ref = doc(collection(db, "calls"));
  call.id = call.ref.id;
  renderCallScreen();

  try {
    createPeer("callerCandidates", "calleeCandidates");
    const offer = await call.pc.createOffer();
    await call.pc.setLocalDescription(offer);
    await setDoc(call.ref, {
      callerId: uid(), calleeId: other.uid, callerName: myName(), kind,
      status: "ringing", offer: { type: offer.type, sdp: offer.sdp, rev: 0 },
      createdAt: serverTimestamp()
    });
    setState("ringing");
  } catch (err) {
    cleanup();
    showEnded("Call failed", friendlyError(err, "Please check your connection and try again."));
    return;
  }

  call.unsubs.push(onSnapshot(call.ref, async snap => {
    const d = snap.data();
    if (!d || !call) return;
    call.remoteCamOff = d[`cam_${call.otherUid}`] === false;
    call.remoteMuted = d[`mic_${call.otherUid}`] === false;
    if (d.answer && d.answer.rev > call.answerRev && call.pc.signalingState === "have-local-offer") {
      call.answerRev = d.answer.rev;
      try {
        await call.pc.setRemoteDescription(d.answer);
        await flushCandidates();
      } catch (err) { console.warn("[asaumi] answer", err); }
    }
    if (d.status === "accepted" && call.state === "ringing") {
      clearTimeout(call.ringTimer);
      setState("connecting");
      call.connectTimer = setTimeout(() => finish("failed"), CONNECT_TIMEOUT);
    }
    if (["declined", "busy", "ended", "missed"].includes(d.status) && d.endedBy !== uid()) remoteEnded(d);
    paintState();
  }));

  call.ringTimer = setTimeout(() => {
    if (call?.state === "ringing") finish("missed");
  }, RING_TIMEOUT);
}

/* ------------------------------------------------------------------ incoming */
export function watchIncoming() {
  incomingUnsub?.();
  incomingUnsub = onSnapshot(
    query(collection(db, "calls"), where("calleeId", "==", uid()), where("status", "==", "ringing")),
    snap => {
      const fresh = snap.docs
        .map(d => ({ id: d.id, data: d.data({ serverTimestamps: "estimate" }) }))
        .filter(c => { const t = toDate(c.data.createdAt); return t && Date.now() - t.getTime() < RING_TIMEOUT + 15000; });
      if (incoming && !fresh.some(c => c.id === incoming.id)) {
        // The caller hung up (or another tab answered)
        const was = incoming;
        closeIncoming();
        getDoc(doc(db, "calls", was.id)).then(s => {
          const st = s.data()?.status;
          if (st === "missed") toast(`📹 You missed a call from ${realNameOf(was.data.callerId, was.data.callerName)}.`);
        }).catch(() => {});
      }
      const next = fresh.find(c => c.id !== incoming?.id);
      if (!next) return;
      if (call || incoming) {
        updateDoc(doc(db, "calls", next.id), { status: "busy", endedAt: serverTimestamp(), endedBy: uid() }).catch(() => {});
        return;
      }
      showIncoming(next);
    },
    err => console.warn("[asaumi] incoming", err)
  );
}

export function stopWatchingIncoming() {
  incomingUnsub?.();
  incomingUnsub = null;
  closeIncoming();
  if (call) hangup();
}

function showIncoming(c) {
  incoming = c;
  const caller = state.members[c.data.callerId] || { name: c.data.callerName };
  const video = c.data.kind !== "audio";
  root().innerHTML = `
    <div class="call-screen incoming">
      <div class="call-bg"></div>
      <div class="incoming-card">
        <span class="call-kind">${video ? ICONS.video : ICONS.phone} Incoming ${video ? "video" : "audio"} call</span>
        <div class="call-rings ringing">${avatarHtml(caller, "xxl")}</div>
        <div class="incoming-heart">❤️</div>
        <h2>${esc(caller.name || "Your person")}</h2>
        <p>is calling you on Asaumi</p>
      </div>
      <div class="incoming-actions">
        <button class="ia decline" data-ia="decline"><span>${ICONS.close}</span>Decline</button>
        <button class="ia accept" data-ia="accept"><span>${video ? ICONS.video : ICONS.phone}</span>Accept</button>
      </div>
    </div>`;
  document.body.classList.add("in-call");
  $('[data-ia="accept"]', root()).addEventListener("click", () => acceptCall(c));
  $('[data-ia="decline"]', root()).addEventListener("click", () => declineCall(c));
  startRinging();
  systemNotify("📹 Incoming call", `${caller.name || "Your person"} is calling you`, "call");
}

function closeIncoming() {
  stopRinging();
  if (incoming && $(".incoming", root())) { root().innerHTML = ""; document.body.classList.remove("in-call"); }
  incoming = null;
}

function startRinging() {
  stopRinging();
  const ring = () => {
    const ctx = audioCtx();
    if (ctx) {
      [0, 0.35].forEach(off => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = off ? 660 : 880;
        const t = ctx.currentTime + off;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.32);
      });
    }
    navigator.vibrate?.([300, 150, 300]);
  };
  ring();
  ringer = setInterval(ring, 2200);
}

function stopRinging() {
  if (!ringer) return;
  clearInterval(ringer);
  ringer = null;
  navigator.vibrate?.(0);
}

async function declineCall(c) {
  closeIncoming();
  await updateDoc(doc(db, "calls", c.id), { status: "declined", endedAt: serverTimestamp(), endedBy: uid() }).catch(() => {});
}

async function acceptCall(c) {
  stopRinging();
  const kind = c.data.kind === "audio" ? "audio" : "video";
  call = { kind, role: "callee", id: c.id, ref: doc(db, "calls", c.id), otherUid: c.data.callerId, state: "connecting", micOn: true, camOn: kind === "video", facing: "user", unsubs: [], offerRev: -1 };
  incoming = null;
  try {
    call.local = await getMedia(kind);
  } catch (err) {
    const msg = friendlyError(err, "Couldn't start your camera or microphone.");
    await updateDoc(call.ref, { status: "declined", endedAt: serverTimestamp(), endedBy: uid() }).catch(() => {});
    call = null;
    showEnded("Couldn't join the call", msg);
    return;
  }
  renderCallScreen();
  try {
    const snap = await getDoc(call.ref);
    const d = snap.data();
    if (!d || d.status !== "ringing") { cleanup(); showEnded("Call ended", "The call is no longer available."); return; }
    createPeer("calleeCandidates", "callerCandidates");
    await answerOffer(d.offer, true);
  } catch (err) {
    console.warn("[asaumi] accept", err);
    finish("failed");
    return;
  }
  call.connectTimer = setTimeout(() => finish("failed"), CONNECT_TIMEOUT);
  call.unsubs.push(onSnapshot(call.ref, async snap => {
    const d = snap.data();
    if (!d || !call) return;
    call.remoteCamOff = d[`cam_${call.otherUid}`] === false;
    call.remoteMuted = d[`mic_${call.otherUid}`] === false;
    if (d.offer && d.offer.rev > call.offerRev) await answerOffer(d.offer, false); // ICE restart
    if (["ended", "missed"].includes(d.status) && d.endedBy !== uid()) remoteEnded(d);
    paintState();
  }));
}

async function answerOffer(offer, first) {
  call.offerRev = offer.rev || 0;
  await call.pc.setRemoteDescription({ type: offer.type, sdp: offer.sdp });
  await flushCandidates();
  const answer = await call.pc.createAnswer();
  await call.pc.setLocalDescription(answer);
  await updateDoc(call.ref, {
    answer: { type: answer.type, sdp: answer.sdp, rev: call.offerRev },
    ...(first ? { status: "accepted", acceptedAt: serverTimestamp() } : {})
  });
}

/* ------------------------------------------------------------------ ending */
function duration() {
  return call?.connectedAt ? Math.round((Date.now() - call.connectedAt) / 1000) : 0;
}

// Local user ends (or a timeout ends) the call
async function finish(reason = "ended") {
  if (!call) return;
  const c = call;
  const secs = duration();
  const unanswered = c.role === "caller" && ["calling", "ringing"].includes(c.state);
  const status = reason === "failed" ? "failed" : c.connectedAt ? "ended" : unanswered ? "missed" : "ended";
  cleanup();
  const upd = { status, endedAt: serverTimestamp(), endedBy: uid(), duration: secs, offer: deleteField(), answer: deleteField() };
  updateDoc(c.ref, upd).catch(() => {});
  cleanCandidates(c.ref);
  if (status === "missed") {
    notifyPartner("missed_call", `📹 You missed a ${c.kind === "audio" ? "call" : "video call"} from ${myName()}.`, { callId: c.id });
  }
  const title = `${c.kind === "audio" ? "Audio" : "Video"} call ended`;
  if (status === "failed") showEnded("Couldn't connect", "The connection couldn't be established. Please try again.");
  else if (status === "missed" && reason !== "missed") showEnded("Call cancelled", "");
  else if (status === "missed") showEnded("No answer", `${partnerName()} didn't pick up. They'll see a missed call.`);
  else showEnded(title, `Duration: ${fmtDuration(secs)}`);
}

// The other person ended / declined
function remoteEnded(d) {
  if (!call) return;
  const c = call;
  const secs = duration();
  cleanup();
  cleanCandidates(c.ref);
  const who = realNameOf(c.otherUid);
  if (d.status === "declined") showEnded("Call declined", `${who} can't talk right now.`);
  else if (d.status === "busy") showEnded("Busy", `${who} is on another call.`);
  else if (d.status === "missed" && !c.connectedAt) showEnded("Call ended", "");
  else showEnded(`${c.kind === "audio" ? "Audio" : "Video"} call ended`, `Duration: ${fmtDuration(secs)}`);
}

function hangup() { finish("ended"); }

function cleanup() {
  if (!call) return;
  const c = call;
  call = null;
  [c.ringTimer, c.connectTimer, c.reconnectTimer, c.giveUpTimer].forEach(clearTimeout);
  clearInterval(c.tick);
  c.unsubs.forEach(u => u());
  c.local?.getTracks().forEach(t => t.stop());
  try { c.pc?.close(); } catch { /* ignore */ }
  c.wakeLock?.release?.().catch(() => {});
  root().innerHTML = "";
  document.body.classList.remove("in-call");
}

// Remove my ICE candidates after the call — only metadata stays.
function cleanCandidates(ref) {
  ["callerCandidates", "calleeCandidates"].forEach(side =>
    getDocs(collection(ref, side)).then(s => s.forEach(d => deleteDoc(d.ref).catch(() => {}))).catch(() => {}));
}

addEventListener("pagehide", () => {
  if (call) updateDoc(call.ref, { status: call.connectedAt ? "ended" : "missed", endedAt: serverTimestamp(), endedBy: uid(), duration: duration() }).catch(() => {});
});
addEventListener("offline", () => { if (call?.connectedAt) setState("reconnecting"); });

actions.startCall = d => startCall(d.kind || "video");
export const inCall = () => !!call;
