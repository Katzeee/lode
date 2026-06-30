import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient } from "@lode/client";
import { FieldType, FieldPresence } from "@lode/protocol/proto";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";
import {
  createTestWorkspaceAndDoc,
  withDefaultWorkspace,
  type TestRpc,
} from "../helpers/workspace.js";
import { createAnimeNotesScenarioHelpers, hello } from "./anime-notes-scenario-helpers.js";

/*
Product scenario: anime impression notes with schemas, fields, and refs.

Goal
----
Create a small but realistic note workspace through the AppServer product APIs.
The point is not to model an anime as one large tree. The user's primary notes
live under Root/Notes, and each note gets its identity from applied schemas.

This scenario belongs at the server integration level because it verifies the
shared product capability that every client should rely on. CLI and GUI tests can
later cover their own interaction surfaces without duplicating the full product
model.

Core modeling rule
------------------
Field definitions are slots the applied node is expected to fill. Stable content
that is not filled per note should remain ordinary nodes or library entries, not
field definitions on a schema.

Workspace shape
---------------

Root
├─ Schema
│  ├─ AnimeWork
│  │  ├─ fieldDef title
│  │  ├─ fieldDef originalTitle optional
│  │  ├─ fieldDef year optional
│  │  └─ fieldDef status optional
│  │
│  ├─ Character
│  │  ├─ fieldDef name
│  │  ├─ fieldDef role optional
│  │  └─ fieldDef fromWork reference -> AnimeWork
│  │
│  ├─ AnimeContext
│  │  ├─ fieldDef work reference -> AnimeWork
│  │  ├─ fieldDef installment optional
│  │  ├─ fieldDef episode optional
│  │  └─ fieldDef scene optional
│  │
│  ├─ QuickImpression
│  │  └─ fieldDef mood optional
│  │
│  └─ Review
│     ├─ fieldDef watchingMotivation
│     ├─ fieldDef plotAndPacing
│     ├─ fieldDef characterThoughts
│     └─ fieldDef overallImpression
│
├─ Library
│  ├─ Anime Works
│  │  └─ 葬送的芙莉莲
│  │     └─ schemas: AnimeWork
│  │
│  └─ Characters
│     ├─ 芙莉莲
│     │  └─ schemas: Character
│     └─ 欣梅尔
│        └─ schemas: Character
│
└─ Notes
   ├─ ref(芙莉莲) 这里太帅了
   │  ├─ schemas: AnimeContext + QuickImpression
   │  ├─ work: ref(葬送的芙莉莲)
   │  ├─ installment: TV S1
   │  ├─ episode: EP10
   │  ├─ scene: 断头台阿乌拉
   │  └─ mood: 爽
   │
   └─ 总结：葬送的芙莉莲 S1 观后感
      ├─ schemas: AnimeContext + Review
      ├─ work: ref(葬送的芙莉莲)
      ├─ installment: TV S1
      ├─ watchingMotivation: 想看高评价公路奇幻如何处理长寿命视角
      ├─ plotAndPacing: 慢节奏但回忆和当下互相补充
      ├─ characterThoughts: ref(芙莉莲) 的迟钝和成长是主线之一
      └─ overallImpression: 温柔、克制，后劲很足

Mermaid sketch
--------------

graph TD
  Root["Root"]
  Root --> SchemaRoot["Schema"]
  Root --> LibraryRoot["Library"]
  Root --> NotesRoot["Notes"]

  SchemaRoot --> AnimeWorkSchema["Schema: AnimeWork"]
  AnimeWorkSchema --> WorkTitle["FieldDef: title"]
  AnimeWorkSchema --> WorkOriginalTitle["FieldDef: originalTitle optional"]
  AnimeWorkSchema --> WorkYear["FieldDef: year optional"]
  AnimeWorkSchema --> WorkStatus["FieldDef: status optional"]

  SchemaRoot --> CharacterSchema["Schema: Character"]
  CharacterSchema --> CharName["FieldDef: name"]
  CharacterSchema --> CharRole["FieldDef: role optional"]
  CharacterSchema --> CharFromWork["FieldDef: fromWork reference -> AnimeWork"]

  SchemaRoot --> AnimeContextSchema["Schema: AnimeContext"]
  AnimeContextSchema --> ContextWork["FieldDef: work reference -> AnimeWork"]
  AnimeContextSchema --> ContextInstallment["FieldDef: installment optional"]
  AnimeContextSchema --> ContextEpisode["FieldDef: episode optional"]
  AnimeContextSchema --> ContextScene["FieldDef: scene optional"]

  SchemaRoot --> QuickImpressionSchema["Schema: QuickImpression"]
  QuickImpressionSchema --> QuickMood["FieldDef: mood optional"]

  SchemaRoot --> ReviewSchema["Schema: Review"]
  ReviewSchema --> Motivation["FieldDef: watchingMotivation"]
  ReviewSchema --> PlotPacing["FieldDef: plotAndPacing"]
  ReviewSchema --> CharacterThoughts["FieldDef: characterThoughts"]
  ReviewSchema --> Overall["FieldDef: overallImpression"]

  LibraryRoot --> AnimeLibrary["Anime Works"]
  AnimeLibrary --> FrierenWork["Node: 葬送的芙莉莲, schema: AnimeWork"]

  LibraryRoot --> CharacterLibrary["Characters"]
  CharacterLibrary --> Frieren["Node: 芙莉莲, schema: Character"]
  CharacterLibrary --> Himmel["Node: 欣梅尔, schema: Character"]

  NotesRoot --> QuickNote["Node: ref(芙莉莲) 这里太帅了, schemas: AnimeContext + QuickImpression"]
  NotesRoot --> ReviewNote["Node: 总结：葬送的芙莉莲 S1 观后感, schemas: AnimeContext + Review"]

  QuickNote -. "field work" .-> FrierenWork
  ReviewNote -. "field work" .-> FrierenWork
  Frieren -. "field fromWork" .-> FrierenWork
  Himmel -. "field fromWork" .-> FrierenWork
  QuickNote -. "content ref" .-> Frieren
  ReviewNote -. "content ref" .-> Frieren

Expected product acceptance path
--------------------------------
The future executable version of this scenario should prove that AppServer can:

1. create a doc and top-level Root/Schema/Library/Notes structure;
2. create schemas and field definitions for AnimeWork, Character, AnimeContext,
   QuickImpression, and Review;
3. create AnimeWork and Character library entries;
4. apply schemas to library entries and notes;
5. set field values with text and refs;
6. create a QuickImpression whose node text is the real note content:
   "ref(芙莉莲) 这里太帅了";
7. create a Review note with AnimeContext + Review fields;
8. read the result back through node read APIs so clients can verify the
   structure without server internals.
*/

describe("anime notes product scenario", () => {
  let server: AppServerDaemon;
  let client: AppServerClient;
  let rpc: TestRpc;

  beforeEach(async () => {
    server = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0" });
    client = new AppServerClient({ url: server.address });
    client.connect();
    await hello(client);
    await createTestWorkspaceAndDoc(client);
    rpc = withDefaultWorkspace(client);
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("creates and reads a realistic anime notes workspace through AppServer APIs", async () => {
    const {
      applySchema,
      childrenOf,
      createFieldDef,
      createSchema,
      createTextNode,
      getNode,
      readSingleRefValue,
      readSingleTextValue,
      setSingleRefValue,
      setSingleTextValue,
    } = createAnimeNotesScenarioHelpers(rpc);

    const root = await createTextNode("Root");
    const schemaRoot = await createTextNode("Schema", root.occurrenceId);
    const libraryRoot = await createTextNode("Library", root.occurrenceId);
    const notesRoot = await createTextNode("Notes", root.occurrenceId);
    const animeWorksRoot = await createTextNode("Anime Works", libraryRoot.occurrenceId);
    const charactersRoot = await createTextNode("Characters", libraryRoot.occurrenceId);

    const animeWorkSchema = await createSchema("AnimeWork", schemaRoot.occurrenceId);
    const animeWorkFields = {
      title: await createFieldDef(animeWorkSchema.occurrenceId, "title"),
      originalTitle: await createFieldDef(animeWorkSchema.occurrenceId, "originalTitle", {
        presence: FieldPresence.OPTIONAL_PRESENCE,
      }),
      year: await createFieldDef(animeWorkSchema.occurrenceId, "year", {
        presence: FieldPresence.OPTIONAL_PRESENCE,
      }),
      status: await createFieldDef(animeWorkSchema.occurrenceId, "status", {
        presence: FieldPresence.OPTIONAL_PRESENCE,
      }),
    };

    const characterSchema = await createSchema("Character", schemaRoot.occurrenceId);
    const characterFields = {
      name: await createFieldDef(characterSchema.occurrenceId, "name"),
      role: await createFieldDef(characterSchema.occurrenceId, "role", {
        presence: FieldPresence.OPTIONAL_PRESENCE,
      }),
      fromWork: await createFieldDef(characterSchema.occurrenceId, "fromWork", {
        fieldType: FieldType.REFERENCE,
      }),
    };

    const animeContextSchema = await createSchema("AnimeContext", schemaRoot.occurrenceId);
    const animeContextFields = {
      work: await createFieldDef(animeContextSchema.occurrenceId, "work", {
        fieldType: FieldType.REFERENCE,
      }),
      installment: await createFieldDef(animeContextSchema.occurrenceId, "installment", {
        presence: FieldPresence.OPTIONAL_PRESENCE,
      }),
      episode: await createFieldDef(animeContextSchema.occurrenceId, "episode", {
        presence: FieldPresence.OPTIONAL_PRESENCE,
      }),
      scene: await createFieldDef(animeContextSchema.occurrenceId, "scene", {
        presence: FieldPresence.OPTIONAL_PRESENCE,
      }),
    };

    const quickImpressionSchema = await createSchema("QuickImpression", schemaRoot.occurrenceId);
    const quickImpressionFields = {
      mood: await createFieldDef(quickImpressionSchema.occurrenceId, "mood", {
        presence: FieldPresence.OPTIONAL_PRESENCE,
      }),
    };

    const reviewSchema = await createSchema("Review", schemaRoot.occurrenceId);
    const reviewFields = {
      watchingMotivation: await createFieldDef(reviewSchema.occurrenceId, "watchingMotivation"),
      plotAndPacing: await createFieldDef(reviewSchema.occurrenceId, "plotAndPacing"),
      characterThoughts: await createFieldDef(reviewSchema.occurrenceId, "characterThoughts"),
      overallImpression: await createFieldDef(reviewSchema.occurrenceId, "overallImpression"),
    };

    const frierenWork = await createTextNode("葬送的芙莉莲", animeWorksRoot.occurrenceId);
    await applySchema(frierenWork.occurrenceId, animeWorkSchema.nodeId);
    await setSingleTextValue(
      frierenWork.occurrenceId,
      animeWorkFields.title.nodeId,
      "葬送的芙莉莲",
    );
    await setSingleTextValue(frierenWork.occurrenceId, animeWorkFields.year.nodeId, "2023");
    await setSingleTextValue(frierenWork.occurrenceId, animeWorkFields.status.nodeId, "watched");

    const frieren = await createTextNode("芙莉莲", charactersRoot.occurrenceId);
    await applySchema(frieren.occurrenceId, characterSchema.nodeId);
    await setSingleTextValue(frieren.occurrenceId, characterFields.name.nodeId, "芙莉莲");
    await setSingleTextValue(frieren.occurrenceId, characterFields.role.nodeId, "主角");
    await setSingleRefValue(
      frieren.occurrenceId,
      characterFields.fromWork.nodeId,
      frierenWork.nodeId,
    );

    const himmel = await createTextNode("欣梅尔", charactersRoot.occurrenceId);
    await applySchema(himmel.occurrenceId, characterSchema.nodeId);
    await setSingleTextValue(himmel.occurrenceId, characterFields.name.nodeId, "欣梅尔");
    await setSingleTextValue(himmel.occurrenceId, characterFields.role.nodeId, "勇者");
    await setSingleRefValue(
      himmel.occurrenceId,
      characterFields.fromWork.nodeId,
      frierenWork.nodeId,
    );

    const quickNote = await createTextNode("ref(芙莉莲) 这里太帅了", notesRoot.occurrenceId);
    await applySchema(quickNote.occurrenceId, animeContextSchema.nodeId);
    await applySchema(quickNote.occurrenceId, quickImpressionSchema.nodeId);
    await setSingleRefValue(
      quickNote.occurrenceId,
      animeContextFields.work.nodeId,
      frierenWork.nodeId,
    );
    await setSingleTextValue(
      quickNote.occurrenceId,
      animeContextFields.installment.nodeId,
      "TV S1",
    );
    await setSingleTextValue(quickNote.occurrenceId, animeContextFields.episode.nodeId, "EP10");
    await setSingleTextValue(
      quickNote.occurrenceId,
      animeContextFields.scene.nodeId,
      "断头台阿乌拉",
    );
    await setSingleTextValue(quickNote.occurrenceId, quickImpressionFields.mood.nodeId, "爽");

    const reviewNote = await createTextNode("总结：葬送的芙莉莲 S1 观后感", notesRoot.occurrenceId);
    await applySchema(reviewNote.occurrenceId, animeContextSchema.nodeId);
    await applySchema(reviewNote.occurrenceId, reviewSchema.nodeId);
    await setSingleRefValue(
      reviewNote.occurrenceId,
      animeContextFields.work.nodeId,
      frierenWork.nodeId,
    );
    await setSingleTextValue(
      reviewNote.occurrenceId,
      animeContextFields.installment.nodeId,
      "TV S1",
    );
    await setSingleTextValue(
      reviewNote.occurrenceId,
      reviewFields.watchingMotivation.nodeId,
      "想看高评价公路奇幻如何处理长寿命视角",
    );
    await setSingleTextValue(
      reviewNote.occurrenceId,
      reviewFields.plotAndPacing.nodeId,
      "慢节奏但回忆和当下互相补充",
    );
    await setSingleTextValue(
      reviewNote.occurrenceId,
      reviewFields.characterThoughts.nodeId,
      "ref(芙莉莲) 的迟钝和成长是主线之一",
    );
    await setSingleTextValue(
      reviewNote.occurrenceId,
      reviewFields.overallImpression.nodeId,
      "温柔、克制，后劲很足",
    );

    await expect(childrenOf(root.occurrenceId)).resolves.toEqual([
      expect.objectContaining({ occurrenceId: schemaRoot.occurrenceId }),
      expect.objectContaining({ occurrenceId: libraryRoot.occurrenceId }),
      expect.objectContaining({ occurrenceId: notesRoot.occurrenceId }),
    ]);
    await expect(childrenOf(schemaRoot.occurrenceId)).resolves.toHaveLength(5);
    await expect(childrenOf(notesRoot.occurrenceId)).resolves.toEqual([
      expect.objectContaining({
        occurrenceId: quickNote.occurrenceId,
        deltas: [expect.objectContaining({ insert: "ref(芙莉莲) 这里太帅了" })],
      }),
      expect.objectContaining({
        occurrenceId: reviewNote.occurrenceId,
        deltas: [expect.objectContaining({ insert: "总结：葬送的芙莉莲 S1 观后感" })],
      }),
    ]);

    await expect(getNode(frierenWork.occurrenceId)).resolves.toMatchObject({
      entityMeta: { schemaIds: [animeWorkSchema.nodeId] },
    });
    await expect(getNode(quickNote.occurrenceId)).resolves.toMatchObject({
      entityMeta: { schemaIds: [animeContextSchema.nodeId, quickImpressionSchema.nodeId] },
    });
    await expect(getNode(reviewNote.occurrenceId)).resolves.toMatchObject({
      entityMeta: { schemaIds: [animeContextSchema.nodeId, reviewSchema.nodeId] },
    });

    await expect(
      readSingleTextValue(frierenWork.occurrenceId, animeWorkFields.title.nodeId),
    ).resolves.toBe("葬送的芙莉莲");
    await expect(
      readSingleRefValue(frieren.occurrenceId, characterFields.fromWork.nodeId),
    ).resolves.toBe(frierenWork.nodeId);
    await expect(
      readSingleRefValue(himmel.occurrenceId, characterFields.fromWork.nodeId),
    ).resolves.toBe(frierenWork.nodeId);
    await expect(
      readSingleRefValue(quickNote.occurrenceId, animeContextFields.work.nodeId),
    ).resolves.toBe(frierenWork.nodeId);
    await expect(
      readSingleTextValue(quickNote.occurrenceId, animeContextFields.scene.nodeId),
    ).resolves.toBe("断头台阿乌拉");
    await expect(
      readSingleTextValue(quickNote.occurrenceId, quickImpressionFields.mood.nodeId),
    ).resolves.toBe("爽");
    await expect(
      readSingleTextValue(reviewNote.occurrenceId, reviewFields.overallImpression.nodeId),
    ).resolves.toBe("温柔、克制，后劲很足");
  });
});
