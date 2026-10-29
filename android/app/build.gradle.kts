import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Push notifications switch on only when the (git-ignored) Firebase config is present
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Release signing secrets live in the git-ignored local.properties
val localProps = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}

android {
    namespace = "com.pavavak.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pavavak.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 27
        versionName = "1.8.1"
        buildConfigField("String", "API_BASE_URL", "\"https://187-127-190-15.sslip.io\"")
    }

    // Two distribution tracks from one codebase:
    //  • sideload — hosted on our own site: keeps the decoy launcher icons and the in-app
    //    APK self-updater (REQUEST_INSTALL_PACKAGES + the download foreground service).
    //  • play     — Google Play: honest PaVa Vak identity only, no decoy aliases, no self-updater
    //    (updates come through Play). The forbidden pieces live in src/sideload/ and never
    //    compile into the play build.
    flavorDimensions += "distribution"
    productFlavors {
        create("play") {
            dimension = "distribution"
            manifestPlaceholders["appLabel"] = "PaVa Vak"
            manifestPlaceholders["appIcon"] = "@mipmap/ic_launcher"
            manifestPlaceholders["appRoundIcon"] = "@mipmap/ic_launcher"
            buildConfigField("boolean", "SIDELOAD", "false")
        }
        create("sideload") {
            dimension = "distribution"
            isDefault = true
            manifestPlaceholders["appLabel"] = "PA Weather"
            manifestPlaceholders["appIcon"] = "@mipmap/ic_launcher_neutral"
            manifestPlaceholders["appRoundIcon"] = "@mipmap/ic_launcher_neutral"
            buildConfigField("boolean", "SIDELOAD", "true")
        }
    }

    signingConfigs {
        create("release") {
            val store = localProps.getProperty("pava.release.storeFile")
            if (store != null) {
                storeFile = file(store)
                storePassword = localProps.getProperty("pava.release.password")
                keyAlias = "pavavak"
                keyPassword = localProps.getProperty("pava.release.password")
            }
        }
    }

    buildTypes {
        debug {
            // Local dev backend as seen from the Android emulator
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3201\"")
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
            // Real phones only — drops the emulator-only x86/x86_64 WebRTC native libs (~half the size).
            // Debug keeps all ABIs so it still runs on the x86_64 emulator.
            ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    lint {
        // Don't let release lint-vital abort our CLI builds; we gate quality elsewhere.
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.biometric)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.socket.io.client) {
        exclude(group = "org.json", module = "json")
    }
    implementation(libs.stream.webrtc)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    debugImplementation(libs.androidx.ui.tooling)
}
