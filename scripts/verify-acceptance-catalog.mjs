import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(resolve(root, "acceptance-catalog.json"), "utf8"));
if (catalog.format !== "lode-acceptance-catalog-v1" || !Array.isArray(catalog.capabilities)) {
  throw new Error("Acceptance catalog format is invalid");
}

const workspaceRoots = {
  engine: resolve(root, "packages/engine"),
  daemon: resolve(root, "packages/daemon"),
  cli: resolve(root, "apps/cli"),
};
const vitest = resolve(root, "node_modules/vitest/vitest.mjs");
const collected = new Map();
for (const [workspace, cwd] of Object.entries(workspaceRoots)) {
  const result = spawnSync(process.execPath, [vitest, "list"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (result.status !== 0) {
    throw new Error(`Unable to collect ${workspace} tests:\n${result.stderr || result.stdout}`);
  }
  collected.set(workspace, new Set(result.stdout.split(/\r?\n/u).filter(Boolean)));
}

const ids = new Set();
const referencedTests = new Set();
for (const capability of catalog.capabilities) {
  if (
    typeof capability.id !== "string" ||
    capability.id.length === 0 ||
    ids.has(capability.id) ||
    typeof capability.contract !== "string" ||
    capability.contract.length === 0 ||
    !Array.isArray(capability.tests) ||
    capability.tests.length === 0
  ) {
    throw new Error("Acceptance catalog contains an invalid or duplicate capability");
  }
  ids.add(capability.id);
  for (const reference of capability.tests) {
    const workspaceTests = collected.get(reference.workspace);
    if (!workspaceTests?.has(reference.test)) {
      throw new Error(`Catalog test is not collected: ${reference.workspace}: ${reference.test}`);
    }
    referencedTests.add(`${reference.workspace}: ${reference.test}`);
  }
}

process.stdout.write(
  `Acceptance catalog verified ${ids.size} capabilities against ${referencedTests.size} collected tests.\n`,
);
