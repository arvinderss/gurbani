package dev.arvinderss.pothisahib;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Thin shell: renders the self-contained Pothi Sahib HTML file from the app's
 * own assets, fully offline. No network, no permissions, no external content.
 *
 * Three WebView gaps are patched here so the reader's own UI keeps working:
 *  - Fullscreen: the reader's Fullscreen API button silently does nothing
 *    without onShowCustomView/onHideCustomView, so those route the request to
 *    a real immersive fullscreen (and the back button exits it).
 *  - Export backup: the reader downloads its settings backup as a data: URL;
 *    a DownloadListener writes it to the Downloads folder.
 *  - Import backup: file inputs need onShowFileChooser or the picker never
 *    opens inside a WebView.
 */
public class MainActivity extends Activity {

    private static final int FILE_CHOOSER_REQUEST = 19001;

    private WebView webView;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private ValueCallback<Uri[]> fileChooserCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenView = view;
                fullscreenCallback = callback;
                getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
                addContentView(fullscreenView, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                if (url != null && url.startsWith("data:application/json")) {
                    saveBackupFromDataUrl(url);
                }
            }
        });
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void saveBackupFromDataUrl(String url) {
        byte[] bytes = null;
        try {
            String b64 = url.substring(url.indexOf("base64,") + 7);
            bytes = Base64.decode(b64, Base64.DEFAULT);
        } catch (Exception e) {
            Toast.makeText(this, "Could not decode the backup.", Toast.LENGTH_LONG).show();
            return;
        }
        if (bytes == null || bytes.length == 0) {
            Toast.makeText(this, "Backup was empty.", Toast.LENGTH_LONG).show();
            return;
        }
        String name = "pothi-sahib-backup.json";
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver resolver = getContentResolver();
                Uri item = resolver.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
                if (item != null) {
                    try (OutputStream out = resolver.openOutputStream(item)) {
                        out.write(bytes);
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    resolver.update(item, values, null, null);
                    Toast.makeText(this, "Backup saved to Downloads/" + name, Toast.LENGTH_LONG).show();
                    return;
                }
            }
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            Toast.makeText(this, "Backup saved to Downloads/" + name, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Could not save the backup: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void exitFullscreen() {
        if (fullscreenView != null) {
            ((ViewGroup) webView.getParent()).removeView(fullscreenView);
            fullscreenView = null;
        }
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            ValueCallback<Uri[]> callback = fileChooserCallback;
            fileChooserCallback = null;
            if (callback != null) {
                Uri[] results = (data == null || resultCode != RESULT_OK)
                    ? null
                    : WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                callback.onReceiveValue(results);
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            exitFullscreen();
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}