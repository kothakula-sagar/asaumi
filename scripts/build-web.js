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
// Sending: the app asks the push relay (push-relay/worker.js); the sending key is never put in the APK.
const relayUrl = (fs.readFileSync(path.join(root, "js", "config.js"), "utf8").match(/PUSH_RELAY_URL\s*=\s*"([^"]*)"/) || [])[1] || "";

const nativeJs = path.join(out, "js", "native.js");
fs.writeFileSync(nativeJs, fs.readFileSync(nativeJs, "utf8").replace("/*@PUSH*/false", hasFirebase ? "true" : "false"));

// Safety net: refuse to build if a private key ended up in the app files
for (const f of fs.readdirSync(path.join(out, "js"))) {
  if (/BEGIN (RSA )?PRIVATE KEY/.test(fs.readFileSync(path.join(out, "js", f), "utf8"))) {
    console.error(`❌ js/${f} contains a private key. Remove it: the sending key belongs only in the push relay.`);
    process.exit(1);
  }
}

// "App updates" in More: which GitHub repository publishes the APK (set automatically inside GitHub Actions)
const repo = process.env.GITHUB_REPOSITORY || "";
const updatesJs = path.join(out, "js", "updates.js");
fs.writeFileSync(updatesJs, fs.readFileSync(updatesJs, "utf8").replace('/*@REPO*/""', JSON.stringify(repo)));

console.log(`Web files copied to www/`);
console.log(`  in-app updates from:   ${repo || "OFF (only inside GitHub Actions)"}`);
console.log(`  receive notifications: ${hasFirebase ? "ON" : "OFF (google-services.json missing)"}`);
console.log(`  send notifications:    ${relayUrl ? `ON (push relay ${relayUrl})` : "OFF (PUSH_RELAY_URL in js/config.js is empty)"}`);
