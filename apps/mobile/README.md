# Lode mobile shell

The Android shell runs React Native for native UI and hosts the shared `@lode/engine` inside an invisible WebView. The host composes it through `@lode/engine-platform-mobile` and persists identity and normalized Workspace document data through the Android SQLite bridge. SQLite is the sole authority; the WebView does not use IndexedDB.

Run the repository build command from the workspace root:

```sh
npm run build:mobile:android
```

The cross-platform Node build script discovers the Android SDK and JDK from explicit environment variables, `PATH`, Android Studio's local configuration, or each operating system's conventional install locations. It leaves Gradle on its normal global cache, builds the WebView Engine Host, and produces the installable debug APK at `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Run `npm run build:mobile:android -- --install` to install it on the currently connected Android device. Debug builds use the `com.lode.mobile.debug` application ID, so developers can use their normal shared debug keystore without replacing an installed release build.

Use `--configuration=Release` for a release build. A signed release reads its keystore path, alias, store password, and key password from `LODE_ANDROID_KEYSTORE`, `LODE_ANDROID_KEY_ALIAS`, `LODE_ANDROID_STORE_PASSWORD`, and `LODE_ANDROID_KEY_PASSWORD`; no signing material or machine path is stored in the repository. Without those variables, the result is an unsigned release artifact and cannot be installed.
