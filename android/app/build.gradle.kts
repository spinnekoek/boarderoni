plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.boarderoni.mobile"
    // Matches the SDK installed on the build machine:
    // platforms android-34/35, build-tools 34.0.0.
    compileSdk = 34

    defaultConfig {
        applicationId = "com.boarderoni.mobile"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "0.1.0-alpha.2"
    }

    // CI provides these via ANDROID_KEYSTORE_PATH (a decoded file, see
    // release.yml) + the password/alias secrets; unset locally, so
    // assembleRelease only produces a signed APK in CI.
    val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
    if (keystorePath != null) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        // Separate package id so a debug build (signed with the build
        // machine's debug key) installs side by side with the release-signed
        // app instead of Android refusing it as a signature conflict. Its
        // launcher label comes from src/debug/res.
        debug {
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = false
            if (keystorePath != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    // Off by default since AGP 8 — needed for BuildConfig.DEBUG, which
    // MainActivity uses to gate WebView remote-debugging (debug builds only).
    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")
}
