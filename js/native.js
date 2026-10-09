// Bridge to the Android app (Capacitor). In a normal browser everything here does nothing.
// PUSH_ENABLED is switched to true by scripts/build-web.js when google-services.json is present.
const PUSH_ENABLED = /*@PUSH*/false;

const Cap = window.Capacitor;
export const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

function plugin(name) {
  if (!isNative) return null;
  try { return (Cap.Plugins && Cap.Plugins[name]) || (Cap.registerPlugin && Cap.registerPlugin(name)) || null; }
  catch { return null; }
}
const Push = plugin("PushNotifications");
const Browser = plugin("Browser");
const App = plugin("App");

export const CHANNELS = { messages: "asaumi_messages", calls: "asaumi_calls" };
export const pushAvailable = () => isNative && PUSH_ENABLED && !!Push;

let currentToken = null;
let tokenHandler = null;
let listenersAdded = false;

function addPushListeners() {
  if (listenersAdded || !Push) return;
  listenersAdded = true;
  Push.addListener("registration", t => {
    currentToken = t.value;
    pushError = "";
    retries = 0;
    clearTimeout(retryTimer);
    tokenHandler?.(t.value);
    subscribeUpdateTopic(t.value); // "a new version is ready" notifications
  });
  Push.addListener("registrationError", e => {
    console.warn("[asaumi] push registration failed", e);
    pushError = `Registration failed: ${e?.error || JSON.stringify(e)}`;
    // SERVICE_NOT_AVAILABLE is usually temporary (Google Play services busy / network) — retry.
    if (retries < 6) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { retries += 1; Push.register().catch(() => {}); }, 15000 * 2 ** retries);
    }
  });
}

let retries = 0, retryTimer = null;

// Try again when the app comes back to the screen and this phone still has no token.
export function retryPushIfNeeded() {
  if (!pushAvailable() || currentToken || !listenersAdded) return;
  retries = 0;
  Push.register().catch(() => {});
}

let pushError = "";
export const lastPushError = () => pushError;

// Ask for permission, create the notification channels and register with Firebase Cloud Messaging.
export async function initPush(onToken) {
  if (!pushAvailable()) return false;
  tokenHandler = onToken;
  try {
    let p = await Push.checkPermissions();
    if (p.receive !== "granted" && p.receive !== "denied") p = await Push.requestPermissions();
    if (p.receive !== "granted") { pushError = `Notification permission is "${p.receive}"`; return false; }
    await Push.createChannel({ id: CHANNELS.messages, name: "Messages & memories", description: "New messages, memories and moments", importance: 4, visibility: 0, vibration: true, lights: true, lightColor: "#8B5CF6" });
    await Push.createChannel({ id: CHANNELS.calls, name: "Calls", description: "Incoming and missed calls", importance: 5, visibility: 1, vibration: true, lights: true, lightColor: "#38BDF8" });
    addPushListeners();
    await Push.register();
    if (currentToken) onToken(currentToken);
    return true;
  } catch (err) {
    console.warn("[asaumi] push init failed", err);
    pushError = `Setup failed: ${err?.message || err}`;
    return false;
  }
}

export const getPushToken = () => currentToken;

export async function pushPermission() {
  if (!pushAvailable()) return "unsupported";
  try { return (await Push.checkPermissions()).receive; } catch { return "unsupported"; }
}

// cb(page) when the user taps a notification (also fires once after a cold start)
export function onNotificationTap(cb) {
  if (!Push) return;
  try { Push.addListener("pushNotificationActionPerformed", a => cb(a?.notification?.data?.page || "home")); } catch { /* ignore */ }
}

export function clearDelivered() {
  try { Push?.removeAllDeliveredNotifications?.().catch(() => {}); } catch { /* ignore */ }
}

export async function openExternal(url) {
  if (Browser) { try { await Browser.open({ url }); return; } catch { /* fall through */ } }
  window.open(url, "_blank", "noopener");
}

// Opens a link in its own app when installed (YouTube, Instagram, Spotify…), otherwise the browser
const Launcher = plugin("AppLauncher");
export async function openInApp(url) {
  if (Launcher) { try { const r = await Launcher.openUrl({ url }); if (r?.completed !== false) return; } catch { /* fall through */ } }
  return openExternal(url);
}

/* ------------------------------------------------------------------ "Share to Asaumi" from other apps */
// Native side: native-android/ShareReceiverPlugin.java copies shared photos/videos into the app cache.
const ShareRx = plugin("ShareReceiver");
export async function takePendingShare() {
  if (!ShareRx) return null;
  try { return (await ShareRx.getPending())?.share || null; } catch { return null; }
}
export function onShareReceived(cb) { try { ShareRx?.addListener("shared", () => cb()); } catch { /* ignore */ } }
export const fileSrc = path => (Cap?.convertFileSrc ? Cap.convertFileSrc(path) : path);

/* ------------------------------------------------------------------ sending push (free, no server) */
// The app that performs an action (sends a message, adds a memory, calls) sends the notification
// straight to the other phone through Firebase Cloud Messaging (free on the Spark plan).
// PUSH_KEY is a service-account key that can ONLY send notifications. It is injected at build
// time from the GitHub secret FCM_SERVICE_ACCOUNT and exists only inside the APK.
const PUSH_KEY = /*@PUSHKEY*/null;
const Http = plugin("CapacitorHttp");
export const canSendPush = () => isNative && !!PUSH_KEY && !!Http;

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = s => b64url(new TextEncoder().encode(s));
function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const oauthCache = {}; // scope → { token, exp }
async function accessToken(scope = FCM_SCOPE) {
  const oauth = oauthCache[scope];
  if (oauth && oauth.exp > Date.now() + 60000) return oauth.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlText(JSON.stringify({
    iss: PUSH_KEY.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  }))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(PUSH_KEY.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await Http.request({
    method: "POST",
    url: "https://oauth2.googleapis.com/token",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }
  });
  const data = parseBody(res.data);
  if (!data?.access_token) {
    delete oauthCache[scope];
    throw new Error(`Google sign-in for the sending key failed (${res.status}): ${data?.error_description || data?.error || JSON.stringify(data).slice(0, 200)}`);
  }
  oauthCache[scope] = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return oauthCache[scope].token;
}

/* ------------------------------------------------------------------ "new version" notifications */
// This phone joins the FCM topic "asaumi-updates". After every GitHub build, the build sends one
// notification to that topic, so phones still on the old version hear about it (even with the app closed).
// Same subscription call the Firebase Admin SDK makes; free.
export const UPDATE_TOPIC = "asaumi-updates";
let topicState = { ok: false, error: "" };
export const updateAlertsState = () => topicState;

async function subscribeUpdateTopic(token) {
  if (!canSendPush() || !token) { topicState = { ok: false, error: "This APK has no notification key." }; return; }
  let done = "";
  try { done = localStorage.getItem("asaumi.topicToken") || ""; } catch { /* ignore */ }
  if (done === token) { topicState = { ok: true, error: "" }; return; }
  try {
    const auth = await accessToken(`${FCM_SCOPE} https://www.googleapis.com/auth/cloud-platform`);
    const res = await Http.request({
      method: "POST",
      url: "https://iid.googleapis.com/iid/v1:batchAdd",
      headers: { Authorization: `Bearer ${auth}`, access_token_auth: "true", "Content-Type": "application/json" },
      data: { to: `/topics/${UPDATE_TOPIC}`, registration_tokens: [token] }
    });
    const d = parseBody(res.data);
    const err = d?.results?.[0]?.error || (res.status >= 300 ? d?.error?.message || d?.error || `HTTP ${res.status}` : "");
    if (err) throw new Error(typeof err === "string" ? err : JSON.stringify(err).slice(0, 160));
    try { localStorage.setItem("asaumi.topicToken", token); } catch { /* ignore */ }
    topicState = { ok: true, error: "" };
  } catch (err) {
    console.warn("[asaumi] update topic", err);
    topicState = { ok: false, error: err.message || String(err) };
  }
}

function parseBody(d) {
  if (typeof d !== "string") return d;
  try { return JSON.parse(d); } catch { return { raw: d }; }
}

// tokens: the other phone's FCM tokens. Never throws.
// Returns one result per token: { ok, status, error }
export async function sendPush(tokens, { title = "Asaumi", body, page = "home", tag = "asaumi", channel = CHANNELS.messages, ttl }) {
  if (!canSendPush()) return [{ ok: false, error: "This APK was built without the sending key (FCM_SERVICE_ACCOUNT)." }];
  if (!tokens?.length) return [{ ok: false, error: "The other phone hasn't registered for notifications yet." }];
  let auth;
  try {
    auth = await accessToken();
  } catch (err) {
    console.warn("[asaumi] push auth", err);
    return [{ ok: false, error: err.message || String(err) }];
  }
  return Promise.all(tokens.map(async token => {
    try {
      const res = await Http.request({
        method: "POST",
        url: `https://fcm.googleapis.com/v1/projects/${PUSH_KEY.project_id}/messages:send`,
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        data: {
          message: {
            token,
            notification: { title, body },
            data: { page, tag },
            android: {
              priority: "HIGH",
              ...(ttl ? { ttl: `${ttl}s` } : {}),
              notification: { channel_id: channel, tag, icon: "ic_stat_icon", color: "#6C3BFF", sound: "default", default_vibrate_timings: true }
            }
          }
        }
      });
      const d = parseBody(res.data);
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
      return { ok: false, status: res.status, error: d?.error?.message || JSON.stringify(d).slice(0, 200) };
    } catch (err) {
      console.warn("[asaumi] push send", err);
      return { ok: false, error: err.message || String(err) };
    }
  }));
}

/* ------------------------------------------------------------------ files (chat backup) */
const Files = plugin("Filesystem");
const ShareSheet = plugin("Share");

// Writes a text file the person can find in the Files app (Documents). Returns { uri, folder } or null.
export async function saveTextFile(name, text) {
  if (!Files) return null;
  try {
    const r = await Files.writeFile({ path: name, data: text, directory: "DOCUMENTS", encoding: "utf8", recursive: true });
    return { uri: r.uri, folder: "Documents" };
  } catch (err) {
    console.warn("[asaumi] save to Documents failed, using app storage", err);
    const r = await Files.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
    return { uri: r.uri, folder: null };
  }
}

// Opens Android's share menu for a file (Google Drive, WhatsApp, Gmail, Files…)
export async function shareFile(uri, title) {
  if (!ShareSheet) return false;
  try { await ShareSheet.share({ title, dialogTitle: title, files: [uri] }); return true; }
  catch (err) { if (!/cancel/i.test(err?.message || "")) console.warn("[asaumi] share", err); return false; }
}

/* ------------------------------------------------------------------ Google Drive sign-in (native-android/DriveAuthPlugin.java) */
const DriveAuth = plugin("DriveAuth");
export const driveSupported = () => !!DriveAuth;
// → access token for Drive ("drive.file": only files Asaumi created). interactive=false never shows a screen.
export async function driveAuthorize(email, interactive = true) {
  if (!DriveAuth) throw new Error("UNSUPPORTED");
  return (await DriveAuth.authorize({ email, interactive })).accessToken;
}

/* ------------------------------------------------------------------ fingerprint / phone screen lock (native-android/BiometricLockPlugin.java) */
const Bio = plugin("BiometricLock");
// → { available, code }  (code 11 = no fingerprint or screen lock set up on the phone)
export async function biometricAvailable() {
  if (!Bio) return { available: false, code: -1 };
  try { const r = await Bio.isAvailable(); return { available: !!r.available, code: r.code }; }
  catch { return { available: false, code: -1 }; } // older APK without the plugin
}
// Shows Android's fingerprint / screen-lock prompt. Never throws: → { ok, cancelled, lockedOut }
export async function biometricUnlock({ title, subtitle }) {
  if (!Bio) return { ok: false, cancelled: false, lockedOut: false };
  try {
    await Bio.authenticate({ title, subtitle });
    return { ok: true };
  } catch (err) {
    const code = String(err?.code ?? "");
    return { ok: false, code, cancelled: ["5", "10", "13"].includes(code), lockedOut: ["7", "9"].includes(code) };
  }
}

/* ------------------------------------------------------------------ in-app update (native-android/AppUpdaterPlugin.java) */
const Updater = plugin("AppUpdater");
export const canSelfUpdate = () => !!Updater;
export async function installAllowed() {
  try { return (await Updater.canInstall()).allowed; } catch { return true; }
}
export async function openInstallSettings() {
  try { await Updater?.openInstallSettings(); } catch { /* ignore */ }
}
// Downloads the APK inside the app, then opens Android's "Update" screen. onProgress(fraction|null, bytes)
export async function downloadAndInstall(url, onProgress) {
  const h = await Updater.addListener("progress", p => onProgress?.(p.total > 0 ? p.loaded / p.total : null, p.loaded));
  try { await Updater.downloadAndInstall({ url }); }
  finally { try { await h?.remove?.(); } catch { /* ignore */ } }
}

// Installed version: { version: "1.57", build: "57" } (build = Android versionCode)
export async function appInfo() {
  if (!App) return null;
  try { return await App.getInfo(); } catch { return null; }
}

export function buildInfo() {
  return { isNative, canReceive: isNative && PUSH_ENABLED, hasKey: !!PUSH_KEY, httpPlugin: !!Http, pushPlugin: !!Push };
}

/* ------------------------------------------------------------------ local notifications (birthday at 12 AM) */
// Scheduled ON this phone, so it fires at midnight even with the app closed and no internet.
const Local = plugin("LocalNotifications");
const BIRTHDAY_ID = 7101;
export const SURPRISE_CHANNEL = "asaumi_surprise";

export async function scheduleBirthday(at, { title, body }) {
  if (!Local) return { ok: false, reason: "not-native" };
  try {
    let p = await Local.checkPermissions();
    if (p.display !== "granted") p = await Local.requestPermissions();
    if (p.display !== "granted") return { ok: false, reason: "permission" };
    await Local.createChannel({ id: SURPRISE_CHANNEL, name: "Surprises", description: "Birthday surprise at midnight", importance: 5, visibility: 0, vibration: true });
    await Local.cancel({ notifications: [{ id: BIRTHDAY_ID }] }).catch(() => {});
    if (!at) return { ok: true, cancelled: true };
    await Local.schedule({
      notifications: [{
        id: BIRTHDAY_ID, title, body, channelId: SURPRISE_CHANNEL, smallIcon: "ic_stat_icon",
        schedule: { at, allowWhileIdle: true }, extra: { page: "home" }
      }]
    });
    return { ok: true };
  } catch (err) {
    console.warn("[asaumi] birthday schedule", err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

// A notification shown right now on this phone (e.g. "Chat backed up"). Never asks for permission.
export async function showLocal(title, body, { id = 7202, page = "more" } = {}) {
  if (!Local) return false;
  try {
    if ((await Local.checkPermissions()).display !== "granted") return false;
    await Local.createChannel({ id: "asaumi_info", name: "Backups & info", description: "Chat backup finished and similar", importance: 3, visibility: 0 });
    await Local.schedule({ notifications: [{ id, title, body, channelId: "asaumi_info", smallIcon: "ic_stat_icon", extra: { page } }] });
    return true;
  } catch (err) {
    console.warn("[asaumi] local notification", err);
    return false;
  }
}

/* ------------------------------------------------------------------ screenshot alert (native-android/ScreenGuardPlugin.java, Android 14+) */
const Guard = plugin("ScreenGuard");
export async function screenshotSupported() {
  if (!Guard) return false;
  try { return !!(await Guard.isSupported()).supported; } catch { return false; } // older APK without the plugin
}
export function onScreenshot(cb) { try { Guard?.addListener("screenshot", () => cb()); } catch { /* ignore */ } }

// Android 12+: "Alarms & reminders" permission makes the 12 AM notification exact
export async function exactAlarmAllowed() {
  if (!Local) return true;
  try { return (await Local.checkExactNotificationSetting()).exact_alarm === "granted"; } catch { return true; }
}
export async function openExactAlarmSettings() { try { await Local?.changeExactNotificationSetting(); } catch { /* ignore */ } }

export function onLocalNotificationTap(cb) {
  try { Local?.addListener("localNotificationActionPerformed", a => cb(a?.notification?.extra?.page || "home")); } catch { /* ignore */ }
}

export function onBackButton(cb) { try { App?.addListener("backButton", cb); } catch { /* ignore */ } }
export function onResume(cb) { try { App?.addListener("resume", cb); } catch { /* ignore */ } }
export function minimizeApp() { try { App?.minimizeApp?.(); } catch { /* ignore */ } }
