package com.asaumi.app;

import android.os.Build;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * App lock with the phone's fingerprint (or face) and, as a fallback, the phone's own screen lock
 * (PIN / pattern / password), the same way PhonePe and GPay do it.
 * JS API (window.Capacitor.Plugins.BiometricLock):
 *   isAvailable()                     -> { available, code }  (code = BiometricManager result, 11 = nothing set up)
 *   authenticate({ title, subtitle }) -> resolves { ok: true }; rejects with code = BiometricPrompt error
 *                                        (10 / 13 / 5 = cancelled, 7 / 9 = too many tries)
 */
@CapacitorPlugin(name = "BiometricLock")
public class BiometricLockPlugin extends Plugin {

    // Fingerprint + phone screen lock. Android 9-10 only allow this mix with "weak" biometrics.
    private static int authenticators() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(authenticators());
        JSObject o = new JSObject();
        o.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        o.put("code", r);
        call.resolve(o);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        final String title = call.getString("title", "Unlock");
        final String subtitle = call.getString("subtitle", "");
        final AtomicBoolean done = new AtomicBoolean(false);
        getActivity().runOnUiThread(() -> {
            try {
                FragmentActivity activity = (FragmentActivity) getActivity();
                BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            if (!done.compareAndSet(false, true)) return;
                            JSObject o = new JSObject();
                            o.put("ok", true);
                            call.resolve(o);
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence message) {
                            if (!done.compareAndSet(false, true)) return;
                            call.reject(message != null ? message.toString() : "Cancelled", String.valueOf(code));
                        }
                        // onAuthenticationFailed (finger not recognised): the prompt stays open for another try
                    });
                BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setAllowedAuthenticators(authenticators())
                    .setConfirmationRequired(false);
                if (!subtitle.isEmpty()) info.setSubtitle(subtitle);
                prompt.authenticate(info.build());
            } catch (Exception e) {
                if (done.compareAndSet(false, true)) call.reject(e.getMessage() != null ? e.getMessage() : "Couldn't open the fingerprint prompt", "-1");
            }
        });
    }
}
