import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startAppServerDaemon, type AppServerDaemon } from "@lode/daemon";
import { ANIME_WORKSPACE_ID, createBeCliHarness } from "./lode-anime-notes-helpers.js";

describe("lode CLI anime notes smoke", () => {
  let server: AppServerDaemon;
  let address: string;
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "lode-anime-data-"));
    server = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      persistence: { dataRoot },
    });
    address = server.address;
  });

  afterEach(async () => {
    await server.stop();
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("creates and reads a realistic anime notes workspace through be commands", async () => {
    const cli = createBeCliHarness(() => address);

    await cli.be("workspace", "create", "--workspace", ANIME_WORKSPACE_ID, "--name", "Anime");
    await cli.be("doc", "create", "--workspace", ANIME_WORKSPACE_ID);

    const root = await cli.createNode("Root");
    const schemaRoot = await cli.createNode("Schema", root.occurrenceId);
    const libraryRoot = await cli.createNode("Library", root.occurrenceId);
    const notesRoot = await cli.createNode("Notes", root.occurrenceId);
    const animeWorksRoot = await cli.createNode("Anime Works", libraryRoot.occurrenceId);
    const charactersRoot = await cli.createNode("Characters", libraryRoot.occurrenceId);

    const animeWorkSchema = await cli.createSchema("AnimeWork", schemaRoot.occurrenceId);
    const animeWorkFields = {
      title: await cli.createFieldDef("title", animeWorkSchema.occurrenceId),
      year: await cli.createFieldDef(
        "year",
        animeWorkSchema.occurrenceId,
        "--presence",
        "optional",
      ),
      status: await cli.createFieldDef(
        "status",
        animeWorkSchema.occurrenceId,
        "--presence",
        "optional",
      ),
    };

    const characterSchema = await cli.createSchema("Character", schemaRoot.occurrenceId);
    const characterFields = {
      name: await cli.createFieldDef("name", characterSchema.occurrenceId),
      role: await cli.createFieldDef(
        "role",
        characterSchema.occurrenceId,
        "--presence",
        "optional",
      ),
      fromWork: await cli.createFieldDef(
        "fromWork",
        characterSchema.occurrenceId,
        "--field-type",
        "reference",
      ),
    };

    const animeContextSchema = await cli.createSchema("AnimeContext", schemaRoot.occurrenceId);
    const animeContextFields = {
      work: await cli.createFieldDef(
        "work",
        animeContextSchema.occurrenceId,
        "--field-type",
        "reference",
      ),
      installment: await cli.createFieldDef(
        "installment",
        animeContextSchema.occurrenceId,
        "--presence",
        "optional",
      ),
      episode: await cli.createFieldDef(
        "episode",
        animeContextSchema.occurrenceId,
        "--presence",
        "optional",
      ),
      scene: await cli.createFieldDef(
        "scene",
        animeContextSchema.occurrenceId,
        "--presence",
        "optional",
      ),
    };

    const quickImpressionSchema = await cli.createSchema(
      "QuickImpression",
      schemaRoot.occurrenceId,
    );
    const quickImpressionFields = {
      mood: await cli.createFieldDef(
        "mood",
        quickImpressionSchema.occurrenceId,
        "--presence",
        "optional",
      ),
    };

    const reviewSchema = await cli.createSchema("Review", schemaRoot.occurrenceId);
    const reviewFields = {
      watchingMotivation: await cli.createFieldDef("watchingMotivation", reviewSchema.occurrenceId),
      plotAndPacing: await cli.createFieldDef("plotAndPacing", reviewSchema.occurrenceId),
      characterThoughts: await cli.createFieldDef("characterThoughts", reviewSchema.occurrenceId),
      overallImpression: await cli.createFieldDef("overallImpression", reviewSchema.occurrenceId),
    };

    const frierenWork = await cli.createNode("葬送的芙莉莲", animeWorksRoot.occurrenceId);
    await cli.applySchema(frierenWork.occurrenceId, animeWorkSchema.nodeId);
    await cli.setTextField(frierenWork.occurrenceId, animeWorkFields.title.nodeId, "葬送的芙莉莲");
    await cli.setTextField(frierenWork.occurrenceId, animeWorkFields.year.nodeId, "2023");
    await cli.setTextField(frierenWork.occurrenceId, animeWorkFields.status.nodeId, "watched");

    const frieren = await cli.createNode("芙莉莲", charactersRoot.occurrenceId);
    await cli.applySchema(frieren.occurrenceId, characterSchema.nodeId);
    await cli.setTextField(frieren.occurrenceId, characterFields.name.nodeId, "芙莉莲");
    await cli.setTextField(frieren.occurrenceId, characterFields.role.nodeId, "主角");
    await cli.setRefField(
      frieren.occurrenceId,
      characterFields.fromWork.nodeId,
      frierenWork.nodeId,
    );

    const himmel = await cli.createNode("欣梅尔", charactersRoot.occurrenceId);
    await cli.applySchema(himmel.occurrenceId, characterSchema.nodeId);
    await cli.setTextField(himmel.occurrenceId, characterFields.name.nodeId, "欣梅尔");
    await cli.setTextField(himmel.occurrenceId, characterFields.role.nodeId, "勇者");
    await cli.setRefField(himmel.occurrenceId, characterFields.fromWork.nodeId, frierenWork.nodeId);

    const quickNote = await cli.createNode("ref(芙莉莲) 这里太帅了", notesRoot.occurrenceId);
    await cli.applySchema(quickNote.occurrenceId, animeContextSchema.nodeId);
    await cli.applySchema(quickNote.occurrenceId, quickImpressionSchema.nodeId);
    await cli.setRefField(
      quickNote.occurrenceId,
      animeContextFields.work.nodeId,
      frierenWork.nodeId,
    );
    await cli.setTextField(quickNote.occurrenceId, animeContextFields.installment.nodeId, "TV S1");
    await cli.setTextField(quickNote.occurrenceId, animeContextFields.episode.nodeId, "EP10");
    await cli.setTextField(quickNote.occurrenceId, animeContextFields.scene.nodeId, "断头台阿乌拉");
    const quickMoodField = await cli.setTextField(
      quickNote.occurrenceId,
      quickImpressionFields.mood.nodeId,
      "爽",
    );

    const reviewNote = await cli.createNode("总结：葬送的芙莉莲 S1 观后感", notesRoot.occurrenceId);
    await cli.applySchema(reviewNote.occurrenceId, animeContextSchema.nodeId);
    await cli.applySchema(reviewNote.occurrenceId, reviewSchema.nodeId);
    await cli.setRefField(
      reviewNote.occurrenceId,
      animeContextFields.work.nodeId,
      frierenWork.nodeId,
    );
    await cli.setTextField(reviewNote.occurrenceId, animeContextFields.installment.nodeId, "TV S1");
    await cli.setTextField(
      reviewNote.occurrenceId,
      reviewFields.watchingMotivation.nodeId,
      "想看高评价公路奇幻如何处理长寿命视角",
    );
    await cli.setTextField(
      reviewNote.occurrenceId,
      reviewFields.plotAndPacing.nodeId,
      "慢节奏但回忆和当下互相补充",
    );
    await cli.setTextField(
      reviewNote.occurrenceId,
      reviewFields.characterThoughts.nodeId,
      "ref(芙莉莲) 的迟钝和成长是主线之一",
    );
    const reviewOverallField = await cli.setTextField(
      reviewNote.occurrenceId,
      reviewFields.overallImpression.nodeId,
      "温柔、克制，后劲很足",
    );

    const rootChildren = await cli.be(
      "node",
      "children",
      "--workspace",
      ANIME_WORKSPACE_ID,

      "--occ",
      root.occurrenceId,
    );
    expect(rootChildren).toContain("Schema");
    expect(rootChildren).toContain("Library");
    expect(rootChildren).toContain("Notes");

    const notesChildren = await cli.be(
      "node",
      "children",
      "--workspace",
      ANIME_WORKSPACE_ID,

      "--occ",
      notesRoot.occurrenceId,
    );
    expect(notesChildren).toContain("ref(芙莉莲) 这里太帅了");
    expect(notesChildren).toContain("总结：葬送的芙莉莲 S1 观后感");

    const quickNoteRead = await cli.be(
      "node",
      "get",
      "--workspace",
      ANIME_WORKSPACE_ID,

      "--occ",
      quickNote.occurrenceId,
    );
    expect(quickNoteRead).toContain(animeContextSchema.nodeId);
    expect(quickNoteRead).toContain(quickImpressionSchema.nodeId);

    const quickMoodValues = await cli.be(
      "node",
      "children",
      "--workspace",
      ANIME_WORKSPACE_ID,

      "--occ",
      quickMoodField.occurrenceId,
    );
    expect(quickMoodValues).toContain("爽");

    const reviewOverallValues = await cli.be(
      "node",
      "children",
      "--workspace",
      ANIME_WORKSPACE_ID,

      "--occ",
      reviewOverallField.occurrenceId,
    );
    expect(reviewOverallValues).toContain("温柔、克制，后劲很足");

    await server.stop();
    server = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      persistence: { dataRoot },
    });
    address = server.address;

    const persistedQuickNote = await cli.be(
      "node",
      "get",
      "--workspace",
      ANIME_WORKSPACE_ID,

      "--occ",
      quickNote.occurrenceId,
    );
    expect(persistedQuickNote).toContain(animeContextSchema.nodeId);
    expect(persistedQuickNote).toContain(quickImpressionSchema.nodeId);
  });
});
