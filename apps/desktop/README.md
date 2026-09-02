# Lode desktop shell

The desktop application is an Electron 41 and React DOM shell packaged by Electron Forge. Electron's main process is the desktop host: it selects a Home, probes its authenticated daemon endpoint, owns a daemon utility process only when no live authority exists, and creates the native window. The preload exposes a small product-shaped bridge through `contextBridge`; it does not expose general IPC. The sandboxed renderer contains only React UI and bridge types, with `nodeIntegration` disabled and no access to Node, SQLite, daemon code, or Engine implementation packages.

Product operations stay on the existing boundary. The host connects through `@lode/desktop-client` and the SDK/RPC contract. The packaged `@lode/daemon` entry remains the only desktop composition root for `@lode/engine-platform-desktop`, `@lode/engine`, SQLite, and Peer Transport. This lets the CLI and GUI reuse one authenticated authority and one persistence format for the same Home instead of embedding a second Engine in the GUI.

## Reproducible Windows build

The validated build environment is 64-bit Windows 10 or Windows 11 with the repository's Node range (`>=22 <27`), npm, and the standard Windows `tar` executable available on `PATH`. Start from the repository root with `npm ci`; the lockfile fixes Electron, Forge, esbuild, and the native dependency versions. Forge normally uses a published `better-sqlite3` binary for the fixed Electron ABI. If it must compile the addon, install Visual Studio 2022 Build Tools through the normal Visual Studio Installer with the **Desktop development with C++** workload and a Windows 10 or 11 SDK, which is the standard `node-gyp` discovery path. A missing npm CLI or `tar` executable produces a named build error rather than selecting a private toolchain.

Build and verify the packaged application from the repository root:

```sh
npm run build:desktop
npm run verify:desktop
```

`build:desktop` builds the required workspace packages, bundles the main, preload, renderer, and daemon entries without development sourcemaps, invokes Forge, and prints the absolute artifact path. On the validated x64 host the runnable directory is `apps/desktop/out/Lode-win32-x64`; an arm64 Windows host selects the matching architecture. `verify:desktop` launches `Lode.exe` itself, not a development server, and exercises initialization, persistence, cold start, daemon reuse, stale endpoint recovery, startup failure, and owned-process cleanup in a generated temporary Home. Build output is ignored and can be regenerated from the checkout.

The build derives every input and output from the checkout, the current architecture, `PATH`, and package metadata. npm keeps its normal user cache, Electron uses its normal shared artifact cache, and native rebuild tooling uses its standard download/header caches. The repository does not contain a copied Node, Rust, SDK, compiler, private cache, user Home, signing key, certificate, or absolute machine path. The first build can require network access for the locked npm packages, fixed Electron runtime, and a native prebuild or headers; subsequent builds can reuse those standard caches.

## Packaging and platform scope

The daemon bundle keeps `better-sqlite3` external so Forge can rebuild it for Electron's Node ABI. Forge's native-unpack plugin places `better_sqlite3.node` under `app.asar.unpacked`, while the compiled daemon, host, preload, static HTML, CSS, and renderer JavaScript stay in `app.asar`. The staging package contains only those compiled entries and their runtime native dependency, and packaging filters dependency test fixtures. The verification command checks both the ASAR inventory and the production dependency tree so mobile packages, React Native, Android resources, tests, sourcemaps, user data, secrets, and signing material cannot silently enter the artifact.

This target delivers a portable runnable Windows directory for development and validation, not a signed installer. Production signing, installer branding, auto-update, and notarization are outside its scope. macOS and Linux can follow the same Electron/Forge source architecture, but their native rebuilds and packaged applications require platform-specific execution before they become supported artifacts. Electron contributes a substantial runtime—roughly hundreds of megabytes in the unpacked directory—but it reuses the project's TypeScript, React, and Node daemon today and avoids a second UI or persistence stack.

The GUI/SDK seam also remains valid if the Engine implementation later moves to Rust. Such a change replaces or wraps the daemon-side host behind the same authenticated application contract; it does not require replacing React, the preload capability model, the renderer, or the desktop client's typed RPC boundary.
