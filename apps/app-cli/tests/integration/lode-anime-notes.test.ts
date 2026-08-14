import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startAppServerDaemon, type AppServerDaemon } from "@lode/daemon";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli.js";
import {
  animeNotesProgram,
  moodProposal,
  pendingMoodEdit,
  reviewApplicationProposal,
} from "./anime-notes-fixture.js";

const workspaceId = "anime-notes";
const outlineWorkspaceId = "outline-product";
const accessToken = "anime-notes-transport-access-token";
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Anime Notes through the public CLI and daemon", () => {
  it("persists, reviews, restarts, and synchronizes one connected knowledge graph", async () => {
    const leftRoot = await temporaryDirectory("left");
    const rightRoot = await temporaryDirectory("right");
    let left = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: leftRoot,
      accessToken,
    });
    let right: AppServerDaemon | null = null;
    try {
      await executeProgram(left.address, "build-anime-notes", animeNotesProgram());
      await expectAnimeNotes(left.address, "initial publication");

      await left.stop();
      left = await startAppServerDaemon({
        listen: "tcp://127.0.0.1:0",
        dataRoot: leftRoot,
        accessToken,
      });
      await expectAnimeNotes(left.address, "daemon restart");

      await execute(left.address, "propose-mood-field", "proposal", moodProposal());
      await execute(left.address, "edit-pending-mood-field", "direct", pendingMoodEdit());
      expect(
        await materializedFieldDefinitions(left.address, "origin", "quick-note"),
      ).not.toContain("mood-field");
      expect(await materializedFieldDefinitions(left.address, "review", "quick-note")).toContain(
        "mood-field",
      );
      const templateHunk = await reviewHunk(left.address, "schema-template");
      const templateEvidence = evidence(templateHunk);
      expect(templateEvidence.supportClosure).toHaveLength(7);
      expect(array(templateEvidence.effects, "Template effects")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "schema-relation",
            relation: "field",
            ownerId: "quick-impression",
            targetId: "mood-field",
          }),
        ]),
      );
      const templateImpacts = array(templateEvidence.associatedImpactIds, "Template impacts");
      expect(templateImpacts).toContain("sschema-field/squick-impression/smood-field");
      expect(
        templateImpacts.some(
          (impact) =>
            typeof impact === "string" &&
            impact.startsWith("seffective-field/squick-note/smood-field/"),
        ),
      ).toBe(true);
      await resolve(left.address, "accept-mood-field", "accept", templateHunk.selection);
      expect(await materializedFieldDefinitions(left.address, "origin", "quick-note")).toContain(
        "mood-field",
      );
      expect(await nodeText(left.address, "origin", "mood-text")).toBe("Reflective");

      await execute(
        left.address,
        "propose-review-application",
        "proposal",
        reviewApplicationProposal(),
      );
      expect(await schemaSearchResult(left.address, "review", "origin")).toEqual(["review-note"]);
      expect(await schemaSearchResult(left.address, "review", "review")).toEqual([
        "quick-note",
        "review-note",
      ]);
      expect(await viewNodeIds(left.address, "review-view", "origin")).toEqual(["review-note"]);
      expect(await viewNodeIds(left.address, "review-view", "review")).toEqual([
        "quick-note",
        "review-note",
      ]);
      const applicationHunk = await reviewHunk(left.address, "schema-application");
      const applicationEvidence = evidence(applicationHunk);
      expect(array(applicationEvidence.effects, "Application effects")).toEqual([
        expect.objectContaining({
          kind: "schema-relation",
          relation: "application",
          ownerId: "quick-note",
          targetId: "review",
        }),
      ]);
      expect(array(applicationEvidence.associatedImpactIds, "Application impacts")).toContain(
        "sschema-application/squick-note/sreview",
      );
      await resolve(left.address, "reject-review-application", "reject", applicationHunk.selection);
      expect(await schemaApplications(left.address, "origin", "quick-note")).toEqual([
        "quick-impression",
        "anime-context",
      ]);

      right = await startAppServerDaemon({
        listen: "tcp://127.0.0.1:0",
        dataRoot: rightRoot,
        accessToken,
      });
      await projectionMap(right.address, "origin", "nodes");
      await runCli([
        "sync",
        left.address,
        workspaceId,
        right.address,
        "--access-token",
        accessToken,
      ]);
      await expectAnimeNotes(right.address, "peer synchronization", true);
      expect(await materializedFieldDefinitions(right.address, "origin", "quick-note")).toContain(
        "mood-field",
      );
      expect(await nodeText(right.address, "origin", "mood-text")).toBe("Reflective");
    } finally {
      await left.stop();
      await right?.stop();
    }
  }, 15_000);

  it("runs an authenticated Workspace-rooted outline on two fresh machines in both directions", async () => {
    const leftRoot = await temporaryDirectory("outline-left");
    const rightRoot = await temporaryDirectory("outline-right");
    let left = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: leftRoot,
      accessToken,
    });
    let right: AppServerDaemon | null = null;
    try {
      await executeOutline(left.address, "create-outline", [
        nodeAt("outline-root", outlineWorkspaceId, "outline-root-occurrence"),
        nodeAt("alpha", "outline-root", "alpha-occurrence"),
        {
          kind: "text-splice",
          nodeId: "alpha",
          deleteAtomIds: [],
          anchor: end,
          insert: "Alpha",
        },
        nodeAt("beta", "outline-root", "beta-occurrence"),
        {
          kind: "text-splice",
          nodeId: "beta",
          deleteAtomIds: [],
          anchor: end,
          insert: "Beta",
        },
        {
          kind: "occurrence-create",
          occurrenceId: "alpha-reference",
          nodeId: "alpha",
          parentNodeId: "beta",
          anchor: end,
        },
        nodeAt("discarded", "outline-root", "discarded-occurrence"),
      ]);

      expect(await outlineChildren(left.address, outlineWorkspaceId)).toEqual([
        "outline-root-occurrence",
      ]);
      const extraRoot = await cliRequest("execute", left.address, {
        kind: "mutate",
        workspaceId: outlineWorkspaceId,
        invocationId: "create-extra-root-occurrence",
        actorId: "outline-user",
        intent: "direct",
        historyChannelId: "outline",
        mutations: [nodeAt("extra-root", outlineWorkspaceId, "extra-root-occurrence")],
      });
      expect(extraRoot).toMatchObject({ status: "published" });
      expect(await outlineChildren(left.address, outlineWorkspaceId)).toEqual([
        "outline-root-occurrence",
        "extra-root-occurrence",
      ]);
      expect(await outlineChildren(left.address, "outline-root")).toEqual([
        "alpha-occurrence",
        "beta-occurrence",
        "discarded-occurrence",
      ]);
      expect(await occurrenceNodeInWorkspace(left.address, "alpha-reference")).toBe("alpha");

      const alphaAtoms = await nodeAtomsInWorkspace(left.address, "alpha");
      await executeOutline(left.address, "mark-and-reorder", [
        {
          kind: "text-mark",
          nodeId: "alpha",
          atomIds: [record(alphaAtoms[0], "Alpha atom").id],
          key: "bold",
          value: { kind: "set", value: true },
        },
        {
          kind: "occurrence-move",
          occurrenceId: "beta-occurrence",
          parentNodeId: "outline-root",
          anchor: {
            after: null,
            before: "alpha-occurrence",
            affinity: "before",
            fallback: "start",
          },
        },
      ]);
      expect(await outlineChildren(left.address, "outline-root")).toEqual([
        "beta-occurrence",
        "alpha-occurrence",
        "discarded-occurrence",
      ]);
      expect(
        record((await nodeAtomsInWorkspace(left.address, "alpha"))[0], "Marked atom"),
      ).toMatchObject({
        attributes: { bold: true },
      });

      await left.stop();
      left = await startAppServerDaemon({
        listen: "tcp://127.0.0.1:0",
        dataRoot: leftRoot,
        accessToken,
      });
      expect(Object.keys(await outlineProjection(left.address, "nodes"))).toEqual([
        "alpha",
        "beta",
        "discarded",
        "extra-root",
        outlineWorkspaceId,
        "outline-root",
      ]);
      const restartedOccurrences = await outlineProjection(left.address, "occurrences");
      expect(restartedOccurrences).toMatchObject({
        "alpha-occurrence": { nodeId: "alpha" },
        "beta-occurrence": { nodeId: "beta" },
      });
      expect(await outlineChildren(left.address, "outline-root")).toEqual([
        "beta-occurrence",
        "alpha-occurrence",
        "discarded-occurrence",
      ]);

      right = await startAppServerDaemon({
        listen: "tcp://127.0.0.1:0",
        dataRoot: rightRoot,
        accessToken,
      });
      await outlineProjection(right.address, "nodes");
      await sync(left.address, right.address, outlineWorkspaceId);
      expect(await nodeTextInWorkspace(right.address, "alpha")).toBe("Alpha");
      expect(await occurrenceNodeInWorkspace(right.address, "alpha-reference")).toBe("alpha");

      const rightAtoms = await nodeAtomsInWorkspace(right.address, "alpha");
      const lastAtomId = record(rightAtoms.at(-1), "Last Alpha atom").id;
      await executeOutline(right.address, "edit-from-right", [
        {
          kind: "text-splice",
          nodeId: "alpha",
          deleteAtomIds: [],
          anchor: { after: lastAtomId, before: null, affinity: "after", fallback: "end" },
          insert: " from right",
        },
      ]);
      await sync(right.address, left.address, outlineWorkspaceId);
      expect(await nodeTextInWorkspace(left.address, "alpha")).toBe("Alpha from right");
      expect(await occurrenceNodeInWorkspace(left.address, "alpha-reference")).toBe("alpha");

      await executeOutline(left.address, "delete-outline-child", [
        {
          kind: "occurrence-delete",
          occurrenceId: "discarded-occurrence",
        },
      ]);
      expect(
        (await outlineProjection(left.address, "occurrences"))["discarded-occurrence"],
      ).toBeUndefined();

      const isolated = await query(left.address, {
        kind: "projection",
        workspaceId: "isolated-workspace",
        view: "origin",
        section: "nodes",
      });
      const isolatedNodes = record(isolated.nodes, "Isolated workspace Nodes");
      expect(Object.keys(isolatedNodes)).toEqual(["isolated-workspace"]);
      expect(record(isolatedNodes["isolated-workspace"], "Isolated Workspace Node").nodeId).toBe(
        "isolated-workspace",
      );
    } finally {
      await left.stop();
      await right?.stop();
    }
  });
});

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string) {
  return { kind: "node-create", nodeId, parentNodeId, occurrenceId, anchor: end };
}

async function executeOutline(
  endpoint: string,
  invocationId: string,
  mutations: readonly unknown[],
): Promise<void> {
  for (const [index, mutation] of mutations.entries()) {
    const result = await cliRequest("execute", endpoint, {
      kind: "mutate",
      workspaceId: outlineWorkspaceId,
      invocationId: `${invocationId}-${index}`,
      actorId: "outline-user",
      intent: "direct",
      historyChannelId: "outline",
      mutations: [mutation],
    });
    if (result.status !== "published") {
      throw new Error(
        `Outline mutation ${index} ${JSON.stringify(mutation)} failed: ${JSON.stringify(result)}`,
      );
    }
    expect(result.status).toBe("published");
  }
}

async function sync(
  endpoint: string,
  remoteEndpoint: string,
  targetWorkspaceId: string,
): Promise<void> {
  await runCli([
    "sync",
    endpoint,
    targetWorkspaceId,
    remoteEndpoint,
    "--access-token",
    accessToken,
  ]);
}

async function outlineProjection(
  endpoint: string,
  section: string,
): Promise<Record<string, unknown>> {
  const collected: Record<string, unknown> = {};
  let after: unknown = null;
  do {
    const value = await query(endpoint, {
      kind: "projection",
      workspaceId: outlineWorkspaceId,
      view: "origin",
      section,
      after,
      limit: 100,
    });
    Object.assign(collected, record(value[section], `${section} Projection`));
    after = value.next;
  } while (typeof after === "string");
  return collected;
}

async function outlineChildren(endpoint: string, parentNodeId: string): Promise<unknown[]> {
  const children = await outlineProjection(endpoint, "children");
  return array(
    children[parentNodeId],
    `Children for ${parentNodeId} in ${JSON.stringify(children)}`,
  );
}

async function nodeAtomsInWorkspace(endpoint: string, nodeId: string): Promise<unknown[]> {
  return array(
    record((await outlineProjection(endpoint, "nodes"))[nodeId], `Node ${nodeId}`).text,
    "Node text",
  );
}

async function nodeTextInWorkspace(endpoint: string, nodeId: string): Promise<string> {
  return (await nodeAtomsInWorkspace(endpoint, nodeId))
    .map((atom) => record(atom, "Text atom").value)
    .join("");
}

async function occurrenceNodeInWorkspace(endpoint: string, occurrenceId: string): Promise<unknown> {
  return record(
    (await outlineProjection(endpoint, "occurrences"))[occurrenceId],
    `Occurrence ${occurrenceId}`,
  ).nodeId;
}

async function expectAnimeNotes(
  endpoint: string,
  stage: string,
  includesMoodField = false,
): Promise<void> {
  expect(await outlineNodeIds(endpoint, workspaceId)).toEqual(["root"]);
  expect(await outlineNodeIds(endpoint, "root")).toEqual([
    "definition-library",
    "library",
    "notes",
  ]);
  expect(await outlineNodeIds(endpoint, "definition-library")).toEqual([
    "anime-work",
    "character",
    "anime-context",
    "quick-impression",
    "review",
    "title-field",
    "work-field",
    "context-field",
    "impression-field",
    "rating-field",
    "review-view",
    ...(includesMoodField ? ["mood-field"] : []),
  ]);
  expect(await outlineNodeIds(endpoint, "library")).toEqual(["frieren", "fern"]);
  expect(await outlineNodeIds(endpoint, "notes")).toEqual(["quick-note", "review-note"]);
  const owners = await projectionMap(endpoint, "origin", "nodeOwners");
  expect(owners).toMatchObject({
    root: workspaceId,
    frieren: "library",
    "quick-note": "notes",
    "review-note": "notes",
  });
  const frierenNodes = await projectionMap(endpoint, "origin", "nodes");
  const frierenAtoms = array(record(frierenNodes.frieren, "Frieren Node").text, "Frieren text");
  expect(
    frierenAtoms.map((atom) => record(atom, "Frieren atom").id),
    `${stage} atom identities`,
  ).toEqual([...new Set(frierenAtoms.map((atom) => record(atom, "Frieren atom").id))]);
  expect(await nodeText(endpoint, "origin", "frieren"), stage).toBe(
    "Frieren: Beyond Journey's End",
  );
  expect(await nodeText(endpoint, "origin", "impression-text")).toBe("Quiet, patient, and humane");
  expect(await schemaApplications(endpoint, "origin", "quick-note")).toEqual([
    "quick-impression",
    "anime-context",
  ]);
  expect(await schemaSearchResult(endpoint, "quick-impression")).toEqual(["quick-note"]);
  expect(await schemaSearchResult(endpoint, "anime-context")).toEqual(["quick-note"]);
  expect(await schemaSearchResult(endpoint, "anime-work")).toEqual(["frieren"]);
  expect(await materializedFieldDefinitions(endpoint, "origin", "quick-note")).toEqual(
    expect.arrayContaining(["work-field", "impression-field"]),
  );
  expect(await occurrenceNode(endpoint, "quick-work-reference")).toBe("frieren");
  const reviewView = await viewResult(endpoint, "review-view");
  expect(reviewView.layout).toBe("table");
  expect(array(reviewView.fieldDefinitionIds, "View columns")).toEqual([
    "work-field",
    "rating-field",
  ]);
  const reviewRow = record(array(reviewView.rows, "View rows")[0], "Review View row");
  expect(reviewRow.nodeId).toBe("review-note");
  const cells = array(reviewRow.fields, "View cells").map((cell) => record(cell, "View cell"));
  expect(record(cells[0], "Work cell").valueNodeIds).toEqual(["frieren"]);
  expect(record(cells[1], "Rating cell").valueNodeIds).toEqual(["rating-text"]);
}

async function outlineNodeIds(endpoint: string, parentNodeId: string): Promise<unknown[]> {
  const children = await projectionMap(endpoint, "origin", "children");
  const occurrences = await projectionMap(endpoint, "origin", "occurrences");
  return array(children[parentNodeId], `Children of ${parentNodeId}`).map(
    (occurrenceId) =>
      record(occurrences[String(occurrenceId)], `Occurrence ${String(occurrenceId)}`).nodeId,
  );
}

async function execute(
  endpoint: string,
  invocationId: string,
  intent: "direct" | "proposal",
  mutations: readonly unknown[],
): Promise<void> {
  const result = await cliRequest("execute", endpoint, {
    kind: "mutate",
    workspaceId,
    invocationId,
    actorId: "anime-notes-user",
    intent,
    historyChannelId: "anime-notes",
    mutations,
  });
  if (result.status !== "published") {
    throw new Error(JSON.stringify(result));
  }
  expect(result.status).toBe("published");
}

async function executeProgram(
  endpoint: string,
  invocationPrefix: string,
  mutations: readonly unknown[],
): Promise<void> {
  const batchSize = 20;
  for (let index = 0; index < mutations.length; index += batchSize) {
    await execute(
      endpoint,
      `${invocationPrefix}-${index / batchSize}`,
      "direct",
      mutations.slice(index, index + batchSize),
    );
  }
}

async function resolve(
  endpoint: string,
  invocationId: string,
  decision: "accept" | "reject",
  selection: unknown,
): Promise<void> {
  const result = await cliRequest("execute", endpoint, {
    kind: "resolve-review",
    workspaceId,
    invocationId,
    actorId: "anime-notes-reviewer",
    decision,
    selection,
  });
  expect(result.status).toBe("published");
}

async function reviewHunk(endpoint: string, kind: string): Promise<Record<string, unknown>> {
  const value = await query(endpoint, { kind: "review", workspaceId });
  const hunks = array(value.hunks, "Review hunks").map((item) => record(item, "Review hunk"));
  const hunk = hunks.find((candidate) => record(candidate.diffSpace, "Diff space").kind === kind);
  if (!hunk) {
    throw new Error(`Missing ${kind} Review hunk`);
  }
  return hunk;
}

function evidence(hunk: Record<string, unknown>): Record<string, unknown> {
  return record(record(hunk.selection, "Review selection").evidence, "Review evidence");
}

async function nodeText(endpoint: string, view: string, nodeId: string): Promise<string> {
  const nodes = await projectionMap(endpoint, view, "nodes");
  const node = record(nodes[nodeId], `Node ${nodeId}`);
  return array(node.text, "Node text")
    .map((atom) => record(atom, "Text atom").value)
    .join("");
}

async function occurrenceNode(endpoint: string, occurrenceId: string): Promise<unknown> {
  const occurrences = await projectionMap(endpoint, "origin", "occurrences");
  return record(occurrences[occurrenceId], `Occurrence ${occurrenceId}`).nodeId;
}

async function schemaApplications(
  endpoint: string,
  view: string,
  nodeId: string,
): Promise<unknown[]> {
  return array((await projectionMap(endpoint, view, "schemaApplications"))[nodeId], "Schemas");
}

async function schemaSearchResult(
  endpoint: string,
  schemaId: string,
  view = "origin",
): Promise<unknown[]> {
  const value = await query(endpoint, {
    kind: "schema-search",
    workspaceId,
    view,
    schemaId,
    limit: 10,
  });
  expect(value.next).toBeNull();
  return array(value.nodeIds, "Schema search result");
}

async function viewNodeIds(
  endpoint: string,
  viewNodeId: string,
  view = "origin",
): Promise<unknown[]> {
  return array((await viewResult(endpoint, viewNodeId, view)).rows, "View rows").map(
    (row) => record(row, "View row").nodeId,
  );
}

async function viewResult(
  endpoint: string,
  viewNodeId: string,
  view = "origin",
): Promise<Record<string, unknown>> {
  return query(endpoint, {
    kind: "view",
    workspaceId,
    view,
    viewNodeId,
    limit: 10,
  });
}

async function materializedFieldDefinitions(
  endpoint: string,
  view: string,
  nodeId: string,
): Promise<unknown[]> {
  const values = await projectionMap(endpoint, view, "materializedFields");
  return array(values[nodeId] ?? [], "Materialized Fields").map(
    (field) => record(field, "Materialized Field").fieldDefinitionId,
  );
}

async function projectionMap(
  endpoint: string,
  view: string,
  section: string,
): Promise<Record<string, unknown>> {
  const value = await query(endpoint, { kind: "projection", workspaceId, view, section });
  return record(value[section], `${section} Projection`);
}

async function query(endpoint: string, request: unknown): Promise<Record<string, unknown>> {
  const result = await cliRequest("query", endpoint, request);
  expect(result.status).toBe("ok");
  return record(result.value, "Query value");
}

async function cliRequest(
  operation: "execute" | "query",
  endpoint: string,
  request: unknown,
): Promise<Record<string, unknown>> {
  let output = "";
  await runCli(
    [operation, endpoint, JSON.stringify(request), "--access-token", accessToken],
    (text) => {
      output += text;
    },
  );
  return record(JSON.parse(output) as unknown, "CLI response");
}

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `lode-anime-notes-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not an array`);
  }
  return value;
}
