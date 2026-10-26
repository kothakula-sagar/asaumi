// Runs in GitHub Actions after a new APK is published.
// Sends one notification to the FCM topic "asaumi-updates" that every installed Asaumi app joins,
// so phones still on the old version are told to update (works with the app closed). Free.
// Uses the same GitHub secret as the app's notifications: FCM_SERVICE_ACCOUNT.
const crypto = require("crypto"), fs = require("fs"), path = require("path");

const TOPIC = "asaumi-updates";
const run = process.env.GITHUB_RUN_NUMBER || "";

(async () => {
  let sa;
  try { sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT || ""); } catch { /* handled below */ }
  if (!sa?.client_email || !sa?.private_key || !sa?.project_id) {
    console.log("::warning::FCM_SERVICE_ACCOUNT secret missing - no 'new version' notification sent.");
    return;
  }
  const appName = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "capacitor.config.json"), "utf8")).appName || "Asaumi";

  // Google sign-in with the service account (signed JWT → access token)
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
  })}`;
  const jwt = `${unsigned}.${crypto.sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key).toString("base64url")}`;
  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  const tok = await tr.json();
  if (!tok.access_token) throw new Error(`Google sign-in failed: ${JSON.stringify(tok)}`);

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        topic: TOPIC,
        notification: { title: appName, body: `${appName} – a new version is ready ✨ Tap to update` },
        data: { page: "more", tag: "update", build: String(run) },
        android: {
          priority: "HIGH",
          ttl: "604800s", // phones that are off or offline still get it within 7 days
          notification: { channel_id: "asaumi_messages", tag: "update", icon: "ic_stat_icon", color: "#6C3BFF", sound: "default" }
        }
      }
    })
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`FCM ${res.status}: ${JSON.stringify(out)}`);
  console.log(`'New version' notification sent for build ${run}: ${out.name}`);
})().catch(err => {
  // never fail the build because of the notification
  console.log(`::warning::Couldn't send the 'new version' notification: ${err.message}`);
});
