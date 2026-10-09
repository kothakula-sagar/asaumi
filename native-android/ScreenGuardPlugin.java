package com.asaumi.app;

import android.app.Activity;
import android.os.Build;
import android.view.WindowManager;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screen privacy (like PhonePe / GPay):
 *  • FLAG_SECURE: screenshots and screen recordings of Asaumi come out black / are refused. On by default,
 *    turned off only while that person has Developer mode on (setSecure).
 *  • Recent apps shows a blank card instead of the chats (Android 13+: setRecentsScreenshotEnabled(false);
 *    older versions: FLAG_SECURE also blanks it).
 *  • Android 14+: tells the app when a screenshot is attempted (Activity.ScreenCaptureCallback).
 * JS API (window.Capacitor.Plugins.ScreenGuard):
 *   isSupported()          -> { supported }  (screenshot detection)
 *   setSecure({ secure })  -> block (true) or allow (false) screenshots
 *   event "screenshot"
 */
@CapacitorPlugin(name = "ScreenGuard")
public class ScreenGuardPlugin extends Plugin {
    private Object callback = null; // Activity.ScreenCaptureCallback (kept as Object so older Android never loads the class)

    private static boolean detectSupported() {
        return Build.VERSION.SDK_INT >= 34; // Android 14
    }

    @Override
    public void load() {
        applySecure(true); // protected from the very first frame, before the web code has loaded
        if (Build.VERSION.SDK_INT >= 33 && getActivity() != null) Api33.hideFromRecents(getActivity());
        register();
    }

    private void applySecure(boolean on) {
        Activity a = getActivity();
        if (a == null) return;
        if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("secure", true));
        if (getActivity() == null) { call.reject("No screen"); return; }
        getActivity().runOnUiThread(() -> {
            applySecure(on);
            call.resolve();
        });
    }

    // Android asks to register while the screen is visible and unregister when it isn't
    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        register();
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        unregister();
    }

    private void register() {
        if (!detectSupported() || callback != null || getActivity() == null) return;
        try {
            callback = Api34.register(getActivity(), () -> notifyListeners("screenshot", new JSObject()));
        } catch (Exception ignored) { callback = null; }
    }

    private void unregister() {
        if (!detectSupported() || callback == null || getActivity() == null) return;
        try { Api34.unregister(getActivity(), callback); } catch (Exception ignored) { }
        callback = null;
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", detectSupported());
        call.resolve(r);
    }

    @RequiresApi(33)
    private static final class Api33 {
        static void hideFromRecents(Activity activity) {
            activity.setRecentsScreenshotEnabled(false);
        }
    }

    @RequiresApi(34)
    private static final class Api34 {
        static Object register(Activity activity, Runnable onShot) {
            Activity.ScreenCaptureCallback cb = onShot::run;
            activity.registerScreenCaptureCallback(activity.getMainExecutor(), cb);
            return cb;
        }

        static void unregister(Activity activity, Object cb) {
            activity.unregisterScreenCaptureCallback((Activity.ScreenCaptureCallback) cb);
        }
    }
}
