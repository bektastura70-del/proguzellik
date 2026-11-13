package com.proguzellik.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * Uygulama ekranı. Derin bağlantılar (proguzellik://r/salon, https://proguzellik.com/r/salon) yerel giriş
 * ekranına ?open= olarak verilir; hangi adresin açılabileceğine giriş ekranındaki izin listesi karar verir.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState == null) openDeepLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openDeepLink(intent);
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
