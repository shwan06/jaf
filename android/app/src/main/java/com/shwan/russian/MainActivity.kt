package com.shwan.russian

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.widget.FrameLayout
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Hosts the Russian course, which ships **inside** the APK under `assets/www`
 * (synced from the repo's `static/` directory by a Gradle task at build time).
 *
 * Serving the app from local assets rather than loading a remote URL matters
 * for two reasons:
 *  - it works with no network at all, on first launch, which is what Google
 *    Play's Minimum Functionality policy expects of an app rather than a
 *    viewer for a website; and
 *  - it keeps a stable https origin, so `localStorage` (all study progress)
 *    persists across launches and app updates.
 *
 * Speech is bridged to native Android engines — see [SpeechBridge].
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var bridge: SpeechBridge

    private val micPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* result read on next use */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Serves assets/www over https://appassets.androidplatform.net/assets/…
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            // Paint the app's colour so nothing flashes white before the page draws.
            setBackgroundColor(APP_BACKGROUND)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true              // localStorage — study progress
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            // Everything is packaged locally; no need to reach the filesystem or network.
            settings.allowFileAccess = false
            settings.allowContentAccess = false

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                // Keep in-app navigation inside the WebView; send anything else
                // (the "Hear real Russians say this" video links, provider
                // signup pages) to the user's real browser.
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    val url = request.url
                    if (url.host == ASSET_HOST) return false
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                        true
                    } catch (e: Exception) {
                        false // no browser to handle it — let the WebView try
                    }
                }
            }

            webChromeClient = object : WebChromeClient() {
                // The page itself never uses getUserMedia (the mic goes through
                // SpeechBridge), but granting this keeps any future audio capture
                // working instead of silently failing.
                override fun onPermissionRequest(request: PermissionRequest) {
                    val wantsAudio = request.resources
                        .contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                    if (wantsAudio && hasMicPermission(this@MainActivity)) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        request.deny()
                        if (wantsAudio) requestMicPermission()
                    }
                }
            }
        }

        bridge = SpeechBridge(
            context = applicationContext,
            webView = webView,
            onNeedsMicPermission = { runOnUiThread { requestMicPermission() } },
        )
        bridge.init()
        webView.addJavascriptInterface(bridge, "RussianNative")

        // Apps targeting Android 15 (API 35) and above are always drawn
        // edge-to-edge and `android:statusBarColor` in the theme is ignored, so
        // the page has to be kept out from under the status and navigation bars
        // by hand.
        //
        // The insets go on a container rather than on the WebView itself:
        // WebView doesn't reliably apply its own padding to `position: fixed`
        // content, so padding the WebView moved the sticky header down but left
        // the fixed sidebar drawer underneath the clock. Shrinking the WebView's
        // real bounds fixes fixed, sticky and 100vh content alike.
        val root = FrameLayout(this).apply {
            setBackgroundColor(APP_BACKGROUND)
            addView(webView)
        }
        setContentView(root)

        ViewCompat.setOnApplyWindowInsetsListener(root) { view, windowInsets ->
            val bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(START_URL)
        }

        // Hardware/gesture back navigates the app's own history first.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    private fun requestMicPermission() {
        if (!hasMicPermission(this)) {
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        bridge.release()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val ASSET_HOST = "appassets.androidplatform.net"
        /** Matches the web app's --bg, so the status/navigation bar strips blend in. */
        private const val APP_BACKGROUND = 0xFF0F1320.toInt()
        private const val START_URL = "https://$ASSET_HOST/assets/www/index.html"

        fun hasMicPermission(context: Context): Boolean =
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
    }
}
