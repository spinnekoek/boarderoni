package com.boarderoni.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

// Must match MDNS_SERVICE_TYPE in boarderoni/src/shared/constants.ts (the
// desktop side of this contract, including what the webPort/dev TXT records
// mean) — Android's NsdManager wants the trailing dot, the desktop's
// bonjour-service doesn't.
private const val SERVICE_TYPE = "_boarderoni._tcp."

// Must match SERVER_PORT in boarderoni/src/shared/constants.ts — used only
// as the manual-entry fallback's default, since a hand-typed IP has no TXT
// record to read a dev-server port from. Fine in practice: manual entry is
// an escape hatch, and it's the packaged build's fixed port that's stable
// enough to be worth typing in by hand anyway.
private const val DEFAULT_WEB_PORT = 17334

private const val DISCOVERY_WATCHDOG_MS = 8000L

// Prefs for remembering the manual-connect field across launches — most
// devices that need the manual fallback (see connectManually) need it every
// time (the OEM Wi-Fi stacks that drop mDNS don't start working later), so
// retyping the same IP each launch is pure friction.
private const val PREFS_NAME = "boarderoni"
private const val KEY_LAST_MANUAL_INPUT = "last_manual_input"

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var statusText: TextView
    private lateinit var statusOverlay: View
    private lateinit var manualIpInput: EditText
    private lateinit var manualConnectButton: Button

    private lateinit var nsdManager: NsdManager
    private lateinit var connectivityManager: ConnectivityManager
    private var multicastLock: WifiManager.MulticastLock? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var discoveryActive = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private var retryRunnable: Runnable? = null
    private var discoveryWatchdog: Runnable? = null

    // "host:port" of whatever's currently loaded, so a redundant onServiceFound
    // for the same instance doesn't reload a perfectly fine WebView.
    private var currentTarget: String? = null

    // Must be registered unconditionally before STARTED (a property
    // initializer runs during construction, ahead of onCreate) — the
    // Activity Result API throws if you try to register once the activity
    // is already started.
    private val nearbyWifiPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startDiscovery()
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // Belt-and-suspenders alongside Theme.Boarderoni (which has no
        // values-night variant): this stops the system dark theme from
        // touching this activity even if the theme lookup ever changes.
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
        super.onCreate(savedInstanceState)

        // Edge-to-edge: without this, the status/nav bars are laid out as
        // opaque strips outside the content area, and since the dashboard's
        // own background isn't necessarily white, they show up as visibly
        // separate white bars rather than blending with the page.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        setContentView(R.layout.activity_main)

        // Lets `chrome://inspect` on a USB-connected desktop attach to this
        // WebView's DevTools (Console/Network/Performance) — off by default,
        // Android doesn't imply it from a debuggable build the way some other
        // frameworks do. Debug-build-only so a release APK never exposes it.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        webView = findViewById(R.id.webview)
        statusText = findViewById(R.id.status_text)
        statusOverlay = findViewById(R.id.status_overlay)
        manualIpInput = findViewById(R.id.manual_ip_input)
        manualConnectButton = findViewById(R.id.manual_connect_button)

        nsdManager = getSystemService(Context.NSD_SERVICE) as NsdManager
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        setUpWebView()
        setUpManualConnect()

        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) {
                webView.goBack()
            } else {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        }

        showSearching()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // System bars can reappear on their own (a swipe-reveal, or coming
        // back from another app/the recents screen) — re-hide every time
        // focus returns rather than fighting the OS mid-gesture.
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun setUpWebView() {
        // WebView paints white by default until the page's own CSS has
        // something to show — visible as a bright flash on every load/
        // reload (a new deck, a reconnect, `changeServer()`) even with the
        // status overlay covering everything else. Matches
        // DEFAULT_DASHBOARD.backgroundColor (shared/types.ts) and
        // status_overlay_background (colors.xml) so there's no seam between
        // this, the overlay, and whatever the loaded dashboard itself paints.
        webView.setBackgroundColor(Color.parseColor("#14161B"))

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        // WebView's own default minimumFontSize is 8 (unlike a desktop
        // browser, which has no such floor) — any CSS font-size below that
        // silently gets clamped back up to 8px instead of erroring or being
        // ignored outright, which is why a label styled smaller than that
        // looked identical to one at exactly 8px on the tablet but rendered
        // fine, smaller, in the desktop editor's own (Chromium, same engine,
        // but not WebView, so no floor) preview. 1 removes the floor in
        // practice — dashboard labels set their own font-size explicitly
        // (DEFAULT_WIDGET_FONT_SIZE in shared/constants.ts), so this only
        // ever matters for someone deliberately going tiny.
        settings.minimumFontSize = 1

        // The dashboard's own CSS already forces `color-scheme: light`, but
        // WebView's algorithmic darkening can still repaint it if left on —
        // this is the actual fix for the white-panel-in-dark-theme bug.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            @Suppress("DEPRECATION")
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
        }

        // The web app's only way to tell it's running inside this app rather
        // than a regular mobile browser — see androidBridge.ts on the web
        // side, which gates the "Prevent screen timeout" option in the
        // 5-finger device settings modal on this object's mere existence.
        webView.addJavascriptInterface(WebAppBridge(), "BoarderoniAndroid")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                hideSearching()
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    currentTarget = null
                    showSearching(message = getString(R.string.status_lost_connection))
                    scheduleRediscovery()
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        acquireMulticastLock()
        registerNetworkCallback()
        ensureNearbyWifiPermissionThenDiscover()
    }

    // NsdManager discovery/resolve throws SecurityException without
    // NEARBY_WIFI_DEVICES on API 33+ (targetSdk 34 here) — see the manifest
    // entry for why. Below 33 the permission doesn't exist, so treat it as
    // implicitly granted.
    private fun hasNearbyWifiPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.NEARBY_WIFI_DEVICES) ==
            PackageManager.PERMISSION_GRANTED

    private fun ensureNearbyWifiPermissionThenDiscover() {
        if (hasNearbyWifiPermission()) {
            startDiscovery()
        } else {
            nearbyWifiPermissionLauncher.launch(Manifest.permission.NEARBY_WIFI_DEVICES)
        }
    }

    override fun onStop() {
        super.onStop()
        cancelRetry()
        cancelDiscoveryWatchdog()
        stopDiscovery()
        unregisterNetworkCallback()
        releaseMulticastLock()
    }

    private fun setUpManualConnect() {
        val lastInput = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_LAST_MANUAL_INPUT, null)
        if (!lastInput.isNullOrEmpty()) {
            manualIpInput.setText(lastInput)
            manualIpInput.setSelection(lastInput.length)
        }

        manualConnectButton.setOnClickListener { connectManually() }
        manualIpInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                connectManually()
                true
            } else {
                false
            }
        }
    }

    // Accepts "192.168.1.23" (asks the desktop itself which port to use —
    // see resolveManualWebPort) or "192.168.1.23:5173" (an explicit port,
    // for pointing at something other than what the desktop reports, e.g. a
    // second desktop instance on a nonstandard port).
    private fun connectManually() {
        val input = manualIpInput.text.toString().trim()
        if (input.isEmpty()) return
        val colonIndex = input.lastIndexOf(':')
        val host = if (colonIndex >= 0) input.substring(0, colonIndex) else input
        if (host.isEmpty()) return
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(KEY_LAST_MANUAL_INPUT, input)
            .apply()
        cancelDiscoveryWatchdog()
        cancelRetry()
        if (colonIndex >= 0) {
            val port = input.substring(colonIndex + 1).toIntOrNull() ?: DEFAULT_WEB_PORT
            currentTarget = "$host:$port"
            loadMobileLink(host, port)
        } else {
            resolveManualWebPort(host)
        }
    }

    // No typed port means "figure it out" — SERVER_PORT (DEFAULT_WEB_PORT)
    // always answers /api/apk-info regardless of dev/packaged mode (see
    // index.ts: that route is handled before the "WS only in dev mode"
    // placeholder), and its appUrl field already carries the real webPort
    // (the Vite dev server's port under `npm run dev`, or SERVER_PORT
    // itself in a packaged build) — the same value mDNS's TXT record would
    // supply, just fetched directly since manual entry has no TXT record to
    // read. Falls back to DEFAULT_WEB_PORT if the probe fails for any
    // reason (unreachable host, older desktop build, timeout).
    private fun resolveManualWebPort(host: String) {
        Thread {
            val resolvedPort = try {
                val connection =
                    URL("http://$host:$DEFAULT_WEB_PORT/api/apk-info").openConnection() as HttpURLConnection
                connection.connectTimeout = 2000
                connection.readTimeout = 2000
                try {
                    val body = connection.inputStream.bufferedReader().readText()
                    val appUrl = JSONObject(body).optString("appUrl")
                    if (appUrl.isEmpty()) null else Regex(""":(\d+)/""").find(appUrl)?.groupValues?.get(1)?.toIntOrNull()
                } finally {
                    connection.disconnect()
                }
            } catch (_: Exception) {
                null
            } ?: DEFAULT_WEB_PORT
            mainHandler.post {
                currentTarget = "$host:$resolvedPort"
                loadMobileLink(host, resolvedPort)
            }
        }.start()
    }

    // Most real-world NSD "discovery just doesn't find anything" reports
    // trace back to this: without a multicast lock, the Wi-Fi radio's
    // power-save mode drops incoming multicast packets, so mDNS replies
    // never reach the app even though the broadcast went out fine.
    private fun acquireMulticastLock() {
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        multicastLock = wifi?.createMulticastLock("boarderoni-mdns")?.apply {
            setReferenceCounted(true)
            acquire()
        }
    }

    private fun releaseMulticastLock() {
        multicastLock?.let { if (it.isHeld) it.release() }
        multicastLock = null
    }

    private fun registerNetworkCallback() {
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // Covers switching Wi-Fi networks (different AP, VPN toggle,
                // etc.) — the previously-resolved IP can't be trusted once
                // the network itself has changed, so start over.
                mainHandler.post {
                    currentTarget = null
                    showSearching()
                    restartDiscovery()
                }
            }

            override fun onLost(network: Network) {
                mainHandler.post {
                    currentTarget = null
                    showSearching(message = getString(R.string.status_no_wifi))
                }
            }
        }
        networkCallback = callback
        connectivityManager.registerNetworkCallback(request, callback)
    }

    private fun unregisterNetworkCallback() {
        networkCallback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
            } catch (_: IllegalArgumentException) {
                // Already unregistered — fine.
            }
        }
        networkCallback = null
    }

    private fun startDiscovery() {
        if (discoveryActive) return
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                discoveryActive = true
            }

            override fun onServiceFound(service: NsdServiceInfo) {
                resolveService(service)
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                mainHandler.post {
                    currentTarget = null
                    showSearching()
                }
            }

            override fun onDiscoveryStopped(serviceType: String) {
                discoveryActive = false
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                discoveryActive = false
                scheduleRediscovery()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                discoveryActive = false
            }
        }
        discoveryListener = listener
        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    }

    private fun stopDiscovery() {
        discoveryListener?.let {
            try {
                nsdManager.stopServiceDiscovery(it)
            } catch (_: IllegalArgumentException) {
                // Wasn't running — fine.
            }
        }
        discoveryListener = null
        discoveryActive = false
    }

    private fun restartDiscovery() {
        stopDiscovery()
        // Guard rather than re-prompt: this runs unattended from the
        // watchdog every DISCOVERY_WATCHDOG_MS, and calling startDiscovery()
        // without the permission throws. If it's still ungranted, onStart's
        // ensureNearbyWifiPermissionThenDiscover() is the only place that
        // should be asking the user for it.
        if (hasNearbyWifiPermission()) {
            mainHandler.postDelayed({ startDiscovery() }, 300)
        }
    }

    private fun resolveService(service: NsdServiceInfo) {
        nsdManager.resolveService(service, object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                // Transient on most OEMs — the next onServiceFound (mDNS
                // re-announces periodically) or the retry timer covers it.
            }

            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                val host = serviceInfo.host?.hostAddress ?: return
                val webPort = serviceInfo.txtValue("webPort")?.toIntOrNull() ?: serviceInfo.port
                val target = "$host:$webPort"
                if (target == currentTarget) return
                currentTarget = target
                mainHandler.post { loadMobileLink(host, webPort) }
            }
        })
    }

    private fun NsdServiceInfo.txtValue(key: String): String? {
        val entry = attributes.entries.firstOrNull { it.key.equals(key, ignoreCase = true) }
        return entry?.value?.toString(Charsets.UTF_8)
    }

    private fun loadMobileLink(host: String, port: Int) {
        webView.loadUrl("http://$host:$port/?mode=view")
    }

    private fun showSearching(message: String? = null) {
        statusText.text = message ?: getString(R.string.status_searching)
        statusOverlay.visibility = View.VISIBLE
        armDiscoveryWatchdog()
    }

    private fun hideSearching() {
        statusOverlay.visibility = View.GONE
        cancelDiscoveryWatchdog()
    }

    // Some OEM Wi-Fi stacks (older Samsung One UI in particular) silently
    // drop the initial multicast join — discovery reports started but no
    // response ever arrives, forever, even with a multicast lock held.
    // Restarting the discovery socket periodically while stuck searching is
    // the standard workaround; it doesn't fix every device, hence also the
    // manual-IP fallback above.
    private fun armDiscoveryWatchdog() {
        cancelDiscoveryWatchdog()
        val runnable = Runnable {
            restartDiscovery()
            // Keeps retrying every DISCOVERY_WATCHDOG_MS for as long as the
            // searching screen stays up — hideSearching() is what stops it.
            armDiscoveryWatchdog()
        }
        discoveryWatchdog = runnable
        mainHandler.postDelayed(runnable, DISCOVERY_WATCHDOG_MS)
    }

    private fun cancelDiscoveryWatchdog() {
        discoveryWatchdog?.let { mainHandler.removeCallbacks(it) }
        discoveryWatchdog = null
    }

    private fun scheduleRediscovery() {
        cancelRetry()
        val runnable = Runnable {
            currentTarget = null
            restartDiscovery()
        }
        retryRunnable = runnable
        mainHandler.postDelayed(runnable, 3000)
    }

    private fun cancelRetry() {
        retryRunnable?.let { mainHandler.removeCallbacks(it) }
        retryRunnable = null
    }

    // Exposed to the web app as window.BoarderoniAndroid (see setUpWebView).
    // Methods run on the WebView's own JS thread, not the UI thread — the
    // FLAG_KEEP_SCREEN_ON toggle has to hop back to it via runOnUiThread.
    private inner class WebAppBridge {
        @JavascriptInterface
        fun setKeepScreenOn(enabled: Boolean) {
            runOnUiThread {
                if (enabled) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }

        // Replaces the old always-on-screen "change server" button — now
        // reachable from the web app's own 5-finger device settings modal
        // instead (see DeviceSettingsModal.tsx, gated on isBoarderoniAndroidApp()).
        // Same effect as before: drop back to the searching screen so a
        // wrong manual IP/port (or just wanting a different desktop) has
        // somewhere to go, regardless of whether the current page "loaded
        // successfully."
        @JavascriptInterface
        fun changeServer() {
            runOnUiThread {
                currentTarget = null
                showSearching()
                restartDiscovery()
            }
        }
    }
}
