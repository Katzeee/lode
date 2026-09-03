# Lode mobile shell

The Android application is a Capacitor shell around the shared `@lode/ui` web surface. The application page and its dedicated Web Worker are separate bundles: the page owns rendering and the Capacitor bridge, while the Worker composes the shared `@lode/engine` through `@lode/engine-platform-mobile`. The UI cannot import the Engine directly.

The Worker sends the existing mobile persistence operations to the page with structured messages. The page forwards each operation to the local `LodeDatabase` Capacitor plugin, whose Kotlin implementation stores identity and normalized Workspace document data in Android SQLite. SQLite remains the sole authority; the web surface does not use IndexedDB.

The product, Design system, and Legal routes render from `@lode/ui`, so Desktop and Android use the same components, catalog, attribution, and HarmonyOS Sans asset. The mobile viewport applies the shared touch target and safe-area behavior. The unmodified font and its official license enter the APK from `packages/design-tokens/assets` during the web build.

Build and synchronize the web bundles without invoking Gradle from `apps/mobile`:

```sh
npm run sync:android
```

Build the installable debug APK from the workspace root:

```sh
npm run build:mobile:android
```

The build script discovers the Android SDK and JDK from the explicit Android environment variables, Android's `local.properties`, `PATH`, Android Studio, or conventional platform locations. It builds the required workspaces, synchronizes Capacitor, and writes `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Passing `--install` installs that APK on the connected device. Debug builds use `com.lode.mobile.debug`, while release builds use `com.lode.mobile`.

Passing `--configuration=Release` produces a release build. A signed release reads its keystore path, alias, store password, and key password from `LODE_ANDROID_KEYSTORE`, `LODE_ANDROID_KEY_ALIAS`, `LODE_ANDROID_STORE_PASSWORD`, and `LODE_ANDROID_KEY_PASSWORD`. Without those variables, Gradle produces an unsigned release artifact.
