// Shared harness for the binary tests (two-fresh-machines.mjs + anime-notes.mjs). Spawns the real
// `app-server` + `lode` dist binaries, captures stdout for assertions, and prints it in verbose mode.
//
// Verbosity: `--quiet` (CI / `npm run test:binary`) captures stdout but suppresses printing; without
// it (direct `node …mjs`) the runner prints each command + its output like a demo. Tests always
// assert against captured stdout regardless of mode.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../../../..", import.meta.url));
const daemonBin = "packages/ipc/daemon/dist/bin/app-server.js";
const cliBin = "apps/app-cli/dist/bin/lode.js";

/** Verbose unless `--quiet` is on the argv (the CI invocation passes it). */
export const verbose = !process.argv.includes("--quiet");

/** Spawn an `app-server` process; resolve once it prints its `listening on: <url>` line. */
function spawnServer(serverArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [daemonBin, ...serverArgs], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let url;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`app-server (${serverArgs.join(" ")}) didn't report its address in time`));
    }, 15000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (verbose) {
        process.stdout.write(`[app-server ${serverArgs.includes("--relay") ? "relay" : "daemon"}] ${text}`);
      }
      const match = /listening on: (\S+)/.exec(text);
      if (match) {
        url = match[1];
      }
    });
    child.stderr.on("data", (chunk) => {
      if (verbose) {
        process.stderr.write(`[app-server] ${chunk}`);
      }
    });
    child.on("exit", (code, signal) => {
      if (!url) {
        clearTimeout(timer);
        reject(new Error(`app-server exited (code ${code}, signal ${signal}) before reporting`));
      }
    });
    const poll = setInterval(() => {
      if (url) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve({ child, url });
      }
    }, 25);
  });
}

/** Spawn a relay-only `app-server --relay 0` → `{ child, url }` (an `http://` URL, plaintext h2c). */
export const spawnRelay = () => spawnServer(["--relay", "0"]);

/** Spawn an engine `app-server --listen … --data-root <dataRoot>` → `{ child, url }` (an `http://` URL). */
export const spawnDaemon = (dataRoot) =>
  spawnServer(["--listen", "tcp://127.0.0.1:0", "--data-root", dataRoot]);

/**
 * Run a `lode` command. `commandArgs` is the group/action + its flags (command-first); the global
 * `--url` and `--actor-mnemonic` are appended. Pass `mnemonic = undefined` for the no-auth `actor new`
 * bootstrap. Always resolves to captured stdout (trimmed); prints command + stdout when verbose.
 */
export function runLode(url, mnemonic, commandArgs) {
  const fullArgs = [
    cliBin,
    ...commandArgs,
    "--url",
    url,
    ...(mnemonic === undefined ? [] : ["--actor-mnemonic", mnemonic]),
  ];
  if (verbose) {
    console.log(`> lode ${commandArgs.join(" ")}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn("node", fullArgs, {
      cwd: rootDir,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
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
  });
}

/** Wait `ms` milliseconds. Used to let an asynchronous sync round (the join's fire-and-forget round,
 *  or a just-triggered `sync now`) finish before the test reads — sync isn't instantaneous, and reading
 *  mid-round hits a child whose content shard hasn't arrived yet. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── output parsers ──────────────────────────────────────────────────────────────

export function parseActorNew(out) {
  const m = /^actor (?<actorId>\S+)\nmnemonic (?<mnemonic>.+)$/m.exec(out);
  if (!m?.groups) {
    throw new Error(`parseActorNew failed: ${out}`);
  }
  return { actorId: m.groups.actorId, mnemonic: m.groups.mnemonic };
}

export function parseSignPub(out) {
  const m = /^signPub (?<signPub>\S+)$/m.exec(out);
  if (!m?.groups) {
    throw new Error(`parseSignPub failed: ${out}`);
  }
  return m.groups.signPub;
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

/**
 * The root occurrence id from a `node list` output. Line 1 is "root"; line 2 begins with
 * "<rootOcc>  <name>". Empty ("No root yet.") → undefined.
 */
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
