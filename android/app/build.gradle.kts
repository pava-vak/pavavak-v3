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
        versionCode = 5
        versionName = "1.3.0"
        buildConfigField("String", "API_BASE_URL", "\"https://187-127-190-15.sslip.io\"")
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
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    debugImplementation(libs.androidx.ui.tooling)
}
