package com.asaumi.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app updates: downloads the new APK inside Asaumi (no browser) and opens Android's installer.
 * JS API (window.Capacitor.Plugins.AppUpdater):
 *   canInstall()            -> { allowed }  (Android 8+: "Install unknown apps" allowed for Asaumi?)
 *   openInstallSettings()   -> opens that setting for Asaumi
 *   downloadAndInstall({ url }) -> downloads, then opens the installer; resolves { ok: true }
 *   event "progress" -> { loaded, total }
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private volatile boolean busy = false;

    private boolean installAllowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", installAllowed());
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open the setting: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("No download link"); return; }
        if (busy) { call.reject("Already downloading"); return; }
        busy = true;
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "update");
                if (!dir.exists()) dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File apk = new File(dir, "Asaumi-update.apk");
                download(url, apk);
                if (!looksLikeApk(apk)) throw new Exception("The downloaded file is not an APK");
                install(apk);
                JSObject r = new JSObject();
                r.put("ok", true);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed");
            } finally {
                busy = false;
            }
        }).start();
    }

    // Follows GitHub's redirect to its file server by hand (https only) and reports progress.
    private void download(String url, File out) throws Exception {
        String current = url;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "Asaumi-Updater");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new Exception("Bad redirect");
                current = new URL(new URL(current), loc).toString();
                if (!current.startsWith("https://")) throw new Exception("Insecure redirect");
                continue;
            }
            if (code != 200) { c.disconnect(); throw new Exception("Server answered " + code); }
            long total = c.getContentLengthLong();
            long done = 0;
            try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream os = new FileOutputStream(out)) {
                byte[] buf = new byte[65536];
                int n;
                long lastEmit = 0;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    done += n;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit > 200) { lastEmit = now; progress(done, total); }
                }
            } finally {
                c.disconnect();
            }
            if (total > 0 && done != total) throw new Exception("Download incomplete");
            progress(done, total > 0 ? total : done);
            return;
        }
        throw new Exception("Too many redirects");
    }

    private void progress(long loaded, long total) {
        JSObject p = new JSObject();
        p.put("loaded", loaded);
        p.put("total", total);
        notifyListeners("progress", p);
    }

    // An APK is a ZIP file: it starts with "PK"
    private static boolean looksLikeApk(File f) {
        try (InputStream in = new FileInputStream(f)) {
            return f.length() > 100000 && in.read() == 'P' && in.read() == 'K';
        } catch (Exception e) {
            return false;
        }
    }

    private void install(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }
}
