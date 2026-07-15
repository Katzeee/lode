// Test C — binary anime-notes business scenario (the fixed `run-anime-notes-demo.mjs`, moved into the
// binary-test folder). Spawns ONE real `lode daemon run` process + drives `lode` to build a realistic
// schema/field/ref note tree, reads it back, restarts the daemon, and reads it back again (persistence).
// Single-daemon: no sync, no relay — the business surface, not the sync flow (Test B owns that).
//
// Run: `node tests/binary/anime-notes.mjs` (verbose, prints the flow) or via `npm run test:binary`
// (`--quiet`: asserts via captured stdout + exit code, no printing).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  spawnDaemon,
  runLode,
  actorNew,
  parseWorkspaceCreated,
  parseNodeCreated,
  parseSchemaCreated,
  parseFieldDefCreated,
  parseFieldAdded,
  parseRootOcc,
  assertContains,
  killAll,
} from "./_binary-helpers.mjs";

let dataRoot;
let server;
let ws;
const ids = {};

const PASS = "binary-test-passphrase";
let home;

try {
  dataRoot = await mkdtemp(join(tmpdir(), "lode-anime-binary-"));
  home = await mkdtemp(join(tmpdir(), "lode-anime-home-"));
  server = await spawnDaemon(dataRoot, home);

  // ── bootstrap identity (vault init + active-actor) ──
  await actorNew(home, PASS, "Alice");

  /** Run a `lode` command against this daemon via its home (header auth from active-actor). */
  const be = (...args) => runLode(home, args);

  // ── workspace + its seeded root ──
  ws = parseWorkspaceCreated(await be("workspace", "create", "--name", "Anime"));
  const rootOcc = parseRootOcc(await be("node", "list", "--workspace", ws));

  const wsArgs = () => ["--workspace", ws];
  const createNode = async (text, parentOccurrenceId) =>
    parseNodeCreated(
      await be("node", "create", ...wsArgs(), "--parent-occ", parentOccurrenceId, "--text", text),
    );
  const createSchema = async (name, parentOccurrenceId) =>
    parseSchemaCreated(
      await be("schema", "create", ...wsArgs(), "--name", name, "--parent-occ", parentOccurrenceId),
    );
  const createFieldDef = async (name, parentOccurrenceId, ...extraFlags) =>
    parseFieldDefCreated(
      await be(
        "field-def",
        "create",
        ...wsArgs(),
        "--parent-occ",
        parentOccurrenceId,
        "--name",
        name,
        ...extraFlags,
      ),
    );
  const applySchema = async (targetOccurrenceId, schemaNodeId) =>
    be(
      "schema",
      "apply",
      ...wsArgs(),
      "--target-occ",
      targetOccurrenceId,
      "--schema-node",
      schemaNodeId,
    );
  const addField = async (targetOccurrenceId, fieldDefNodeId) =>
    parseFieldAdded(
      await be(
        "field",
        "add",
        ...wsArgs(),
        "--target-occ",
        targetOccurrenceId,
        "--field-def-node",
        fieldDefNodeId,
      ),
    );
  const setTextField = async (targetOccurrenceId, fieldDefNodeId, text) => {
    const field = await addField(targetOccurrenceId, fieldDefNodeId);
    await be("field", "set-values", ...wsArgs(), "--field-occ", field.occurrenceId, "--text", text);
    return field;
  };
  const setRefField = async (targetOccurrenceId, fieldDefNodeId, targetNodeId) => {
    const field = await addField(targetOccurrenceId, fieldDefNodeId);
    await be(
      "field",
      "set-values",
      ...wsArgs(),
      "--field-occ",
      field.occurrenceId,
      "--ref-node",
      targetNodeId,
    );
    return field;
  };

  // ── build the tree (the "Root" container nests under the workspace's seeded root) ──
  ids.root = await createNode("Root", rootOcc);
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
  ids.characterFromWork = await createFieldDef("fromWork", ids.characterSchema.occurrenceId, "--field-type", "reference");

  ids.animeContextSchema = await createSchema("AnimeContext", ids.schemaRoot.occurrenceId);
  ids.animeContextWork = await createFieldDef("work", ids.animeContextSchema.occurrenceId, "--field-type", "reference");
  ids.animeContextInstallment = await createFieldDef("installment", ids.animeContextSchema.occurrenceId, "--presence", "optional");
  ids.animeContextEpisode = await createFieldDef("episode", ids.animeContextSchema.occurrenceId, "--presence", "optional");
  ids.animeContextScene = await createFieldDef("scene", ids.animeContextSchema.occurrenceId, "--presence", "optional");

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

  // ── readback ──
  await readBack();

  // ── restart the daemon (same dataRoot + home) → persistence readback ──
  killAll(server.child);
  server = await spawnDaemon(dataRoot, home);
  await runLode(home, ["unlock"], `${PASS}\n`); // the vault re-locks on daemon restart
  await readBack();

  if (process.argv.includes("--quiet")) {
    console.log("anime-notes binary test: OK");
  }
} finally {
  killAll(server?.child);
  if (dataRoot) {
    await rm(dataRoot, { recursive: true, force: true });
  }
  if (home) {
    await rm(home, { recursive: true, force: true });
  }
}

async function readBack() {
  const rb = (...args) => runLode(home, args);

  const rootChildren = await rb("node", "children", "--workspace", ws, "--occ", ids.root.occurrenceId);
  assertContains(rootChildren, "Schema", "root children");
  assertContains(rootChildren, "Library", "root children");
  assertContains(rootChildren, "Notes", "root children");

  const notesChildren = await rb("node", "children", "--workspace", ws, "--occ", ids.notesRoot.occurrenceId);
  assertContains(notesChildren, "ref(芙莉莲) 这里太帅了", "notes children");
  assertContains(notesChildren, "总结：葬送的芙莉莲 S1 观后感", "notes children");

  const quickNote = await rb("node", "get", "--workspace", ws, "--occ", ids.quickNote.occurrenceId);
  assertContains(quickNote, ids.animeContextSchema.nodeId, "quick note schemas");
  assertContains(quickNote, ids.quickImpressionSchema.nodeId, "quick note schemas");

  const quickMood = await rb("node", "children", "--workspace", ws, "--occ", ids.quickMoodField.occurrenceId);
  assertContains(quickMood, "爽", "quick mood value");

  const reviewNote = await rb("node", "get", "--workspace", ws, "--occ", ids.reviewNote.occurrenceId);
  assertContains(reviewNote, ids.reviewSchema.nodeId, "review note schemas");

  const reviewOverall = await rb("node", "children", "--workspace", ws, "--occ", ids.reviewOverallField.occurrenceId);
  assertContains(reviewOverall, "温柔、克制，后劲很足", "review overall value");
}
