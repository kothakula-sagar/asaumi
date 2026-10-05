package com.asaumi.app;

import android.accounts.Account;
import android.app.Activity;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;

import java.util.Collections;

/**
 * Google Drive access for the chat backup, using the Google account that is already on the phone.
 * Only the "drive.file" permission is asked: Asaumi can see and change ONLY the files it created itself.
 * JS API (window.Capacitor.Plugins.DriveAuth):
 *   authorize({ email, interactive }) -> { accessToken }
 *     email: the Google account to use (the Asaumi login email)
 *     interactive=false: never shows a screen; rejects with "NEEDS_CONSENT" if the person must agree first
 */
@CapacitorPlugin(name = "DriveAuth")
public class DriveAuthPlugin extends Plugin {
    private static final String SCOPE = "https://www.googleapis.com/auth/drive.file";
    private ActivityResultLauncher<IntentSenderRequest> consent;
    private PluginCall waiting = null;

    @Override
    public void load() {
        // registered while the activity is being created (required by Android)
        consent = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            PluginCall call = waiting;
            waiting = null;
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                call.reject("CANCELLED");
                return;
            }
            try {
                AuthorizationResult r = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData());
                resolveToken(call, r);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Google sign-in failed");
            }
        });
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        String email = call.getString("email");
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", true));
        AuthorizationRequest.Builder b = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(SCOPE)));
        if (email != null && !email.isEmpty()) b.setAccount(new Account(email, "com.google"));
        Identity.getAuthorizationClient(getActivity()).authorize(b.build())
            .addOnSuccessListener(r -> {
                if (r.hasResolution() && r.getPendingIntent() != null) {
                    if (!interactive) { call.reject("NEEDS_CONSENT"); return; }
                    if (waiting != null) { call.reject("BUSY"); return; }
                    waiting = call;
                    try {
                        consent.launch(new IntentSenderRequest.Builder(r.getPendingIntent().getIntentSender()).build());
                    } catch (Exception e) {
                        waiting = null;
                        call.reject(e.getMessage() != null ? e.getMessage() : "Couldn't open Google sign-in");
                    }
                    return;
                }
                resolveToken(call, r);
            })
            .addOnFailureListener(e -> call.reject(e.getMessage() != null ? e.getMessage() : "Google sign-in failed"));
    }

    private void resolveToken(PluginCall call, AuthorizationResult r) {
        if (r == null || r.getAccessToken() == null) { call.reject("No access token"); return; }
        JSObject o = new JSObject();
        o.put("accessToken", r.getAccessToken());
        call.resolve(o);
    }
}
