import { describe, expect, it } from "vitest";

import type { EngineEvent, MutationCommand } from "../../application/contract.js";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import {
  admitAuthorityRecordShapes,
  canonicalJson,
  requestDigest,
  type SequenceAnchor,
} from "../../domain/fact/index.js";
import type { HistoryPlanningObserver } from "../../domain/history/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import {
  createReplicaId,
  FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
  FactAuthorityStore,
} from "../authority/fact-authority-store.js";
import { FactSyncComposite } from "../sync/fact-sync.js";
import { syncPair } from "../sync/sync-exchange.js";
import { ProjectionCheckpointRepository } from "./projection-checkpoints.js";
import { BoundedProjectionMaterializer } from "./bounded-materializer.js";
import { ProposalWorkspace } from "./proposal-workspace.js";
import type { ProjectionPublisher } from "./proposal-workspace-types.js";

const versions = { rulesVersion: "proposal-rules-3", schemaVersion: "lode-schema-16" } as const;
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

function nodeAtWorkspace(nodeId: string) {
  return [nodeAt(nodeId, "workspace", `${nodeId}-original`)];
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  anchor: SequenceAnchor = end,
) {
  return { kind: "node-create" as const, nodeId, occurrenceId, parentNodeId, anchor };
}

async function setup(
  publisher?: ProjectionPublisher,
  documents: DocumentStore = new InMemoryDocumentStore(),
  publicationTimeoutMs?: number,
  historyPlanningObserver?: HistoryPlanningObserver,
  admitRecords: typeof admitAuthorityRecords = admitAuthorityRecords,
) {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId: "101",
    documents,
    admitRecords,
  });
  return {
    facts,
    workspace: await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      publisher,
      publicationTimeoutMs,
      historyPlanningObserver,
    }),
  };
}

async function setupReplica(documents: DocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId,
    documents,
    admitRecords: admitAuthorityRecords,
  });
  return {
    facts,
    workspace: await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts,
      versions,
    }),
  };
}

function createNode(
  invocationId = "create",
  intent: "direct" | "proposal" = "direct",
): MutationCommand {
  return {
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "desktop",
    mutations: [
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

async function lifecycleExists(
  workspace: ProposalWorkspace,
  owner: "node" | "occurrence",
  identity: string,
): Promise<boolean> {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
    section: owner === "node" ? "nodes" : "occurrences",
    limit: 100,
  });
  return owner === "node"
    ? "nodes" in projection && projection.nodes[identity] !== undefined
    : "occurrences" in projection && projection.occurrences[identity] !== undefined;
}

async function boldValues(workspace: ProposalWorkspace): Promise<readonly unknown[]> {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
    section: "nodes",
    limit: 100,
  });
  if (!("nodes" in projection)) {
    throw new Error("Expected Node projection");
  }
  return projection.nodes.node?.text.map((atom) => atom.attributes.bold) ?? [];
}

async function expectUnsupportedDirect(
  workspace: ProposalWorkspace,
  contributionId: string,
  actorId: string,
): Promise<void> {
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
      contributionId,
      mutationKind: "text-splice",
      actorId,
      recoveryActions: ["restore-support"],
    }),
  );
}

async function expectNoUnsupportedDirect(workspace: ProposalWorkspace): Promise<void> {
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

async function projectedText(workspace: ProposalWorkspace, nodeId: string): Promise<string> {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
    section: "nodes",
    limit: 100,
  });
  if (!("nodes" in projection)) {
    throw new Error("Expected Node projection");
  }
  return projection.nodes[nodeId]?.text.map((atom) => atom.value).join("") ?? "";
}

describe("Proposal Workspace coordinator", () => {
  it("queries and adjudicates concurrent opposite Resolutions through the public Engine contract", async () => {
    const documentsA = new InMemoryDocumentStore();
    const a = await setupReplica(documentsA, "201");
    const b = await setupReplica(new InMemoryDocumentStore(), "202");
    const c = await setupReplica(new InMemoryDocumentStore(), "203");
    expect(
      (
        await a.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-node",
          actorId: "author",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: nodeAtWorkspace("proposal-node"),
        })
      ).status,
    ).toBe("published");
    await syncPair(
      new FactSyncComposite(a.facts.replication),
      new FactSyncComposite(b.facts.replication),
    );
    await syncPair(
      new FactSyncComposite(a.facts.replication),
      new FactSyncComposite(c.facts.replication),
    );
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
    await syncPair(
      new FactSyncComposite(b.facts.replication),
      new FactSyncComposite(a.facts.replication),
    );
    await syncPair(
      new FactSyncComposite(c.facts.replication),
      new FactSyncComposite(a.facts.replication),
    );
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
    expect(conflict.candidates.map((candidate) => candidate.decision).sort()).toEqual([
      "accept",
      "reject",
    ]);
    const beforeAdjudication = a.facts.snapshot().facts.length;
    expect(
      await a.workspace.execute({
        kind: "adjudicate-resolution",
        workspaceId: "workspace",
        invocationId: "adjudicate-incomplete",
        actorId: "adjudicator",
        decision: "accept",
        proposalContributionIds: conflict.proposalContributionIds,
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
          proposalContributionIds: conflict.proposalContributionIds,
          resolutionIds: conflict.candidates.map((candidate) => candidate.resolutionId),
        })
      ).status,
    ).toBe("published");
    const origin = await a.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
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
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "linked-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "setup",
          mutations: [
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
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "linked-proposal",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "proposal",
          mutations: [
            {
              kind: "text-splice",
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
      const page = await workspace.query({
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

  it("Review pagination preserves Schema Field Definition association", async () => {
    const { workspace } = await setup();
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "schema-link-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "setup",
          mutations: [
            nodeAt("parent", "workspace", "parent-occ"),
            ...nodeAtWorkspace("schema"),
            ...nodeAtWorkspace("field"),
            {
              kind: "schema-field-add",
              schemaId: "schema",
              fieldDefinitionId: "field",
              fieldNodeId: "schema-field-template-field",
              fieldOccurrenceId: "schema-field-template-field-occurrence",
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            },
            {
              kind: "schema-apply",
              nodeId: "parent",
              schemaId: "schema",
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "schema-config-proposal",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "proposal",
          mutations: [
            {
              kind: "schema-field-configure",
              schemaId: "schema",
              fieldDefinitionId: "field",
              fieldNodeId: "schema-field-template-field",

              config: {
                visibility: "normal",
                staticDefault: null,
                initializer: null,
              },
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "field-label-proposal",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "proposal",
          mutations: [
            {
              kind: "value-set",
              target: { kind: "node", id: "field" },
              namespace: "property",
              key: "label",
              value: "X",
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
      throw new Error("Expected Schema Review Hunks");
    }
    const paged = [];
    let after: string | null = null;
    do {
      const page = await workspace.query({
        kind: "review",
        workspaceId: "workspace",
        after,
        limit: 1,
      });
      if (!("hunks" in page)) {
        throw new Error("Expected paged Schema Review Hunks");
      }
      paged.push(...page.hunks);
      after = page.next;
    } while (after !== null);
    expect(paged).toEqual(complete.hunks);
    expect(complete.hunks).toHaveLength(1);
    expect(complete.hunks[0]).toMatchObject({
      diffSpace: { kind: "value", identity: "node/field/property/label" },
    });
  });

  it("partially overlapping text marks restore atom state through public Undo and Redo", async () => {
    const { workspace } = await setup();
    await workspace.execute(createNode());
    const inserted = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "insert-abc",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "setup",
      mutations: [
        {
          kind: "text-splice",
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
    const [a, b, c] = [`${factId}#0`, `${factId}#1`, `${factId}#2`] as const;
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "setup-c-bold",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "setup",
          mutations: [
            {
              kind: "text-mark",
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
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "overlap-marks",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "marks",
          mutations: [
            {
              kind: "text-mark",
              nodeId: "node",
              atomIds: [a, b],
              key: "bold",
              value: { kind: "set", value: true },
            },
            {
              kind: "text-mark",
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

  it("repeated lifecycle owners remain atomic through public Undo and Redo", async () => {
    for (const owner of ["node", "occurrence"] as const) {
      const { workspace } = await setup();
      if (owner === "occurrence") {
        expect((await workspace.execute(createNode("occurrence-node"))).status).toBe("published");
        expect(
          (
            await workspace.execute({
              ...createNode("occurrence-parent"),
              mutations: nodeAtWorkspace("repeat-parent"),
            })
          ).status,
        ).toBe("published");
      }
      const mutation =
        owner === "node"
          ? nodeAt("repeated", "workspace", "repeated-original")
          : {
              kind: "occurrence-create" as const,
              occurrenceId: "repeated",
              nodeId: "node",
              parentNodeId: "repeat-parent",
              anchor: {
                after: null,
                before: null,
                affinity: "after" as const,
                fallback: "end" as const,
              },
            };
      expect(
        (
          await workspace.execute({
            kind: "mutate",
            workspaceId: "workspace",
            invocationId: `repeated-${owner}`,
            actorId: "actor",
            intent: "direct",
            historyChannelId: `repeated-${owner}`,
            mutations: owner === "node" ? [mutation, mutation] : [mutation, mutation],
          })
        ).status,
      ).toBe("published");
      const history = await workspace.query({
        kind: "history",
        workspaceId: "workspace",
        channelId: `repeated-${owner}`,
      });
      if (!("undo" in history) || !history.undo) {
        throw new Error("Expected lifecycle Undo");
      }
      expect(
        (
          await workspace.execute({
            kind: "undo",
            workspaceId: "workspace",
            invocationId: `undo-${owner}`,
            actorId: "actor",
            selection: history.undo,
          })
        ).status,
      ).toBe("published");
      const afterUndo = await workspace.query({
        kind: "history",
        workspaceId: "workspace",
        channelId: `repeated-${owner}`,
      });
      if (!("redo" in afterUndo) || !afterUndo.redo) {
        throw new Error("Expected lifecycle Redo");
      }
      expect(
        (
          await workspace.execute({
            kind: "redo",
            workspaceId: "workspace",
            invocationId: `redo-${owner}`,
            actorId: "actor",
            selection: afterUndo.redo,
          })
        ).status,
      ).toBe("published");
      const projection = await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        limit: 100,
        section: owner === "node" ? "nodes" : "occurrences",
      });
      expect(
        owner === "node"
          ? "nodes" in projection && projection.nodes.repeated !== undefined
          : "occurrences" in projection && projection.occurrences.repeated !== undefined,
      ).toBe(true);
    }
  });

  it("deletes a Reference placement alone and moves an Original-owned subtree to Trash atomically", async () => {
    const { facts, workspace } = await setup();
    expect(
      (
        await workspace.execute({
          ...createNode("deletion-setup"),
          mutations: [
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
      mutations: [{ kind: "occurrence-delete", occurrenceId: "node-reference" }],
    });
    if (referenceDeletion.status !== "published") {
      throw new Error("Expected Reference deletion");
    }
    expect(facts.facts(referenceDeletion.receipt.factIds)[0]?.body).toMatchObject({
      mutation: { kind: "occurrence-delete", occurrenceId: "node-reference" },
    });
    expect(await lifecycleExists(workspace, "node", "node")).toBe(true);
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        section: "nodeOwners",
      }),
    ).toMatchObject({ nodeOwners: { child: "node", node: "workspace" } });

    const originalDeletionCommand = {
      ...createNode("delete-original"),
      mutations: [{ kind: "occurrence-delete", occurrenceId: "node-original" }],
    } as const;
    const originalDeletion = await workspace.execute(originalDeletionCommand);
    if (originalDeletion.status !== "published") {
      throw new Error("Expected Original deletion");
    }
    const deletedNodeIds = facts
      .facts(originalDeletion.receipt.factIds)
      .flatMap((fact) =>
        fact.body.kind === "contribution" && fact.body.mutation.kind === "node-delete"
          ? [fact.body.mutation.nodeId]
          : [],
      );
    expect(deletedNodeIds).toEqual(["child", "node"]);
    expect(
      new Set(
        facts.facts(originalDeletion.receipt.factIds).map((fact) => fact.transaction.transactionId),
      ).size,
    ).toBe(1);
    expect(await lifecycleExists(workspace, "node", "node")).toBe(false);
    expect(await lifecycleExists(workspace, "node", "child")).toBe(false);
  });

  it("keeps public History query and Undo counterfactual work independent of unrelated entities", async () => {
    const maximumScopes = [];
    for (const count of [250, 1_000]) {
      const scopes: number[] = [];
      const { facts, workspace } = await setup(
        undefined,
        new InMemoryDocumentStore(),
        undefined,
        ({ factCount }) => scopes.push(factCount),
        admitAuthorityRecordShapes,
      );
      await commitFactOnlyNodes(
        facts,
        `unrelated-${count}`,
        Array.from({ length: count }, (_, index) => `unrelated-${String(index).padStart(4, "0")}`),
      );
      await workspace.reconcileAuthorityAdvance();
      expect(
        (
          await workspace.execute({
            ...createNode(`target-${count}`),
            historyChannelId: "target",
            mutations: nodeAtWorkspace("target"),
          })
        ).status,
      ).toBe("published");
      scopes.length = 0;
      const history = await workspace.query({
        kind: "history",
        workspaceId: "workspace",
        channelId: "target",
      });
      if (!("undo" in history) || !history.undo) {
        throw new Error("Expected bounded History selection");
      }
      const undone = await workspace.execute({
        kind: "undo",
        workspaceId: "workspace",
        invocationId: `undo-target-${count}`,
        actorId: "actor",
        selection: history.undo,
      });
      expect(undone.status).toBe("published");
      maximumScopes.push(Math.max(...scopes));
    }
    expect(maximumScopes).toEqual([3, 3]);
  });

  it("CMD-3 retry returns one receipt and published success is read-your-write", async () => {
    const { facts, workspace } = await setup();
    const command = createNode();
    const first = await workspace.execute(command);
    const retry = await workspace.execute(command);

    expect(first.status).toBe("published");
    expect(retry).toEqual(first);
    expect(facts.snapshot().facts).toHaveLength(3);
    const projection = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
    });
    expect(projection).toMatchObject({ nodes: { node: { nodeId: "node" } } });
  });

  it("concurrent commands plan commit and publish inside one workspace serial boundary", async () => {
    const { facts, workspace } = await setup();
    const second = {
      ...createNode("second"),
      mutations: nodeAtWorkspace("second"),
    };

    const results = await Promise.all([workspace.execute(createNode()), workspace.execute(second)]);

    expect(results.map((result) => result.status)).toEqual(["published", "published"]);
    expect(facts.snapshot().facts).toHaveLength(5);
    expect(
      await workspace.query({ kind: "projection", workspaceId: "workspace", view: "origin" }),
    ).toMatchObject({ nodes: { node: { nodeId: "node" }, second: { nodeId: "second" } } });
  });

  it("one ordered command plans later Edits against earlier Edits without merging their transactions", async () => {
    const { facts, workspace } = await setup();
    await workspace.execute(createNode());
    const result = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "sequential-values",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "x",
          value: 1,
        },
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "x",
          value: 2,
        },
      ],
    });
    expect(result.status).toBe("published");
    const valueFacts = facts
      .snapshot()
      .facts.filter(
        (fact) => result.status === "published" && result.receipt.factIds.includes(fact.id),
      );
    const values = valueFacts.map((fact) =>
      fact.body.kind === "contribution" ? fact.body.mutation : null,
    );
    expect(values).toEqual([
      expect.objectContaining({ kind: "value-set", value: 1, previous: { kind: "unset" } }),
      expect.objectContaining({ kind: "value-set", value: 2, previous: { kind: "set", value: 1 } }),
    ]);
    expect(new Set(valueFacts.map((fact) => fact.transaction.transactionId)).size).toBe(2);
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
      }),
    ).toMatchObject({ nodes: { node: { properties: { x: 2 } } } });

    const structure = await workspace.execute({
      ...createNode("sequential-structure"),
      mutations: [
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
        view: "origin",
        section: "occurrences",
      }),
    ).toMatchObject({ occurrences: { child: { parentNodeId: "parent-node" } } });
  });

  it("rejects text references to Atoms created earlier in the same ordered command", async () => {
    const { facts, workspace } = await setup();
    await workspace.execute(createNode());
    const syntheticAtomId = "g1/workspace/77777777777777777777777777/1#0";
    const splice = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "batch-splice-reference",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "X",
        },
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [syntheticAtomId],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "Y",
        },
      ],
    });
    expect(splice).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(facts.snapshot().facts).toHaveLength(3);

    const mark = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "batch-mark-reference",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "X",
        },
        {
          kind: "text-mark",
          nodeId: "node",
          atomIds: [syntheticAtomId],
          key: "bold",
          value: { kind: "set", value: true },
        },
      ],
    });
    expect(mark).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(facts.snapshot().facts).toHaveLength(3);
    const projection = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "nodes",
    });
    if (!("nodes" in projection)) {
      throw new Error("Expected Node projection");
    }
    expect(projection.nodes.node?.text).toEqual([]);
  });

  it("an ordered command plans from restored Node and Occurrence state", async () => {
    const { facts, workspace } = await setup();
    const created = await workspace.execute({
      ...createNode("restore-base"),
      mutations: [
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
          kind: "text-splice",
          nodeId: "restored-node",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          deleteAtomIds: [],
          insert: "A",
        },
        {
          kind: "value-set",
          target: { kind: "occurrence", id: "restored-occurrence" },
          namespace: "property",
          key: "before",
          value: true,
        },
      ],
    });
    if (created.status !== "published") {
      throw new Error(`Expected restore fixture: ${canonicalJson(created)}`);
    }
    const textFact = facts
      .facts(created.receipt.factIds)
      .find(
        (fact) => fact.body.kind === "contribution" && fact.body.mutation.kind === "text-splice",
      );
    const insertedAtomId = `${required(textFact, "Text Fact").id}#0` as const;
    const occurrenceDeleted = await workspace.execute({
      ...createNode("delete-occurrence"),
      mutations: [
        {
          kind: "occurrence-delete",
          occurrenceId: "restored-reference",
        },
      ],
    });
    const nodeDeleted = await workspace.execute({
      ...createNode("delete-node"),
      mutations: [{ kind: "node-delete", nodeId: "restored-node" }],
    });
    if (occurrenceDeleted.status !== "published" || nodeDeleted.status !== "published") {
      throw new Error("Expected durable deletions");
    }
    const restored = await workspace.execute({
      ...createNode("restore-and-edit"),
      mutations: [
        {
          kind: "node-restore",
          nodeId: "restored-node",
          deletionFactId: required(nodeDeleted.receipt.factIds[0], "Node deletion Fact"),
        },
        {
          kind: "text-splice",
          nodeId: "restored-node",
          anchor: { after: insertedAtomId, before: null, affinity: "after", fallback: "end" },
          deleteAtomIds: [],
          insert: "B",
        },
        {
          kind: "occurrence-restore",
          occurrenceId: "restored-reference",
          deletionFactId: required(
            occurrenceDeleted.receipt.factIds[0],
            "Occurrence deletion Fact",
          ),
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "value-set",
          target: { kind: "occurrence", id: "restored-reference" },
          namespace: "property",
          key: "after",
          value: true,
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
        view: "origin",
        section: "nodes",
      }),
    ).toMatchObject({
      nodes: {
        "restored-node": {
          text: [expect.objectContaining({ value: "A" }), expect.objectContaining({ value: "B" })],
        },
      },
    });
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        section: "occurrences",
      }),
    ).toMatchObject({
      occurrences: {
        "restored-reference": {
          nodeId: "restored-node",
          parentNodeId: "reference-parent",
          properties: { after: true },
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
          mutations: [
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
        mutations: [
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
          mutations: [
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
      mutations: [{ kind: "reference-promote", occurrenceId: "shared-reference" }],
    });
    expect(promotion).toMatchObject({ status: "published" });
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        section: "nodeOwners",
      }),
    ).toMatchObject({ nodeOwners: { shared: "context" } });
  });

  it("creates the Workspace through the common Node lifecycle and uses it as the ownership root", async () => {
    const { facts, workspace } = await setup();
    expect(facts.snapshot().facts[0]?.body).toMatchObject({
      kind: "contribution",
      mutation: { kind: "node-create", nodeId: "workspace" },
    });
    expect(
      (
        await workspace.execute({
          ...createNode("name-workspace"),
          mutations: [
            {
              kind: "value-set",
              target: { kind: "node", id: "workspace" },
              namespace: "property",
              key: "name",
              value: "Workspace",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      await workspace.execute({
        ...createNode("workspace-lifecycle"),
        mutations: [{ kind: "node-delete", nodeId: "workspace" }],
      }),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(facts.snapshot().facts).toHaveLength(2);

    expect(
      (
        await workspace.execute({
          ...createNode("top-level"),
          mutations: [
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

  it("public workspace queries load projection shards through the bounded materializer", async () => {
    const documents = new RecordingLoadDocumentStore();
    const facts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: createReplicaId(),
      loroPeerId: "101",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 1 });
    const workspace = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      generations: materializer,
    });
    await workspace.execute({
      ...createNode("materialized"),
      mutations: [...nodeAtWorkspace("first"), ...nodeAtWorkspace("second")],
    });
    documents.materializedShardLoads = 0;
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        section: "nodes",
        after: "first",
        limit: 1,
      }),
    ).toMatchObject({ entries: [{ identity: "second" }], next: "second" });
    expect(documents.materializedShardLoads).toBe(1);
    expect(materializer.retainedUnits()).toBe(1);
  });

  it("Review queries page stable owner scopes through the bounded materializer", async () => {
    const documents = new RecordingLoadDocumentStore();
    const facts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: createReplicaId(),
      loroPeerId: "101",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 2 });
    const workspace = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      generations: materializer,
    });
    await workspace.execute({
      ...createNode("review-page-base"),
      mutations: ["a", "b", "c"].flatMap(nodeAtWorkspace),
    });
    for (const nodeId of ["a", "b", "c"]) {
      await workspace.execute({
        ...createNode(`proposal-${nodeId}`, "proposal"),
        mutations: [
          {
            kind: "value-set",
            target: { kind: "node", id: nodeId },
            namespace: "property",
            key: "reviewed",
            value: nodeId,
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
    expect(materializer.retainedUnits()).toBeLessThanOrEqual(2);
  });

  it("Review pagination keeps structure replacement Hunks merge-closed", async () => {
    const { workspace } = await setup();
    expect(
      (
        await workspace.execute({
          ...createNode("replacement-base"),
          mutations: [
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
          mutations: [
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
          mutations: [
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
          ...createNode("proposal-independent-value", "proposal"),
          mutations: [
            {
              kind: "value-set",
              target: { kind: "node", id: "parent-node" },
              namespace: "property",
              key: "label",
              value: "Parent",
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
    const replacement = complete.hunks.find((hunk) => hunk.proposalContributionIds.length === 2);
    expect(replacement?.diffSpace.kind).toBe("child-sequence");

    const paged = [];
    let after: string | null = null;
    do {
      const page = await workspace.query({
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

    expect(new Map(paged.map((hunk) => [hunk.id, hunk.selection.evidence]))).toEqual(
      new Map(complete.hunks.map((hunk) => [hunk.id, hunk.selection.evidence])),
    );
    expect(paged.find((hunk) => hunk.id === replacement?.id)?.proposalContributionIds).toEqual(
      replacement?.proposalContributionIds,
    );
  });

  it("Direct planning captures Origin evidence while a pending Proposal changes Review", async () => {
    const { facts, workspace } = await setup();
    await workspace.execute(createNode());
    await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "proposal-blue",
      actorId: "actor",
      intent: "proposal",
      historyChannelId: "proposal-channel",
      mutations: [
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "color",
          value: "blue",
        },
      ],
    });
    const direct = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "direct-red",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "direct-channel",
      mutations: [
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "color",
          value: "red",
        },
      ],
    });
    if (direct.status !== "published") {
      throw new Error("Expected Direct edit publication");
    }
    const directFact = facts
      .snapshot()
      .facts.find((fact) => direct.receipt.factIds.includes(fact.id));
    expect(directFact?.body).toMatchObject({
      mutation: { kind: "value-set", previous: { kind: "unset" } },
    });
    const history = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "direct-channel",
    });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected Direct Undo selection");
    }
    await workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-red",
      actorId: "actor",
      selection: history.undo,
    });
    const origin = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
    });
    expect(
      "nodes" in origin ? origin.nodes.node?.properties.color : "not-projection",
    ).toBeUndefined();
  });

  it("Direct edits can target a pending Proposal identity and follow its terminal support", async () => {
    for (const decision of ["accept", "reject"] as const) {
      const { facts, workspace } = await setup();
      await workspace.execute({
        ...createNode("proposal-create", "proposal"),
        mutations: nodeAtWorkspace("proposal-node"),
      });
      expect(
        (
          await workspace.execute({
            ...createNode("direct-text"),
            mutations: [
              {
                kind: "text-splice",
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
        view: "origin",
      });
      expect(
        "nodes" in origin
          ? origin.nodes["proposal-node"]?.text.map((atom) => atom.value).join("")
          : null,
      ).toBe(decision === "accept" ? "X" : undefined);
      expect(
        facts
          .snapshot()
          .facts.some(
            (fact) =>
              fact.body.kind === "contribution" &&
              fact.body.intent === "direct" &&
              fact.body.mutation.kind === "text-splice",
          ),
      ).toBe(true);
    }
  });

  it("exposes rejected unsupported Direct intent and restores it after restart and sync", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await setupReplica(documents, "301");
    const proposal = await first.workspace.execute({
      ...createNode("proposal-create", "proposal"),
      mutations: nodeAtWorkspace("proposal-node"),
    });
    const direct = await first.workspace.execute({
      ...createNode("direct-text"),
      actorId: "direct-author",
      mutations: [
        {
          kind: "text-splice",
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
      throw new Error("Expected Direct contribution identity");
    }
    const review = await first.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Proposal Review Hunk");
    }
    expect(review.hunks[0].selection.evidence.associatedImpactIds).toContain(directFactId);
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

    await expectUnsupportedDirect(first.workspace, directFactId, "direct-author");
    const restarted = await setupReplica(documents, "302");
    await expectUnsupportedDirect(restarted.workspace, directFactId, "direct-author");

    const remote = await setupReplica(new InMemoryDocumentStore(), "303");
    await syncPair(
      new FactSyncComposite(restarted.facts.replication),
      new FactSyncComposite(remote.facts.replication),
    );
    await remote.workspace.reconcileAuthorityAdvance();
    await expectUnsupportedDirect(remote.workspace, directFactId, "direct-author");

    expect(
      (
        await remote.workspace.execute({
          ...createNode("restore-independent-support"),
          mutations: nodeAtWorkspace("proposal-node"),
        })
      ).status,
    ).toBe("published");
    await expectNoUnsupportedDirect(remote.workspace);
    expect(await projectedText(remote.workspace, "proposal-node")).toBe("preserved intent");

    await syncPair(
      new FactSyncComposite(remote.facts.replication),
      new FactSyncComposite(restarted.facts.replication),
    );
    await restarted.workspace.reconcileAuthorityAdvance();
    await expectNoUnsupportedDirect(restarted.workspace);
    expect(await projectedText(restarted.workspace, "proposal-node")).toBe("preserved intent");
  });

  it("History executes occurrence and current-anchor text compensations through admission", async () => {
    const { workspace } = await setup();
    await workspace.execute(createNode("history-base"));
    await workspace.execute({
      ...createNode("history-parent"),
      mutations: nodeAtWorkspace("history-parent"),
    });
    expect(
      (
        await workspace.execute({
          ...createNode("occurrence-step"),
          historyChannelId: "occurrence-channel",
          mutations: [
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
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-occurrence",
          actorId: "actor",
          selection: occurrenceHistory.undo,
        })
      ).status,
    ).toBe("published");

    const initial = await workspace.execute({
      ...createNode("initial-text"),
      historyChannelId: "setup-text",
      mutations: [
        {
          kind: "text-splice",
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
    const initialFactId = initial.receipt.factIds[0];
    const inserted = await workspace.execute({
      ...createNode("insert-between"),
      historyChannelId: "insert-channel",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: {
            after: `${initialFactId}#0`,
            before: `${initialFactId}#1`,
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
          mutations: [
            {
              kind: "text-splice",
              nodeId: "node",
              deleteAtomIds: [`${initialFactId}#0`],
              anchor: {
                after: null,
                before: `${initialFactId}#1`,
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
      view: "origin",
    });
    expect(
      "nodes" in projection ? projection.nodes.node?.text.map((atom) => atom.value).join("") : null,
    ).toBe("B");
  });

  it("History target reader loads previous placement evidence for Move and Delete Undo", async () => {
    const { workspace } = await setup();
    expect(
      (
        await workspace.execute({
          ...createNode("placement-base"),
          historyChannelId: "setup-placement",
          mutations: [
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
          mutations: [
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
      view: "origin",
      section: "occurrences",
    });
    expect(
      "occurrences" in afterMoveUndo ? afterMoveUndo.occurrences.child?.parentNodeId : null,
    ).toBe("node-a");

    expect(
      (
        await workspace.execute({
          ...createNode("delete-child"),
          historyChannelId: "delete-child",
          mutations: [
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
      view: "origin",
      section: "occurrences",
    });
    expect(
      "occurrences" in afterDeleteUndo ? afterDeleteUndo.occurrences.child?.parentNodeId : null,
    ).toBe("node-a");
  });

  it("History exposes Review-visible Direct work on a pending Proposal identity", async () => {
    const { workspace } = await setup();
    await workspace.execute({
      ...createNode("proposal-only", "proposal"),
      historyChannelId: "proposal-channel",
      mutations: nodeAtWorkspace("proposal-only"),
    });
    await workspace.execute({
      ...createNode("direct-contingent"),
      historyChannelId: "direct-contingent",
      mutations: [
        {
          kind: "text-splice",
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
      throw new Error("Review-visible Direct contribution must be undoable");
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
      view: "review",
    });
    expect(
      "nodes" in review
        ? review.nodes["proposal-only"]?.text.map((atom) => atom.value).join("")
        : null,
    ).toBe("");
  });

  it("semantic command validation rejects missing restore and text mark targets before commit", async () => {
    const { facts, workspace } = await setup();
    await workspace.execute(createNode());
    const before = facts.snapshot();
    for (const mutations of [
      [{ kind: "node-restore", nodeId: "node", deletionFactId: "missing" }],
      [
        {
          kind: "text-mark",
          nodeId: "node",
          atomIds: ["missing#0"],
          key: "bold",
          value: { kind: "set", value: true },
        },
      ],
    ] as const) {
      expect(
        await workspace.execute({ ...createNode(`invalid-${mutations[0].kind}`), mutations }),
      ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    }
    expect(facts.snapshot()).toEqual(before);
    expect(
      (
        await workspace.execute({
          ...createNode("healthy-after-invalid"),
          mutations: nodeAtWorkspace("healthy"),
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
      mutations: nodeAtWorkspace("second"),
    });
    expect(lagged).toMatchObject({
      status: "rejected",
      error: { code: "projection-unavailable" },
    });
    expect(facts.receipt("second")).toBeNull();
    expect(
      await workspace.execute({
        ...createNode("state-dependent"),
        mutations: [
          {
            kind: "value-set",
            target: { kind: "node", id: "node" },
            namespace: "property",
            key: "color",
            value: "red",
          },
        ],
      }),
    ).toMatchObject({ status: "rejected", error: { code: "projection-unavailable" } });
    expect(facts.receipt("state-dependent")).toBeNull();

    const conflict = await workspace.execute({
      ...createNode(),
      mutations: nodeAtWorkspace("other"),
    });
    expect(conflict).toMatchObject({
      status: "rejected",
      error: { code: "invocation-conflict" },
    });
  });

  it("CMD-5 result states distinguish rejected published pending and unknown", async () => {
    const publisher = new ControlledPublisher();
    const { workspace } = await setup(publisher);
    publisher.fail = true;
    expect((await workspace.execute(createNode())).status).toBe("committed-projection-pending");
    publisher.fail = false;
    expect((await workspace.execute(createNode())).status).toBe("published");
    expect(await workspace.execute({ ...createNode("empty"), mutations: [] })).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
  });

  it("CMD-5 returns outcome-unknown when durable append acknowledgement is lost", async () => {
    const documents = new PersistThenFailDocumentStore();
    documents.fail = false;
    const { facts, workspace } = await setup(undefined, documents);
    documents.fail = true;
    expect(await workspace.execute(createNode("uncertain"))).toEqual({
      status: "outcome-unknown",
      invocationId: "uncertain",
    });
    expect(
      await workspace.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "uncertain",
      }),
    ).toMatchObject({
      status: "committed-projection-pending",
      receipt: { invocationId: "uncertain" },
    });

    documents.fail = false;
    const restartedFacts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: facts.replicaId,
      loroPeerId: "101",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    const restarted = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts: restartedFacts,
      versions,
    });
    expect(
      await restarted.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "uncertain",
      }),
    ).toMatchObject({ status: "published", receipt: { invocationId: "uncertain" } });
  });

  it("blocks Hard Delete until an outcome-unknown Invocation is explicitly audited", async () => {
    const documents = new PersistThenFailDocumentStore();
    documents.fail = false;
    const { workspace } = await setup(undefined, documents);
    expect((await workspace.execute(createNode("purge-target-setup"))).status).toBe("published");
    const deletion = await workspace.execute({
      ...createNode("purge-target-delete"),
      mutations: [{ kind: "node-delete", nodeId: "node" }],
    });
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected purge target tombstone");
    }
    expect(
      (
        await workspace.execute({
          kind: "acknowledge-deletion",
          workspaceId: "workspace",
          invocationId: "purge-target-ack",
          actorId: "maintainer",
          nodeId: "node",
          deletionFactIds: [deletion.receipt.factIds[0]],
        })
      ).status,
    ).toBe("published");

    documents.fail = true;
    expect(
      await workspace.execute({
        ...createNode("uncertain-before-purge"),
        mutations: nodeAtWorkspace("uncertain-node"),
      }),
    ).toEqual({
      status: "outcome-unknown",
      invocationId: "uncertain-before-purge",
    });
    const blocked = await workspace.query({
      kind: "hard-delete-preview",
      workspaceId: "workspace",
      nodeId: "node",
    });
    expect("blockers" in blocked && blocked.blockers).toContain("outcome-unknown");
    expect("blockers" in blocked && blocked.outcomeUnknownInvocationIds).toEqual([
      "uncertain-before-purge",
    ]);

    await workspace.query({
      kind: "invocation",
      workspaceId: "workspace",
      invocationId: "uncertain-before-purge",
    });
    const audited = await workspace.query({
      kind: "hard-delete-preview",
      workspaceId: "workspace",
      nodeId: "node",
    });
    expect("blockers" in audited && audited.blockers).not.toContain("outcome-unknown");
  });

  it("receipt-only retry remains committed-pending until its Fact frontier is admitted", async () => {
    const documents = new InMemoryDocumentStore();
    const replicaId = createReplicaId();
    const command = createNode("receipt-gap");
    await documents.appendUpdate(
      FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
      new TextEncoder().encode(
        canonicalJson([
          {
            recordKind: "receipt",
            receipt: {
              workspaceId: "workspace",
              replicaId,
              invocationId: command.invocationId,
              requestDigest: requestDigest(command),
              factIds: [`g1/workspace/${replicaId}/1`],
              committedFrontier: { [replicaId]: 1 },
              lineage: null,
            },
          },
        ]),
      ),
    );
    const facts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId,
      loroPeerId: "101",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    const workspace = await ProposalWorkspace.open({ workspaceId: "workspace", facts, versions });

    expect(await workspace.execute(command)).toMatchObject({
      status: "committed-projection-pending",
      receipt: { invocationId: "receipt-gap" },
    });
  });

  it("authority fault keeps the last published generation readable until explicit recovery", async () => {
    const documents = new InMemoryDocumentStore();
    const { facts, workspace } = await setup(undefined, documents);
    const originallyPublished = await workspace.execute(createNode());
    expect(originallyPublished.status).toBe("published");
    await appendMalformedAuthorityRecord(documents);

    const restartedFacts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: facts.replicaId,
      loroPeerId: "101",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    const restarted = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts: restartedFacts,
      versions,
    });
    const recoveryEvents: EngineEvent[] = [];
    restarted.subscribe((event) => recoveryEvents.push(event));
    expect(
      await restarted.query({ kind: "projection", workspaceId: "workspace", view: "origin" }),
    ).toMatchObject({ nodes: { node: { nodeId: "node" } } });
    expect(await restarted.execute(createNode())).toEqual(originallyPublished);
    expect(await restarted.execute(createNode("restart-blocked"))).toMatchObject({
      status: "rejected",
      error: { code: "authority-fault" },
    });

    await restarted.recoverAuthority();
    expect(recoveryEvents.map((event) => event.kind)).toEqual(["projection-recovered"]);
    await restarted.recoverAuthority();
    expect(recoveryEvents.map((event) => event.kind)).toEqual(["projection-recovered"]);
    expect(
      (
        await restarted.execute({
          ...createNode("after-recovery"),
          mutations: nodeAtWorkspace("after-recovery"),
        })
      ).status,
    ).toBe("published");
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
    publisher.fail = true;
    const result = await workspace.execute(createNode());
    expect(result.status).toBe("committed-projection-pending");
    expect(facts.snapshot().facts).toHaveLength(3);
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

  it("restart rebuilds the required materializer without promoting a failed publication checkpoint", async () => {
    const documents = new InMemoryDocumentStore();
    const facts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: createReplicaId(),
      loroPeerId: "101",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    const failedPublisher = new ControlledPublisher();
    const first = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      checkpoints: new ProjectionCheckpointRepository(documents, "checkpoint-test-key"),
      publisher: failedPublisher,
    });
    failedPublisher.fail = true;
    expect((await first.execute(createNode())).status).toBe("committed-projection-pending");

    const restartedFacts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: facts.replicaId,
      loroPeerId: "101",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    const materializer = new BoundedProjectionMaterializer(documents);
    const restarted = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts: restartedFacts,
      versions,
      checkpoints: new ProjectionCheckpointRepository(documents, "checkpoint-test-key"),
      publisher: materializer,
    });
    expect(materializer.generationId()).not.toBeNull();
    expect(materializer.retainedUnits()).toBeGreaterThan(0);
    expect(
      await restarted.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "create",
      }),
    ).toMatchObject({ status: "published" });
  });

  it("acknowledged generation stays readable across lost manifest ack and the next publication", async () => {
    const documents = new ManifestAckLossDocumentStore();
    const facts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: createReplicaId(),
      loroPeerId: "101",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    const materializer = new BoundedProjectionMaterializer(documents);
    const checkpoints = new GateCheckpointRepository(documents);
    const workspace = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      generations: materializer,
      checkpoints,
    });

    documents.loseNextManifestAcknowledgement();
    expect(
      await workspace.execute({
        ...createNode("hidden-generation"),
        mutations: nodeAtWorkspace("hidden"),
      }),
    ).toMatchObject({ status: "committed-projection-pending" });

    await commitAuthorityNode(facts, "remote-next", "remote");
    checkpoints.gateNextSave();
    const publishing = workspace.reconcileAuthorityAdvance();
    await checkpoints.entered;
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        section: "nodes",
      }),
    ).toMatchObject({ nodes: {} });

    checkpoints.release();
    await publishing;
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        section: "nodes",
      }),
    ).toMatchObject({
      nodes: {
        hidden: { nodeId: "hidden" },
        remote: { nodeId: "remote" },
      },
    });
  });

  it("Projection unavailable", async () => {
    const publisher = new ControlledPublisher();
    const { workspace } = await setup(publisher);
    publisher.fail = true;
    await workspace.execute(createNode());
    expect(
      await workspace.query({ kind: "projection", workspaceId: "workspace", view: "origin" }),
    ).toMatchObject({ nodes: {} });
    expect(await workspace.query({ kind: "review", workspaceId: "workspace" })).toMatchObject({
      hunks: [],
    });

    publisher.fail = false;
    expect((await workspace.execute(createNode())).status).toBe("published");
    expect(
      await workspace.query({ kind: "projection", workspaceId: "workspace", view: "origin" }),
    ).toMatchObject({
      nodes: { node: { nodeId: "node" } },
    });
  });

  it("Origin/Review 原子发布", async () => {
    const publisher = new ControlledPublisher();
    const { workspace } = await setup(publisher);
    await workspace.execute(createNode("proposal", "proposal"));
    const published = required(publisher.generations[0], "published generation");
    expect(published.origin.identity.frontier).toEqual(published.review.identity.frontier);
    expect(published.origin.identity.rulesVersion).toBe(published.review.identity.rulesVersion);
  });

  it("Events 与 query", async () => {
    const publisher = new ControlledPublisher();
    const { workspace } = await setup(publisher);
    const events: EngineEvent[] = [];
    const unsubscribe = workspace.subscribe((event) => events.push(event));
    await workspace.execute(createNode());
    expect(events.map((event) => event.kind)).toEqual([
      "authority-advanced",
      "projection-published",
    ]);
    publisher.fail = true;
    expect(
      await workspace.execute({
        ...createNode("lagged"),
        mutations: nodeAtWorkspace("lagged"),
      }),
    ).toMatchObject({ status: "committed-projection-pending" });
    expect(events.slice(-2).map((event) => event.kind)).toEqual([
      "authority-advanced",
      "projection-failed",
    ]);
    expect(
      await workspace.query({ kind: "projection", workspaceId: "workspace", view: "origin" }),
    ).not.toHaveProperty("nodes.lagged");
    publisher.fail = false;
    expect(
      (
        await workspace.execute({
          ...createNode("lagged"),
          mutations: nodeAtWorkspace("lagged"),
        })
      ).status,
    ).toBe("published");
    expect(events.at(-1)?.kind).toBe("projection-recovered");
    unsubscribe();
    expect(events.every((event) => !Object.hasOwn(event, "facts"))).toBe(true);
  });

  it("event listener failures cannot change a durable command result", async () => {
    const { workspace } = await setup();
    workspace.subscribe(() => {
      throw new Error("injected listener failure");
    });

    const result = await workspace.execute(createNode());

    expect(result.status).toBe("published");
    expect(
      await workspace.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "create",
      }),
    ).toEqual(result);
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

  it("publication timeout returns durable pending without wedging retry or close", async () => {
    const publisher = new GatePublisher();
    const { workspace } = await setup(publisher, new InMemoryDocumentStore(), 10);
    publisher.enable();
    const pending = await workspace.execute(createNode("timed-publication"));
    expect(pending).toMatchObject({
      status: "committed-projection-pending",
      receipt: { invocationId: "timed-publication" },
      failure: "Projection publication timed out",
    });
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
      }),
    ).not.toHaveProperty("nodes.node");
    publisher.release();
    expect((await workspace.execute(createNode("timed-publication"))).status).toBe("published");
    await workspace.close();
  });

  it("a late timed-out generation cannot displace later authority publications", async () => {
    const documents = new InMemoryDocumentStore();
    const facts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: createReplicaId(),
      loroPeerId: "101",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    let blockNext = false;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const materializer = new BoundedProjectionMaterializer(documents, {
      beforeCommit: async () => {
        if (!blockNext) {
          return;
        }
        blockNext = false;
        entered();
        await gate;
      },
    });
    const workspace = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts,
      versions,
      generations: materializer,
      publicationTimeoutMs: 10,
    });
    blockNext = true;
    const lateCommand = workspace.execute({
      ...createNode("late-generation"),
      mutations: nodeAtWorkspace("late-generation"),
    });
    await waiting;
    expect(await lateCommand).toMatchObject({ status: "committed-projection-pending" });

    await commitAuthorityNode(facts, "remote-two", "remote-two");
    await workspace.reconcileAuthorityAdvance();
    const generationTwo = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      limit: 1,
    });
    if (!("identity" in generationTwo)) {
      throw new Error("Expected Projection page");
    }
    release();
    await commitAuthorityNode(facts, "remote-three", "remote-three");
    await workspace.reconcileAuthorityAdvance();

    await expect(materializer.load(generationTwo.identity.generationId)).resolves.toMatchObject({
      origin: {
        nodes: {
          "late-generation": { nodeId: "late-generation" },
          "remote-two": { nodeId: "remote-two" },
        },
      },
    });
    expect(
      await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        limit: 10,
      }),
    ).toMatchObject({ nodes: { "remote-three": { nodeId: "remote-three" } } });
  });

  it("Checkpoint restart validates a durable checkpoint and reconciles its Fact tail", async () => {
    const documents = new InMemoryDocumentStore();
    const replicaId = createReplicaId();
    const openFacts = () =>
      FactAuthorityStore.open({
        workspaceId: "workspace",
        replicaId,
        loroPeerId: "808",
        documents,
        admitRecords: admitAuthorityRecords,
      });
    const firstFacts = await openFacts();
    const checkpoints = new ProjectionCheckpointRepository(documents, "checkpoint-test-key");
    const first = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts: firstFacts,
      versions,
      checkpoints,
    });
    await first.execute(createNode());
    await firstFacts.commit({
      invocationId: "tail",
      request: { kind: "tail" },
      writes: [
        {
          kind: "transaction",
          bodies: [
            {
              kind: "contribution",
              actorId: "actor",
              intent: "direct",
              mutation: { kind: "node-create", nodeId: "tail-node" },
            },
            {
              kind: "contribution",
              actorId: "actor",
              intent: "direct",
              mutation: {
                kind: "occurrence-create",
                occurrenceId: "tail-node-original",
                nodeId: "tail-node",
                parentNodeId: "workspace",
                anchor: end,
              },
            },
          ],
        },
      ],
      lineage: null,
      publishedFrontier: firstFacts.snapshot().frontier,
    });

    const restarted = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts: await openFacts(),
      versions,
      checkpoints,
    });
    expect(
      await restarted.query({ kind: "projection", workspaceId: "workspace", view: "origin" }),
    ).toMatchObject({ nodes: { node: { nodeId: "node" }, "tail-node": { nodeId: "tail-node" } } });
  });
});

class ControlledPublisher implements ProjectionPublisher {
  fail = false;
  readonly generations: Parameters<ProjectionPublisher["publish"]>[0][] = [];

  publish(generation: Parameters<ProjectionPublisher["publish"]>[0]): Promise<void> {
    if (this.fail) {
      return Promise.reject(new Error("injected projection failure"));
    }
    this.generations.push(generation);
    return Promise.resolve();
  }
}

class GatePublisher implements ProjectionPublisher {
  readonly entered: Promise<void>;
  private enter!: () => void;
  private continue!: () => void;
  private readonly gate: Promise<void>;
  private enabled = false;

  constructor() {
    this.entered = new Promise((resolve) => {
      this.enter = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.continue = resolve;
    });
  }

  async publish(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    this.enter();
    await this.gate;
  }

  enable(): void {
    this.enabled = true;
  }

  release(): void {
    this.continue();
  }
}

async function appendMalformedAuthorityRecord(documents: DocumentStore): Promise<void> {
  await documents.appendUpdate(
    FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
    new TextEncoder().encode(JSON.stringify([{ recordKind: "future" }])),
  );
}

async function commitAuthorityNode(
  facts: FactAuthorityStore,
  invocationId: string,
  nodeId: string,
): Promise<void> {
  await facts.commit({
    invocationId,
    request: { kind: "remote-authority-node", nodeId },
    writes: [
      {
        kind: "transaction",
        bodies: authorityNodeBodies(nodeId),
      },
    ],
    lineage: null,
    publishedFrontier: facts.snapshot().frontier,
  });
}

async function commitFactOnlyNodes(
  facts: FactAuthorityStore,
  invocationId: string,
  nodeIds: readonly string[],
): Promise<void> {
  await facts.commit({
    invocationId,
    request: { kind: "fact-only-nodes", nodeIds },
    writes: nodeIds.map((nodeId) => ({
      kind: "contribution" as const,
      actorId: "fact-only",
      intent: "direct" as const,
      mutation: { kind: "node-create" as const, nodeId },
    })),
    lineage: null,
    publishedFrontier: facts.snapshot().frontier,
  });
}

function authorityNodeBodies(nodeId: string) {
  return [
    {
      kind: "contribution" as const,
      actorId: "remote",
      intent: "direct" as const,
      mutation: { kind: "node-create" as const, nodeId },
    },
    {
      kind: "contribution" as const,
      actorId: "remote",
      intent: "direct" as const,
      mutation: {
        kind: "occurrence-create" as const,
        occurrenceId: `${nodeId}-original`,
        nodeId,
        parentNodeId: "workspace",
        anchor: end,
      },
    },
  ] as const;
}

class PersistThenFailDocumentStore extends InMemoryDocumentStore {
  fail = true;

  override async appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    const sequence = await super.appendUpdate(id, bytes);
    if (this.fail) {
      throw new Error("injected crash after durable append");
    }
    return sequence;
  }
}

class ManifestAckLossDocumentStore extends InMemoryDocumentStore {
  private armed = false;

  loseNextManifestAcknowledgement(): void {
    this.armed = true;
  }

  override async writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    await super.writeSnapshot(id, bytes);
    if (this.armed && id === "materialized-generation/manifest") {
      this.armed = false;
      throw new Error("injected lost manifest acknowledgement");
    }
  }
}

class GateCheckpointRepository extends ProjectionCheckpointRepository {
  private enabled = false;
  private enter!: () => void;
  private continue!: () => void;
  entered: Promise<void> = Promise.resolve();

  constructor(documents: DocumentStore) {
    super(documents, "checkpoint-test-key");
  }

  gateNextSave(): void {
    this.enabled = true;
    this.entered = new Promise((resolve) => {
      this.enter = resolve;
    });
  }

  release(): void {
    this.continue?.();
  }

  override async save(
    workspaceId: string,
    snapshot: Parameters<ProjectionCheckpointRepository["save"]>[1],
    generation: Parameters<ProjectionCheckpointRepository["save"]>[2],
  ): Promise<void> {
    if (this.enabled) {
      this.enabled = false;
      this.enter();
      await new Promise<void>((resolve) => {
        this.continue = resolve;
      });
    }
    return super.save(workspaceId, snapshot, generation);
  }
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
