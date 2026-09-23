plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.boarderoni.mobile"
    // Matches the SDK actually installed on the build machine:
    // platforms android-34/35, build-tools 34.0.0.
    compileSdk = 34

    defaultConfig {
        applicationId = "com.boarderoni.mobile"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-alpha.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
