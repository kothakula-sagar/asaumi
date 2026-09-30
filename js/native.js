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
  Push.addListener("registration", t => { currentToken = t.value; tokenHandler?.(t.value); });
  Push.addListener("registrationError", e => console.warn("[asaumi] push registration failed", e));
}

// Ask for permission, create the notification channels and register with Firebase Cloud Messaging.
export async function initPush(onToken) {
  if (!pushAvailable()) return false;
  tokenHandler = onToken;
  try {
    let p = await Push.checkPermissions();
    if (p.receive !== "granted" && p.receive !== "denied") p = await Push.requestPermissions();
    if (p.receive !== "granted") return false;
    await Push.createChannel({ id: CHANNELS.messages, name: "Messages & memories", description: "New messages, memories and moments", importance: 4, visibility: 0, vibration: true, lights: true, lightColor: "#8B5CF6" });
    await Push.createChannel({ id: CHANNELS.calls, name: "Calls", description: "Incoming and missed calls", importance: 5, visibility: 1, vibration: true, lights: true, lightColor: "#38BDF8" });
    addPushListeners();
    await Push.register();
    if (currentToken) onToken(currentToken);
    return true;
  } catch (err) {
    console.warn("[asaumi] push init failed", err);
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

let oauth = null; // { token, exp }
async function accessToken() {
  if (oauth && oauth.exp > Date.now() + 60000) return oauth.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlText(JSON.stringify({
    iss: PUSH_KEY.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
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
  const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  if (!data?.access_token) throw new Error(`token ${res.status}`);
  oauth = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return oauth.token;
}

// tokens: the other phone's FCM tokens. Never throws.
export async function sendPush(tokens, { title = "❤️ Asaumi", body, page = "home", tag = "asaumi", channel = CHANNELS.messages, ttl }) {
  if (!canSendPush() || !tokens?.length) return;
  try {
    const auth = await accessToken();
    await Promise.all(tokens.map(token => Http.request({
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
    }).catch(err => console.warn("[asaumi] push send", err))));
  } catch (err) {
    console.warn("[asaumi] push failed", err);
  }
}

export function onBackButton(cb) { try { App?.addListener("backButton", cb); } catch { /* ignore */ } }
export function onResume(cb) { try { App?.addListener("resume", cb); } catch { /* ignore */ } }
export function minimizeApp() { try { App?.minimizeApp?.(); } catch { /* ignore */ } }
