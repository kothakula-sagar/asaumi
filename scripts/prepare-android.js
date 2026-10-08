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
    "android.permission.RECEIVE_BOOT_COMPLETED",
    // More → App updates: install the downloaded update (Android asks the person once)
    "android.permission.REQUEST_INSTALL_PACKAGES",
    // App lock with fingerprint / phone screen lock
    "android.permission.USE_BIOMETRIC"
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
  // ---- 5) "Share to Asaumi": appear in the phone's share menu for text, links, photos and videos ----
  if (!m.includes("android.intent.action.SEND")) {
    const filters = `
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
                <data android:mimeType="video/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
                <data android:mimeType="video/*" />
            </intent-filter>
`;
    m = m.replace("</activity>", `${filters}        </activity>`);
  }
  // ---- 5b) FileProvider: hands the downloaded update (app cache) to Android's installer ----
  fs.mkdirSync(path.join(res, "xml"), { recursive: true });
  fs.writeFileSync(path.join(res, "xml", "file_paths.xml"), `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="my_images" path="." />
    <cache-path name="my_cache_images" path="." />
    <files-path name="my_files" path="." />
</paths>
`);
  if (!m.includes("androidx.core.content.FileProvider")) {
    m = m.replace("</application>", `        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" />
        </provider>
    </application>`);
  }

  fs.writeFileSync(manifestPath, m);
  console.log("Manifest permissions and share targets installed.");

  // ---- 6) Our MainActivity + ShareReceiver plugin (Java) ----
  const appId = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf8")).appId;
  const javaDir = path.join(appDir, "src", "main", "java", ...appId.split("."));
  fs.mkdirSync(javaDir, { recursive: true });
  for (const f of fs.readdirSync(javaDir)) if (/^MainActivity\.(java|kt)$/.test(f)) fs.rmSync(path.join(javaDir, f));
  for (const f of fs.readdirSync(path.join(root, "native-android"))) {
    const src = fs.readFileSync(path.join(root, "native-android", f), "utf8").replace(/^package [\w.]+;/m, `package ${appId};`);
    fs.writeFileSync(path.join(javaDir, f), src);
  }
  console.log("Share receiver installed.");

  // ---- 7) app/build.gradle: Google sign-in library (chat backup to Google Drive), fingerprint library + version number ----
  const gradle = path.join(appDir, "build.gradle");
  let g = fs.readFileSync(gradle, "utf8");
  if (!g.includes("play-services-auth")) {
    g = g.replace(/dependencies\s*\{/, m0 => `${m0}\n    implementation "com.google.android.gms:play-services-auth:21.3.0"`);
  }
  if (!g.includes("androidx.biometric")) {
    g = g.replace(/dependencies\s*\{/, m0 => `${m0}\n    implementation "androidx.biometric:biometric:1.1.0"`);
  }
  // Version = GitHub build number, so the app can tell when a newer build exists
  const run = Number(process.env.GITHUB_RUN_NUMBER) || 0;
  if (run) {
    g = g.replace(/versionCode\s+\d+/, `versionCode ${run}`).replace(/versionName\s+"[^"]*"/, `versionName "1.${run}"`);
    console.log(`Version 1.${run} (build ${run}).`);
  }
  fs.writeFileSync(gradle, g);

  // ---- 8) Firebase Android config (enables push notifications) ----
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
