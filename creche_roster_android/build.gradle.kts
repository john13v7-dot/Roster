// Top-level build file. Module build.gradle.kts files apply these without
// repeating the version (":engine" is a plain Kotlin/JVM module and pins its
// own Kotlin plugin version directly, since it is also built standalone).
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
