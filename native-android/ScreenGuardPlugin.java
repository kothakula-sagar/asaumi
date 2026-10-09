package com.asaumi.app;

import android.app.Activity;
import android.os.Build;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screenshot alert: Android 14+ tells the app when a screenshot of it is taken
 * (Activity.ScreenCaptureCallback, permission DETECT_SCREEN_CAPTURE). Older Android versions can't detect it.
 * JS API (window.Capacitor.Plugins.ScreenGuard):
 *   isSupported()      -> { supported }
 *   event "screenshot" -> a screenshot of Asaumi was just taken
 */
@CapacitorPlugin(name = "ScreenGuard")
public class ScreenGuardPlugin extends Plugin {
    private Object callback = null; // Activity.ScreenCaptureCallback (kept as Object so older Android never loads the class)

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= 34; // Android 14
    }

    @Override
    public void load() {
        register();
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
        if (!supported() || callback != null || getActivity() == null) return;
        try {
            callback = Api34.register(getActivity(), () -> notifyListeners("screenshot", new JSObject()));
        } catch (Exception ignored) { callback = null; }
    }

    private void unregister() {
        if (!supported() || callback == null || getActivity() == null) return;
        try { Api34.unregister(getActivity(), callback); } catch (Exception ignored) { }
        callback = null;
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", supported());
        call.resolve(r);
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
