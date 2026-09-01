import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const androidRoot = join(repositoryRoot, "apps", "mobile", "android");
const isWindows = process.platform === "win32";

const options = parseOptions(process.argv.slice(2));
const releaseSigningConfigured = hasReleaseSigningConfiguration();
if (options.configuration === "Release" && options.install && !releaseSigningConfigured) {
  fail(
    "Installing a Release APK requires LODE_ANDROID_KEYSTORE, LODE_ANDROID_KEY_ALIAS, LODE_ANDROID_STORE_PASSWORD, and LODE_ANDROID_KEY_PASSWORD. Use the default Debug build for local installation.",
  );
}
const androidSdk = findAndroidSdk();
const javaHome = findJavaHome();
const javaExecutable = join(javaHome, "bin", isWindows ? "java.exe" : "java");

requireDirectory(join(repositoryRoot, "node_modules"), "Workspace dependencies");

const environment = {
  ...process.env,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
};
if (javaHome !== undefined) {
  environment.JAVA_HOME = javaHome;
}

const variant = options.configuration.toLowerCase();
const gradleTask = `:app:assemble${options.configuration}`;
const gradleWrapper = join(androidRoot, "gradle", "wrapper", "gradle-wrapper.jar");
requireFile(gradleWrapper, "The Gradle Wrapper JAR is missing");
run(
  javaExecutable,
  ["-classpath", gradleWrapper, "org.gradle.wrapper.GradleWrapperMain", gradleTask, "--no-daemon", "--console=plain"],
  {
    cwd: androidRoot,
    env: environment,
  },
);

const apk = join(
  androidRoot,
  "app",
  "build",
  "outputs",
  "apk",
  variant,
  options.configuration === "Release" && !releaseSigningConfigured ? "app-release-unsigned.apk" : `app-${variant}.apk`,
);
requireFile(apk, "Gradle completed without producing the expected APK");

if (options.install) {
  const sdkAdb = join(androidSdk, "platform-tools", isWindows ? "adb.exe" : "adb");
  const adb = existsSync(sdkAdb) ? sdkAdb : findOnPath("adb");
  if (adb === undefined) {
    fail("adb is unavailable. Install Android SDK Platform-Tools or add adb to PATH.");
  }
  run(adb, ["install", "-r", apk], { env: environment });
}

process.stdout.write(`${apk}\n`);

function parseOptions(arguments_) {
  let configuration = "Debug";
  let install = false;

  for (const argument of arguments_) {
    if (argument === "--install") {
      install = true;
      continue;
    }

    if (argument.startsWith("--configuration=")) {
      const requested = argument.slice("--configuration=".length).toLowerCase();
      if (requested !== "debug" && requested !== "release") {
        fail("--configuration must be Debug or Release.");
      }
      configuration = requested === "debug" ? "Debug" : "Release";
      continue;
    }

    fail(`Unknown build option: ${argument}`);
  }

  return { configuration, install };
}

function hasReleaseSigningConfiguration() {
  const names = [
    "LODE_ANDROID_KEYSTORE",
    "LODE_ANDROID_KEY_ALIAS",
    "LODE_ANDROID_STORE_PASSWORD",
    "LODE_ANDROID_KEY_PASSWORD",
  ];
  const configured = names.filter((name) => (process.env[name]?.length ?? 0) > 0);
  if (configured.length > 0 && configured.length < names.length) {
    fail(`Release signing is incomplete. Configure all of ${names.join(", ")}.`);
  }
  return configured.length === names.length;
}

function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    readAndroidSdkFromLocalProperties(),
    ...standardAndroidSdkLocations(),
  ];
  const sdk = firstDirectory(candidates);
  if (sdk === undefined) {
    fail(
      "Android SDK was not found. Set ANDROID_SDK_ROOT or ANDROID_HOME, or install the SDK in the platform's standard Android Studio location.",
    );
  }
  return sdk;
}

function readAndroidSdkFromLocalProperties() {
  const localProperties = join(androidRoot, "local.properties");
  if (!existsSync(localProperties)) {
    return undefined;
  }

  const match = readFileSync(localProperties, "utf8").match(/^sdk\.dir=(.*)$/m);
  if (match === null) {
    return undefined;
  }

  return match[1]
    .trim()
    .replaceAll("\\\\", "\\")
    .replace(/\\([:= ])/g, "$1");
}

function standardAndroidSdkLocations() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (process.platform === "win32") {
    return [joinIfDefined(process.env.LOCALAPPDATA, "Android", "Sdk")];
  }
  if (process.platform === "darwin") {
    return [joinIfDefined(home, "Library", "Android", "sdk")];
  }
  return [joinIfDefined(home, "Android", "Sdk")];
}

function findJavaHome() {
  const configured = firstJavaHome([process.env.JAVA_HOME]);
  if (configured !== undefined) {
    return configured;
  }

  const pathJava = findOnPath("java");
  if (pathJava !== undefined) {
    const inferred = readJavaHome(pathJava) ?? inferJavaHome(pathJava);
    if (inferred !== undefined) {
      return inferred;
    }
    return undefined;
  }

  const discovered = firstJavaHome(standardAndroidStudioJavaHomes());
  if (discovered !== undefined) {
    return discovered;
  }

  fail("A JDK was not found. Put java on PATH, set JAVA_HOME, or install Android Studio with its bundled JDK.");
}

function standardAndroidStudioJavaHomes() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (process.platform === "win32") {
    return [
      joinIfDefined(process.env.ProgramFiles, "Android", "Android Studio", "jbr"),
      joinIfDefined(process.env.LOCALAPPDATA, "Programs", "Android Studio", "jbr"),
    ];
  }
  if (process.platform === "darwin") {
    return ["/Applications/Android Studio.app/Contents/jbr/Contents/Home"];
  }
  return [joinIfDefined(home, "android-studio", "jbr"), "/opt/android-studio/jbr"];
}

function inferJavaHome(javaExecutable) {
  let executable = javaExecutable;
  try {
    executable = realpathSync(javaExecutable);
  } catch {
    // The PATH entry remains useful when the platform does not expose a real path.
  }

  const candidate = dirname(dirname(executable));
  return isJavaHome(candidate) ? candidate : undefined;
}

function readJavaHome(javaExecutable) {
  const result = spawnSync(javaExecutable, ["-XshowSettings:properties", "-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return undefined;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/^\s*java\.home\s*=\s*(.+)$/m);
  if (match === null) {
    return undefined;
  }

  const candidate = match[1].trim();
  return isJavaHome(candidate) ? resolve(candidate) : undefined;
}

function firstJavaHome(candidates) {
  for (const candidate of candidates) {
    if (candidate !== undefined && isJavaHome(candidate)) {
      return resolve(candidate);
    }
  }
  return undefined;
}

function isJavaHome(candidate) {
  return existsSync(join(candidate, "bin", isWindows ? "java.exe" : "java"));
}

function findOnPath(command) {
  const locator = isWindows ? "where.exe" : "which";
  const result = spawnSync(locator, [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return undefined;
  }

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function firstDirectory(candidates) {
  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(candidate)) {
      return resolve(candidate);
    }
  }
  return undefined;
}

function joinIfDefined(base, ...segments) {
  return base === undefined ? undefined : join(base, ...segments);
}

function requireDirectory(path, label) {
  if (!existsSync(path)) {
    fail(`${label} are missing at ${path}. Run npm install at the repository root.`);
  }
}

function requireFile(path, message) {
  if (!existsSync(path)) {
    fail(`${message}: ${path}`);
  }
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    ...options,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error !== undefined) {
    fail(`Unable to start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
