import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const daemonBin = "packages/ipc/daemon/dist/bin/app-server.js";
const cliBin = "apps/app-cli/dist/bin/lode.js";
const actorId = process.env.LODE_ACTOR || "alice";
const workspaceId = "ws_anime";
const docId = "main";

const ids = {};

let server;
let serverUrl;
let dataRoot;

try {
  dataRoot = await mkdtemp(join(tmpdir(), "lode-anime-notes-data-"));
  await run("npm", ["run", "build"]);

  server = startServer();
  await waitForServer();

  await be("workspace", "create", "--workspace", workspaceId, "--name", "Anime");
  await be("doc", "create", "--workspace", workspaceId, "--doc", docId);

  ids.root = await createNode("Root");
  ids.schemaRoot = await createNode("Schema", ids.root.occurrenceId);
  ids.libraryRoot = await createNode("Library", ids.root.occurrenceId);
  ids.notesRoot = await createNode("Notes", ids.root.occurrenceId);
  ids.animeWorksRoot = await createNode("Anime Works", ids.libraryRoot.occurrenceId);
  ids.charactersRoot = await createNode("Characters", ids.libraryRoot.occurrenceId);

  ids.animeWorkSchema = await createSchema("AnimeWork", ids.schemaRoot.occurrenceId);
  ids.animeWorkTitle = await createFieldDef("title", ids.animeWorkSchema.occurrenceId);
  ids.animeWorkYear = await createFieldDef("year", ids.animeWorkSchema.occurrenceId, "--presence", "optional");
  ids.animeWorkStatus = await createFieldDef("status", ids.animeWorkSchema.occurrenceId, "--presence", "optional");

  ids.characterSchema = await createSchema("Character", ids.schemaRoot.occurrenceId);
  ids.characterName = await createFieldDef("name", ids.characterSchema.occurrenceId);
  ids.characterRole = await createFieldDef("role", ids.characterSchema.occurrenceId, "--presence", "optional");
  ids.characterFromWork = await createFieldDef(
    "fromWork",
    ids.characterSchema.occurrenceId,
    "--field-type",
    "reference",
  );

  ids.animeContextSchema = await createSchema("AnimeContext", ids.schemaRoot.occurrenceId);
  ids.animeContextWork = await createFieldDef(
    "work",
    ids.animeContextSchema.occurrenceId,
    "--field-type",
    "reference",
  );
  ids.animeContextInstallment = await createFieldDef(
    "installment",
    ids.animeContextSchema.occurrenceId,
    "--presence",
    "optional",
  );
  ids.animeContextEpisode = await createFieldDef(
    "episode",
    ids.animeContextSchema.occurrenceId,
    "--presence",
    "optional",
  );
  ids.animeContextScene = await createFieldDef(
    "scene",
    ids.animeContextSchema.occurrenceId,
    "--presence",
    "optional",
  );

  ids.quickImpressionSchema = await createSchema("QuickImpression", ids.schemaRoot.occurrenceId);
  ids.quickMood = await createFieldDef("mood", ids.quickImpressionSchema.occurrenceId, "--presence", "optional");

  ids.reviewSchema = await createSchema("Review", ids.schemaRoot.occurrenceId);
  ids.reviewWatchingMotivation = await createFieldDef("watchingMotivation", ids.reviewSchema.occurrenceId);
  ids.reviewPlotAndPacing = await createFieldDef("plotAndPacing", ids.reviewSchema.occurrenceId);
  ids.reviewCharacterThoughts = await createFieldDef("characterThoughts", ids.reviewSchema.occurrenceId);
  ids.reviewOverallImpression = await createFieldDef("overallImpression", ids.reviewSchema.occurrenceId);

  ids.frierenWork = await createNode("葬送的芙莉莲", ids.animeWorksRoot.occurrenceId);
  await applySchema(ids.frierenWork.occurrenceId, ids.animeWorkSchema.nodeId);
  await setTextField(ids.frierenWork.occurrenceId, ids.animeWorkTitle.nodeId, "葬送的芙莉莲");
  await setTextField(ids.frierenWork.occurrenceId, ids.animeWorkYear.nodeId, "2023");
  await setTextField(ids.frierenWork.occurrenceId, ids.animeWorkStatus.nodeId, "watched");

  ids.frieren = await createNode("芙莉莲", ids.charactersRoot.occurrenceId);
  await applySchema(ids.frieren.occurrenceId, ids.characterSchema.nodeId);
  await setTextField(ids.frieren.occurrenceId, ids.characterName.nodeId, "芙莉莲");
  await setTextField(ids.frieren.occurrenceId, ids.characterRole.nodeId, "主角");
  await setRefField(ids.frieren.occurrenceId, ids.characterFromWork.nodeId, ids.frierenWork.nodeId);

  ids.himmel = await createNode("欣梅尔", ids.charactersRoot.occurrenceId);
  await applySchema(ids.himmel.occurrenceId, ids.characterSchema.nodeId);
  await setTextField(ids.himmel.occurrenceId, ids.characterName.nodeId, "欣梅尔");
  await setTextField(ids.himmel.occurrenceId, ids.characterRole.nodeId, "勇者");
  await setRefField(ids.himmel.occurrenceId, ids.characterFromWork.nodeId, ids.frierenWork.nodeId);

  ids.quickNote = await createNode("ref(芙莉莲) 这里太帅了", ids.notesRoot.occurrenceId);
  await applySchema(ids.quickNote.occurrenceId, ids.animeContextSchema.nodeId);
  await applySchema(ids.quickNote.occurrenceId, ids.quickImpressionSchema.nodeId);
  await setRefField(ids.quickNote.occurrenceId, ids.animeContextWork.nodeId, ids.frierenWork.nodeId);
  await setTextField(ids.quickNote.occurrenceId, ids.animeContextInstallment.nodeId, "TV S1");
  await setTextField(ids.quickNote.occurrenceId, ids.animeContextEpisode.nodeId, "EP10");
  await setTextField(ids.quickNote.occurrenceId, ids.animeContextScene.nodeId, "断头台阿乌拉");
  ids.quickMoodField = await setTextField(ids.quickNote.occurrenceId, ids.quickMood.nodeId, "爽");

  ids.reviewNote = await createNode("总结：葬送的芙莉莲 S1 观后感", ids.notesRoot.occurrenceId);
  await applySchema(ids.reviewNote.occurrenceId, ids.animeContextSchema.nodeId);
  await applySchema(ids.reviewNote.occurrenceId, ids.reviewSchema.nodeId);
  await setRefField(ids.reviewNote.occurrenceId, ids.animeContextWork.nodeId, ids.frierenWork.nodeId);
  await setTextField(ids.reviewNote.occurrenceId, ids.animeContextInstallment.nodeId, "TV S1");
  await setTextField(ids.reviewNote.occurrenceId, ids.reviewWatchingMotivation.nodeId, "想看高评价公路奇幻如何处理长寿命视角");
  await setTextField(ids.reviewNote.occurrenceId, ids.reviewPlotAndPacing.nodeId, "慢节奏但回忆和当下互相补充");
  await setTextField(ids.reviewNote.occurrenceId, ids.reviewCharacterThoughts.nodeId, "ref(芙莉莲) 的迟钝和成长是主线之一");
  ids.reviewOverallField = await setTextField(ids.reviewNote.occurrenceId, ids.reviewOverallImpression.nodeId, "温柔、克制，后劲很足");

  printSection("Readback");
  await be("doc", "list", "--workspace", workspaceId);
  await readBack();

  printSection("Restart AppServer");
  await stopServer();
  server = startServer();
  await waitForServer();

  printSection("Persistent Readback");
  await readBack();

  printSection("Done");
  console.log(`URL: ${serverUrl}`);
  console.log(`Actor: ${actorId}`);
  console.log(`Temporary data root: ${dataRoot}`);
} finally {
  await stopServer();
  if (dataRoot) {
    await rm(dataRoot, { recursive: true, force: true });
    console.log(`Cleaned temporary data root: ${dataRoot}`);
  }
}

function startServer() {
  const child = spawn(
    "node",
    [daemonBin, "--listen", "tcp://127.0.0.1:0", "--data-root", dataRoot],
    {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`[app-server] ${text}`);
    const match = /listening on: (\S+)/.exec(text);
    if (match) {
      serverUrl = match[1];
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`[app-server] ${chunk}`));
  return child;
}

async function stopServer() {
  if (!server) {
    return;
  }
  if (server.exitCode !== null || server.signalCode !== null || server.killed) {
    server = undefined;
    serverUrl = undefined;
    return;
  }
  const exited = new Promise((resolve) => {
    server.once("exit", resolve);
  });
  server.kill();
  await exited;
  server = undefined;
  serverUrl = undefined;
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    if (serverUrl) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for app-server to report its address.");
}

async function createNode(text, parentOccurrenceId) {
  const args = ["node", "create", ...docArgs(), "--text", text];
  if (parentOccurrenceId !== undefined) {
    args.push("--parent-occ", parentOccurrenceId);
  }
  return parseNodeCreated(await be(...args));
}

async function createSchema(name, parentOccurrenceId) {
  return parseSchemaCreated(
    await be("schema", "create", ...docArgs(), "--name", name, "--parent-occ", parentOccurrenceId),
  );
}

async function createFieldDef(name, parentOccurrenceId, ...extraFlags) {
  return parseFieldDefCreated(
    await be("field-def", "create", ...docArgs(), "--parent-occ", parentOccurrenceId, "--name", name, ...extraFlags),
  );
}

async function applySchema(targetOccurrenceId, schemaNodeId) {
  await be("schema", "apply", ...docArgs(), "--target-occ", targetOccurrenceId, "--schema-node", schemaNodeId);
}

async function setTextField(targetOccurrenceId, fieldDefNodeId, text) {
  const field = await addField(targetOccurrenceId, fieldDefNodeId);
  await be("field", "set-values", ...docArgs(), "--field-occ", field.occurrenceId, "--text", text);
  return field;
}

async function setRefField(targetOccurrenceId, fieldDefNodeId, targetNodeId) {
  const field = await addField(targetOccurrenceId, fieldDefNodeId);
  await be("field", "set-values", ...docArgs(), "--field-occ", field.occurrenceId, "--ref-node", targetNodeId);
  return field;
}

async function addField(targetOccurrenceId, fieldDefNodeId) {
  return parseFieldAdded(
    await be("field", "add", ...docArgs(), "--target-occ", targetOccurrenceId, "--field-def-node", fieldDefNodeId),
  );
}

async function readBack() {
  await be("node", "children", ...docArgs(), "--occ", ids.root.occurrenceId);
  await be("node", "children", ...docArgs(), "--occ", ids.notesRoot.occurrenceId);
  const quickNote = await be("node", "get", ...docArgs(), "--occ", ids.quickNote.occurrenceId);
  const quickMood = await be("node", "children", ...docArgs(), "--occ", ids.quickMoodField.occurrenceId);
  const reviewNote = await be("node", "get", ...docArgs(), "--occ", ids.reviewNote.occurrenceId);
  const reviewOverall = await be("node", "children", ...docArgs(), "--occ", ids.reviewOverallField.occurrenceId);
  assertContains(quickNote, ids.animeContextSchema.nodeId, "quick note anime context schema");
  assertContains(quickNote, ids.quickImpressionSchema.nodeId, "quick note impression schema");
  assertContains(quickMood, "爽", "quick mood value");
  assertContains(reviewNote, ids.reviewSchema.nodeId, "review schema");
  assertContains(reviewOverall, "温柔、克制，后劲很足", "review overall value");
}

function docArgs() {
  return ["--workspace", workspaceId, "--doc", docId];
}

function assertContains(output, expected, label) {
  if (!output.includes(expected)) {
    throw new Error(`Expected ${label} output to contain ${JSON.stringify(expected)}.`);
  }
}

async function be(...args) {
  const fullArgs = [cliBin, "--url", serverUrl, "--actor", actorId, ...args];
  return run("node", fullArgs);
}

function run(command, args) {
  printCommand(command, args);
  return new Promise((resolve, reject) => {
    const useShell = usesShell(command);
    const child = spawn(executable(command, useShell), args, {
      cwd: rootDir,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell,
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
      if (stdout.trim().length > 0) {
        console.log(stdout.trimEnd());
      }
      if (stderr.trim().length > 0) {
        console.error(stderr.trimEnd());
      }
      console.log("");
      if (code === 0) {
        resolve(stdout.trimEnd());
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

function executable(command, useShell) {
  return process.platform === "win32" && command === "npm" && !useShell ? "npm.cmd" : command;
}

function usesShell(command) {
  return process.platform === "win32" && command === "npm";
}

function printCommand(command, args) {
  console.log(`> ${[command, ...args].map(quoteArg).join(" ")}`);
}

function quoteArg(arg) {
  return /[\s"'()\\-￿]/.test(arg) ? JSON.stringify(arg) : arg;
}

function printSection(title) {
  console.log("");
  console.log(`=== ${title} ===`);
  console.log("");
}

function parseNodeCreated(output) {
  const match = /^Created node (?<nodeId>\S+) at occurrence (?<occurrenceId>\S+)/.exec(output);
  if (!match?.groups) {
    throw new Error(`Could not parse node creation output: ${output}`);
  }
  return { nodeId: match.groups.nodeId, occurrenceId: match.groups.occurrenceId };
}

function parseSchemaCreated(output) {
  const match = /^Created schema ".+" as node (?<nodeId>\S+) \(occurrence (?<occurrenceId>\S+)\)\./.exec(output);
  if (!match?.groups) {
    throw new Error(`Could not parse schema creation output: ${output}`);
  }
  return { nodeId: match.groups.nodeId, occurrenceId: match.groups.occurrenceId };
}

function parseFieldDefCreated(output) {
  const match = /^Created field definition .+ as node (?<nodeId>\S+)\.$/.exec(output);
  if (!match?.groups) {
    throw new Error(`Could not parse field definition output: ${output}`);
  }
  return { nodeId: match.groups.nodeId };
}

function parseFieldAdded(output) {
  const match = /^field add status=(created|reused)\n(?<occurrenceId>\S+)  field/m.exec(output);
  if (!match?.groups) {
    throw new Error(`Could not parse field add output: ${output}`);
  }
  return { occurrenceId: match.groups.occurrenceId };
}
