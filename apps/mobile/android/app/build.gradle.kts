import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing. Credentials come from android/key.properties (git-ignored:
// storeFile, storePassword, keyAlias, keyPassword) or, for CI, from the
// environment variables MASARI_KEYSTORE_FILE, MASARI_KEYSTORE_PASSWORD,
// MASARI_KEY_ALIAS and MASARI_KEY_PASSWORD. The file wins over the environment.
// See docs/mobile/ANDROID_RELEASE.md.
val keyProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.isFile) file.inputStream().use { load(it) }
}

fun signingValue(propertyName: String, envName: String): String? =
    (keyProperties.getProperty(propertyName) ?: System.getenv(envName))?.takeIf { it.isNotBlank() }

val releaseStoreFile = signingValue("storeFile", "MASARI_KEYSTORE_FILE")
val releaseStorePassword = signingValue("storePassword", "MASARI_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "MASARI_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "MASARI_KEY_PASSWORD")
val hasReleaseSigning = listOf(
    releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword,
).all { it != null }

// CI-only escape hatch: `-PallowDebugSigning=true` signs the release build with
// the debug key so CI can build and scan an APK without secrets. Never
// distribute such an APK.
val allowDebugSigning =
    (project.findProperty("allowDebugSigning") ?: System.getenv("MASARI_ALLOW_DEBUG_SIGNING"))?.toString() == "true"

android {
    namespace = "ps.masari.mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "ps.masari.mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                // Absolute path, or relative to android/ (then to android/app).
                val candidate = rootProject.file(releaseStoreFile!!)
                storeFile = if (candidate.isFile) candidate else file(releaseStoreFile)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            signingConfig = when {
                hasReleaseSigning -> signingConfigs.getByName("release")
                allowDebugSigning -> signingConfigs.getByName("debug")
                else -> null
            }
            // Minification/shrinking is intentionally left off: it has not been
            // verified against the plugin set (see docs/mobile/ANDROID_RELEASE.md).
        }
    }
}

// Fail packaging of a release build that would otherwise be unsigned.
gradle.taskGraph.whenReady {
    val releasePackaging = allTasks.any {
        it.project == project && Regex("^(assemble|bundle|package)Release$").matches(it.name)
    }
    if (releasePackaging && !hasReleaseSigning && !allowDebugSigning) {
        throw GradleException(
            "Release signing is not configured. Provide android/key.properties " +
                "(storeFile, storePassword, keyAlias, keyPassword) or the environment variables " +
                "MASARI_KEYSTORE_FILE, MASARI_KEYSTORE_PASSWORD, MASARI_KEY_ALIAS, " +
                "MASARI_KEY_PASSWORD. For a non-distributable CI build only, pass " +
                "-PallowDebugSigning=true. See docs/mobile/ANDROID_RELEASE.md.",
        )
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
