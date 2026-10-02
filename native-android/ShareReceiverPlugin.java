package com.asaumi.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;

/**
 * Receives "Share to Asaumi" from other apps (text, links, photos, videos).
 * JS API (window.Capacitor.Plugins.ShareReceiver):
 *   getPending() -> { share: { text, subject, files: [{ path, mimeType, name, size }] } } (then cleared)
 *   event "shared" -> something new was shared while the app was running; call getPending()
 * Shared files are copied into the app's cache folder so the web code can read them.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {
    private Intent pendingIntent = null;

    @Override
    public void load() {
        cleanOldFiles();
        Intent i = getActivity() != null ? getActivity().getIntent() : null;
        if (isShare(i)) pendingIntent = i;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (!isShare(intent)) return;
        pendingIntent = intent;
        notifyListeners("shared", new JSObject(), true);
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject result = new JSObject();
        Intent intent = pendingIntent;
        pendingIntent = null;
        if (intent != null) {
            result.put("share", read(intent));
            if (getActivity() != null && getActivity().getIntent() == intent) getActivity().setIntent(new Intent());
        }
        call.resolve(result);
    }

    private static boolean isShare(Intent i) {
        if (i == null || i.getAction() == null) return false;
        return Intent.ACTION_SEND.equals(i.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(i.getAction());
    }

    @SuppressWarnings("deprecation")
    private JSObject read(Intent intent) {
        JSObject data = new JSObject();
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text != null) data.put("text", text.toString());
        if (subject != null) data.put("subject", subject);

        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        JSArray files = new JSArray();
        for (Uri u : uris) {
            JSObject f = copyToCache(u, intent.getType());
            if (f != null) files.put(f);
        }
        data.put("files", files);
        return data;
    }

    private JSObject copyToCache(Uri uri, String fallbackType) {
        try {
            ContentResolver cr = getContext().getContentResolver();
            String type = cr.getType(uri);
            if (type == null) type = fallbackType;
            String name = "shared";
            try (Cursor c = cr.query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0 && c.getString(idx) != null) name = c.getString(idx);
                }
            } catch (Exception ignored) { }

            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists()) dir.mkdirs();
            File out = new File(dir, System.currentTimeMillis() + "_" + name.replaceAll("[^A-Za-z0-9._-]", "_"));
            try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                if (in == null) return null;
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            JSObject f = new JSObject();
            f.put("path", out.getAbsolutePath());
            f.put("mimeType", type);
            f.put("name", name);
            f.put("size", out.length());
            return f;
        } catch (Exception e) {
            return null;
        }
    }

    // Shared copies are only needed briefly; remove ones older than a day
    private void cleanOldFiles() {
        try {
            File dir = new File(getContext().getCacheDir(), "shared");
            File[] list = dir.listFiles();
            if (list == null) return;
            long cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
            for (File f : list) if (f.lastModified() < cutoff) f.delete();
        } catch (Exception ignored) { }
    }
}
