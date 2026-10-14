plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "tv.svoya"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    defaultConfig { applicationId = "tv.svoya"; minSdk = 23; targetSdk = 35; versionCode = 1; versionName = "1.0.0" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("io.socket:socket.io-client:2.1.1") { exclude(group="org.json", module="json") }
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("com.google.zxing:core:3.5.3")
}
