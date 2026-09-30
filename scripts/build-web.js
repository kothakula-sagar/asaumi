// Copies the website files into ./www, which Capacitor packages inside the Android app.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const out = path.join(root, "www");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ["index.html", "manifest.json", "sw.js", "icon.svg"]) {
  fs.copyFileSync(path.join(root, f), path.join(out, f));
}
for (const d of ["css", "js"]) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });

// Turn on push notifications only when the Firebase Android config is present.
const hasFirebase = fs.existsSync(path.join(root, "google-services.json"));
// Sending key: comes from the GitHub secret FCM_SERVICE_ACCOUNT and is only written into the APK copy.
let pushKey = null;
if (process.env.FCM_SERVICE_ACCOUNT) {
  try {
    const sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
    if (sa.client_email && sa.private_key && sa.project_id) {
      pushKey = { project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key };
    } else console.warn("⚠️  FCM_SERVICE_ACCOUNT is missing client_email / private_key / project_id.");
  } catch {
    console.warn("⚠️  FCM_SERVICE_ACCOUNT is not valid JSON - paste the whole key file into the GitHub secret.");
  }
}

const nativeJs = path.join(out, "js", "native.js");
fs.writeFileSync(nativeJs, fs.readFileSync(nativeJs, "utf8")
  .replace("/*@PUSH*/false", hasFirebase ? "true" : "false")
  .replace("/*@PUSHKEY*/null", pushKey ? JSON.stringify(pushKey) : "null"));

console.log(`Web files copied to www/`);
console.log(`  receive notifications: ${hasFirebase ? "ON" : "OFF (google-services.json missing)"}`);
console.log(`  send notifications:    ${pushKey ? "ON" : "OFF (GitHub secret FCM_SERVICE_ACCOUNT missing)"}`);
