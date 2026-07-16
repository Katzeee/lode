import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// B-c: `lode actor pin` requires the vault UNLOCKED. When the vault is locked it must NOT error
// directly — it joins the same "VaultLocked → prompt unlock → retry" flow the domain commands use, so a
// locked vault can be re-unlocked inline and the PIN still gets set. Drives the real `lode` dist binary
// end-to-end (the daemon's vault state persists across the invocations that share one LODE_HOME).
const LODE_BIN = fileURLToPath(new URL("../../dist/bin/lode.js", import.meta.url));
const PASS = "vault-test-passphrase"; // >= MIN_PASSPHRASE_LEN (12)
const PIN = "1234"; // == MIN_PIN_LEN (4)

type RunResult = { stdout: string; stderr: string; code: number };

function runLode(
  home: string,
  args: string[],
  stdin: string,
  timeoutMs = 15_000,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [LODE_BIN, ...args], {
      env: { ...process.env, LODE_HOME: home, FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

const freshHome = () => mkdtemp(join(tmpdir(), "lode-pin-"));

describe("lode actor pin — lazy unlock when the vault is locked", () => {
  let home: string;
  beforeEach(async () => {
    home = await freshHome();
  });
  afterEach(async () => {
    await runLode(home, ["daemon", "stop"], "").catch(() => {});
    await rm(home, { recursive: true, force: true });
  });

  it("prompts to unlock then sets the PIN (does not error directly when locked)", async () => {
    // 1. Create the vault + an identity (the vault is UNLOCKED afterward).
    const created = await runLode(
      home,
      ["actor", "new", "--label", "default"],
      `${PASS}\n${PASS}\n`,
    );
    expect(created.code, created.stderr).toBe(0);

    // 2. Lock the vault. (No PIN is set yet, so the unlock path will ask for the passphrase.)
    const locked = await runLode(home, ["lock"], "");
    expect(locked.code, locked.stderr).toBe(0);

    // 3. `actor pin` on the locked vault: choose + confirm the PIN, then (setPin throws VaultLocked)
    //    the unlock prompt fires for the passphrase, the vault unlocks, and setPin retries. Succeeds
    //    overall — without the lazy-unlock this would exit non-zero with a "vault locked" error.
    const res = await runLode(home, ["actor", "pin"], `${PIN}\n${PIN}\n${PASS}\n`);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain("PIN set.");
  });
}, 60_000);
