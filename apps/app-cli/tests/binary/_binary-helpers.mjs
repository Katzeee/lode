// Shared harness for the binary tests. Spawns the real `lode` dist binary (a `daemon run` / `relay run`
// process) + runs CLI commands against it, captures stdout for assertions, and prints it in verbose
// mode. Phase 3: identity is the daemon-side vault, so each machine has its own LODE_HOME (vault +
// client-id + active-actor); `actorNew` initializes the vault + mints an identity (feeding the
// passphrase on stdin), and `runLode` drives header-authed commands via that home.
//
// Verbosity: `--quiet` (CI / `npm run test:binary`) captures stdout but suppresses printing; without
// it (direct `node …mjs`) the runner prints each command + its output like a demo.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../../../..", import.meta.url));
const cliBin = "apps/app-cli/dist/bin/lode.js";

/** Verbose unless `--quiet` is on the argv (the CI invocation passes it). */
export const verbose = !process.argv.includes("--quiet");

/** Spawn a `lode daemon run` / `lode relay run` process with its own LODE_HOME; resolve once it prints
 *  its `listening on: <url>` line. Returns the home too (vault/active-actor live there). */
function spawnLifecycle(group, action, serverArgs, homeArg) {
  const home = homeArg ?? mkdtempSync(join(tmpdir(), "lode-bin-"));
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliBin, group, action, ...serverArgs], {
      cwd: rootDir,
      env: { ...process.env, LODE_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let url;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`lode ${group} ${action} (${serverArgs.join(" ")}) didn't report its address in time`));
    }, 15000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (verbose) {
        process.stdout.write(`[${group} ${action}] ${text}`);
      }
      const match = /listening on: (\S+)/.exec(text);
      if (match) {
        url = match[1];
      }
    });
    child.stderr.on("data", (chunk) => {
      if (verbose) {
        process.stderr.write(`[${group} ${action}] ${chunk}`);
      }
    });
    child.on("exit", (code, signal) => {
      if (!url) {
        clearTimeout(timer);
        reject(new Error(`lode ${group} ${action} exited (code ${code}, signal ${signal}) before reporting`));
      }
    });
    const poll = setInterval(() => {
      if (url) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve({ child, url, home });
      }
    }, 25);
  });
}

/** Spawn a relay-only `lode relay run --port 0` → `{ child, url, home }`. */
export const spawnRelay = () => spawnLifecycle("relay", "run", ["--port", "0"]);

/** Spawn an engine `lode daemon run --listen tcp://… --data-root <dataRoot>` → `{ child, url, home }`.
 *  `homeArg` reuses an existing LODE_HOME (so a restart keeps the same vault + active-actor). */
export const spawnDaemon = (dataRoot, homeArg) =>
  spawnLifecycle("daemon", "run", ["--listen", "tcp://127.0.0.1:0", "--data-root", dataRoot], homeArg);

/** Initialize the vault (if needed) + mint an identity in `home`, feeding the passphrase twice on stdin.
 *  Returns the new actor id (and writes it to home/active-actor). */
export async function actorNew(home, passphrase, label = "default") {
  const out = await runLode(home, ["actor", "new", "--label", label], `${passphrase}\n${passphrase}\n`);
  return parseActorId(out);
}

/** Run a `lode` command against the daemon at `home` (header auth via home/client-id + active-actor).
 *  `stdin` (optional) is written to the child's stdin before closing. Resolves to trimmed stdout. */
export function runLode(home, commandArgs, stdin) {
  if (verbose) {
    console.log(`> lode ${commandArgs.join(" ")}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliBin, ...commandArgs], {
      cwd: rootDir,
      env: { ...process.env, LODE_HOME: home, FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (verbose && stdout.trim()) {
        console.log(stdout.trimEnd());
      }
      if (verbose && stderr.trim()) {
        console.error(stderr.trimEnd());
      }
      if (verbose) {
        console.log("");
      }
      if (code === 0) {
        resolve(stdout.trimEnd());
      } else {
        reject(new Error(`lode ${commandArgs.join(" ")} exited with code ${code}\n${stderr}`));
      }
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

/** Wait `ms` milliseconds (let an async sync round finish before reading). */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── output parsers ──────────────────────────────────────────────────────────────

export function parseActorId(out) {
  const m = /Created identity (?<id>\S+)/.exec(out);
  if (!m?.groups) {
    throw new Error(`parseActorId failed: ${out}`);
  }
  return m.groups.id;
}

export function parseMnemonic(out) {
  const m = /^Recovery mnemonic .*:$\n(?<words>.+)$/m.exec(out);
  if (!m?.groups) {
    throw new Error(`parseMnemonic failed: ${out}`);
  }
  return m.groups.words.trim();
}

export function parseWorkspaceCreated(out) {
  const m = /^Created workspace .* \((?<ws>.+)\)\.$/m.exec(out);
  if (!m?.groups) {
    throw new Error(`parseWorkspaceCreated failed: ${out}`);
  }
  return m.groups.ws;
}

export function parseNodeCreated(out) {
  const m = /^Created node (?<nodeId>\S+) at occurrence (?<occurrenceId>\S+)/.exec(out);
  if (!m?.groups) {
    throw new Error(`parseNodeCreated failed: ${out}`);
  }
  return { nodeId: m.groups.nodeId, occurrenceId: m.groups.occurrenceId };
}

export function parseSchemaCreated(out) {
  const m =
    /^Created schema ".+" as node (?<nodeId>\S+) \(occurrence (?<occurrenceId>\S+)\)\./.exec(out);
  if (!m?.groups) {
    throw new Error(`parseSchemaCreated failed: ${out}`);
  }
  return { nodeId: m.groups.nodeId, occurrenceId: m.groups.occurrenceId };
}

export function parseFieldDefCreated(out) {
  const m = /^Created field definition .+ as node (?<nodeId>\S+)\.$/.exec(out);
  if (!m?.groups) {
    throw new Error(`parseFieldDefCreated failed: ${out}`);
  }
  return { nodeId: m.groups.nodeId };
}

export function parseFieldAdded(out) {
  const m = /^field add status=(created|reused)\n(?<occurrenceId>\S+) {2}field/m.exec(out);
  if (!m?.groups) {
    throw new Error(`parseFieldAdded failed: ${out}`);
  }
  return { occurrenceId: m.groups.occurrenceId };
}

/** The root occurrence id from a `node list` output. Line 1 is "root"; line 2 begins with
 *  "<rootOcc>  <name>". Empty ("No root yet.") → undefined. */
export function parseRootOcc(out) {
  return out.split("\n").at(1)?.split(/\s+/).at(0);
}

export function assertContains(out, expected, label) {
  if (!out.includes(expected)) {
    throw new Error(`Expected ${label} output to contain ${JSON.stringify(expected)}.\nGot:\n${out}`);
  }
}

/** Kill one or more spawned children (best-effort; ignores already-exited). */
export function killAll(...children) {
  for (const child of children) {
    if (child && child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill();
    }
  }
}
