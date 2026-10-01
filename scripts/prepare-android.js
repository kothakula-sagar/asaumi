// Runs after `cap add android`: app icons, notification icon, permissions and Firebase config.
const fs = require("fs"), path = require("path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const appDir = path.join(root, "android", "app");
const res = path.join(appDir, "src", "main", "res");
const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");

(async () => {
  // ---- 1) Launcher (home-screen) icon: assets/app-icon.png if you uploaded one, otherwise icon.svg ----
  const customIcon = ["png", "jpg", "jpeg", "webp"].map(e => path.join(root, "assets", `app-icon.${e}`)).find(p => fs.existsSync(p));
  const icon = fs.readFileSync(customIcon || path.join(root, "icon.svg"));
  console.log(`Home-screen icon: ${customIcon ? path.basename(customIcon) : "icon.svg (default)"}`);
  const launcher = { "mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192 };
  for (const [dir, px] of Object.entries(launcher)) {
    fs.mkdirSync(path.join(res, dir), { recursive: true });
    for (const name of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
      await sharp(icon, { density: 300 }).resize(px, px).png().toFile(path.join(res, dir, name));
    }
  }
  // Remove adaptive-icon XML so Android uses the PNG icons above
  fs.rmSync(path.join(res, "mipmap-anydpi-v26"), { recursive: true, force: true });

  // ---- 2) Small white notification icon ----
  const stat = fs.readFileSync(path.join(root, "assets", "notification-icon.svg"));
  const small = { drawable: 48, "drawable-mdpi": 24, "drawable-hdpi": 36, "drawable-xhdpi": 48, "drawable-xxhdpi": 72, "drawable-xxxhdpi": 96 };
  for (const [dir, px] of Object.entries(small)) {
    fs.mkdirSync(path.join(res, dir), { recursive: true });
    await sharp(stat, { density: 300 }).resize(px, px).png().toFile(path.join(res, dir, "ic_stat_icon.png"));
  }
  fs.mkdirSync(path.join(res, "values"), { recursive: true });
  fs.writeFileSync(path.join(res, "values", "asaumi_colors.xml"),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="asaumi_accent">#6C3BFF</color>\n</resources>\n');
  console.log("Icons installed.");

  // ---- 3) Permissions: camera + microphone for calls and voice notes, notifications ----
  let m = fs.readFileSync(manifestPath, "utf8");
  const perms = [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.VIBRATE",
    "android.permission.WAKE_LOCK",
    // "Together" distance (only while the app is open, only if turned on in Settings)
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    // Birthday surprise notification at exactly 12 AM
    "android.permission.SCHEDULE_EXACT_ALARM",
    "android.permission.USE_EXACT_ALARM",
    "android.permission.RECEIVE_BOOT_COMPLETED"
  ];
  const addPerms = perms.filter(p => !m.includes(`"${p}"`)).map(p => `    <uses-permission android:name="${p}" />`);
  const features = [
    '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
    '    <uses-feature android:name="android.hardware.microphone" android:required="false" />'
  ].filter(f => !m.includes(f.trim()));
  if (addPerms.length || features.length) m = m.replace("</manifest>", [...addPerms, ...features].join("\n") + "\n</manifest>");

  // ---- 4) Defaults for Firebase Cloud Messaging notifications ----
  if (!m.includes("default_notification_channel_id")) {
    const meta = `        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="asaumi_messages" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_icon" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/asaumi_accent" />
`;
    m = m.replace("</application>", meta + "    </application>");
  }
  fs.writeFileSync(manifestPath, m);
  console.log("Manifest permissions installed.");

  // ---- 5) Firebase Android config (enables push notifications) ----
  const gs = path.join(root, "google-services.json");
  if (fs.existsSync(gs)) {
    const cfg = JSON.parse(fs.readFileSync(gs, "utf8"));
    const appId = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf8")).appId;
    const pkgs = (cfg.client || []).map(c => c.client_info?.android_client_info?.package_name);
    if (!pkgs.includes(appId)) {
      console.error(`\n❌ google-services.json is for ${pkgs.join(", ") || "another app"}, but this app is ${appId}.`);
      console.error(`   In Firebase, add an Android app with package name ${appId} and download its google-services.json.\n`);
      process.exit(1);
    }
    fs.copyFileSync(gs, path.join(appDir, "google-services.json"));
    console.log("google-services.json installed - push notifications ON.");
  } else {
    console.warn("⚠️  google-services.json not found - the app will build, but without push notifications.");
  }
})().catch(err => { console.error(err); process.exit(1); });
