plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.shwan.mazerunner"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.shwan.mazerunner"
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // Release signing is wired to a keystore via gradle properties so secrets
    // never live in source control. See README "Signing & release".
    val keystorePath = (project.findProperty("MAZE_KEYSTORE") as String?)
    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = project.findProperty("MAZE_KEYSTORE_PASSWORD") as String?
                keyAlias = project.findProperty("MAZE_KEY_ALIAS") as String?
                keyPassword = project.findProperty("MAZE_KEY_PASSWORD") as String?
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (keystorePath != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
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

    // JVM unit tests for the pure game logic (Maze, pathfinding, GameWorld).
    testImplementation("junit:junit:4.13.2")
}
