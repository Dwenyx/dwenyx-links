package com.dwenyx.keyboardrivals;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView web;
    private BillingClient billing;
    private boolean billingReady = false;
    private final Map<String, ProductDetails> products = new HashMap<>();
    private final List<String> wanted = new ArrayList<>();

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(0x1706);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        int c = 0xffd6e6ff;
        w.setStatusBarColor(c);
        w.setNavigationBarColor(c);
        web = new WebView(this);
        web.setBackgroundColor(c);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " KeyboardRivalsApp/5");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "KRBilling");
        setContentView(web);
        immersive();
        String url = "https://paint-clash.vercel.app/?appv=5";
        String cred = credOf(getIntent());
        if (cred != null) url += "#cred=" + cred;
        web.loadUrl(url);
        setupBilling();
    }

    // ---------- Google Play Billing ----------
    private void setupBilling() {
        billing = BillingClient.newBuilder(this)
                .setListener((res, purchases) -> {
                    if (res.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
                        for (Purchase p : purchases) handlePurchase(p);
                    } else if (res.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
                        js("window.krPurchaseFail&&krPurchaseFail('cancel')");
                    } else {
                        js("window.krPurchaseFail&&krPurchaseFail('error')");
                    }
                })
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
        connect();
    }

    private void connect() {
        billing.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    billingReady = true;
                    if (!wanted.isEmpty()) queryProducts(new ArrayList<>(wanted));
                    restore();
                }
            }
            @Override
            public void onBillingServiceDisconnected() { billingReady = false; }
        });
    }

    private void queryProducts(List<String> ids) {
        List<QueryProductDetailsParams.Product> list = new ArrayList<>();
        for (String id : ids) list.add(QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(BillingClient.ProductType.INAPP).build());
        billing.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(list).build(), (r, result) -> {
            try {
                JSONObject o = new JSONObject();
                for (ProductDetails pd : result.getProductDetailsList()) {
                    products.put(pd.getProductId(), pd);
                    ProductDetails.OneTimePurchaseOfferDetails off = pd.getOneTimePurchaseOfferDetails();
                    if (off != null) o.put(pd.getProductId(), off.getFormattedPrice());
                }
                js("window.krPrices&&krPrices(" + o.toString() + ")");
            } catch (Exception ignored) {}
        });
    }

    private void restore() {
        billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(), (r, list) -> {
            if (r.getResponseCode() == BillingClient.BillingResponseCode.OK && list != null) for (Purchase p : list) handlePurchase(p);
        });
    }

    private void handlePurchase(Purchase p) {
        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) {
            if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) js("window.krPurchaseFail&&krPurchaseFail('pending')");
            return;
        }
        final String token = p.getPurchaseToken();
        final List<String> ids = p.getProducts();
        billing.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(token).build(), (r, t) -> {
            if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                for (String id : ids) js("window.krPurchase&&krPurchase(" + JSONObject.quote(id) + "," + JSONObject.quote(token) + ")");
            }
        });
    }

    private void js(final String code) {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    class Bridge {
        @JavascriptInterface
        public boolean ready() { return billingReady; }

        @JavascriptInterface
        public void query(String idsJson) {
            try {
                JSONArray a = new JSONArray(idsJson);
                wanted.clear();
                for (int i = 0; i < a.length(); i++) wanted.add(a.getString(i));
                if (billingReady) queryProducts(new ArrayList<>(wanted));
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void buy(final String id) {
            runOnUiThread(() -> {
                ProductDetails pd = products.get(id);
                if (!billingReady || pd == null) { js("window.krPurchaseFail&&krPurchaseFail('unavailable')"); return; }
                List<BillingFlowParams.ProductDetailsParams> l = new ArrayList<>();
                l.add(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).build());
                billing.launchBillingFlow(MainActivity.this, BillingFlowParams.newBuilder().setProductDetailsParamsList(l).build());
            });
        }
    }

    // ---------- WebView / navigation ----------
    class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, String url) {
            if (!url.contains("applogin") && url.contains("paint-clash.vercel.app") && !url.contains(".apk")) return false;
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                if (url.contains("applogin")) {
                    Bundle bb = new Bundle();
                    bb.putBinder("android.support.customtabs.extra.SESSION", null);
                    i.putExtras(bb);
                    i.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", 0xff2457dc);
                    i.putExtra("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
                    i.putExtra("androidx.browser.customtabs.extra.SHARE_STATE", 2);
                }
                startActivity(i);
            } catch (Exception ignored) {}
            return true;
        }
    }

    @Override
    public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }
    @Override
    protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
    @Override
    protected void onResume() { super.onResume(); if (web != null) web.onResume(); if (billingReady) restore(); }
    @Override
    public void onBackPressed() {
        if (web != null) { web.evaluateJavascript("window.dispatchEvent(new Event('androidback'))", null); return; }
        super.onBackPressed();
    }
    private String credOf(Intent i) {
        if (i == null || i.getData() == null) return null;
        return i.getData().getQueryParameter("cred");
    }
    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        String c = credOf(i);
        if (c != null && web != null) web.evaluateJavascript("window.appLogin&&appLogin(" + JSONObject.quote(c) + ")", null);
    }
    @Override
    protected void onDestroy() { if (billing != null) billing.endConnection(); super.onDestroy(); }
}
