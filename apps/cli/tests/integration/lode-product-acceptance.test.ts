import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { startDaemonProcess } from "./daemon-process-test-helpers.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const lodeBinary = resolve(repositoryRoot, "apps/cli/dist/bin/lode.js");
const accessToken = "product-acceptance-token";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

type Run = Readonly<{ exitCode: number; stdout: string; stderr: string; envelope: Record<string, unknown> | null }>;

/** Spawns the built `lode` binary — product acceptance runs the real process. */
async function lode(argv: readonly string[], configDir: string = productConfigDir): Promise<Run> {
  const child = spawn(process.execPath, [lodeBinary, ...argv], {
    cwd: repositoryRoot,
    env: { ...process.env, LODE_CONFIG_DIR: configDir },
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code ?? 0));
  });
  let envelope: Record<string, unknown> | null;
  try {
    envelope = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    envelope = null;
  }
  return { exitCode, stdout, stderr, envelope };
}

let productConfigDir = "";

/** Creates a registered home (token + data dir) and its lode.toml, and points
 * the product CLI at it. The daemon is NOT started here — the first product
 * command auto-spawns it through the launcher, exercising the real flow. */
async function setupProductHome(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `lode-product-${label}-`));
  temporaryDirectories.push(root);
  const home = join(root, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "token"), `${accessToken}\n`, "utf8");
  const configDir = join(root, "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "lode.toml"),
    `default_home = "main"\n\n[homes.main]\npath = ${tomlPath(home)}\n`,
    "utf8",
  );
  await writeFile(join(root, "passphrase.txt"), "product-acceptance-passphrase\n", "utf8");
  productConfigDir = configDir;
  productRoot = root;
  return root;
}

let productRoot = "";

function passphraseFile(): string {
  return join(productRoot, "passphrase.txt");
}

/** Creates the home's first Actor through the real CLI and leaves the vault
 * unlocked, so governed creation and knowledge writes can proceed. */
async function bootstrapProductActor(label: string, configDir: string = productConfigDir): Promise<string> {
  const run = await lode(
    ["--format", "json", "identity", "create", label, "--passphrase-file", passphraseFile()],
    configDir,
  );
  expect(run.exitCode, run.stdout + run.stderr).toBe(0);
  const actor = record(
    record(record(run.envelope, "Create Actor envelope").data, "Create Actor data").actor,
    "Created Actor",
  );
  return String(actor.actorId);
}

async function lodeIn(configDir: string, argv: readonly string[]): Promise<Record<string, unknown>> {
  const run = await lode(["--format", "json", ...argv], configDir);
  expect(run.exitCode, `${argv.join(" ")}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`).toBe(0);
  expect(run.envelope?.status, argv.join(" ")).toBe("ok");
  return run.envelope as Record<string, unknown>;
}

function tomlPath(path: string): string {
  return `"${path.replace(/\\/gu, "\\\\")}"`;
}

const KNOWLEDGE_FAMILIES = new Set(["node", "supertag", "field", "search", "view", "history", "review", "sync"]);
const VALUE_FLAGS = new Set([
  "--request-id",
  "--format",
  "--limit",
  "--cursor",
  "--perspective",
  "--intent",
  "--workspace",
  "--home",
]);

/** Knowledge commands carry an explicit --workspace; management ones do not. */
function withWorkspace(workspace: string, argv: readonly string[]): readonly string[] {
  if (argv.includes("--workspace")) {
    return argv;
  }
  let index = 0;
  while (index < argv.length && VALUE_FLAGS.has(argv[index] ?? "")) {
    index += 2;
  }
  return KNOWLEDGE_FAMILIES.has(argv[index] ?? "") ? ["--workspace", workspace, ...argv] : argv;
}

/** Runs a product command in JSON mode and asserts it succeeded. */
async function product(workspace: string, argv: readonly string[]): Promise<Record<string, unknown>> {
  const run = await lode(["--format", "json", ...withWorkspace(workspace, argv)]);
  expect(run.exitCode, `${argv.join(" ")}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`).toBe(0);
  expect(run.envelope?.status, argv.join(" ")).toBe("ok");
  return run.envelope as Record<string, unknown>;
}

async function failing(workspace: string, argv: readonly string[], exitCode: number): Promise<Record<string, unknown>> {
  const run = await lode(["--format", "json", ...withWorkspace(workspace, argv)]);
  expect(run.exitCode, `${argv.join(" ")} failed with ${run.exitCode}: ${run.stderr}`).toBe(exitCode);
  expect(run.envelope?.status).toBe("error");
  return run.envelope as Record<string, unknown>;
}

function items(envelope: Record<string, unknown>): readonly Record<string, unknown>[] {
  return (envelope.data as { items?: readonly Record<string, unknown>[] } | null)?.items ?? [];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

describe("Task and Project through the product CLI binary", () => {
  it("builds, searches, presents, reviews, restores, restarts, and syncs the daily modeling loop", async () => {
    const root = await setupProductHome("task");
    let daemonStopped = false;
    const stopDaemon = async () => {
      if (!daemonStopped) {
        daemonStopped = true;
        await product("Task and Project", ["daemon", "stop"]);
      }
    };
    try {
      const noWorkspaceRun = await lode(["--format", "json", "node", "create", "Projects"]);
      expect(noWorkspaceRun.exitCode).toBe(2);
      const noWorkspace = record(JSON.parse(noWorkspaceRun.stdout) as unknown, "No-workspace envelope");
      expect(noWorkspace.status).toBe("error");
      expect((noWorkspace.error as { code: string }).code).toBe("configuration-missing");
      expect((noWorkspace.error as { candidates: unknown[] }).candidates).toEqual([]);
      const ownerActorId = await bootstrapProductActor("Task Owner");
      await product("Task and Project", ["--actor", ownerActorId, "workspace", "create", "Task and Project"]);
      await product("Task and Project", ["node", "create", "Projects"]);

      await product("Task and Project", ["--request-id", "s-task", "supertag", "create", "Task"]);
      await product("Task and Project", ["--request-id", "s-proj", "supertag", "create", "Project"]);
      await product("Task and Project", ["--request-id", "s-urg", "supertag", "create", "Urgent"]);
      await product("Task and Project", ["--request-id", "e1", "supertag", "extend", "Urgent", "--with", "Task"]);

      await product("Task and Project", ["--request-id", "f-status", "field", "create", "Status", "--type", "plain"]);
      await product("Task and Project", ["--request-id", "f-due", "field", "create", "Due date", "--type", "date"]);
      await product("Task and Project", ["--request-id", "f-est", "field", "create", "Estimate", "--type", "number"]);
      await product("Task and Project", ["--request-id", "f-done", "field", "create", "Done", "--type", "checkbox"]);
      await product("Task and Project", [
        "--request-id",
        "f-proj",
        "field",
        "create",
        "Project",
        "--type",
        "options-from-supertag",
        "--options-from",
        "Project",
      ]);

      await product("Task and Project", [
        "--request-id",
        "tf1",
        "supertag",
        "field",
        "add-existing",
        "Task",
        "--field",
        "Status",
      ]);
      await product("Task and Project", [
        "--request-id",
        "d1",
        "supertag",
        "field",
        "set-default",
        "Task",
        "--field",
        "Status",
        "--value",
        "Backlog",
      ]);
      await product("Task and Project", [
        "--request-id",
        "p1",
        "supertag",
        "field",
        "pin",
        "Task",
        "--field",
        "Status",
      ]);
      for (const [id, field] of [
        ["tf2", "Due date"],
        ["tf3", "Estimate"],
        ["tf4", "Done"],
        ["tf5", "Project"],
      ] as const) {
        await product("Task and Project", [
          "--request-id",
          id,
          "supertag",
          "field",
          "add-existing",
          "Task",
          "--field",
          field,
        ]);
      }

      await product("Task and Project", ["--request-id", "n1", "node", "create", "Project A", "--under", "Projects"]);
      await product("Task and Project", ["--request-id", "a1", "supertag", "apply", "Project", "--to", "Project A"]);
      await product("Task and Project", ["--request-id", "n2", "node", "create", "First task", "--under", "Project A"]);
      await product("Task and Project", [
        "--request-id",
        "n3",
        "node",
        "create",
        "Second task",
        "--under",
        "Project A",
      ]);
      for (const task of ["First task", "Second task"]) {
        await product("Task and Project", ["--request-id", `apply-${task}`, "supertag", "apply", "Task", "--to", task]);
      }
      await product("Task and Project", [
        "--request-id",
        "v-status",
        "field",
        "set",
        "Status",
        "--on",
        "First task",
        "--value",
        "Backlog",
      ]);
      await product("Task and Project", [
        "--request-id",
        "v-status-2",
        "field",
        "set",
        "Status",
        "--on",
        "Second task",
        "--value",
        "Done",
      ]);
      await product("Task and Project", [
        "--request-id",
        "v-due",
        "field",
        "set",
        "Due date",
        "--on",
        "First task",
        "--value",
        "2026-09-01",
      ]);
      await product("Task and Project", [
        "--request-id",
        "v-est",
        "field",
        "set",
        "Estimate",
        "--on",
        "First task",
        "--value",
        "3",
      ]);
      await product("Task and Project", [
        "--request-id",
        "v-done",
        "field",
        "set",
        "Done",
        "--on",
        "First task",
        "--value",
        "false",
      ]);
      await product("Task and Project", [
        "--request-id",
        "v-proj",
        "field",
        "set",
        "Project",
        "--on",
        "First task",
        "--value",
        "Project A",
      ]);

      await product("Task and Project", [
        "--request-id",
        "sc1",
        "search",
        "create",
        "Open tasks",
        "--where",
        "tag(Task) and field(Status) = Backlog",
      ]);
      await product("Task and Project", ["--request-id", "vt1", "view", "table", "Open tasks"]);
      await product("Task and Project", [
        "--request-id",
        "vc1",
        "view",
        "column",
        "add",
        "Status",
        "--on",
        "Open tasks",
      ]);
      await product("Task and Project", [
        "--request-id",
        "vc2",
        "view",
        "column",
        "add",
        "Due date",
        "--on",
        "Open tasks",
      ]);
      await product("Task and Project", [
        "--request-id",
        "vs1",
        "view",
        "sort",
        "set",
        "Due date",
        "--on",
        "Open tasks",
        "--direction",
        "ascending",
      ]);

      const results = await product("Task and Project", ["search", "results", "Open tasks"]);
      expect(items(results).map((item) => item.label)).toEqual(["First task"]);
      const rows = await product("Task and Project", ["view", "rows", "Open tasks"]);
      expect(items(rows).map((item) => item.label)).toEqual(["First task"]);

      await product("Task and Project", [
        "--intent",
        "proposal",
        "--request-id",
        "pr1",
        "supertag",
        "apply",
        "Urgent",
        "--to",
        "Second task",
      ]);
      const reviewList = await product("Task and Project", ["review", "list"]);
      const supertagReview = items(reviewList).find((item) => {
        const space = item.diffSpace as { kind?: string } | undefined;
        return space?.kind === "supertag-application";
      });
      expect(supertagReview).toBeDefined();
      await product("Task and Project", ["--request-id", "ra1", "review", "accept", String(supertagReview?.ref)]);
      const urgent = await product("Task and Project", ["supertag", "instances", "Urgent"]);
      expect(items(urgent).map((item) => item.label)).toEqual(["Second task"]);

      const stale = await failing(
        "Task and Project",
        ["--request-id", "ra2", "review", "accept", String(supertagReview?.ref)],
        3,
      );
      expect((stale.error as { code: string }).code).toBe("stale-selection");

      await product("Task and Project", [
        "--request-id",
        "h1",
        "field",
        "set",
        "Status",
        "--on",
        "Second task",
        "--value",
        "Backlog",
      ]);
      const afterFlip = await product("Task and Project", ["search", "results", "Open tasks"]);
      expect(
        items(afterFlip)
          .map((item) => item.label)
          .sort(),
      ).toEqual(["First task", "Second task"]);
      await product("Task and Project", ["history", "undo"]);
      const afterUndo = await product("Task and Project", ["search", "results", "Open tasks"]);
      expect(items(afterUndo).map((item) => item.label)).toEqual(["First task"]);

      await product("Task and Project", ["--request-id", "t1", "node", "trash", "Second task"]);
      await product("Task and Project", ["--request-id", "r1", "node", "restore", "Second task"]);
      const restored = await product("Task and Project", ["node", "show", "Second task"]);
      expect((restored.data as { location: string }).location).toBe("active");

      const badDate = await failing(
        "Task and Project",
        ["--request-id", "bad1", "field", "set", "Due date", "--on", "First task", "--value", "tomorrow"],
        2,
      );
      expect((badDate.error as { code: string }).code).toBe("invalid-value");
      const missingTarget = await failing("Task and Project", ["node", "show", "Ghost"], 2);
      expect((missingTarget.error as { code: string }).code).toBe("target-not-found");

      await stopDaemon();
      daemonStopped = false;
      const afterRestart = await product("Task and Project", ["search", "results", "Open tasks"]);
      expect(items(afterRestart).map((item) => item.label)).toEqual(["First task"]);
      const statusAfterRestart = await product("Task and Project", ["sync", "status"]);
      expect((statusAfterRestart.data as { connected: boolean }).connected).toBe(false);
      await product("Task and Project", ["identity", "unlock", "--passphrase-file", passphraseFile()]);

      const replicaRoot = await setupReplicaHome(root, "replica");
      const replica = await startDaemonProcess(replicaRoot, accessToken);
      const replicaConfig = join(replicaRoot, "config");
      try {
        const workspaceId = await workspaceIdByLabel("Task and Project");
        const joinerActorId = await bootstrapProductActor("Replica Owner", replicaConfig);
        const exported = await lodeIn(replicaConfig, ["identity", "export"]);
        const admission = record(record(exported, "Export envelope").data, "Export data").admission;
        const admissionFile = join(replicaRoot, "admission.json");
        await writeFile(admissionFile, `${JSON.stringify(admission)}\n`, "utf8");
        await product("Task and Project", ["workspace", "admit-actor", "Task and Project", joinerActorId]);
        await product("Task and Project", [
          "workspace",
          "admit-peer",
          "Task and Project",
          "--admission-file",
          admissionFile,
        ]);
        const primaryExchange = (await readFile(join(root, "home", "sync-endpoint"), "utf8")).trim();
        await lodeIn(replicaConfig, ["workspace", "adopt", primaryExchange, workspaceId]);
        const replicaExchange = (await readFile(join(replicaRoot, "home", "sync-endpoint"), "utf8")).trim();
        await product("Task and Project", ["sync", "connect", replicaExchange]);
        await product("Task and Project", ["sync", "run"]);
        const replicaResults = await lode(
          ["--format", "json", "--workspace", "Task and Project", "search", "results", "Open tasks"],
          replicaConfig,
        );
        const envelope = record(JSON.parse(replicaResults.stdout) as unknown, "Replica search");
        expect(items(envelope).map((item) => item.label)).toEqual(["First task"]);
        await lodeIn(replicaConfig, ["--workspace", "Task and Project", "sync", "connect", primaryExchange]);
        await lodeIn(replicaConfig, ["--workspace", "Task and Project", "sync", "run"]);
        const replicaSearch = await product("Task and Project", ["search", "results", "Open tasks"]);
        expect(items(replicaSearch).map((item) => item.label)).toEqual(["First task"]);
      } finally {
        await replica.stop();
      }
    } finally {
      await stopDaemon();
    }
  }, 180_000);
});

describe("Anime Notes through the product CLI binary", () => {
  it("models, searches, presents, reviews, and syncs connected notes without raw JSON", async () => {
    await setupProductHome("anime");
    try {
      const animeActorId = await bootstrapProductActor("Anime Owner");
      await product("Anime Notes", ["--actor", animeActorId, "workspace", "create", "Anime Notes"]);
      await product("Anime Notes", ["--request-id", "n-lib", "node", "create", "Definition Library"]);
      await product("Anime Notes", ["--request-id", "n-notes", "node", "create", "Notes"]);

      await product("Anime Notes", [
        "--request-id",
        "s-work",
        "supertag",
        "create",
        "AnimeWork",
        "--under",
        "Definition Library",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "s-char",
        "supertag",
        "create",
        "Character",
        "--under",
        "Definition Library",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "s-quick",
        "supertag",
        "create",
        "QuickImpression",
        "--under",
        "Definition Library",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "s-review",
        "supertag",
        "create",
        "Review",
        "--under",
        "Definition Library",
      ]);

      await product("Anime Notes", [
        "--request-id",
        "f-work",
        "field",
        "create",
        "Work",
        "--type",
        "options-from-supertag",
        "--options-from",
        "AnimeWork",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "f-impr",
        "field",
        "create",
        "Impression",
        "--type",
        "plain",
        "--cardinality",
        "list",
      ]);
      await product("Anime Notes", ["--request-id", "f-rate", "field", "create", "Rating", "--type", "number"]);
      await product("Anime Notes", [
        "--request-id",
        "tf-work",
        "supertag",
        "field",
        "add-existing",
        "QuickImpression",
        "--field",
        "Work",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "tf-work-2",
        "supertag",
        "field",
        "add-existing",
        "Review",
        "--field",
        "Work",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "tf-impr",
        "supertag",
        "field",
        "add-existing",
        "QuickImpression",
        "--field",
        "Impression",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "tf-rate",
        "supertag",
        "field",
        "add-existing",
        "Review",
        "--field",
        "Rating",
      ]);

      await product("Anime Notes", ["--request-id", "n-frieren", "node", "create", "Frieren: Beyond Journey's End"]);
      await product("Anime Notes", ["--request-id", "n-quick", "node", "create", "Quick note", "--under", "Notes"]);
      await product("Anime Notes", [
        "--request-id",
        "a-frieren",
        "supertag",
        "apply",
        "AnimeWork",
        "--to",
        "Frieren: Beyond Journey's End",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "a-quick",
        "supertag",
        "apply",
        "QuickImpression",
        "--to",
        "Quick note",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "v-work",
        "field",
        "set",
        "Work",
        "--on",
        "Quick note",
        "--value",
        "Frieren: Beyond Journey's End",
      ]);
      await product("Anime Notes", [
        "--request-id",
        "v-impr",
        "field",
        "add",
        "Impression",
        "--on",
        "Quick note",
        "--value",
        "Quiet, patient, and humane",
        "--value",
        "Poignant",
      ]);

      await product("Anime Notes", [
        "--request-id",
        "sc1",
        "search",
        "create",
        "Anime notes",
        "--where",
        'tag(QuickImpression) and text("Quick note")',
      ]);
      await product("Anime Notes", ["--request-id", "vt1", "view", "table", "Anime notes"]);
      await product("Anime Notes", ["--request-id", "vc1", "view", "column", "add", "Work", "--on", "Anime notes"]);
      const results = await product("Anime Notes", ["search", "results", "Anime notes"]);
      expect(items(results).map((item) => item.label)).toEqual(["Quick note"]);

      await product("Anime Notes", [
        "--intent",
        "proposal",
        "--request-id",
        "pr1",
        "supertag",
        "apply",
        "Review",
        "--to",
        "Quick note",
      ]);
      const reviewList = await product("Anime Notes", ["review", "list"]);
      const reviewRef = items(reviewList).at(0)?.ref;
      expect(reviewRef).toBeDefined();
      await product("Anime Notes", ["--request-id", "rj1", "review", "reject", String(reviewRef)]);
      const reviewAfter = await product("Anime Notes", ["review", "list"]);
      expect((reviewAfter.data as { items: unknown[] }).items).toEqual([]);

      await product("Anime Notes", ["daemon", "stop"]);
      const afterRestart = await product("Anime Notes", ["search", "results", "Anime notes"]);
      expect(items(afterRestart).map((item) => item.label)).toEqual(["Quick note"]);
    } finally {
      await product("Anime Notes", ["daemon", "stop"]);
    }
  }, 180_000);
});

describe("product CLI process exit codes", () => {
  it("classifies authorization failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "lode-product-codes-"));
    temporaryDirectories.push(root);
    const daemon = await startDaemonProcess(join(root, "d"), accessToken);
    await writeFile(join(root, "d", "home", "token"), "wrong-token\n", "utf8");
    const configDir = join(root, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "lode.toml"),
      `default_home = "main"\n\n[homes.main]\npath = ${JSON.stringify(join(root, "d", "home"))}\n`,
      "utf8",
    );
    try {
      const child = spawn(process.execPath, [lodeBinary, "--format", "json", "workspace", "list"], {
        cwd: repositoryRoot,
        env: { ...process.env, LODE_CONFIG_DIR: configDir },
      });
      let out = "";
      let err = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        out += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        err += chunk;
      });
      const code = await new Promise<number>((resolveExit) => child.once("exit", (exit) => resolveExit(exit ?? 0)));
      expect(code).toBe(4);
      const envelope = JSON.parse(out) as Record<string, unknown>;
      expect(envelope.status).toBe("error");
      expect((envelope.error as { code: string }).code).toBe("authorization");
      // stdout carries exactly one envelope object; JSON mode keeps stderr empty.
      expect(out.trim().split("\n")).toHaveLength(1);
      expect(err).toBe("");
      // stdout/stderr separation: the envelope is the only stdout object.
      expect(out.trim().split("\n")).toHaveLength(1);
    } finally {
      await daemon.stop();
    }
  }, 60_000);
});

/** Reads a workspace id by label through the product CLI. */
async function workspaceIdByLabel(label: string): Promise<string> {
  const listed = await product(label, ["workspace", "list"]);
  const entries = (listed.data as { items: readonly { ref: string; label: string }[] }).items;
  const entry = entries.find((candidate) => candidate.label === label);
  if (!entry) {
    throw new Error(`${label} workspace missing`);
  }
  return entry.ref.replace(/^workspace:/, "");
}

/** A second registered home whose daemon is spawned through the internal mode
 * (startDaemonProcess) instead of the launcher, so the primary home's daemon
 * stays the one under test. */
async function setupReplicaHome(root: string, label: string): Promise<string> {
  const replicaRoot = join(root, label);
  const home = join(replicaRoot, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "token"), `${accessToken}\n`, "utf8");
  const configDir = join(replicaRoot, "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "lode.toml"),
    `default_home = "main"\n\n[homes.main]\npath = ${tomlPath(home)}\n`,
    "utf8",
  );
  return replicaRoot;
}
