import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultExchangeEndpoint, DesktopPeerTransport, startDaemon, type Daemon } from "@lode/daemon";
import { createEngine, NodePersistenceBackend } from "@lode/engine/host";
import { afterEach, describe, expect, it } from "vitest";

import { createDesktopClient } from "@lode/desktop-client";
import { runDiagnosticCli } from "../../src/diagnostics/index.js";
import { animeNotesProgram, reviewApplicationProposal } from "./anime-notes-fixture.js";

const workspaceId = "anime-notes";
const outlineWorkspaceId = "outline-product";
const workspaceTrashNodeId = (id: string) => `workspace-trash:v1:${id}`;
const workspaceTrashOccurrenceId = (id: string) => `workspace-trash-occ:v1:${id}`;
const workspaceSchemaNodeId = (id: string) => `workspace-schema:v1:${id}`;
const systemDefinitionCatalogNodeId = "system-definition-catalog:v1";
const systemDefinitionNodeIds = [
  systemDefinitionCatalogNodeId,
  "system-field-datatypes:v1",
  "system-field-datatype:v1:plain",
  "system-field-datatype:v1:options",
  "system-field-datatype:v1:options-from-supertag",
  "system-field-datatype:v1:number",
  "system-field-datatype:v1:checkbox",
  "system-field-datatype:v1:date",
  "system-checkbox-value:v1:yes",
  "system-checkbox-value:v1:no",
  "system-field-cardinalities:v1",
  "system-field-cardinality:v1:single",
  "system-field-cardinality:v1:list",
  "system-field-optionalities:v1",
  "system-field-optionality:v1:yes",
  "system-field-optionality:v1:no",
  "system-field-configuration-definitions:v1",
  "system-field-configuration-definition:v1:datatype",
  "system-field-configuration-definition:v1:cardinality",
  "system-field-configuration-definition:v1:optionality",
  "system-field-configuration-definition:v1:initialization-expression",
  "system-field-definition:v1:node-supertags",
  "system-field-definition:v1:node-views",
  "system-field-definition:v1:optional-fields",
  "system-field-definition:v1:search-expression",
  "system-field-definition:v1:url",
  "system-field-definition:v1:code-block-language",
  "system-field-definition:v1:view-sort-order",
  "system-field-definition:v1:view-sort-field",
  "system-view-sort-value:v1:node-name",
  "system-view-sort-value:v1:ascending",
] as const;
const accessToken = "anime-notes-transport-access-token";
const vaultPassphrase = "anime-notes-vault-passphrase";
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
/** The Actor whose key signs writes on the home under test. */
let actingActorId = "";
const temporaryDirectories: string[] = [];

async function startTestDaemon(options: Readonly<{ listen: string; dataRoot: string; accessToken: string }>) {
  const peerTransport = new DesktopPeerTransport(defaultExchangeEndpoint(options.listen));
  const engine = createEngine({
    persistence: new NodePersistenceBackend(options.dataRoot),
    peerTransport,
  });
  await engine.start();
  const daemon = await startDaemon({
    engine,
    listen: options.listen,
    exchangeAddress: peerTransport.address,
    accessToken: options.accessToken,
    status: { homeName: "test", daemonVersion: "test", homePath: options.dataRoot },
  });
  return daemon;
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Anime Notes through the public CLI and daemon", () => {
  it("preserves the legacy structured transport for one connected knowledge graph", async () => {
    const leftRoot = await temporaryDirectory("left");
    const rightRoot = await temporaryDirectory("right");
    let left = await startTestDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: leftRoot,
      accessToken,
    });
    let right: Daemon | null = null;
    try {
      const leftActor = await createFor(left.address, workspaceId, "Anime Notes");
      await executeProgram(left.address, "build-anime-notes", animeNotesProgram());
      await expectAnimeNotes(left.address, "initial publication");

      await left.stop();
      left = await startTestDaemon({
        listen: "tcp://127.0.0.1:0",
        dataRoot: leftRoot,
        accessToken,
      });
      await unlockVaultOn(left.address);
      await expectAnimeNotes(left.address, "daemon restart");

      await execute(left.address, "propose-review-application", "proposal", reviewApplicationProposal());
      expect(await supertagInstancesResult(left.address, "review", "origin")).toEqual(["review-note"]);
      expect(await supertagInstancesResult(left.address, "review", "review")).toEqual(["quick-note", "review-note"]);
      const applicationHunk = await reviewHunk(left.address, "supertag-application");
      const applicationEvidence = evidence(applicationHunk);
      const relationEffect = array(applicationEvidence.effects, "Application effects")
        .map((effect) => record(effect, "Application effect"))
        .find((effect) => effect.kind === "supertag-relation");
      expect(relationEffect).toMatchObject({
        kind: "supertag-relation",
        relation: "application",
        ownerId: "quick-note",
        targetId: "quick-note-review-application",
      });
      expect(array(applicationEvidence.associatedImpactIds, "Application impacts")).toContain(
        "supertag-application/quick-note/quick-note-review-application",
      );
      await resolve(left.address, "reject-review-application", "reject", applicationHunk.selection);
      expect(await supertagApplications(left.address, "origin", "quick-note")).toEqual([
        "quick-impression",
        "anime-context",
      ]);

      right = await startTestDaemon({
        listen: "tcp://127.0.0.1:0",
        dataRoot: rightRoot,
        accessToken,
      });
      await joinIntoWorkspace(left, leftActor, right, workspaceId);
      await projectionMap(right.address, "origin", "nodes");
      await sync(left, right, workspaceId);
      await expectAnimeNotes(right.address, "peer synchronization");
    } finally {
      await left.stop();
      await right?.stop();
    }
  }, 15_000);

  it("runs an authenticated Workspace-rooted outline on two fresh machines in both directions", async () => {
    const leftRoot = await temporaryDirectory("outline-left");
    const rightRoot = await temporaryDirectory("outline-right");
    let left = await startTestDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: leftRoot,
      accessToken,
    });
    let right: Daemon | null = null;
    try {
      const leftActor = await createFor(left.address, outlineWorkspaceId, "Outline Product");
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
        workspaceTrashOccurrenceId(outlineWorkspaceId),
        "outline-root-occurrence",
      ]);
      const extraRoot = await cliRequest("execute", left.address, {
        kind: "mutate",
        workspaceId: outlineWorkspaceId,
        invocationId: "create-extra-root-occurrence",
        actorId: actingActorId,
        intent: "direct",
        historyChannelId: "outline",
        mutations: [nodeAt("extra-root", outlineWorkspaceId, "extra-root-occurrence")],
      });
      expect(extraRoot).toMatchObject({ status: "published" });
      expect(await outlineChildren(left.address, outlineWorkspaceId)).toEqual([
        workspaceTrashOccurrenceId(outlineWorkspaceId),
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
      expect(record((await nodeAtomsInWorkspace(left.address, "alpha"))[0], "Marked atom")).toMatchObject({
        attributes: { bold: true },
      });

      await left.stop();
      left = await startTestDaemon({
        listen: "tcp://127.0.0.1:0",
        dataRoot: leftRoot,
        accessToken,
      });
      await unlockVaultOn(left.address);
      expect(new Set(Object.keys(await outlineProjection(left.address, "nodes")))).toEqual(
        new Set([
          "alpha",
          "beta",
          "discarded",
          "extra-root",
          outlineWorkspaceId,
          "outline-root",
          workspaceTrashNodeId(outlineWorkspaceId),
          workspaceSchemaNodeId(outlineWorkspaceId),
          ...systemDefinitionNodeIds,
        ]),
      );
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

      right = await startTestDaemon({
        listen: "tcp://127.0.0.1:0",
        dataRoot: rightRoot,
        accessToken,
      });
      await joinIntoWorkspace(left, leftActor, right, outlineWorkspaceId);
      await outlineProjection(right.address, "nodes");
      await sync(left, right, outlineWorkspaceId);
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
      await sync(right, left, outlineWorkspaceId);
      expect(await nodeTextInWorkspace(left.address, "alpha")).toBe("Alpha from right");
      expect(await occurrenceNodeInWorkspace(left.address, "alpha-reference")).toBe("alpha");

      actingActorId = leftActor;
      await executeOutline(left.address, "delete-outline-child", [
        {
          kind: "occurrence-delete",
          occurrenceId: "discarded-occurrence",
        },
      ]);
      expect((await outlineProjection(left.address, "occurrences"))["discarded-occurrence"]).toMatchObject({
        nodeId: "discarded",
        parentNodeId: workspaceTrashNodeId(outlineWorkspaceId),
      });

      await createFor(left.address, "isolated-workspace", "Isolated");
      void leftActor;
      const isolated = await query(left.address, {
        kind: "projection",
        workspaceId: "isolated-workspace",
        perspective: "origin",
        section: "nodes",
      });
      const isolatedNodes = record(isolated.nodes, "Isolated workspace Nodes");
      expect(new Set(Object.keys(isolatedNodes))).toEqual(
        new Set([
          "isolated-workspace",
          workspaceTrashNodeId("isolated-workspace"),
          workspaceSchemaNodeId("isolated-workspace"),
          ...systemDefinitionNodeIds,
        ]),
      );
      expect(record(isolatedNodes["isolated-workspace"], "Isolated Workspace Node").nodeId).toBe("isolated-workspace");
    } finally {
      await left.stop();
      await right?.stop();
    }
  });
});

async function createFor(endpoint: string, targetWorkspaceId: string, name: string): Promise<string> {
  const client = createDesktopClient(endpoint, accessToken);
  try {
    const actor = await client.createActor({ label: `${name} Owner`, passphrase: vaultPassphrase });
    await client.createWorkspace(targetWorkspaceId, name, actor.actorId);
    actingActorId = actor.actorId;
    return actor.actorId;
  } finally {
    client.close();
  }
}

/** A restart locks the vault again; writes still need the Actor key. */
async function unlockVaultOn(endpoint: string): Promise<void> {
  const client = createDesktopClient(endpoint, accessToken);
  try {
    await client.unlockVault(vaultPassphrase);
  } finally {
    client.close();
  }
}

/** The product admission-and-adoption flow: the joiner's own Actor, admitted
 * by the member, adopts the remote journal instead of forging a second
 * genesis for the same id. */
async function joinIntoWorkspace(
  member: Daemon,
  memberActorId: string,
  joiner: Daemon,
  targetWorkspaceId: string,
): Promise<string> {
  const joinerClient = createDesktopClient(joiner.address, accessToken);
  const memberClient = createDesktopClient(member.address, accessToken);
  try {
    const joinerActor = await joinerClient.createActor({ label: "Joiner", passphrase: vaultPassphrase });
    const material = await joinerClient.peerMaterial();
    await memberClient.admitActor({
      workspaceId: targetWorkspaceId,
      actingActorId: memberActorId,
      actorId: joinerActor.actorId,
    });
    await memberClient.admitPeer({
      workspaceId: targetWorkspaceId,
      actingActorId: memberActorId,
      peerId: material.peerId,
      peerKxPublicKey: material.peerKxPublicKey,
    });
    const adopted = await joinerClient.adoptWorkspace(member.exchangeAddress, targetWorkspaceId);
    expect(adopted.workspaceId).toBe(targetWorkspaceId);
    actingActorId = joinerActor.actorId;
    return joinerActor.actorId;
  } finally {
    joinerClient.close();
    memberClient.close();
  }
}

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string) {
  return { kind: "node-create", nodeId, parentNodeId, occurrenceId, anchor: end };
}

async function executeOutline(endpoint: string, invocationId: string, mutations: readonly unknown[]): Promise<void> {
  for (const [index, mutation] of mutations.entries()) {
    const result = await cliRequest("execute", endpoint, {
      kind: "mutate",
      workspaceId: outlineWorkspaceId,
      invocationId: `${invocationId}-${index}`,
      actorId: actingActorId,
      intent: "direct",
      historyChannelId: "outline",
      mutations: [mutation],
    });
    if (result.status !== "published") {
      throw new Error(`Outline mutation ${index} ${JSON.stringify(mutation)} failed: ${JSON.stringify(result)}`);
    }
    expect(result.status).toBe("published");
  }
}

async function sync(local: Daemon, remote: Daemon, targetWorkspaceId: string): Promise<void> {
  // Low-level transport regression: the Fact exchange itself, not the product sync family.
  const client = createDesktopClient(local.address, accessToken);
  try {
    await client.syncWorkspace(targetWorkspaceId, remote.exchangeAddress);
  } finally {
    client.close();
  }
}

async function outlineProjection(endpoint: string, section: string): Promise<Record<string, unknown>> {
  const collected: Record<string, unknown> = {};
  let after: unknown = null;
  do {
    const value = await query(endpoint, {
      kind: "projection",
      workspaceId: outlineWorkspaceId,
      perspective: "origin",
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
  const childOccurrences = await outlineProjection(endpoint, "childOccurrences");
  return array(
    childOccurrences[parentNodeId],
    `Child Occurrences for ${parentNodeId} in ${JSON.stringify(childOccurrences)}`,
  );
}

async function nodeAtomsInWorkspace(endpoint: string, nodeId: string): Promise<unknown[]> {
  return textItems(record((await outlineProjection(endpoint, "nodes"))[nodeId], `Node ${nodeId}`));
}

async function nodeTextInWorkspace(endpoint: string, nodeId: string): Promise<string> {
  return (await nodeAtomsInWorkspace(endpoint, nodeId)).map((atom) => record(atom, "Text atom").value).join("");
}

async function occurrenceNodeInWorkspace(endpoint: string, occurrenceId: string): Promise<unknown> {
  return record((await outlineProjection(endpoint, "occurrences"))[occurrenceId], `Occurrence ${occurrenceId}`).nodeId;
}

async function expectAnimeNotes(endpoint: string, stage: string): Promise<void> {
  expect(await outlineNodeIds(endpoint, workspaceId)).toEqual([workspaceTrashNodeId(workspaceId), "root"]);
  expect(await outlineNodeIds(endpoint, "root")).toEqual(["definition-library", "library", "notes"]);
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
  const frierenAtoms = textItems(record(frierenNodes.frieren, "Frieren Node"));
  expect(
    frierenAtoms.map((atom) => record(atom, "Frieren atom").id),
    `${stage} atom identities`,
  ).toEqual([...new Set(frierenAtoms.map((atom) => record(atom, "Frieren atom").id))]);
  expect(await nodeText(endpoint, "origin", "frieren"), stage).toBe("Frieren: Beyond Journey's End");
  expect(await nodeText(endpoint, "origin", "impression-text")).toBe("Quiet, patient, and humane");
  expect(await supertagApplications(endpoint, "origin", "quick-note")).toEqual(["quick-impression", "anime-context"]);
  expect(await supertagInstancesResult(endpoint, "quick-impression")).toEqual(["quick-note"]);
  expect(await supertagInstancesResult(endpoint, "anime-context")).toEqual(["quick-note"]);
  expect(await supertagInstancesResult(endpoint, "anime-work")).toEqual(["frieren"]);
  expect(await materializedFieldDefinitions(endpoint, "origin", "quick-note")).toEqual(
    expect.arrayContaining(["work-field", "impression-field"]),
  );
  expect(await occurrenceNode(endpoint, "quick-work-reference")).toBe("frieren");
}

async function outlineNodeIds(endpoint: string, parentNodeId: string): Promise<unknown[]> {
  const childOccurrences = await projectionMap(endpoint, "origin", "childOccurrences");
  const occurrences = await projectionMap(endpoint, "origin", "occurrences");
  return array(childOccurrences[parentNodeId], `Child Occurrences of ${parentNodeId}`).map(
    (occurrenceId) => record(occurrences[String(occurrenceId)], `Occurrence ${String(occurrenceId)}`).nodeId,
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
    actorId: actingActorId,
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
    actorId: actingActorId,
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

async function nodeText(endpoint: string, perspective: string, nodeId: string): Promise<string> {
  const nodes = await projectionMap(endpoint, perspective, "nodes");
  const node = record(nodes[nodeId], `Node ${nodeId}`);
  return textItems(node)
    .map((atom) => record(atom, "Text atom").value)
    .join("");
}

function textItems(node: Record<string, unknown>): unknown[] {
  return array(node.content, "Node content").filter((item) => record(item, "Node content item").kind === "text");
}

async function occurrenceNode(endpoint: string, occurrenceId: string): Promise<unknown> {
  const occurrences = await projectionMap(endpoint, "origin", "occurrences");
  return record(occurrences[occurrenceId], `Occurrence ${occurrenceId}`).nodeId;
}

async function supertagApplications(endpoint: string, perspective: string, nodeId: string): Promise<unknown[]> {
  return array((await projectionMap(endpoint, perspective, "supertagApplications"))[nodeId], "Supertags").map(
    (application) => record(application, "Supertag Application").supertagId,
  );
}

async function supertagInstancesResult(
  endpoint: string,
  supertagId: string,
  perspective = "origin",
): Promise<unknown[]> {
  const value = await query(endpoint, {
    kind: "supertag-instances",
    workspaceId,
    perspective,
    supertagId,
    limit: 10,
  });
  expect(value.next).toBeNull();
  return array(value.nodeIds, "Supertag search result");
}

async function materializedFieldDefinitions(endpoint: string, perspective: string, nodeId: string): Promise<unknown[]> {
  const values = await projectionMap(endpoint, perspective, "materializedFields");
  return array(values[nodeId] ?? [], "Materialized Fields").map(
    (field) => record(field, "Materialized Field").fieldDefinitionId,
  );
}

async function projectionMap(endpoint: string, perspective: string, section: string): Promise<Record<string, unknown>> {
  const value = await query(endpoint, { kind: "projection", workspaceId, perspective, section });
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
  await runDiagnosticCli([operation, endpoint, JSON.stringify(request), "--access-token", accessToken], (text) => {
    output += text;
  });
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
