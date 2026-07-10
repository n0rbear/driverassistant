import java.net.URL
import java.net.URLEncoder
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlin.concurrent.thread

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "com.example.driverassistant"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.example.driverassistant"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        val mistralApiKey = System.getenv("MISTRAL_API_KEY") ?: ""
        buildConfigField("String", "MISTRAL_API_KEY", "\"${mistralApiKey.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.hilt.navigation.compose)

    // Retrofit & OkHttp
    implementation(libs.retrofit.core)
    implementation(libs.retrofit.gson)
    implementation(libs.okhttp.logging)

    // Coil for images
    implementation("io.coil-kt:coil-compose:2.6.0")

    // ML Kit OCR
    implementation(libs.mlkit.text.recognition)
    implementation(libs.play.services.location)
    implementation(libs.kotlinx.coroutines.play.services)

    // Room
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)

    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}

// Telegram Build Notification Bot
gradle.buildFinished {
    val token = System.getenv("TELEGRAM_BOT_TOKEN") ?: return@buildFinished
    val chatId = System.getenv("TELEGRAM_CHAT_ID") ?: return@buildFinished
    val success = failure == null
    val status = if (success) "✅ SIKERES" else "❌ SIKERTELEN"
    val projectName = rootProject.name
    val timeStr = LocalDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"))
    
    val message = "🚀 *$projectName Build Result* ($timeStr)\nStatus: $status" + 
                  (failure?.let { "\nError: ${it.message?.take(300)}" } ?: "")

    try {
        val encodedText = URLEncoder.encode(message, "UTF-8")
        val urlString = "https://api.telegram.org/bot$token/sendMessage?chat_id=$chatId&text=$encodedText&parse_mode=Markdown"
        thread {
            try {
                URL(urlString).readText()
            } catch (e: Exception) {}
        }
    } catch (e: Exception) {}
}
