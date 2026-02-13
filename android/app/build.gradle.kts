plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
    // OpenAPI codegen disabled — all API calls use manual Retrofit interfaces
    // alias(libs.plugins.openapi.generator)
    // Uncomment when you have a real google-services.json from Firebase Console:
    // alias(libs.plugins.google.services)
    // alias(libs.plugins.firebase.crashlytics)
}

android {
    namespace = "com.polemicyst.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.polemicyst.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "GOOGLE_CLIENT_ID", "\"${project.findProperty("GOOGLE_CLIENT_ID") ?: ""}\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("KEYSTORE_PATH")
                ?: project.findProperty("KEYSTORE_PATH") as String?
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                    ?: project.findProperty("KEYSTORE_PASSWORD") as String?
                keyAlias = System.getenv("KEY_ALIAS")
                    ?: project.findProperty("KEY_ALIAS") as String?
                keyPassword = System.getenv("KEY_PASSWORD")
                    ?: project.findProperty("KEY_PASSWORD") as String?
            }
        }
    }

    flavorDimensions += "environment"

    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField("String", "API_BASE_URL", "\"https://10.0.2.2:3000\"")
        }
        create("prod") {
            dimension = "environment"
            buildConfigField("String", "API_BASE_URL", "\"https://polemicyst.com\"")
        }
    }

    buildTypes {
        debug {
            // No API_BASE_URL here — defined per flavor
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
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
}

// OpenAPI codegen disabled — all API calls use manual Retrofit interfaces
// openApiGenerate {
//     generatorName.set("kotlin")
//     inputSpec.set("${rootProject.projectDir}/../openapi/spec.yaml")
//     outputDir.set("${layout.buildDirectory.get()}/generated/openapi")
//     apiPackage.set("com.polemicyst.android.api.client")
//     modelPackage.set("com.polemicyst.android.api.model")
//     configOptions.set(
//         mapOf(
//             "library" to "jvm-retrofit2",
//             "serializationLibrary" to "moshi",
//             "useCoroutines" to "true",
//             "dateLibrary" to "java8",
//             "enumPropertyNaming" to "UPPERCASE",
//             "sourceFolder" to "src/main/kotlin",
//         )
//     )
// }
//
// kotlin.sourceSets["main"].kotlin.srcDir(
//     "${layout.buildDirectory.get()}/generated/openapi/src/main/kotlin"
// )
//
// tasks.named("preBuild") {
//     dependsOn("openApiGenerate")
// }

dependencies {
    // Core
    implementation(libs.core.ktx)
    implementation(libs.activity.compose)

    // Compose
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.tooling.preview)
    debugImplementation(libs.compose.tooling)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    // Networking
    implementation(libs.retrofit)
    implementation(libs.retrofit.moshi)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.moshi)
    ksp(libs.moshi.codegen)

    // Coroutines
    implementation(libs.coroutines.core)
    implementation(libs.coroutines.android)

    // Lifecycle
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.lifecycle.runtime)

    // Navigation
    implementation(libs.navigation.compose)

    // Image loading
    implementation(libs.coil.compose)

    // Video playback
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)

    // Auth
    implementation(libs.credentials)
    implementation(libs.credentials.play)
    implementation(libs.googleid)
    implementation(libs.security.crypto)

    // Firebase — uncomment when you have a real google-services.json:
    // implementation(platform(libs.firebase.bom))
    // implementation(libs.firebase.crashlytics)
    // implementation(libs.firebase.analytics)

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.arch.core.testing)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test)
    debugImplementation(libs.compose.ui.test.manifest)
}
