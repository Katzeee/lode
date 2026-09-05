import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { _electron } from "playwright-core";
import { probeDaemon } from "@lode/desktop-client";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const architecture = process.arch === "arm64" ? "arm64" : "x64";
const artifact = join(repositoryRoot, "apps", "desktop", "out", `Lode-win32-${architecture}`);
const executable = join(artifact, "Lode.exe");
const verificationImage = join(repositoryRoot, "apps", "desktop", "build", "desktop-verification.png");
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const openApplications = new Set();

if (process.platform !== "win32") {
  throw new Error("verify:desktop currently validates the required packaged artifact on Windows only");
}

await verifyArtifact();
verifyProductionTree();

const temporaryRoot = await mkdtemp(join(tmpdir(), "lode-desktop-verify-"));
const home = join(temporaryRoot, "home");
let runNumber = 0;

try {
  const initialized = await launchPackaged(home);
  await initialized.page.getByRole("heading", { name: "Welcome to Lode" }).waitFor();
  await initialized.page.getByLabel("Your name", { exact: true }).fill("Desktop verification");
  await initialized.page.getByLabel("Passphrase", { exact: true }).fill("desktop-verification-passphrase");
  await initialized.page.getByRole("button", { name: "Create identity", exact: true }).click();
  await initialized.page.getByTestId("recovery-phrase").waitFor();
  await initialized.page.getByRole("button", { name: "I saved my recovery phrase" }).click();
  await initialized.page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await initialized.page.getByRole("heading", { name: "My workspace", exact: true }).waitFor();
  await initialized.page.getByRole("button", { name: "Create node", exact: true }).click();
  await initialized.page.locator('[data-ui="outline-row-text"]').first().click();
  await initialized.page.locator('[data-ui="outline-editor"]').pressSequentially("Desktop persistent note");
  await initialized.page.getByRole("heading", { name: "My workspace", exact: true }).click();
  await initialized.page.getByText("Saved locally", { exact: true }).waitFor();
  await mkdir(dirname(verificationImage), { recursive: true });
  await initialized.page.screenshot({ path: verificationImage });
  const firstShutdown = await closePackaged(initialized);
  assert.equal(firstShutdown.shutdown?.ownedExited, false);
  assert.ok(processExists(firstShutdown.shutdown.ownedPid), "Closing GUI must leave the shared daemon running");
  const shared = await launchPackaged(home);
  await shared.page.getByText("Desktop persistent note", { exact: true }).waitFor();
  const guest = await launchPackaged(home);
  await guest.page.getByText("Desktop persistent note", { exact: true }).waitFor();
  const guestReport = await closePackaged(guest);
  assert.equal(guestReport.shutdown?.ownedPid, null);
  await closePackaged(shared);
  await stopAuthority();
  await assertPersistence(home);
  const cold = await launchPackaged(home);
  await cold.page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
  await cold.page.getByLabel("Passphrase", { exact: true }).fill("desktop-verification-passphrase");
  await cold.page.getByRole("button", { name: "Unlock", exact: true }).click();
  await cold.page.getByText("Desktop persistent note", { exact: true }).waitFor();
  await closePackaged(cold);
  await stopAuthority();
  await writeFile(join(home, "endpoint"), "tcp://127.0.0.1:1\n", "utf8");
  const stale = await launchPackaged(home);
  await stale.page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
  await closePackaged(stale);
  await stopAuthority();
  const corruptLock = join(home, "daemon.lock");
  await mkdir(corruptLock);
  await writeFile(join(corruptLock, "owner"), "corrupt ownership marker\n", "utf8");
  const failed = await launchPackaged(home);
  await failed.page.getByRole("alert").waitFor();
  await closePackaged(failed);
  assert.equal(await readFile(join(corruptLock, "owner"), "utf8"), "corrupt ownership marker\n");
  process.stdout.write(
    `Desktop verification passed for ${artifact}: shared application, persistent daemon, cold restart and startup failures.\n`,
  );
} finally {
  for (const application of [...openApplications]) {
    await application.close().catch(() => undefined);
  }
  await stopAuthority(false).catch(() => undefined);
  await removeVerificationRoot(temporaryRoot);
}

async function stopAuthority(waitForCleanup = true) {
  const connection = await probeDaemon({ name: "verification", path: home });
  if (connection) {
    try {
      await connection.client.shutdown();
    } finally {
      connection.client.close();
    }
  }
  if (waitForCleanup) {
    await assertAuthorityFilesAbsent(home);
  }
}

async function verifyArtifact() {
  for (const required of [
    executable,
    join(artifact, "resources.pak"),
    join(artifact, "icudtl.dat"),
    join(artifact, "locales"),
    join(artifact, "resources", "app.asar"),
    join(
      artifact,
      "resources",
      "app.asar.unpacked",
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node",
    ),
  ]) {
    await access(required);
  }
  const packagePath = join(artifact, "resources", "app.asar");
  const entries = asar.listPackage(packagePath).map((entry) => entry.replaceAll("\\", "/").toLowerCase());
  for (const required of [
    "/dist/main.js",
    "/dist/daemon.js",
    "/dist/preload.cjs",
    "/dist/renderer.js",
    "/dist/renderer.css",
    "/dist/index.html",
    "/dist/assets/fonts/harmonyos_sans_sc.ttf",
    "/dist/assets/legal/harmonyos sans/license-update.txt",
    "/package.json",
  ]) {
    assert.ok(entries.includes(required), `Packaged app is missing ${required}`);
  }
  const forbidden = entries.filter((entry) =>
    /(?:^|\/)(?:android|mobile|fixtures?|tests?)(?:\/|$)|\.map$|(?:^|\/)(?:data|token|endpoint|daemon\.lock)(?:\/|$)|\.(?:cer|key|pem|pfx|sig)$/u.test(
      entry,
    ),
  );
  assert.deepEqual(forbidden, [], `Forbidden development, mobile, user, or signing files are packaged: ${forbidden}`);
  const sourceFont = await readFile(
    join(repositoryRoot, "packages", "design-tokens", "assets", "fonts", "HarmonyOS_Sans_SC.ttf"),
  );
  const packagedFont = asar.extractFile(packagePath, join("dist", "assets", "fonts", "HarmonyOS_Sans_SC.ttf"));
  assert.equal(sha256(packagedFont), sha256(sourceFont), "Packaged HarmonyOS Sans must remain byte-identical");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function verifyProductionTree() {
  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined) {
    throw new Error("verify:desktop must run through npm so it can inspect the current workspace dependency tree");
  }
  const result = spawnSync(
    process.execPath,
    [npmCli, "ls", "--omit=dev", "--workspace=@lode/app-desktop", "--all", "--json"],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`Desktop production dependency tree is invalid:\n${result.stdout}${result.stderr}`);
  }
  const tree = JSON.parse(result.stdout);
  const dependencies = dependencyNames(tree);
  for (const required of ["@lode/daemon", "@lode/desktop-client", "@lode/engine-platform-desktop", "electron"]) {
    assert.ok(dependencies.has(required), `Desktop production tree is missing ${required}`);
  }
  for (const forbidden of ["@lode/engine-platform-mobile", "@lode/app-mobile", "react-native"]) {
    assert.equal(dependencies.has(forbidden), false, `Desktop production tree contains ${forbidden}`);
  }
}

function dependencyNames(node, names = new Set()) {
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    names.add(name);
    dependencyNames(dependency, names);
  }
  return names;
}

async function launchPackaged(homePath) {
  runNumber += 1;
  const reportPath = join(temporaryRoot, `report-${runNumber}.json`);
  const application = await _electron.launch({
    executablePath: executable,
    args: [
      `--lode-home-path=${homePath}`,
      "--lode-home-name=verification",
      `--lode-verification-report=${reportPath}`,
      `--user-data-dir=${join(temporaryRoot, `user-data-${runNumber}`)}`,
    ],
    cwd: repositoryRoot,
    env: { ...process.env, LODE_CONFIG_DIR: join(temporaryRoot, "config") },
  });
  const output = [];
  application.process().stdout?.on("data", (chunk) => output.push(chunk.toString()));
  application.process().stderr?.on("data", (chunk) => output.push(chunk.toString()));
  openApplications.add(application);
  const page = await application.firstWindow({ timeout: 30_000 });
  return { application, output, page, reportPath };
}

async function closePackaged(run) {
  const child = run.application.process();
  const closed = new Promise((resolve) => child.once("exit", resolve));
  void run.application.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await closed;
  openApplications.delete(run.application);
  try {
    return await poll(
      async () => {
        const report = await jsonOrNull(run.reportPath);
        return report?.shutdown === null || report === null ? null : report;
      },
      `shutdown report ${basename(run.reportPath)}`,
    );
  } catch (error) {
    throw new Error(`${error.message}\nPackaged desktop output:\n${run.output.join("")}`, { cause: error });
  }
}

async function assertAuthorityFilesAbsent(homePath) {
  for (const name of ["endpoint", "sync-endpoint", "daemon.lock"]) {
    await poll(async () => ((await exists(join(homePath, name))) ? null : true), `${name} cleanup`);
  }
}

async function assertPersistence(homePath) {
  const token = (await readFile(join(homePath, "token"), "utf8")).trim();
  assert.match(token, /^[0-9a-f]{64}$/u);
  const files = await collectFiles(join(homePath, "data"));
  assert.ok(files.length > 0, "The persisted Home data directory must contain Engine state");
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function jsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function poll(operation, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await operation();
    if (result !== null && result !== false) {
      return result;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function assertMissing(path) {
  assert.equal(await exists(path), false, `${path} must not exist`);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, "ESRCH")) {
      return false;
    }
    if (hasCode(error, "EPERM")) {
      return true;
    }
    throw error;
  }
}

function hasCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function removeVerificationRoot(path) {
  assert.ok(isAbsolute(path), "Desktop verification root must be absolute");
  const local = relative(tmpdir(), path);
  assert.ok(!local.startsWith("..") && !isAbsolute(local) && basename(path).startsWith("lode-desktop-verify-"));
  await rm(path, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
}
