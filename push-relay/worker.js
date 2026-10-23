// Asaumi push relay: a free Cloudflare Worker that sends the phone notifications.
// The Firebase "send notifications" key lives ONLY here (a Worker secret), never inside the APK.
// The app proves who it is with its Firebase login (ID token); only the two Asaumi emails are accepted.
//
// Settings (Cloudflare → Workers → asaumi-push → Settings → Variables and Secrets):
//   FCM_SERVICE_ACCOUNT  (Secret) the whole service-account JSON key file
//   ALLOWED_EMAILS       (Text)   the two login emails, comma separated (same as firestore.rules)
//
// Endpoints (POST, header "Authorization: Bearer <Firebase ID token>", JSON body):
//   /send       { tokens: [..], title, body, page, tag, channel, ttl } → { results: [{ ok, status, error }] }
//   /subscribe  { token }  → joins the "asaumi-updates" topic (new-version notifications)

const TOPIC = "asaumi-updates";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const CHANNELS = ["asaumi_messages", "asaumi_calls"];
const MAX_TOKENS = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });

/* ------------------------------------------------------------------ bytes */
const te = new TextEncoder(), td = new TextDecoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const pemToDer = pem => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), c => c.charCodeAt(0)).buffer;

/* ------------------------------------------------------------------ who is asking (Firebase ID token) */
let jwks = { keys: null, exp: 0 };
async function googleKeys() {
  if (jwks.keys && jwks.exp > Date.now()) return jwks.keys;
  const r = await fetch(JWK_URL);
  if (!r.ok) throw new Error(`keys ${r.status}`);
  const maxAge = Number((r.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1]) || 3600;
  jwks = { keys: (await r.json()).keys || [], exp: Date.now() + maxAge * 1000 };
  return jwks.keys;
}

// → the verified email, or null
async function verifyIdToken(token, projectId, allowed) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = JSON.parse(td.decode(unb64url(parts[0])));
    claims = JSON.parse(td.decode(unb64url(parts[1])));
  } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(parts[2]), te.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (!claims.sub || !(claims.exp > now) || claims.iat > now + 300) return null;
  const email = String(claims.email || "").toLowerCase();
  return allowed.includes(email) ? email : null;
}

/* ------------------------------------------------------------------ Google access token for the service account */
const oauthCache = {}; // scope → { token, exp }
async function accessToken(sa, scope) {
  const c = oauthCache[scope];
  if (c && c.exp > Date.now() + 60000) return c.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(te.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(te.encode(JSON.stringify({
    iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
  })))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, te.encode(unsigned));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` })
  });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error(`Google sign-in for the sending key failed (${r.status}): ${d.error_description || d.error || ""}`);
  oauthCache[scope] = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return d.access_token;
}

/* ------------------------------------------------------------------ actions */
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const isToken = t => typeof t === "string" && t.length > 20 && t.length < 4096;

async function send(sa, b) {
  const tokens = Array.isArray(b.tokens) ? [...new Set(b.tokens.filter(isToken))].slice(0, MAX_TOKENS) : [];
  if (!tokens.length) return { results: [{ ok: false, error: "The other phone hasn't registered for notifications yet." }] };
  const channel = CHANNELS.includes(b.channel) ? b.channel : CHANNELS[0];
  const tag = str(b.tag, 40) || "asaumi";
  const ttl = Number(b.ttl) > 0 ? Math.min(Math.round(Number(b.ttl)), 2419200) : 0;
  const auth = await accessToken(sa, FCM_SCOPE);
  const results = await Promise.all(tokens.map(async token => {
    try {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: str(b.title, 120) || "Asaumi", body: str(b.body, 500) },
            data: { page: str(b.page, 40) || "home", tag },
            android: {
              priority: "HIGH",
              ...(ttl ? { ttl: `${ttl}s` } : {}),
              notification: { channel_id: channel, tag, icon: "ic_stat_icon", color: "#6C3BFF", sound: "default", default_vibrate_timings: true }
            }
          }
        })
      });
      if (r.ok) return { ok: true, status: r.status };
      const d = await r.json().catch(() => ({}));
      return { ok: false, status: r.status, error: d?.error?.message || `HTTP ${r.status}` };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }));
  return { results };
}

async function subscribe(sa, b) {
  if (!isToken(b.token)) return { ok: false, error: "No token" };
  const auth = await accessToken(sa, `${FCM_SCOPE} https://www.googleapis.com/auth/cloud-platform`);
  const r = await fetch("https://iid.googleapis.com/iid/v1:batchAdd", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, access_token_auth: "true", "Content-Type": "application/json" },
    body: JSON.stringify({ to: `/topics/${TOPIC}`, registration_tokens: [b.token] })
  });
  const d = await r.json().catch(() => ({}));
  const err = d?.results?.[0]?.error || (r.ok ? "" : d?.error?.message || d?.error || `HTTP ${r.status}`);
  return err ? { ok: false, error: typeof err === "string" ? err : JSON.stringify(err).slice(0, 160) } : { ok: true };
}

/* ------------------------------------------------------------------ entry */
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ error: "Asaumi push relay is running." }, 405);
    let sa;
    try { sa = JSON.parse(env.FCM_SERVICE_ACCOUNT || ""); } catch { /* handled below */ }
    if (!sa?.client_email || !sa?.private_key || !sa?.project_id) return json({ error: "Relay setup: the FCM_SERVICE_ACCOUNT secret is missing or not the whole key file." }, 500);
    const allowed = String(env.ALLOWED_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
    if (!allowed.length) return json({ error: "Relay setup: the ALLOWED_EMAILS variable is missing." }, 500);

    const idToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let email = null;
    try { email = await verifyIdToken(idToken, sa.project_id, allowed); } catch (err) { return json({ error: `Couldn't check the login: ${err.message}` }, 503); }
    if (!email) return json({ error: "Not allowed: sign in to Asaumi with one of the two accounts." }, 401);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const path = new URL(req.url).pathname;
    try {
      if (path === "/send") return json(await send(sa, body));
      if (path === "/subscribe") return json(await subscribe(sa, body));
      return json({ error: "Unknown endpoint" }, 404);
    } catch (err) {
      return json({ error: String(err?.message || err) }, 502);
    }
  }
};
