import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { api } from "@electron-forge/core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appRoot, "..", "..");
const stage = join(appRoot, "build", "package-stage");
const output = join(appRoot, "out");
const architecture = process.arch === "arm64" ? "arm64" : "x64";
const require = createRequire(import.meta.url);

if (process.platform !== "win32") {
  throw new Error("build:desktop currently produces and verifies its required artifact on Windows only");
}

await removeGenerated(stage);
await removeGenerated(output);
await mkdir(stage, { recursive: true });
await cp(join(appRoot, "dist"), join(stage, "dist"), { recursive: true });
await cp(join(appRoot, "forge.config.cjs"), join(stage, "forge.config.cjs"));
await writeFile(
  join(stage, "package.json"),
  `${JSON.stringify(
    {
      name: "lode-desktop",
      productName: "Lode",
      version: "0.1.0",
      description: "The packaged Lode desktop shell",
      author: "Lode contributors",
      type: "module",
      main: "./dist/main.js",
      dependencies: { "better-sqlite3": "12.11.1" },
      devDependencies: { electron: "41.10.7" },
      config: { forge: "./forge.config.cjs" },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await run(process.execPath, [
  npmCliPath(),
  "install",
  "--prefix",
  stage,
  "--no-audit",
  "--no-fund",
  "--ignore-scripts",
  "--package-lock=false",
]);

installWindowsArchiveExtractor();
await api.package({ arch: architecture, dir: stage, interactive: false, platform: "win32" });

const artifact = join(output, `Lode-win32-${architecture}`);
await mkdir(output, { recursive: true });
await rename(join(stage, "out", `Lode-win32-${architecture}`), artifact);
await removeGenerated(stage);
console.log(`Desktop artifact: ${resolve(artifact)}`);

async function removeGenerated(path) {
  assertGeneratedPath(path);
  await rm(path, { force: true, recursive: true });
}

function assertGeneratedPath(path) {
  if (!isAbsolute(path)) {
    throw new Error(`Generated desktop path must be absolute: ${path}`);
  }
  const local = relative(appRoot, path);
  if (local.startsWith("..") || local === "" || isAbsolute(local)) {
    throw new Error(`Refusing to remove a path outside the desktop package: ${path}`);
  }
}

function npmCliPath() {
  const path = process.env.npm_execpath;
  if (path === undefined) {
    throw new Error("The desktop package step must run through npm so its current CLI can be reused");
  }
  return path;
}

function installWindowsArchiveExtractor() {
  const packagerEntry = require.resolve("@electron/packager");
  const unzipModule = require(join(dirname(packagerEntry), "unzip.js"));
  if (typeof unzipModule.extractElectronZip !== "function") {
    throw new Error("The pinned Electron Packager archive seam is unavailable");
  }
  unzipModule.extractElectronZip = async (zipPath, targetDirectory) => {
    await run("tar", ["-xf", zipPath, "-C", targetDirectory], { cwd: repositoryRoot });
  };
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.environment ?? process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) => {
      reject(new Error(`Cannot start ${command} from PATH: ${error.message}`, { cause: error }));
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${String(code)}`));
      }
    });
  });
}
