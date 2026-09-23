package com.boarderoni.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
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
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
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

// TEMP DEBUG LOGGING — added 2026-09-10 to track down the tablet randomly
// dropping to the "looking for boarderoni" spinner and reconnecting with no
// user action. Every plausible trigger (NSD service lost, Wi-Fi network
// callback, WebView main-frame error, Activity onStop/onStart) is tagged
// below via dlog() (see its definition) so `adb logcat -s BoarderoniDebug:D`
// pinpoints which one actually fires. Remove this constant, KEY_DEBUG_LOGGING_
// ENABLED, dlog(), WebAppBridge.setDebugLogging, and every dlog() call site
// once diagnosed.
private const val DEBUG_TAG = "BoarderoniDebug"

// Prefs for remembering the manual-connect field across launches — most
// devices that need the manual fallback (see connectManually) need it every
// time (the OEM Wi-Fi stacks that drop mDNS don't start working later), so
// retyping the same IP each launch is pure friction.
private const val PREFS_NAME = "boarderoni"
private const val KEY_LAST_MANUAL_INPUT = "last_manual_input"

// "host:port" of the last server this app successfully connected to (set on
// every real webView.onPageFinished, regardless of how the connection was
// made — the found/connect screen, manual entry, or a previous remembered
// reconnect). A fresh launch with this set skips discovery/the found/connect
// screen entirely and goes straight for it (see attemptRememberedConnect) —
// only falling back to showing the found/connect screen if that direct
// attempt actually fails. Cleared by changeServer() (the 5-finger modal's
// "Change server"), which is the explicit "I want to pick a different one"
// escape hatch.
private const val KEY_LAST_CONNECTED_TARGET = "last_connected_target"

// TEMP DEBUG LOGGING — persisted (not just in-memory) so a toggle survives
// app restarts: the whole point is enabling this once, then letting the
// tablet roam untethered until the bug reproduces, then pulling `adb logcat
// -d` (dumps the existing on-device ring buffer, no live tail needed)
// whenever it's next convenient to plug in.
private const val KEY_DEBUG_LOGGING_ENABLED = "debug_logging_enabled"

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var statusText: TextView
    private lateinit var statusOverlay: View
    private lateinit var manualIpInput: EditText
    private lateinit var manualConnectButton: Button

    // Three mutually exclusive sub-states of one shared card inside
    // statusOverlay — see activity_main.xml's own comment. searchingGroup is
    // up by default; showSearching()/showConnecting()/showFoundPrompt()
    // toggle between the three.
    private lateinit var searchingGroup: View
    private lateinit var connectingGroup: View
    private lateinit var connectingText: TextView
    private lateinit var foundGroup: View
    private lateinit var foundText: TextView
    private lateinit var foundDesktopVersion: TextView
    private lateinit var foundConnectButton: Button
    private lateinit var foundKeepSearchingButton: Button
    private lateinit var appVersionLabel: TextView

    private lateinit var nsdManager: NsdManager
    private lateinit var connectivityManager: ConnectivityManager
    private var multicastLock: WifiManager.MulticastLock? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var discoveryActive = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private var retryRunnable: Runnable? = null
    private var discoveryWatchdog: Runnable? = null

    // Backs resolveManualWebPort/probeAndShowFoundPrompt's network probes — a
    // fixed cap (rather than each spawning its own bare Thread) since the
    // discovery watchdog restarting every DISCOVERY_WATCHDOG_MS could
    // otherwise queue up an unbounded number of live threads over a long
    // unattended session. Two is enough for both call sites to run
    // concurrently without ever actually queueing in practice.
    private val networkExecutor: ExecutorService = Executors.newFixedThreadPool(2)

    // "host:port" of whatever's currently loaded, so a redundant onServiceFound
    // for the same instance doesn't reload a perfectly fine WebView.
    private var currentTarget: String? = null

    // A resolved-but-not-yet-confirmed discovery — set when onServiceResolved
    // finds something new, cleared once the user taps Connect (which promotes
    // it into currentTarget) or Keep searching. Kept separate from
    // currentTarget so a periodic mDNS re-announcement of the SAME pending
    // target while the prompt is still up doesn't re-show/reset it.
    private var pendingHost: String? = null
    private var pendingPort: Int = 0
    private val pendingTarget: String?
        get() = pendingHost?.let { "$it:$pendingPort" }

    // True from a remembered-target reconnect attempt (attemptRememberedConnect)
    // until it either succeeds (onPageFinished) or fails (onReceivedError) —
    // suppresses the found/connect screen the whole time, since the point is
    // to reconnect silently. Once it flips false (a real failure, not just
    // never having been true), discovery results go through the normal
    // found/connect screen from then on for the rest of this Activity's life.
    private var awaitingRememberedConnect = false

    // Guards attemptRememberedConnect so it only ever fires once per Activity
    // instance — onStart can run again later (app backgrounded/foregrounded)
    // without re-triggering a silent reconnect attempt that would re-suppress
    // an already-showing found/connect screen.
    private var hasAttemptedRememberedConnect = false

    // TEMP DEBUG LOGGING — gates every dlog() call below. Off by default;
    // toggled from the web app's 5-finger device settings modal (see
    // WebAppBridge.setDebugLogging), loaded from prefs at the very top of
    // onCreate so it's already correct before the first dlog() call fires.
    private var debugLoggingEnabled = false

    // Must be registered unconditionally before STARTED (a property
    // initializer runs during construction, ahead of onCreate) — the
    // Activity Result API throws if you try to register once the activity
    // is already started.
    private val nearbyWifiPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startDiscovery()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Belt-and-suspenders alongside Theme.Boarderoni (which has no
        // values-night variant): this stops the system dark theme from
        // touching this activity even if the theme lookup ever changes.
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
        super.onCreate(savedInstanceState)
        // TEMP DEBUG LOGGING — loaded before anything else so it's correct
        // for the dlog() call on the very next line.
        debugLoggingEnabled = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_DEBUG_LOGGING_ENABLED, false)
        dlog("onCreate: savedInstanceState=${savedInstanceState != null}")

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
        searchingGroup = findViewById(R.id.searching_group)
        connectingGroup = findViewById(R.id.connecting_group)
        connectingText = findViewById(R.id.connecting_text)
        foundGroup = findViewById(R.id.found_group)
        foundText = findViewById(R.id.found_text)
        foundDesktopVersion = findViewById(R.id.found_desktop_version)
        foundConnectButton = findViewById(R.id.found_connect_button)
        foundKeepSearchingButton = findViewById(R.id.found_keep_searching_button)
        appVersionLabel = findViewById(R.id.app_version_label)
        appVersionLabel.text = getString(R.string.status_app_version, BuildConfig.VERSION_NAME)

        nsdManager = getSystemService(Context.NSD_SERVICE) as NsdManager
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        configureWebView(webView)
        setUpManualConnect()
        setUpFoundPrompt()

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

    // TEMP DEBUG LOGGING — the manifest's android:configChanges list already
    // covers every config change we've confirmed via logcat before (see its
    // comment), but if some *other* config change still isn't listed there,
    // the system skips this callback entirely and destroys/recreates the
    // Activity instead — which would show up as onStop() immediately
    // followed by onCreate()+onStart() rather than this line. So: this line
    // appearing means a covered config change happened (harmless, no
    // reconnect); onStop() -> onCreate() with no onConfigurationChanged in
    // between means an uncovered one slipped through and IS the bug.
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        dlog("onConfigurationChanged: $newConfig")
    }

    // TEMP DEBUG LOGGING — every call site below funnels through here so
    // the debugLoggingEnabled toggle actually gates something; remove
    // alongside every dlog() call once diagnosed.
    private fun dlog(msg: String) {
        if (debugLoggingEnabled) Log.d(DEBUG_TAG, msg)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        dlog("onWindowFocusChanged: hasFocus=$hasFocus")
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

    // Parameterized on `view` rather than the fixed webView field so
    // recreateWebView() can run the exact same setup on a freshly created
    // replacement after onRenderProcessGone — a crashed WebView's render
    // process is gone for good, so recovery means building a new instance,
    // not reconfiguring the dead one.
    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(view: WebView) {
        // WebView paints white by default until the page's own CSS has
        // something to show — visible as a bright flash on every load/
        // reload (a new deck, a reconnect, `changeServer()`) even with the
        // status overlay covering everything else. Matches
        // DEFAULT_DASHBOARD.backgroundColor (shared/types.ts) and
        // status_overlay_background (colors.xml) so there's no seam between
        // this, the overlay, and whatever the loaded dashboard itself paints.
        view.setBackgroundColor(Color.parseColor("#14161B"))

        val settings = view.settings
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
        view.addJavascriptInterface(WebAppBridge(), "BoarderoniAndroid")

        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                dlog("webView.onPageFinished: url=$url")
                hideSearching()
                // A real successful load — remember it (whatever got us here:
                // the found/connect screen, manual entry, or a remembered
                // reconnect) so the next launch can skip straight to it. Past
                // this point we're no longer "awaiting" anything.
                awaitingRememberedConnect = false
                currentTarget?.let { target ->
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                        .putString(KEY_LAST_CONNECTED_TARGET, target)
                        .apply()
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                // TEMP DEBUG LOGGING — every main-frame WebView load error
                // (including a request?.isForMainFrame == false one, logged
                // here too so we can see it was correctly ignored).
                dlog(
                    "webView.onReceivedError: isForMainFrame=${request?.isForMainFrame} " +
                        "url=${request?.url} errorCode=${error?.errorCode} description=${error?.description}"
                )
                if (request?.isForMainFrame == true) {
                    currentTarget = null
                    // A failed remembered-reconnect is exactly what should
                    // fall back to the found/connect screen from here on.
                    awaitingRememberedConnect = false
                    showSearching(message = getString(R.string.status_lost_connection))
                    scheduleRediscovery()
                }
            }

            // addJavascriptInterface's BoarderoniAndroid bridge is exposed to
            // whatever origin currently occupies the top frame, not scoped to
            // the desktop we actually meant to connect to — with cleartext
            // traffic required app-wide (see the manifest's own comment: no
            // fixed hostname a network-security-config domain rule could
            // pin to, since the desktop's IP is only known via runtime mDNS),
            // a LAN actor able to inject a redirect/navigation could
            // otherwise steer the WebView to a page that inherits the bridge.
            // Only ever reached for page-driven navigation (link, JS, or
            // redirect) — our own loadUrl() calls in loadMobileLink() don't
            // go through this callback at all, so the app's own legitimate
            // loads are never affected.
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                if (request.isForMainFrame && !isAllowedNavigationTarget(url)) {
                    dlog("webView.shouldOverrideUrlLoading: blocked url=$url currentTarget=$currentTarget")
                    return true
                }
                return false
            }

            // Required as of targetSdk O (see this method's own Android
            // docs) — without it, a WebView renderer crash (or the system
            // reclaiming a backgrounded one under memory pressure) takes the
            // whole app down with no recovery, which matters more here than
            // for a typical app since this is meant to run unattended on a
            // mounted cockpit tablet with nobody there to relaunch it.
            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                dlog(
                    "webView.onRenderProcessGone: didCrash=${detail?.didCrash()} " +
                        "rendererPriorityAtExit=${detail?.rendererPriorityAtExit()}"
                )
                // Already tearing down for an unrelated reason — nothing to
                // recover into, and touching views mid-teardown would be
                // unsafe. Returning true either way avoids the crash the
                // system falls back to if this callback returns false.
                if (!isFinishing && !isDestroyed) recreateWebView()
                return true
            }
        }
    }

    override fun onStart() {
        super.onStart()
        dlog("onStart")
        acquireMulticastLock()
        registerNetworkCallback()
        ensureNearbyWifiPermissionThenDiscover()
        if (!hasAttemptedRememberedConnect) {
            hasAttemptedRememberedConnect = true
            attemptRememberedConnect()
        }
    }

    // Skips the found/connect screen entirely on a launch that already knows
    // where to go — straight to whatever we last successfully connected to.
    // No-op (falls through to the normal discovery + found/connect screen
    // flow already underway from ensureNearbyWifiPermissionThenDiscover
    // above) if nothing's remembered.
    private fun attemptRememberedConnect() {
        val remembered = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_LAST_CONNECTED_TARGET, null) ?: return
        val (host, port) = splitHostPort(remembered) ?: return
        dlog("attemptRememberedConnect: target=$remembered")
        awaitingRememberedConnect = true
        currentTarget = remembered
        // "Connecting…", not the default "Looking for Boarderoni" onCreate
        // already put up — this already knows exactly where it's going, so
        // the wait (however brief) should say that rather than implying a
        // discovery scan is what's actually happening.
        showConnecting(host, port)
        loadMobileLink(host, port)
    }

    // Splits an internally-constructed "host:port" string — always produced
    // by this app itself as "$host:$port" (currentTarget, KEY_LAST_CONNECTED_
    // TARGET), never user-typed (see parseManualTarget for that) — back into
    // its parts. Only needs to survive a missing/corrupt pref value, not
    // arbitrary input.
    private fun splitHostPort(value: String): Pair<String, Int>? {
        val colonIndex = value.lastIndexOf(':')
        if (colonIndex < 0) return null
        val port = value.substring(colonIndex + 1).toIntOrNull() ?: return null
        val host = value.substring(0, colonIndex)
        if (host.isEmpty()) return null
        return host to port
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
        dlog("onStop")
        cancelRetry()
        cancelDiscoveryWatchdog()
        stopDiscovery()
        unregisterNetworkCallback()
        releaseMulticastLock()
    }

    override fun onDestroy() {
        dlog("onDestroy")
        networkExecutor.shutdownNow()
        destroyWebView(webView)
        super.onDestroy()
    }

    // A WebView holds a reference back to this Activity (via its Context) for
    // as long as it's alive — addJavascriptInterface's WebAppBridge makes
    // that worse, since it's an inner class carrying its own implicit outer-
    // Activity reference too. Neither is cleaned up automatically just
    // because the Activity is finishing, so an un-destroyed WebView is a
    // guaranteed per-instance Activity leak. destroy() itself needs the
    // WebView detached from its parent first and no further callbacks able
    // to fire into now-gone views — same ordering Google's own WebView
    // cleanup guidance recommends.
    private fun destroyWebView(view: WebView) {
        (view.parent as? ViewGroup)?.removeView(view)
        view.stopLoading()
        view.webViewClient = object : WebViewClient() {}
        view.webChromeClient = null
        view.removeJavascriptInterface("BoarderoniAndroid")
        view.loadUrl("about:blank")
        view.destroy()
    }

    // Called from onRenderProcessGone: the crashed WebView's underlying
    // render process is gone for good, so recovery means swapping in a
    // brand new instance, not reusing the dead one. Deliberately does NOT
    // call the old view's destroy() — per Android's own onRenderProcessGone
    // guidance, that's for the still-alive teardown path (destroyWebView(),
    // used from onDestroy()); the crashed instance is just detached and
    // dropped so it can be garbage collected.
    private fun recreateWebView() {
        dlog("recreateWebView")
        val target = currentTarget
        val old = webView
        val parent = old.parent as? ViewGroup
        val index = parent?.indexOfChild(old) ?: -1
        val layoutParams = old.layoutParams
        parent?.removeView(old)

        val fresh = WebView(this)
        configureWebView(fresh)
        if (parent != null) {
            if (index >= 0) parent.addView(fresh, index, layoutParams) else parent.addView(fresh, layoutParams)
        }
        webView = fresh

        // Reconnect to whatever was loaded before the crash, same as a fresh
        // launch's attemptRememberedConnect — falling back to plain discovery
        // if nothing was actually connected yet (e.g. it crashed while still
        // on the searching/found screen).
        val hostPort = target?.let { splitHostPort(it) }
        if (hostPort != null) {
            val (host, port) = hostPort
            showConnecting(host, port)
            loadMobileLink(host, port)
        } else {
            currentTarget = null
            showSearching()
            restartDiscovery()
        }
    }

    // Guards shouldOverrideUrlLoading: only the desktop this WebView actually
    // connected to (currentTarget, set immediately before every loadMobileLink
    // call) may navigate the top frame — see shouldOverrideUrlLoading's own
    // comment for why. currentTarget being unset (nothing connected yet)
    // means there's nothing legitimate for the page to navigate to, so that
    // correctly denies by default rather than allowing.
    private fun isAllowedNavigationTarget(url: Uri): Boolean {
        val target = currentTarget ?: return false
        val (allowedHost, allowedPort) = splitHostPort(target) ?: return false
        return url.scheme.equals("http", ignoreCase = true) &&
            url.host?.equals(allowedHost, ignoreCase = true) == true &&
            url.port == allowedPort
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
        val parsed = parseManualTarget(input)
        if (parsed == null) {
            manualIpInput.error = getString(R.string.manual_connect_invalid)
            return
        }
        manualIpInput.error = null
        val (host, typedPort) = parsed
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(KEY_LAST_MANUAL_INPUT, input)
            .apply()
        cancelDiscoveryWatchdog()
        cancelRetry()
        if (typedPort != null) {
            currentTarget = "$host:$typedPort"
            showConnecting(host, typedPort)
            loadMobileLink(host, typedPort)
        } else {
            resolveManualWebPort(host)
        }
    }

    // input is whatever the user actually typed/pasted — unlike splitHostPort
    // (which trusts a string this app built itself), this has to survive a
    // pasted browser-bar URL ("http://192.168.1.23:5173/") and reject genuine
    // garbage instead of silently mis-splitting it. Returns (host, port) with
    // port null when none was typed (the "figure it out via resolveManualWebPort"
    // case), or null outright for input that can't be parsed with any
    // confidence — notably an unbracketed IPv6 literal (2+ colons), which
    // this app has never needed LAN support for and won't guess a split for
    // rather than silently loading whatever comes out.
    private fun parseManualTarget(raw: String): Pair<String, Int?>? {
        val input = raw.trim().removePrefix("http://").removePrefix("https://").substringBefore('/')
        if (input.isEmpty()) return null
        return when (input.count { it == ':' }) {
            0 -> input to null
            1 -> {
                val colonIndex = input.indexOf(':')
                val host = input.substring(0, colonIndex)
                val port = input.substring(colonIndex + 1).toIntOrNull()
                if (host.isEmpty() || port == null) null else host to port
            }
            else -> null
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
        networkExecutor.execute {
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
                // The Activity can finish (or already be gone) by the time
                // this probe — run on networkExecutor, with no lifecycle tie-in
                // of its own — actually completes; touching views or prefs
                // past that point would be unsafe/pointless.
                if (isFinishing || isDestroyed) return@post
                currentTarget = "$host:$resolvedPort"
                showConnecting(host, resolvedPort)
                loadMobileLink(host, resolvedPort)
            }
        }
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
                dlog("NetworkCallback.onAvailable: network=$network")
                // Covers switching Wi-Fi networks (different AP, VPN toggle,
                // etc.) — the previously-resolved IP can't be trusted once
                // the network itself has changed, so start over. BUT: per
                // Android's own documented behavior, registering a NEW
                // NetworkCallback fires onAvailable immediately for a
                // network that's already satisfying the request, even
                // though nothing actually changed — and registerNetworkCallback()
                // runs fresh on every onStart(), so this fires on literally
                // every app launch/foreground. Confirmed via logcat
                // (2026-09-10): this was clobbering attemptRememberedConnect's
                // "Connecting…" screen back to plain "Looking for Boarderoni"
                // for the whole page-load wait, every single launch. The
                // same view-state gating onServiceLost uses (mid a connect
                // attempt, or already connected) applies here for the same
                // reason: this callback can't tell "actually changed" apart
                // from "just registered," so state already in progress wins.
                if (connectingGroup.visibility == View.VISIBLE || statusOverlay.visibility != View.VISIBLE) return
                mainHandler.post {
                    currentTarget = null
                    showSearching()
                    restartDiscovery()
                }
            }

            override fun onLost(network: Network) {
                dlog("NetworkCallback.onLost: network=$network")
                mainHandler.post {
                    currentTarget = null
                    showSearching(message = getString(R.string.status_no_wifi))
                }
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                // TEMP DEBUG LOGGING — doesn't change any app state today,
                // logged only to see whether a capability flap (no
                // onAvailable/onLost) lines up with a spinner reappearance.
                dlog("NetworkCallback.onCapabilitiesChanged: network=$network capabilities=$capabilities")
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
        // Set optimistically, before discoverServices() rather than after
        // onDiscoveryStarted confirms it — that callback fires from NsdManager's
        // own thread (not guaranteed main, and sometimes badly delayed on OEM
        // stacks, see armDiscoveryWatchdog's own comment), so leaving the guard
        // false until then let two close-together callers (onStart, the 8s
        // watchdog) both slip past it and register a second listener on top of
        // the first, leaking it for the Activity's lifetime.
        discoveryActive = true
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                dlog("Nsd.onDiscoveryStarted: serviceType=$serviceType")
            }

            override fun onServiceFound(service: NsdServiceInfo) {
                dlog("Nsd.onServiceFound: $service")
                resolveService(service)
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                dlog("Nsd.onServiceLost: $service currentTarget=$currentTarget statusOverlayVisible=${statusOverlay.visibility == View.VISIBLE}")
                // mDNS is a DISCOVERY mechanism, not a liveness monitor for an
                // already-established connection — it has no idea whether the
                // WebView's actual connection is still alive, only whether
                // Android's mDNS bookkeeping heard a recent re-announcement.
                // Once the WebView has a page loaded (status overlay hidden),
                // what actually indicates a real failure is the WebView's own
                // onReceivedError (main-frame) or the web app's own WebSocket
                // reconnect logic (store.ts) — not this. Confirmed via logcat
                // (2026-09-10) that onServiceLost can fire as a purely
                // cosmetic mDNS/multicast re-announcement miss on this OEM's
                // Wi-Fi stack while the connection is otherwise completely
                // fine; reacting to it while already connected is what
                // interrupted an active session for no reason. Same
                // reasoning applies mid a "Connecting…" attempt (connectingGroup
                // visible) — the WebView load already in flight isn't
                // affected by mDNS at all, so bouncing back to the plain
                // searching screen there would be just as spurious. Still
                // relevant while NOT yet connected/connecting (searching or
                // found screen up) — that's the actual discovery phase this
                // exists for.
                if (statusOverlay.visibility != View.VISIBLE || connectingGroup.visibility == View.VISIBLE) return
                currentTarget = null
                showSearching()
            }

            override fun onDiscoveryStopped(serviceType: String) {
                dlog("Nsd.onDiscoveryStopped: serviceType=$serviceType")
                discoveryActive = false
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                dlog("Nsd.onStartDiscoveryFailed: serviceType=$serviceType errorCode=$errorCode")
                discoveryActive = false
                scheduleRediscovery()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                dlog("Nsd.onStopDiscoveryFailed: serviceType=$serviceType errorCode=$errorCode")
                discoveryActive = false
            }
        }
        discoveryListener = listener
        dlog("startDiscovery: calling nsdManager.discoverServices")
        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            // Synchronous failure (e.g. SecurityException) — the async
            // onStartDiscoveryFailed above never fires in this case, so the
            // optimistic flag set above would otherwise strand discoveryActive
            // true forever, permanently blocking every future startDiscovery().
            dlog("startDiscovery: discoverServices threw: $e")
            discoveryActive = false
            discoveryListener = null
        }
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
        dlog("restartDiscovery")
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

    // resolveService/host is deprecated as of API 34 in favor of
    // registerServiceInfoCallback/hostAddresses (also fixes the old API's
    // IPv4-only single-address limitation) — but the new API needs API 34,
    // and minSdk here is 26, so both paths stay: the modern one on 34+, the
    // legacy one (suppressed, not removed) below it.
    private fun resolveService(service: NsdServiceInfo) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            resolveServiceModern(service)
        } else {
            resolveServiceLegacy(service)
        }
    }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun resolveServiceModern(service: NsdServiceInfo) {
        val callback = object : NsdManager.ServiceInfoCallback {
            override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
                dlog("Nsd.onServiceInfoCallbackRegistrationFailed: errorCode=$errorCode")
            }

            override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
                onServiceResolved(serviceInfo.hostAddresses.firstOrNull()?.hostAddress, serviceInfo)
                // One-shot, like the legacy resolveService below — this app
                // only wants a single current address, not to keep tracking
                // updates for the service's whole remaining lifetime, so
                // unregister right after the first callback.
                try {
                    nsdManager.unregisterServiceInfoCallback(this)
                } catch (_: IllegalArgumentException) {
                    // Already unregistered — fine.
                }
            }

            override fun onServiceLost() {
                dlog("Nsd.ServiceInfoCallback.onServiceLost: $service")
            }

            override fun onServiceInfoCallbackUnregistered() {
                dlog("Nsd.onServiceInfoCallbackUnregistered: $service")
            }
        }
        nsdManager.registerServiceInfoCallback(service, ContextCompat.getMainExecutor(this), callback)
    }

    @Suppress("DEPRECATION")
    private fun resolveServiceLegacy(service: NsdServiceInfo) {
        nsdManager.resolveService(service, object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                dlog("Nsd.onResolveFailed: $serviceInfo errorCode=$errorCode")
                // Transient on most OEMs — the next onServiceFound (mDNS
                // re-announces periodically) or the retry timer covers it.
            }

            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                onServiceResolved(serviceInfo.host?.hostAddress, serviceInfo)
            }
        })
    }

    // Shared tail end of both resolution paths above — everything from here
    // down is unchanged from before the API split.
    private fun onServiceResolved(hostAddress: String?, serviceInfo: NsdServiceInfo) {
        val host = hostAddress ?: return
        val webPort = serviceInfo.txtValue("webPort")?.toIntOrNull() ?: serviceInfo.port
        val target = "$host:$webPort"
        dlog(
            "Nsd.onServiceResolved: target=$target currentTarget=$currentTarget " +
                "pendingTarget=$pendingTarget awaitingRememberedConnect=$awaitingRememberedConnect"
        )
        // Already connected (or connecting) to this exact target —
        // nothing to do, same as before.
        if (target == currentTarget) return
        // Still waiting to see whether a silent remembered-reconnect
        // succeeds — don't pop the found/connect screen over that; a
        // real failure (onReceivedError) is what un-suppresses this.
        if (awaitingRememberedConnect) return
        // Already connected to something ELSE and just viewing it —
        // a background mDNS re-announcement shouldn't interrupt an
        // active session with a found/connect prompt.
        if (statusOverlay.visibility != View.VISIBLE) return
        // Already showing the found/connect screen for this exact
        // target — a periodic re-announcement while the user just
        // hasn't tapped Connect yet shouldn't re-show/reset it.
        if (target == pendingTarget) return
        probeAndShowFoundPrompt(host, webPort, target)
    }

    // mDNS only knows a service WAS advertised, not that it's still actually
    // reachable — a dead process that never got to send an mDNS goodbye
    // (force-closed rather than quit cleanly, or this OEM's NSD stack just
    // caching) leaves a stale entry that can keep resolving successfully for
    // a while after the real server is gone. Confirmed via logcat
    // (2026-09-10): closing the desktop app, waiting, and having the found/
    // connect screen still claim to have found it. A quick HTTP probe here
    // — the same /api/apk-info endpoint resolveManualWebPort already uses,
    // chosen there specifically because it "always answers regardless of
    // dev/packaged mode" — is what tells "actually there" apart from "still
    // cached" before claiming to have found something.
    private fun probeAndShowFoundPrompt(host: String, port: Int, target: String) {
        networkExecutor.execute {
            // desktopVersion stays null on anything short of a clean 200 +
            // parseable body — an older desktop build (pre-version-field
            // apk-info) or a body read hiccup just means the found screen
            // shows no desktop version, not a fake reachable=false.
            var reachable = false
            var desktopVersion: String? = null
            try {
                val connection = URL("http://$host:$port/api/apk-info").openConnection() as HttpURLConnection
                connection.connectTimeout = 2000
                connection.readTimeout = 2000
                try {
                    reachable = connection.responseCode in 200..299
                    if (reachable) {
                        val body = connection.inputStream.bufferedReader().readText()
                        desktopVersion = JSONObject(body).optString("version").ifEmpty { null }
                    }
                } finally {
                    connection.disconnect()
                }
            } catch (_: Exception) {
                // reachable/desktopVersion already at their not-found defaults
            }
            mainHandler.post {
                // Same reasoning as resolveManualWebPort's own guard — this
                // probe runs on networkExecutor with no lifecycle tie-in, so
                // the Activity may already be finishing by the time it posts
                // back.
                if (isFinishing || isDestroyed) return@post
                dlog("probeAndShowFoundPrompt: target=$target reachable=$reachable desktopVersion=$desktopVersion")
                if (!reachable) return@post
                // Several seconds may have passed since the probe started —
                // re-check the same dedupe/suppression guards onServiceResolved
                // itself used rather than trusting state from when it kicked
                // off (a real connect could have happened meanwhile, or the
                // user could have moved on).
                if (target == currentTarget || target == pendingTarget) return@post
                if (awaitingRememberedConnect) return@post
                if (statusOverlay.visibility != View.VISIBLE) return@post
                showFoundPrompt(host, port, desktopVersion)
            }
        }
    }

    private fun NsdServiceInfo.txtValue(key: String): String? {
        val entry = attributes.entries.firstOrNull { it.key.equals(key, ignoreCase = true) }
        return entry?.value?.toString(Charsets.UTF_8)
    }

    private fun loadMobileLink(host: String, port: Int) {
        dlog("loadMobileLink: host=$host port=$port")
        webView.loadUrl("http://$host:$port/?mode=view")
    }

    private fun showSearching(message: String? = null) {
        // TEMP DEBUG LOGGING — Log.getStackTraceString so we can see which
        // caller triggered this particular reappearance of the spinner,
        // since several independent code paths call showSearching(). Only
        // worth building the string when logging is actually enabled.
        if (debugLoggingEnabled) {
            dlog(
                "showSearching: message=$message\n" +
                    Log.getStackTraceString(Throwable()).lineSequence().drop(1).take(5).joinToString("\n")
            )
        }
        statusText.text = message ?: getString(R.string.status_searching)
        // Reverts the connecting/found screen back to plain searching, if
        // one was up — e.g. a connect attempt actually failed (see
        // onReceivedError), or the found service got lost again before the
        // user tapped Connect (see onServiceLost's own comment).
        pendingHost = null
        connectingGroup.visibility = View.GONE
        foundGroup.visibility = View.GONE
        searchingGroup.visibility = View.VISIBLE
        statusOverlay.visibility = View.VISIBLE
        armDiscoveryWatchdog()
    }

    private fun hideSearching() {
        dlog("hideSearching")
        statusOverlay.visibility = View.GONE
        cancelDiscoveryWatchdog()
    }

    // Shows "Boarderoni found at host:port" + Connect/Keep searching instead
    // of connecting straight away. Only reachable (see the gating in
    // onServiceResolved above) on a first launch with nothing remembered yet,
    // or after an explicit "Change server" — never while already connected,
    // or mid a silent remembered-reconnect attempt (attemptRememberedConnect).
    private fun showFoundPrompt(host: String, port: Int, desktopVersion: String? = null) {
        dlog("showFoundPrompt: host=$host port=$port desktopVersion=$desktopVersion")
        pendingHost = host
        pendingPort = port
        foundText.text = getString(R.string.status_found_address, host, port)
        if (desktopVersion != null) {
            foundDesktopVersion.text = getString(R.string.status_found_desktop_version, desktopVersion)
            foundDesktopVersion.visibility = View.VISIBLE
        } else {
            foundDesktopVersion.visibility = View.GONE
        }
        connectingGroup.visibility = View.GONE
        searchingGroup.visibility = View.GONE
        foundGroup.visibility = View.VISIBLE
        statusOverlay.visibility = View.VISIBLE
    }

    // Immediate feedback for "I tapped Connect and it's actually doing
    // something" — shown the instant a real, explicit connect attempt (the
    // found screen's Connect button, or manual entry) fires loadMobileLink,
    // not just left sitting on whatever screen was up. Cleared by
    // showSearching() (a real failure — onReceivedError — or the found
    // service vanishing again mid-attempt) or hideSearching() (success).
    // Deliberately NOT used for attemptRememberedConnect's silent reconnect
    // — that one stays on plain searching (or nothing, if it's fast), by
    // design (see its own comment).
    private fun showConnecting(host: String, port: Int) {
        dlog("showConnecting: host=$host port=$port")
        connectingText.text = getString(R.string.status_connecting, host, port)
        searchingGroup.visibility = View.GONE
        foundGroup.visibility = View.GONE
        connectingGroup.visibility = View.VISIBLE
        statusOverlay.visibility = View.VISIBLE
    }

    private fun setUpFoundPrompt() {
        foundConnectButton.setOnClickListener {
            val host = pendingHost ?: return@setOnClickListener
            val port = pendingPort
            pendingHost = null
            currentTarget = "$host:$port"
            showConnecting(host, port)
            loadMobileLink(host, port)
        }
        foundKeepSearchingButton.setOnClickListener {
            pendingHost = null
            foundGroup.visibility = View.GONE
            searchingGroup.visibility = View.VISIBLE
        }
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
            dlog("discoveryWatchdog fired")
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
            dlog("scheduleRediscovery fired")
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
            dlog("WebAppBridge.changeServer called from JS")
            runOnUiThread {
                currentTarget = null
                // The explicit "I want to pick a different one" escape hatch
                // — forget the remembered target so the next discovery
                // result goes through the found/connect screen instead of
                // silently reconnecting right back to the one being left.
                awaitingRememberedConnect = false
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                    .remove(KEY_LAST_CONNECTED_TARGET)
                    .apply()
                showSearching()
                restartDiscovery()
            }
        }

        // Called from ViewCanvas.tsx (androidBridge.ts's connectionLost) once
        // the web app's own WebSocket has stayed disconnected for a while —
        // see its own comment for the exact grace period and reasoning. Same
        // "drop back to searching + restart discovery" effect as
        // changeServer() above, but deliberately does NOT touch
        // KEY_LAST_CONNECTED_TARGET/awaitingRememberedConnect: this is "the
        // session died, let the user see what's happening," not "I want a
        // different desktop" — the remembered server is probably still the
        // right one to reach for once it's back, so the next app launch
        // should still get to skip straight to it.
        @JavascriptInterface
        fun connectionLost() {
            dlog("WebAppBridge.connectionLost called from JS")
            runOnUiThread {
                currentTarget = null
                showSearching()
                restartDiscovery()
            }
        }

        // TEMP DEBUG LOGGING — reachable from the web app's 5-finger device
        // settings modal (see DeviceSettingsModal.tsx), same gating shape as
        // changeServer above. Persists so the tablet can be sent off
        // untethered with logging already on; adb logcat -d later dumps
        // whatever's still in the on-device ring buffer. Remove this method,
        // its DeviceSettingsModal checkbox, and androidBridge.ts's
        // setDebugLogging once diagnosed.
        @JavascriptInterface
        fun setDebugLogging(enabled: Boolean) {
            runOnUiThread {
                debugLoggingEnabled = enabled
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                    .putBoolean(KEY_DEBUG_LOGGING_ENABLED, enabled)
                    .apply()
                dlog("WebAppBridge.setDebugLogging: enabled=$enabled")
            }
        }
    }
}
