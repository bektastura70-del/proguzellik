package com.proguzellik.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;
import java.lang.reflect.Method;
import java.util.HashSet;
import java.util.Set;

/**
 * Uygulama ekranı. Derin bağlantılar (proguzellik://r/salon, https://proguzellik.com/r/salon) yerel giriş
 * ekranına ?open= olarak verilir; hangi adresin açılabileceğine giriş ekranındaki izin listesi karar verir.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        injectBridgeIntoSite();
        if (savedInstanceState == null) openDeepLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openDeepLink(intent);
    }

    /**
     * Capacitor köprüsünü (yerel eklentiler: hatırlatmalar vb.) yalnızca izin verilen Pro Güzellik adreslerine ekler.
     * Capacitor bunu kendiliğinden yalnızca yerel giriş ekranına ekler; iOS'ta tüm ana sayfalara eklendiği için
     * Android'de de aynı davranış sağlanır. İzin listesi capacitor.config.json'daki allowNavigation'dır.
     */
    private void injectBridgeIntoSite() {
        if (bridge == null || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        try {
            Method m = bridge.getClass().getDeclaredMethod("getJSInjector");
            m.setAccessible(true);
            Object injector = m.invoke(bridge);
            if (injector == null) return;
            String script = (String) injector.getClass().getMethod("getScriptString").invoke(injector);
            String local = Uri.parse(bridge.getLocalUrl()).buildUpon().path(null).clearQuery().fragment(null).build().toString();
            Set<String> origins = new HashSet<>();
            for (String origin : bridge.getAllowedOriginRules()) {
                if (!origin.equals(local) && !origin.equals(local + "/")) origins.add(origin);
            }
            if (!origins.isEmpty()) WebViewCompat.addDocumentStartJavaScript(bridge.getWebView(), script, origins);
        } catch (Exception e) {
            Logger.warn("Köprü site sayfalarına eklenemedi: " + e.getMessage());
        }
    }

    private void openDeepLink(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        if (bridge == null) return;
        final WebView webView = bridge.getWebView();
        final String target = Uri.parse(bridge.getLocalUrl()).buildUpon()
            .path("/index.html")
            .appendQueryParameter("open", intent.getData().toString())
            .build()
            .toString();
        webView.post(() -> webView.loadUrl(target));
    }
}
