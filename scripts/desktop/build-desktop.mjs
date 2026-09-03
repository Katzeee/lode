import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workspaces = [
  "@lode/design-tokens",
  "@lode/design-system-catalog",
  "@lode/ui",
  "@lode/system-schema",
  "@lode/protocol",
  "@lode/sdk",
  "@lode/node-endpoint",
  "@lode/engine",
  "@lode/engine-platform-desktop",
  "@lode/desktop-client",
  "@lode/daemon",
  "@lode/app-desktop",
];

for (const workspace of workspaces) {
  await runNpm(["run", "build", `--workspace=${workspace}`]);
}
await runNpm(["run", "package", "--workspace=@lode/app-desktop"]);

function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined) {
    throw new Error("build:desktop must run through npm so its current CLI can be reused");
  }
  const command = process.execPath;
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, [npmCli, ...args], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`npm ${args.join(" ")} exited with code ${String(code)}`));
      }
    });
  });
}
