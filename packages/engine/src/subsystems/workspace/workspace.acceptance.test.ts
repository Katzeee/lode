import { describe, expect, it } from "vitest";

import type { EngineEvent, EditCommand } from "@lode/sdk";
import {
  canonicalJson,
  factActionId,
  factActionsFromFacts,
  factId,
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  workspaceTrashNodeId,
  type ProjectionPerspective,
  type SequenceAnchor,
} from "../../domain/fact/index.js";
import type { ReviewQuery } from "../../domain/review/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import type { DocumentStore, DocumentUpdate } from "../persistence/document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { FactReplication } from "./fact-replication.js";
import { syncPair } from "../../../tests/support/sync.js";
import { BoundedProjectionStore, type ProjectionSlicePage } from "./projection/index.js";
import { Workspace } from "./workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions, type ProjectionSectionName } from "../../domain/reconcile/index.js";
import type { EventSink } from "../event/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

function eventCollector(events: EngineEvent[]): EventSink {
  return { publish: (event) => events.push(event) };
}

function nodeAtWorkspace(nodeId: string) {
  return [nodeAt(nodeId, "workspace", `${nodeId}-original`)];
}

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string, anchor: SequenceAnchor = end) {
  return { kind: "node-create" as const, nodeId, occurrenceId, parentNodeId, anchor };
}

async function setup(
  store?: BoundedProjectionStore,
  documents: DocumentStore = new InMemoryDocumentStore(),
  eventSink?: EventSink,
) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId: "101",
    documents: documents,
  });
  return {
    facts,
    workspace: await Workspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      eventSink,
      projection: { ...(store ? { store } : {}) },
    }),
  };
}

async function setupReplica(documents: DocumentStore, loroPeerId: `${number}`, seedGenesis = true) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId,
    documents: documents,
  });
  return {
    facts,
    workspace: await Workspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      seedGenesis,
    }),
  };
}

function createNode(invocationId = "create", intent: "direct" | "proposal" = "direct"): EditCommand {
  return {
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "desktop",
    actions: [
      {
        kind: "node-create",
        occurrenceId: "node-original",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
    ],
  };
}

async function lifecycleExists(workspace: Workspace, owner: "node" | "occurrence", identity: string): Promise<boolean> {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: owner === "node" ? "nodes" : "occurrences",
    limit: 100,
  });
  return owner === "node"
    ? "nodes" in projection && projection.nodes[identity] !== undefined
    : "occurrences" in projection && projection.occurrences[identity] !== undefined;
}

async function boldValues(workspace: Workspace): Promise<readonly unknown[]> {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "nodes",
    limit: 100,
  });
  if (!("nodes" in projection)) {
    throw new Error("Expected Node projection");
  }
  return (
    projection.nodes.node?.content.filter((item) => item.kind === "text").map((atom) => atom.attributes.bold) ?? []
  );
}

async function expectUnsupportedDirect(workspace: Workspace, factActionId: string, actorId: string): Promise<void> {
  const conflicts = await workspace.query({
    kind: "conflicts",
    workspaceId: "workspace",
    limit: 10,
  });
  if (!("issues" in conflicts)) {
    throw new Error("Expected conflict query");
  }
  expect(conflicts.issues).toContainEqual(
    expect.objectContaining({
      kind: "unsupported-direct-intent",
      factActionId,
      actionKind: "rich-text-splice",
      actorId,
      recoveryActions: ["restore-support"],
    }),
  );
}

async function expectNoUnsupportedDirect(workspace: Workspace): Promise<void> {
  const conflicts = await workspace.query({
    kind: "conflicts",
    workspaceId: "workspace",
    limit: 10,
  });
  if (!("issues" in conflicts)) {
    throw new Error("Expected conflict query");
  }
  expect(conflicts.issues.some((issue) => issue.kind === "unsupported-direct-intent")).toBe(false);
}

async function projectedText(workspace: Workspace, nodeId: string): Promise<string> {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "nodes",
    limit: 100,
  });
  if (!("nodes" in projection)) {
    throw new Error("Expected Node projection");
  }
  return (
    projection.nodes[nodeId]?.content
      .filter((item) => item.kind === "text")
      .map((atom) => atom.value)
      .join("") ?? ""
  );
}

describe("Proposal Workspace coordinator", () => {
  it("queries and adjudicates concurrent opposite Resolutions through the public Engine contract", async () => {
    const documentsA = new InMemoryDocumentStore();
    const a = await setupReplica(documentsA, "201");
    const b = await setupReplica(new InMemoryDocumentStore(), "202", false);
    const c = await setupReplica(new InMemoryDocumentStore(), "203", false);
    expect(
      (
        await a.workspace.execute({
          kind: "edit",
          workspaceId: "workspace",
          invocationId: "propose-node",
          actorId: "author",
          intent: "proposal",
          historyChannelId: "desktop",
          actions: nodeAtWorkspace("proposal-node"),
        })
      ).status,
    ).toBe("published");
    await syncPair(new FactReplication(a.facts.replication), new FactReplication(b.facts.replication));
    await syncPair(new FactReplication(a.facts.replication), new FactReplication(c.facts.replication));
    await b.workspace.reconcileAuthorityAdvance();
    await c.workspace.reconcileAuthorityAdvance();

    const reviewB = await b.workspace.query({ kind: "review", workspaceId: "workspace" });
    const reviewC = await c.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in reviewB) || !reviewB.hunks[0] || !("hunks" in reviewC) || !reviewC.hunks[0]) {
      throw new Error("Expected Proposal Review Hunk on both replicas");
    }
    expect(
      (
        await b.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-offline",
          actorId: "accept-reviewer",
          decision: "accept",
          selection: reviewB.hunks[0].selection,
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await c.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "reject-offline",
          actorId: "reject-reviewer",
          decision: "reject",
          selection: reviewC.hunks[0].selection,
        })
      ).status,
    ).toBe("published");
    await syncPair(new FactReplication(b.facts.replication), new FactReplication(a.facts.replication));
    await syncPair(new FactReplication(c.facts.replication), new FactReplication(a.facts.replication));
    await a.workspace.reconcileAuthorityAdvance();

    const conflicts = await a.workspace.query({
      kind: "conflicts",
      workspaceId: "workspace",
    });
    if (!("issues" in conflicts) || conflicts.issues[0]?.kind !== "resolution-conflict") {
      throw new Error("Expected public Resolution conflict");
    }
    const conflict = conflicts.issues[0];
    const firstCandidate = conflict.candidates[0];
    if (!firstCandidate) {
      throw new Error("Expected Resolution conflict candidate");
    }
    expect(conflict.candidates.map((candidate) => candidate.decision).sort()).toEqual(["accept", "reject"]);
    const beforeAdjudication = a.facts.snapshot().facts.length;
    expect(
      await a.workspace.execute({
        kind: "adjudicate-resolution",
        workspaceId: "workspace",
        invocationId: "adjudicate-incomplete",
        actorId: "adjudicator",
        decision: "accept",
        proposalFactIds: conflict.proposalFactIds,
        resolutionIds: [firstCandidate.resolutionId],
      }),
    ).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    expect(a.facts.snapshot().facts).toHaveLength(beforeAdjudication);
    expect(
      (
        await a.workspace.execute({
          kind: "adjudicate-resolution",
          workspaceId: "workspace",
          invocationId: "adjudicate-accept",
          actorId: "adjudicator",
          decision: "accept",
          proposalFactIds: conflict.proposalFactIds,
          resolutionIds: conflict.candidates.map((candidate) => candidate.resolutionId),
        })
      ).status,
    ).toBe("published");
    const origin = await a.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
    });
    expect("nodes" in origin && origin.nodes["proposal-node"]).toBeDefined();
    const resolved = await a.workspace.query({ kind: "conflicts", workspaceId: "workspace" });
    expect("issues" in resolved && resolved.issues).toEqual([]);

    await a.workspace.close();
    const restarted = await setupReplica(documentsA, "204");
    const afterRestart = await restarted.workspace.query({
      kind: "conflicts",
      workspaceId: "workspace",
    });
    expect("issues" in afterRestart && afterRestart.issues).toEqual([]);
  });
  it("Review pagination preserves shared Node links across cross-position Move endpoints", async () => {
    const { workspace } = await setup();
    expect(
      (
        await workspace.execute({
          kind: "edit",
          workspaceId: "workspace",
          invocationId: "linked-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "setup",
          actions: [
            nodeAt("outline-root-node", "workspace", "outline-root-occurrence"),
            nodeAt("p1-node", "outline-root-node", "p1"),
            nodeAt("p2-node", "outline-root-node", "p2", {
              after: "p1",
              before: null,
              affinity: "after",
              fallback: "end",
            }),
            nodeAt("shared", "p1-node", "shared-occ"),
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          kind: "edit",
          workspaceId: "workspace",
          invocationId: "linked-proposal",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "proposal",
          actions: [
            {
              kind: "rich-text-splice",
              nodeId: "shared",
              deleteAtomIds: [],
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
              insert: "X",
            },
            {
              kind: "occurrence-move",
              occurrenceId: "shared-occ",
              parentNodeId: "p2-node",
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            },
          ],
        })
      ).status,
    ).toBe("published");
    const complete = await workspace.query({
      kind: "review",
      workspaceId: "workspace",
      limit: 100,
    });
    if (!("hunks" in complete)) {
      throw new Error("Expected linked Review Hunks");
    }
    const paged = [];
    let after: string | null = null;
    do {
      const page: ReviewQuery = await workspace.query({
        kind: "review",
        workspaceId: "workspace",
        after,
        limit: 1,
      });
      if (!("hunks" in page)) {
        throw new Error("Expected paged linked Review Hunks");
      }
      paged.push(...page.hunks);
      after = page.next;
    } while (after !== null);
    expect(paged).toEqual(complete.hunks);
    expect(complete.hunks).toHaveLength(3);
    expect(complete.hunks.every((hunk) => hunk.linkedHunkIds.length === 2)).toBe(true);
  });

  it("partially overlapping text marks restore atom state through public Undo and Redo", async () => {
    const { workspace } = await setup();
    await workspace.execute(createNode());
    const inserted = await workspace.execute({
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "insert-abc",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "setup",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "ABC",
        },
      ],
    });
    if (inserted.status !== "published") {
      throw new Error("Expected ABC insertion");
    }
    const factId = inserted.receipt.factIds[0];
    if (!factId) {
      throw new Error("Expected text Fact identity");
    }
    const actionId = factActionId(factId, 0);
    const [a, b, c] = [`${actionId}#0`, `${actionId}#1`, `${actionId}#2`] as const;
    expect(
      (
        await workspace.execute({
          kind: "edit",
          workspaceId: "workspace",
          invocationId: "setup-c-bold",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "setup",
          actions: [
            {
              kind: "rich-text-mark",
              nodeId: "node",
              atomIds: [c],
              key: "bold",
              value: { kind: "set", value: true },
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          kind: "edit",
          workspaceId: "workspace",
          invocationId: "overlap-marks",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "marks",
          actions: [
            {
              kind: "rich-text-mark",
              nodeId: "node",
              atomIds: [a, b],
              key: "bold",
              value: { kind: "set", value: true },
            },
            {
              kind: "rich-text-mark",
              nodeId: "node",
              atomIds: [b, c],
              key: "bold",
              value: { kind: "set", value: false },
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(await boldValues(workspace)).toEqual([true, false, false]);
    const history = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "marks",
    });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected mark Undo");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-overlap",
          actorId: "actor",
          selection: history.undo,
        })
      ).status,
    ).toBe("published");
    expect(await boldValues(workspace)).toEqual([undefined, undefined, true]);
    const redo = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "marks",
    });
    if (!("redo" in redo) || !redo.redo) {
      throw new Error("Expected mark Redo");
    }
    expect(
      (
        await workspace.execute({
          kind: "redo",
          workspaceId: "workspace",
          invocationId: "redo-overlap",
          actorId: "actor",
          selection: redo.redo,
        })
      ).status,
    ).toBe("published");
    expect(await boldValues(workspace)).toEqual([true, false, false]);
  });

  it("deletes a Reference placement alone and moves an Original-owned subtree to Trash atomically", async () => {
    const { facts, workspace } = await setup();
    expect(
      (
        await workspace.execute({
          ...createNode("deletion-setup"),
          actions: [
            nodeAt("node", "workspace", "node-original"),
            nodeAt("child", "node", "child-original"),
            nodeAt("context", "workspace", "context-original"),
            {
              kind: "occurrence-create",
              occurrenceId: "node-reference",
              nodeId: "node",
              parentNodeId: "context",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");

    const referenceDeletion = await workspace.execute({
      ...createNode("delete-reference"),
      actions: [{ kind: "occurrence-delete", occurrenceId: "node-reference" }],
    });
    if (referenceDeletion.status !== "published") {
      throw new Error("Expected Reference deletion");
    }
    expect(facts.facts(referenceDeletion.receipt.factIds)[0]?.body).toMatchObject({
      kind: "action",
      actions: [expect.objectContaining({ kind: "placement-remove", placementId: "node-reference" })],
    });
    expect(await lifecycleExists(workspace, "node", "node")).toBe(true);
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "nodeOwners",
      }),
    ).toMatchObject({ nodeOwners: { child: "node", node: "workspace" } });
    expect(
      (
        await workspace.execute({
          ...createNode("create-surviving-reference"),
          actions: [
            {
              kind: "occurrence-create",
              occurrenceId: "node-reference-survivor",
              nodeId: "node",
              parentNodeId: "context",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");

    const originalDeletionCommand = {
      ...createNode("delete-original"),
      actions: [{ kind: "occurrence-delete", occurrenceId: "node-original" }],
    } as const;
    const originalDeletion = await workspace.execute(originalDeletionCommand);
    if (originalDeletion.status !== "published") {
      throw new Error("Expected Original deletion");
    }
    const deletedNodeIds = factActionsFromFacts(facts.facts(originalDeletion.receipt.factIds)).flatMap((fact) =>
      fact.action.kind === "node-trash" ? [fact.action.nodeId] : [],
    );
    expect(deletedNodeIds).toEqual(["node"]);
    expect(originalDeletion.receipt.factIds).toHaveLength(1);

    const trashNodeId = workspaceTrashNodeId("workspace");
    expect(await lifecycleExists(workspace, "node", "node")).toBe(true);
    expect(await lifecycleExists(workspace, "node", "child")).toBe(true);
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "occurrences",
        limit: 100,
      }),
    ).toMatchObject({
      occurrences: {
        "node-original": { nodeId: "node", parentNodeId: trashNodeId },
        "child-original": { nodeId: "child", parentNodeId: "node" },
        "node-reference-survivor": { nodeId: "node", parentNodeId: "context" },
      },
    });
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "nodeOwners",
        limit: 100,
      }),
    ).toMatchObject({ nodeOwners: { node: trashNodeId, child: "node" } });

    const deletionFactId = originalDeletion.receipt.factIds[0];
    if (!deletionFactId) {
      throw new Error("Expected structural Node deletion Fact");
    }
    expect(
      (
        await workspace.execute({
          ...createNode("restore-original"),
          actions: [
            {
              kind: "node-restore",
              nodeId: "node",
              occurrenceId: "node-original",
              parentNodeId: "workspace",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "occurrences",
        limit: 100,
      }),
    ).toMatchObject({
      occurrences: {
        "node-original": { nodeId: "node", parentNodeId: "workspace" },
        "child-original": { nodeId: "child", parentNodeId: "node" },
        "node-reference-survivor": { nodeId: "node", parentNodeId: "context" },
      },
    });
    expect(
      await workspace.execute({
        ...createNode("delete-system-trash"),
        actions: [{ kind: "node-delete", nodeId: trashNodeId }],
      }),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
  });

  it("concurrent commands plan commit and publish inside one workspace serial boundary", async () => {
    const { workspace } = await setup();
    const second = {
      ...createNode("second"),
      actions: nodeAtWorkspace("second"),
    };

    const results = await Promise.all([workspace.execute(createNode()), workspace.execute(second)]);

    expect(results.map((result) => result.status)).toEqual(["published", "published"]);
    expect(
      await workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin" }),
    ).toMatchObject({
      nodes: { node: { nodeId: "node" }, second: { nodeId: "second" } },
    });
  });

  it("one ordered command plans later Edits against earlier Edits without merging their transactions", async () => {
    const { facts, workspace } = await setup();
    await workspace.execute(createNode());
    const result = await workspace.execute({
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "sequential-text",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: end,
          insert: "1",
        },
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: end,
          insert: "2",
        },
      ],
    });
    expect(result.status).toBe("published");
    const textFacts = facts
      .snapshot()
      .facts.filter((fact) => result.status === "published" && result.receipt.factIds.includes(fact.id));
    const edits = factActionsFromFacts(textFacts).map((fact) => fact.action);
    expect(edits).toEqual([
      expect.objectContaining({ kind: "rich-text-splice", insert: "1" }),
      expect.objectContaining({ kind: "rich-text-splice", insert: "2" }),
    ]);
    expect(textFacts).toHaveLength(2);
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({
      nodes: {
        node: {
          content: [expect.objectContaining({ value: "1" }), expect.objectContaining({ value: "2" })],
        },
      },
    });

    const structure = await workspace.execute({
      ...createNode("sequential-structure"),
      actions: [
        nodeAt("structure-root-node", "workspace", "structure-root"),
        nodeAt("parent-node", "structure-root-node", "parent"),
        {
          kind: "occurrence-create",
          occurrenceId: "child",
          nodeId: "node",
          parentNodeId: "structure-root-node",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "occurrence-move",
          occurrenceId: "child",
          parentNodeId: "parent-node",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    });
    expect(structure.status).toBe("published");
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "occurrences",
      }),
    ).toMatchObject({ occurrences: { child: { parentNodeId: "parent-node" } } });
  });

  it("uses final Fact Action identities when later Edits reference Atoms created in the same command", async () => {
    const { facts, workspace } = await setup();
    await workspace.execute(createNode());
    const initialFactIds = facts.snapshot().facts.map(({ id }) => id);
    const nextSequence = (facts.snapshot().frontier[facts.replicaId] ?? 0) + 1;
    const createdActionId = factActionId(factId("workspace", facts.replicaId, nextSequence), 0);
    const createdAtomId = `${createdActionId}#0` as const;
    const splice = await workspace.execute({
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "batch-splice-reference",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "X",
        },
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [createdAtomId],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "Y",
        },
      ],
    });
    expect(splice).toMatchObject({ status: "published" });
    expect(facts.snapshot().facts.map(({ id }) => id)).toEqual([
      ...initialFactIds,
      factId("workspace", facts.replicaId, nextSequence),
      factId("workspace", facts.replicaId, nextSequence + 1),
    ]);
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "nodes",
      }),
    ).toMatchObject({ nodes: { node: { content: [{ value: "Y" }] } } });

    const markedActionId = factActionId(factId("workspace", facts.replicaId, nextSequence + 2), 0);
    const markedAtomId = `${markedActionId}#0` as const;
    const mark = await workspace.execute({
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "batch-mark-reference",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "X",
        },
        {
          kind: "rich-text-mark",
          nodeId: "node",
          atomIds: [markedAtomId],
          key: "bold",
          value: { kind: "set", value: true },
        },
      ],
    });
    expect(mark).toMatchObject({ status: "published" });
    const projection = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
    });
    if (!("nodes" in projection)) {
      throw new Error("Expected Node projection");
    }
    expect(projection.nodes.node?.content).toMatchObject([
      { kind: "text", value: "Y", attributes: {} },
      { kind: "text", value: "X", attributes: { bold: true } },
    ]);
  });

  it("an ordered command plans from restored Node and Occurrence state", async () => {
    const { facts, workspace } = await setup();
    const created = await workspace.execute({
      ...createNode("restore-base"),
      actions: [
        nodeAt("parent-node", "workspace", "parent-occurrence"),
        nodeAt("restored-node", "parent-node", "restored-occurrence"),
        nodeAt("reference-parent", "workspace", "reference-parent-occurrence"),
        {
          kind: "occurrence-create",
          occurrenceId: "restored-reference",
          nodeId: "restored-node",
          parentNodeId: "workspace",
          anchor: end,
        },
        {
          kind: "rich-text-splice",
          nodeId: "restored-node",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          deleteAtomIds: [],
          insert: "A",
        },
      ],
    });
    if (created.status !== "published") {
      throw new Error(`Expected restore fixture: ${canonicalJson(created)}`);
    }
    const textFact = factActionsFromFacts(facts.facts(created.receipt.factIds)).find(
      (fact) => fact.action.kind === "rich-text-splice",
    );
    const insertedAtomId = `${required(textFact, "Text Fact").id}#0` as const;
    const occurrenceDeleted = await workspace.execute({
      ...createNode("delete-occurrence"),
      actions: [
        {
          kind: "occurrence-delete",
          occurrenceId: "restored-reference",
        },
      ],
    });
    const nodeDeleted = await workspace.execute({
      ...createNode("delete-node"),
      actions: [{ kind: "node-delete", nodeId: "restored-node" }],
    });
    if (occurrenceDeleted.status !== "published" || nodeDeleted.status !== "published") {
      throw new Error("Expected durable deletions");
    }
    const restored = await workspace.execute({
      ...createNode("restore-and-edit"),
      actions: [
        {
          kind: "node-restore",
          nodeId: "restored-node",
          occurrenceId: "restored-occurrence",
          parentNodeId: "parent-node",
          anchor: end,
        },
        {
          kind: "rich-text-splice",
          nodeId: "restored-node",
          anchor: { after: insertedAtomId, before: null, affinity: "after", fallback: "end" },
          deleteAtomIds: [],
          insert: "B",
        },
        {
          kind: "occurrence-restore",
          occurrenceId: "restored-reference",
          nodeId: "restored-node",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "occurrence-move",
          occurrenceId: "restored-reference",
          parentNodeId: "reference-parent",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    });
    expect(restored.status).toBe("published");
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "nodes",
      }),
    ).toMatchObject({
      nodes: {
        "restored-node": {
          content: [expect.objectContaining({ value: "A" }), expect.objectContaining({ value: "B" })],
        },
      },
    });
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "occurrences",
      }),
    ).toMatchObject({
      occurrences: {
        "restored-reference": {
          nodeId: "restored-node",
          parentNodeId: "reference-parent",
        },
      },
    });
  });

  it("rejects an owner cycle before authority commit", async () => {
    const { facts, workspace } = await setup();
    expect(
      (
        await workspace.execute({
          ...createNode("cycle-setup"),
          actions: [
            nodeAt("na", "workspace", "a"),
            nodeAt("nb", "na", "b"),
            nodeAt("nc", "nb", "c"),
            {
              kind: "occurrence-create",
              occurrenceId: "a-reference",
              nodeId: "na",
              parentNodeId: "nc",
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            },
          ],
        })
      ).status,
    ).toBe("published");
    const before = facts.snapshot().facts.length;
    expect(
      await workspace.execute({
        ...createNode("cycle"),
        actions: [
          {
            kind: "reference-promote",
            occurrenceId: "a-reference",
          },
        ],
      }),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(facts.snapshot().facts).toHaveLength(before);
  });

  it("promotes a Reference Occurrence through the public domain operation", async () => {
    const { workspace } = await setup();
    expect(
      (
        await workspace.execute({
          ...createNode("reference-setup"),
          actions: [
            nodeAt("context", "workspace", "context-original"),
            nodeAt("shared", "workspace", "shared-original"),
            {
              kind: "occurrence-create",
              occurrenceId: "shared-reference",
              nodeId: "shared",
              parentNodeId: "context",
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            },
          ],
        })
      ).status,
    ).toBe("published");

    const promotion = await workspace.execute({
      ...createNode("promote-reference"),
      actions: [{ kind: "reference-promote", occurrenceId: "shared-reference" }],
    });
    expect(promotion).toMatchObject({ status: "published" });
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "nodeOwners",
      }),
    ).toMatchObject({ nodeOwners: { shared: "context" } });
  });

  it("bootstraps the Workspace ownership root", async () => {
    const { facts, workspace } = await setup();
    expect(facts.snapshot().facts[0]?.body).toMatchObject({ kind: "action", actorId: "workspace-genesis" });
    const genesisFacts = facts.snapshot().facts;
    expect(genesisFacts).toHaveLength(1);
    expect(factActionsFromFacts(genesisFacts).map((fact) => fact.action)).toEqual(
      expect.arrayContaining([{ kind: "workspace-bootstrap", workspaceNodeId: "workspace" }]),
    );
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "nodes",
      }),
    ).toMatchObject({
      nodes: {
        workspace: { intrinsicNodeType: "workspace" },
        [workspaceTrashNodeId("workspace")]: { intrinsicNodeType: null },
        [SYSTEM_DEFINITION_CATALOG_NODE_ID]: { intrinsicNodeType: null },
      },
    });
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "workspaceSystemNodes",
      }),
    ).toMatchObject({
      workspaceSystemNodes: {
        trash: workspaceTrashNodeId("workspace"),
        systemDefinitionCatalog: SYSTEM_DEFINITION_CATALOG_NODE_ID,
      },
    });
    expect(
      (
        await workspace.execute({
          ...createNode("name-workspace"),
          actions: [
            {
              kind: "rich-text-splice",
              nodeId: "workspace",
              deleteAtomIds: [],
              anchor: end,
              insert: "Workspace",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      await workspace.execute({
        ...createNode("workspace-lifecycle"),
        actions: [{ kind: "node-delete", nodeId: "workspace" }],
      }),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(
      factActionsFromFacts(facts.snapshot().facts).some(
        (fact) => fact.action.kind === "node-trash" && fact.action.nodeId === "workspace",
      ),
    ).toBe(false);

    expect(
      (
        await workspace.execute({
          ...createNode("top-level"),
          actions: [
            nodeAt("first-root", "workspace", "first-root-occurrence"),
            nodeAt("second-root", "workspace", "second-root-occurrence", {
              after: "first-root-occurrence",
              before: null,
              affinity: "after",
              fallback: "end",
            }),
          ],
        })
      ).status,
    ).toBe("published");
  });

  it("public workspace queries load bounded Projection store shards", async () => {
    const documents = new RecordingLoadDocumentStore();
    const facts = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "101",
      documents: documents,
    });
    const materializer = new BoundedProjectionStore(documents, { capacity: 1 });
    const workspace = await Workspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      projection: { store: materializer },
    });
    await workspace.execute({
      ...createNode("materialized"),
      actions: [...nodeAtWorkspace("first"), ...nodeAtWorkspace("second")],
    });
    documents.materializedShardLoads = 0;
    const page = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
      after: "first",
      limit: 1,
    });
    if (!("section" in page) || page.section !== "nodes") {
      throw new Error("Expected Node Projection page");
    }
    expect(page).toMatchObject({ nodes: { second: { nodeId: "second" } }, next: "second" });
    expect(documents.materializedShardLoads).toBe(1);
  });

  it("Review queries page stable owner scopes through the Projection store", async () => {
    const documents = new RecordingLoadDocumentStore();
    const facts = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "101",
      documents: documents,
    });
    const materializer = new BoundedProjectionStore(documents, { capacity: 2 });
    const workspace = await Workspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      projection: { store: materializer },
    });
    await workspace.execute({
      ...createNode("review-page-base"),
      actions: ["a", "b", "c"].flatMap(nodeAtWorkspace),
    });
    for (const nodeId of ["a", "b", "c"]) {
      await workspace.execute({
        ...createNode(`proposal-${nodeId}`, "proposal"),
        actions: [
          {
            kind: "rich-text-splice",
            nodeId,
            deleteAtomIds: [],
            anchor: end,
            insert: nodeId,
          },
        ],
      });
    }

    const first = await workspace.query({
      kind: "review",
      workspaceId: "workspace",
      limit: 1,
    });
    if (!("hunks" in first)) {
      throw new Error("Expected Review page");
    }
    expect(first.hunks).toHaveLength(1);
    expect(first.next).not.toBeNull();
    const second = await workspace.query({
      kind: "review",
      workspaceId: "workspace",
      after: first.next,
      limit: 1,
    });
    if (!("hunks" in second)) {
      throw new Error("Expected Review page");
    }
    expect(second.hunks).toHaveLength(1);
    expect(second.hunks[0]?.id).not.toBe(first.hunks[0]?.id);
  });

  it("Review pagination keeps structure replacement Hunks merge-closed", async () => {
    const { workspace } = await setup();
    expect(
      (
        await workspace.execute({
          ...createNode("replacement-base"),
          actions: [
            nodeAt("parent-node", "workspace", "parent"),
            nodeAt("old-node", "workspace", "old-original"),
            nodeAt("new-node", "workspace", "new-original", {
              after: "parent",
              before: null,
              affinity: "after",
              fallback: "end",
            }),
            {
              kind: "occurrence-create",
              occurrenceId: "old",
              nodeId: "old-node",
              parentNodeId: "parent-node",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          ...createNode("proposal-delete-old", "proposal"),
          actions: [
            {
              kind: "occurrence-delete",
              occurrenceId: "old",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          ...createNode("proposal-create-new", "proposal"),
          actions: [
            {
              kind: "occurrence-create",
              occurrenceId: "new",
              nodeId: "new-node",
              parentNodeId: "parent-node",
              anchor: { after: "old", before: null, affinity: "after", fallback: "end" },
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          ...createNode("proposal-independent-content", "proposal"),
          actions: [
            {
              kind: "rich-text-splice",
              nodeId: "parent-node",
              deleteAtomIds: [],
              anchor: end,
              insert: "Parent",
            },
          ],
        })
      ).status,
    ).toBe("published");

    const complete = await workspace.query({
      kind: "review",
      workspaceId: "workspace",
      limit: 100,
    });
    if (!("hunks" in complete)) {
      throw new Error("Expected complete Review query");
    }
    const replacement = complete.hunks.find((hunk) => hunk.selection.proposalActionIds.length === 2);
    expect(replacement?.diffSpace.kind).toBe("child-sequence");

    const paged = [];
    let after: string | null = null;
    do {
      const page: ReviewQuery = await workspace.query({
        kind: "review",
        workspaceId: "workspace",
        after,
        limit: 1,
      });
      if (!("hunks" in page)) {
        throw new Error("Expected paged Review query");
      }
      paged.push(...page.hunks);
      after = page.next;
    } while (after !== null);

    expect(new Map(paged.map((hunk) => [hunk.id, hunk.evidence]))).toEqual(
      new Map(complete.hunks.map((hunk) => [hunk.id, hunk.evidence])),
    );
    expect(paged.find((hunk) => hunk.id === replacement?.id)?.selection.proposalActionIds).toEqual(
      replacement?.selection.proposalActionIds,
    );
  });

  it("Direct edits can target a pending Proposal identity and follow its terminal support", async () => {
    for (const decision of ["accept", "reject"] as const) {
      const { facts, workspace } = await setup();
      await workspace.execute({
        ...createNode("proposal-create", "proposal"),
        actions: nodeAtWorkspace("proposal-node"),
      });
      expect(
        (
          await workspace.execute({
            ...createNode("direct-text"),
            actions: [
              {
                kind: "rich-text-splice",
                nodeId: "proposal-node",
                deleteAtomIds: [],
                anchor: { after: null, before: null, affinity: "after", fallback: "end" },
                insert: "X",
              },
            ],
          })
        ).status,
      ).toBe("published");
      const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
      if (!("hunks" in review) || !review.hunks[0]) {
        throw new Error("Expected the pending create Review Hunk");
      }
      expect(
        (
          await workspace.execute({
            kind: "resolve-review",
            workspaceId: "workspace",
            invocationId: `resolve-${decision}`,
            actorId: "reviewer",
            decision,
            selection: review.hunks[0].selection,
          })
        ).status,
      ).toBe("published");
      const origin = await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      });
      expect(
        "nodes" in origin
          ? origin.nodes["proposal-node"]?.content
              .filter((item) => item.kind === "text")
              .map((atom) => atom.value)
              .join("")
          : null,
      ).toBe(decision === "accept" ? "X" : undefined);
      expect(
        factActionsFromFacts(facts.snapshot().facts).some(
          (fact) => fact.intent === "direct" && fact.action.kind === "rich-text-splice",
        ),
      ).toBe(true);
    }
  });

  it("exposes rejected unsupported Direct intent and restores it after restart and sync", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await setupReplica(documents, "301");
    const proposal = await first.workspace.execute({
      ...createNode("proposal-create", "proposal"),
      actions: nodeAtWorkspace("proposal-node"),
    });
    const direct = await first.workspace.execute({
      ...createNode("direct-text"),
      actorId: "direct-author",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "proposal-node",
          deleteAtomIds: [],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "preserved intent",
        },
      ],
    });
    if (proposal.status !== "published" || direct.status !== "published") {
      throw new Error("Expected Proposal and dependent Direct publication");
    }
    const directFactId = direct.receipt.factIds[0];
    if (!directFactId) {
      throw new Error("Expected Direct action identity");
    }
    const directActionId = factActionId(directFactId, 0);
    const review = await first.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Proposal Review Hunk");
    }
    expect(review.hunks[0].evidence.associatedImpactIds).toContain(directActionId);
    expect(
      (
        await first.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "reject-provider",
          actorId: "reviewer",
          decision: "reject",
          selection: review.hunks[0].selection,
        })
      ).status,
    ).toBe("published");

    await expectUnsupportedDirect(first.workspace, directActionId, "direct-author");
    const restarted = await setupReplica(documents, "302");
    await expectUnsupportedDirect(restarted.workspace, directActionId, "direct-author");

    const remote = await setupReplica(new InMemoryDocumentStore(), "303", false);
    await syncPair(new FactReplication(restarted.facts.replication), new FactReplication(remote.facts.replication));
    await remote.workspace.reconcileAuthorityAdvance();
    await expectUnsupportedDirect(remote.workspace, directActionId, "direct-author");

    expect(
      (
        await remote.workspace.execute({
          ...createNode("restore-independent-support"),
          actions: nodeAtWorkspace("proposal-node"),
        })
      ).status,
    ).toBe("published");
    await expectNoUnsupportedDirect(remote.workspace);
    expect(await projectedText(remote.workspace, "proposal-node")).toBe("preserved intent");

    await syncPair(new FactReplication(remote.facts.replication), new FactReplication(restarted.facts.replication));
    await restarted.workspace.reconcileAuthorityAdvance();
    await expectNoUnsupportedDirect(restarted.workspace);
    expect(await projectedText(restarted.workspace, "proposal-node")).toBe("preserved intent");
  });

  it("History executes occurrence and current-anchor text compensations through interpretation", async () => {
    const { workspace } = await setup();
    await workspace.execute(createNode("history-base"));
    await workspace.execute({
      ...createNode("history-parent"),
      actions: nodeAtWorkspace("history-parent"),
    });
    expect(
      (
        await workspace.execute({
          ...createNode("occurrence-step"),
          historyChannelId: "occurrence-channel",
          actions: [
            {
              kind: "occurrence-create",
              occurrenceId: "occurrence",
              nodeId: "node",
              parentNodeId: "history-parent",
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            },
          ],
        })
      ).status,
    ).toBe("published");
    const occurrenceHistory = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "occurrence-channel",
    });
    if (!("undo" in occurrenceHistory) || !occurrenceHistory.undo) {
      throw new Error("Occurrence create must expose an Undo selection");
    }
    const occurrenceUndo = await workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-occurrence",
      actorId: "actor",
      selection: occurrenceHistory.undo,
    });
    expect(occurrenceUndo.status, JSON.stringify(occurrenceUndo)).toBe("published");

    const initial = await workspace.execute({
      ...createNode("initial-text"),
      historyChannelId: "setup-text",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "AB",
        },
      ],
    });
    if (initial.status !== "published") {
      throw new Error("Initial text must publish");
    }
    const initialFactId = required(initial.receipt.factIds[0], "Initial text Fact");
    const initialActionId = factActionId(initialFactId, 0);
    const inserted = await workspace.execute({
      ...createNode("insert-between"),
      historyChannelId: "insert-channel",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: {
            after: `${initialActionId}#0`,
            before: `${initialActionId}#1`,
            affinity: "after",
            fallback: "end",
          },
          insert: "X",
        },
      ],
    });
    expect(inserted.status).toBe("published");
    expect(
      (
        await workspace.execute({
          ...createNode("delete-old-anchor"),
          historyChannelId: "other-channel",
          actions: [
            {
              kind: "rich-text-splice",
              nodeId: "node",
              deleteAtomIds: [`${initialActionId}#0`],
              anchor: {
                after: null,
                before: `${initialActionId}#1`,
                affinity: "before",
                fallback: "start",
              },
              insert: "",
            },
          ],
        })
      ).status,
    ).toBe("published");
    const textHistory = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "insert-channel",
    });
    if (!("undo" in textHistory) || !textHistory.undo) {
      throw new Error("Text insertion must expose an Undo selection");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-insert-between",
          actorId: "actor",
          selection: textHistory.undo,
        })
      ).status,
    ).toBe("published");
    const projection = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
    });
    expect(
      "nodes" in projection
        ? projection.nodes.node?.content
            .filter((item) => item.kind === "text")
            .map((atom) => atom.value)
            .join("")
        : null,
    ).toBe("B");
  });

  it("History target reader loads previous placement evidence for Move and Delete Undo", async () => {
    const { workspace } = await setup();
    expect(
      (
        await workspace.execute({
          ...createNode("placement-base"),
          historyChannelId: "setup-placement",
          actions: [
            nodeAt("placement-root-node", "workspace", "placement-root"),
            nodeAt("node-a", "placement-root-node", "parent-a"),
            nodeAt("node-b", "placement-root-node", "parent-b", {
              after: "parent-a",
              before: null,
              affinity: "after",
              fallback: "end",
            }),
            nodeAt("node-child", "node-a", "child"),
          ],
        })
      ).status,
    ).toBe("published");

    expect(
      (
        await workspace.execute({
          ...createNode("move-child"),
          historyChannelId: "move-child",
          actions: [
            {
              kind: "occurrence-move",
              occurrenceId: "child",
              parentNodeId: "node-b",
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            },
          ],
        })
      ).status,
    ).toBe("published");
    const moveHistory = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "move-child",
    });
    if (!("undo" in moveHistory) || !moveHistory.undo) {
      throw new Error("Move must expose an Undo selection with its previous parent");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-move-child",
          actorId: "actor",
          selection: moveHistory.undo,
        })
      ).status,
    ).toBe("published");
    const afterMoveUndo = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "occurrences",
    });
    expect("occurrences" in afterMoveUndo ? afterMoveUndo.occurrences.child?.parentNodeId : null).toBe("node-a");

    expect(
      (
        await workspace.execute({
          ...createNode("delete-child"),
          historyChannelId: "delete-child",
          actions: [
            {
              kind: "occurrence-delete",
              occurrenceId: "child",
            },
          ],
        })
      ).status,
    ).toBe("published");
    const deleteHistory = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "delete-child",
    });
    if (!("undo" in deleteHistory) || !deleteHistory.undo) {
      throw new Error("Occurrence Delete must expose an Undo selection with its old placement");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-delete-child",
          actorId: "actor",
          selection: deleteHistory.undo,
        })
      ).status,
    ).toBe("published");
    const afterDeleteUndo = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "occurrences",
    });
    expect("occurrences" in afterDeleteUndo ? afterDeleteUndo.occurrences.child?.parentNodeId : null).toBe("node-a");
  });

  it("History exposes Review-visible Direct work on a pending Proposal identity", async () => {
    const { workspace } = await setup();
    await workspace.execute({
      ...createNode("proposal-only", "proposal"),
      historyChannelId: "proposal-channel",
      actions: nodeAtWorkspace("proposal-only"),
    });
    await workspace.execute({
      ...createNode("direct-contingent"),
      historyChannelId: "direct-contingent",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "proposal-only",
          deleteAtomIds: [],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "X",
        },
      ],
    });
    const history = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "direct-contingent",
    });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Review-visible Direct action must be undoable");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-direct-contingent",
          actorId: "actor",
          selection: history.undo,
        })
      ).status,
    ).toBe("published");
    const review = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "review",
    });
    expect(
      "nodes" in review
        ? review.nodes["proposal-only"]?.content
            .filter((item) => item.kind === "text")
            .map((atom) => atom.value)
            .join("")
        : null,
    ).toBe("");
  });

  it("semantic command validation rejects missing restore and text mark targets before commit", async () => {
    const { facts, workspace } = await setup();
    await workspace.execute(createNode());
    const before = facts.snapshot();
    for (const actions of [
      [
        {
          kind: "node-restore",
          nodeId: "node",
          deletionActionId: "g1/workspace/999/999/actions/0",
          occurrenceId: "node-original",
          ownerNodeId: "workspace",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
      [
        {
          kind: "rich-text-mark",
          nodeId: "node",
          atomIds: ["g1/workspace/999/999/actions/0#0"],
          key: "bold",
          value: { kind: "set", value: true },
        },
      ],
    ] as const) {
      expect(await workspace.execute({ ...createNode(`invalid-${actions[0].kind}`), actions })).toMatchObject({
        status: "rejected",
        error: { code: "invalid-input" },
      });
    }
    expect(facts.snapshot()).toEqual(before);
    expect(
      (
        await workspace.execute({
          ...createNode("healthy-after-invalid"),
          actions: nodeAtWorkspace("healthy"),
        })
      ).status,
    ).toBe("published");
  });

  it("CMD-4 request digest and generation gate fail closed", async () => {
    const publisher = new ControlledPublisher();
    const { facts, workspace } = await setup(publisher);
    publisher.fail = true;
    const pending = await workspace.execute(createNode());
    expect(pending.status).toBe("committed-projection-pending");

    const lagged = await workspace.execute({
      ...createNode("second"),
      actions: nodeAtWorkspace("second"),
    });
    expect(lagged).toMatchObject({
      status: "rejected",
      error: { code: "projection-unavailable" },
    });
    expect(facts.receipt("second")).toBeNull();
    expect(
      await workspace.execute({
        ...createNode("state-dependent"),
        actions: [
          {
            kind: "rich-text-splice",
            nodeId: "node",
            deleteAtomIds: [],
            anchor: end,
            insert: "red",
          },
        ],
      }),
    ).toMatchObject({ status: "rejected", error: { code: "projection-unavailable" } });
    expect(facts.receipt("state-dependent")).toBeNull();

    const conflict = await workspace.execute({
      ...createNode(),
      actions: nodeAtWorkspace("other"),
    });
    expect(conflict).toMatchObject({
      status: "rejected",
      error: { code: "invocation-conflict" },
    });
  });

  it("CMD-5 result states distinguish rejected published and pending", async () => {
    const publisher = new ControlledPublisher();
    const { workspace } = await setup(publisher);
    publisher.fail = true;
    expect((await workspace.execute(createNode())).status).toBe("committed-projection-pending");
    publisher.fail = false;
    expect((await workspace.execute(createNode())).status).toBe("published");
    expect(await workspace.execute({ ...createNode("empty"), actions: [] })).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
  });

  it("authority storage failures escape instead of masquerading as invalid input", async () => {
    const documents = new FailingAppendDocumentStore();
    const { facts, workspace } = await setup(undefined, documents);
    documents.failAppend = true;

    await expect(workspace.execute(createNode("storage-failure"))).rejects.toThrow("injected authority append failure");
    expect(facts.receipt("storage-failure")).toBeNull();
  });

  it("PROJ-4 origin and review publish as one generation", async () => {
    const publisher = new ControlledPublisher();
    const { workspace } = await setup(publisher);
    const result = await workspace.execute(createNode("proposal", "proposal"));
    expect(result.status).toBe("published");
    expect(publisher.generations).toHaveLength(2);
    const generation = required(publisher.generations.at(-1), "published generation");
    expect(generation.origin.identity).toEqual(generation.review.identity);
    expect(generation.origin.nodes.node).toBeUndefined();
    expect(generation.review.nodes.node).toBeDefined();
  });

  it("DUR-2 derived failures never roll back facts", async () => {
    const publisher = new ControlledPublisher();
    const { facts, workspace } = await setup(publisher);
    const initialFactIds = facts.snapshot().facts.map(({ id }) => id);
    publisher.fail = true;
    const result = await workspace.execute(createNode());
    if (result.status !== "committed-projection-pending") {
      throw new Error(`Expected committed Projection failure, received ${result.status}`);
    }
    expect(facts.snapshot().facts.map(({ id }) => id)).toEqual([...initialFactIds, ...result.receipt.factIds]);
    expect(
      await workspace.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "create",
      }),
    ).toMatchObject({
      status: "committed-projection-pending",
      receipt: { invocationId: "create" },
    });
  });

  it("restart restores the current published generation without publishing it again", async () => {
    const documents = new InMemoryDocumentStore();
    const firstStore = new ControlledPublisher(documents);
    const { facts, workspace: first } = await setup(firstStore, documents);
    expect((await first.execute(createNode())).status).toBe("published");

    const restoredStore = new ControlledPublisher(documents);
    const restarted = await Workspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      projection: { store: restoredStore },
    });

    expect(restoredStore.generations).toEqual([]);
    expect(
      await restarted.query({ kind: "projection", workspaceId: "workspace", perspective: "origin" }),
    ).toMatchObject({ nodes: { node: { nodeId: "node" } } });
  });

  it("restart rebuilds the required generation after a failed publication", async () => {
    const documents = new InMemoryDocumentStore();
    const facts = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "101",
      documents: documents,
    });
    const failedPublisher = new ControlledPublisher(documents);
    const first = await Workspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      projection: { store: failedPublisher },
    });
    failedPublisher.fail = true;
    expect((await first.execute(createNode())).status).toBe("committed-projection-pending");

    const restartedFacts = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "101",
      documents: documents,
    });
    const materializer = new BoundedProjectionStore(documents);
    const restarted = await Workspace.open({
      workspaceId: "workspace",
      facts: restartedFacts,
      versions,
      projection: { store: materializer },
    });
    expect(
      await restarted.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "create",
      }),
    ).toMatchObject({ status: "published" });
  });

  it("Events 与 query", async () => {
    const publisher = new ControlledPublisher();
    const events: EngineEvent[] = [];
    const { workspace } = await setup(publisher, undefined, eventCollector(events));
    await workspace.execute(createNode());
    expect(events.map((event) => event.kind)).toEqual(["authority-advanced", "projection-published"]);
    publisher.fail = true;
    expect(
      await workspace.execute({
        ...createNode("lagged"),
        actions: nodeAtWorkspace("lagged"),
      }),
    ).toMatchObject({ status: "committed-projection-pending" });
    expect(events.slice(-2).map((event) => event.kind)).toEqual(["authority-advanced", "projection-failed"]);
    expect(
      await workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin" }),
    ).not.toHaveProperty("nodes.lagged");
    publisher.fail = false;
    expect(
      (
        await workspace.execute({
          ...createNode("lagged"),
          actions: nodeAtWorkspace("lagged"),
        })
      ).status,
    ).toBe("published");
    expect(events.at(-1)?.kind).toBe("projection-recovered");
    expect(
      await workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin" }),
    ).toMatchObject({
      nodes: { lagged: { nodeId: "lagged" } },
    });
    expect(events.every((event) => !Object.hasOwn(event, "facts"))).toBe(true);
  });

  it("authority reconciliation reports publication failure through the projection lifecycle", async () => {
    const publisher = new ControlledPublisher();
    const events: EngineEvent[] = [];
    const { facts, workspace } = await setup(publisher, undefined, eventCollector(events));
    await commitAuthorityNode(facts, "remote-failure", "remote-failure");
    publisher.fail = true;

    await expect(workspace.reconcileAuthorityAdvance()).rejects.toThrow("injected projection failure");

    expect(events.map((event) => event.kind)).toEqual(["authority-advanced", "projection-failed"]);
  });

  it("workspace close rejects new work and drains a command already inside publication", async () => {
    const publisher = new GatePublisher();
    const { workspace } = await setup(publisher);
    publisher.enable();
    const executing = workspace.execute(createNode());
    await publisher.entered;
    let closed = false;
    const closing = workspace.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    publisher.release();
    expect((await executing).status).toBe("published");
    await closing;
    expect(await workspace.execute(createNode("after-close"))).toMatchObject({
      status: "rejected",
      error: { code: "projection-unavailable" },
    });
  });

  it("workspace close drains an accepted query before releasing its runtime", async () => {
    const store = new GateQueryStore();
    const { workspace } = await setup(store);
    store.enable();
    const querying = workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin" });
    await store.entered;
    let closed = false;
    const closing = workspace.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    store.release();
    await expect(querying).resolves.toMatchObject({ perspective: "origin" });
    await closing;
    await expect(
      workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin" }),
    ).rejects.toThrow("Workspace is closed");
  });

  it("restart advances the last complete generation across an unpublished Authority tail", async () => {
    const documents = new InMemoryDocumentStore();
    const openFacts = () =>
      FactAuthority.open({
        workspaceId: "workspace",
        loroPeerId: "808",
        documents: documents,
      });
    const firstFacts = await openFacts();
    const firstStore = new BoundedProjectionStore(documents);
    const first = await Workspace.open({
      workspaceId: "workspace",
      facts: firstFacts,
      versions,
      projection: { store: firstStore },
    });
    await first.execute(createNode());
    const publishedIdentity = (await firstStore.storedIdentities())[0];
    if (!publishedIdentity) {
      throw new Error("Expected one complete materialized generation");
    }
    await firstFacts.commit({
      invocationId: "tail",
      request: { kind: "tail" },
      writes: [
        {
          kind: "action",
          actorId: "actor",
          intent: "direct",
          actions: [
            {
              kind: "node-create",
              nodeId: "tail-node",
              ownerNodeId: "workspace",
              originalPlacement: { placementId: "tail-node-original", anchor: end },
            },
          ],
        },
      ],
      lineage: null,
      publishedFrontier: firstFacts.snapshot().frontier,
    });

    const recoveringStore = new ControlledPublisher(documents);
    const restarted = await Workspace.open({
      workspaceId: "workspace",
      facts: await openFacts(),
      versions,
      projection: { store: recoveringStore },
    });
    expect(recoveringStore.restoredGenerationIds).toContain(publishedIdentity.generationId);
    expect(recoveringStore.generations).toHaveLength(1);
    expect(
      await restarted.query({ kind: "projection", workspaceId: "workspace", perspective: "origin" }),
    ).toMatchObject({
      nodes: { node: { nodeId: "node" }, "tail-node": { nodeId: "tail-node" } },
    });
  });
});

class ControlledPublisher extends BoundedProjectionStore {
  fail = false;
  readonly generations: Parameters<BoundedProjectionStore["publish"]>[0][] = [];
  readonly restoredGenerationIds: string[] = [];

  constructor(documents: DocumentStore = new InMemoryDocumentStore()) {
    super(documents);
  }

  override restore(generationId: string) {
    this.restoredGenerationIds.push(generationId);
    return super.restore(generationId);
  }

  override async publish(
    generation: Parameters<BoundedProjectionStore["publish"]>[0],
    review: Parameters<BoundedProjectionStore["publish"]>[1],
  ): Promise<void> {
    if (this.fail) {
      throw new Error("injected projection failure");
    }
    await super.publish(generation, review);
    this.generations.push(generation);
  }
}

class GateQueryStore extends BoundedProjectionStore {
  readonly entered: Promise<void>;
  private enter!: () => void;
  private continue!: () => void;
  private readonly gate: Promise<void>;
  private enabled = false;

  constructor() {
    super(new InMemoryDocumentStore());
    this.entered = new Promise((resolve) => {
      this.enter = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.continue = resolve;
    });
  }

  override async page<Section extends ProjectionSectionName>(
    generationId: string,
    perspective: ProjectionPerspective,
    section: Section,
    after: string | null,
    limit: number,
  ): Promise<ProjectionSlicePage<Section>> {
    if (this.enabled) {
      this.enter();
      await this.gate;
    }
    return super.page(generationId, perspective, section, after, limit);
  }

  enable(): void {
    this.enabled = true;
  }

  release(): void {
    this.continue();
  }
}

class GatePublisher extends BoundedProjectionStore {
  readonly entered: Promise<void>;
  private enter!: () => void;
  private continue!: () => void;
  private readonly gate: Promise<void>;
  private enabled = false;

  constructor(documents: DocumentStore = new InMemoryDocumentStore()) {
    super(documents);
    this.entered = new Promise((resolve) => {
      this.enter = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.continue = resolve;
    });
  }

  override async publish(
    generation: Parameters<BoundedProjectionStore["publish"]>[0],
    review: Parameters<BoundedProjectionStore["publish"]>[1],
  ): Promise<void> {
    if (!this.enabled) {
      return super.publish(generation, review);
    }
    this.enter();
    await this.gate;
    await super.publish(generation, review);
  }

  enable(): void {
    this.enabled = true;
  }

  release(): void {
    this.continue();
  }
}

class FailingAppendDocumentStore extends InMemoryDocumentStore {
  failAppend = false;

  override appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    return this.failAppend
      ? Promise.reject(new Error("injected authority append failure"))
      : super.appendUpdate(id, bytes);
  }

  override appendUpdates(updates: readonly DocumentUpdate[]): Promise<readonly number[]> {
    return this.failAppend
      ? Promise.reject(new Error("injected authority append failure"))
      : super.appendUpdates(updates);
  }
}

async function commitAuthorityNode(facts: FactAuthority, invocationId: string, nodeId: string): Promise<void> {
  await facts.commit({
    invocationId,
    request: { kind: "remote-authority-node", nodeId },
    writes: [{ kind: "action", actorId: "remote", intent: "direct", actions: authorityNodeActions(nodeId) }],
    lineage: null,
    publishedFrontier: facts.snapshot().frontier,
  });
}

function authorityNodeActions(nodeId: string) {
  return [
    {
      kind: "node-create" as const,
      nodeId,
      ownerNodeId: "workspace",
      originalPlacement: { placementId: `${nodeId}-original`, anchor: end },
    },
  ] as const;
}

class RecordingLoadDocumentStore extends InMemoryDocumentStore {
  materializedShardLoads = 0;

  override load(id: string) {
    if (id.startsWith("materialized-generation/shard/")) {
      this.materializedShardLoads += 1;
    }
    return super.load(id);
  }
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
