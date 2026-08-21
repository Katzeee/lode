import { describe, expect, it } from "vitest";
import { createSupertagApplication } from "../../../tests/support/workspace/edit-test-mutations.js";

import type { HardDeletePreview, MutationCommand } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthority } from "./authority/fact-authority.js";
import { FactReplication } from "./fact-replication.js";
import { syncPair } from "../../../tests/support/sync.js";
import { Workspace } from "./workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Hard Delete maintenance", () => {
  it("requires a current acknowledgement, rejects stale evidence, and leaves an anti-resurrection marker", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open(documents, "101");
    expect((await opened.workspace.execute(setupCommand())).status).toBe("published");
    const deletion = await opened.workspace.execute(deleteSupertagCommand("delete-supertag"));
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected durable Supertag deletion");
    }
    const deletionFactIds = [deletion.receipt.factIds[0]];
    let preview = await previewHardDelete(opened.workspace);
    expect(preview).toMatchObject({
      canExecute: false,
      blockers: ["replica-unconfirmed"],
      supertagApplicationNodeIds: ["task"],
    });
    expect(preview.referenceOccurrenceIds).toContain("supertag-reference");
    expect(preview.referenceOccurrenceIds).toContain("task-supertag-application-task-supertag-1-definition-occurrence");
    expect(preview.historyImpact).toMatchObject({
      affectedChannelIds: ["maintenance-test"],
      truncated: false,
    });
    expect(preview.historyImpact.affectedInvocationIds).toEqual(
      expect.arrayContaining(["hard-delete-setup", "delete-supertag"]),
    );

    expect(
      (
        await opened.workspace.execute({
          kind: "acknowledge-deletion",
          workspaceId: "workspace",
          invocationId: "acknowledge-supertag-deletion",
          actorId: "maintainer",
          nodeId: "task-supertag",
          deletionFactIds,
        })
      ).status,
    ).toBe("published");
    preview = await previewHardDelete(opened.workspace);
    expect(preview).toMatchObject({ canExecute: true, blockers: [] });

    expect(
      (
        await opened.workspace.execute({
          ...command("advance-unrelated"),
          mutations: nodeAtWorkspace("unrelated"),
        })
      ).status,
    ).toBe("published");
    expect(
      await opened.workspace.execute({
        kind: "hard-delete",
        workspaceId: "workspace",
        invocationId: "stale-hard-delete",
        actorId: "maintainer",
        selection: preview.selection,
      }),
    ).toMatchObject({ status: "rejected", error: { code: "maintenance-blocked" } });

    preview = await previewHardDelete(opened.workspace);
    const purged = await opened.workspace.execute({
      kind: "hard-delete",
      workspaceId: "workspace",
      invocationId: "purge-task-supertag",
      actorId: "maintainer",
      selection: preview.selection,
    });
    expect(purged, JSON.stringify(purged)).toMatchObject({ status: "published" });
    expect(
      await opened.workspace.execute({
        kind: "hard-delete",
        workspaceId: "workspace",
        invocationId: "purge-task-supertag",
        actorId: "maintainer",
        selection: preview.selection,
      }),
    ).toEqual(purged);
    expect(await projectionMap(opened.workspace, "nodes")).not.toHaveProperty("task-supertag");
    expect(await projectionMap(opened.workspace, "supertagApplications")).not.toHaveProperty("task");

    await opened.workspace.close();
    const restarted = await open(documents, "202", opened.facts.replicaId);
    expect(await projectionMap(restarted.workspace, "nodes")).not.toHaveProperty("task-supertag");
    const restartedPreview = await previewHardDelete(restarted.workspace);
    expect(restartedPreview.canExecute).toBe(false);
    expect(restartedPreview.blockers).toContain("already-purged");
    expect(restartedPreview.historyImpact.affectedInvocationIds).toEqual(
      expect.arrayContaining(["hard-delete-setup", "delete-supertag"]),
    );
  });

  it("lists a related pending Proposal as a destructive blocker", async () => {
    const opened = await open(new InMemoryDocumentStore(), "303");
    expect((await opened.workspace.execute(setupCommand())).status).toBe("published");
    expect(
      (
        await opened.workspace.execute({
          ...command("pending-supertag-edit", "proposal"),
          mutations: [
            {
              kind: "text-splice",
              nodeId: "task-supertag",
              deleteAtomIds: [],
              anchor: end,
              insert: "pending",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect((await opened.workspace.execute(deleteSupertagCommand("delete-with-pending"))).status).toBe("published");
    const preview = await previewHardDelete(opened.workspace);
    expect(preview.blockers).toEqual(expect.arrayContaining(["pending-proposal", "replica-unconfirmed"]));
    expect(preview.pendingProposalContributionIds).toHaveLength(1);
  });

  it("blocks root-only purge while Trash contains owned descendants", async () => {
    const opened = await open(new InMemoryDocumentStore(), "313");
    expect(
      (
        await opened.workspace.execute({
          ...command("subtree-setup"),
          mutations: [
            ...nodeAtWorkspace("parent"),
            {
              kind: "node-create",
              occurrenceId: "child-original",
              nodeId: "child",
              parentNodeId: "parent",
              anchor: end,
            },
            {
              kind: "node-create",
              occurrenceId: "grandchild-original",
              nodeId: "grandchild",
              parentNodeId: "child",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    const deletion = await opened.workspace.execute({
      ...command("delete-subtree"),
      mutations: [{ kind: "node-delete", nodeId: "parent" }],
    });
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected subtree root deletion");
    }
    const deletionFactIds = [deletion.receipt.factIds[0]];
    expect(
      (
        await opened.workspace.execute({
          kind: "acknowledge-deletion",
          workspaceId: "workspace",
          invocationId: "acknowledge-subtree-deletion",
          actorId: "maintainer",
          nodeId: "parent",
          deletionFactIds,
        })
      ).status,
    ).toBe("published");

    const preview = await previewHardDelete(opened.workspace, "parent");
    expect(preview.ownedDescendantNodeIds).toEqual(["child", "grandchild"]);
    expect(preview.blockers).toEqual(["owned-descendants"]);
    expect(preview.canExecute).toBe(false);
    const rejected = await opened.workspace.execute({
      kind: "hard-delete",
      workspaceId: "workspace",
      invocationId: "reject-root-only-subtree-purge",
      actorId: "maintainer",
      selection: preview.selection,
    });
    expect(rejected, JSON.stringify(rejected)).toMatchObject({
      status: "rejected",
      error: { code: "maintenance-blocked" },
    });
  });

  it("requires every known Replica to causally acknowledge the Trash placement", async () => {
    const left = await open(new InMemoryDocumentStore(), "404");
    const right = await open(new InMemoryDocumentStore(), "505");
    expect((await left.workspace.execute(setupCommand())).status).toBe("published");
    const deletion = await left.workspace.execute(deleteSupertagCommand("multi-delete"));
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected multi-Replica deletion");
    }
    const deletionFactIds = [deletion.receipt.factIds[0]];
    await syncPair(new FactReplication(left.facts.replication), new FactReplication(right.facts.replication));
    await right.workspace.reconcileAuthorityAdvance();
    expect(
      (
        await right.workspace.execute({
          ...command("right-presence"),
          mutations: nodeAtWorkspace("right-node"),
        })
      ).status,
    ).toBe("published");
    await syncPair(new FactReplication(right.facts.replication), new FactReplication(left.facts.replication));
    await left.workspace.reconcileAuthorityAdvance();

    await acknowledge(left.workspace, "left-ack", deletionFactIds);
    let preview = await previewHardDelete(left.workspace);
    expect(preview.knownReplicaIds).toEqual(expect.arrayContaining([left.facts.replicaId, right.facts.replicaId]));
    expect(preview.blockers).toContain("replica-unconfirmed");

    await acknowledge(right.workspace, "right-ack", deletionFactIds);
    await syncPair(new FactReplication(right.facts.replication), new FactReplication(left.facts.replication));
    await left.workspace.reconcileAuthorityAdvance();
    preview = await previewHardDelete(left.workspace);
    expect(preview.acknowledgedReplicaIds).toEqual(
      expect.arrayContaining([left.facts.replicaId, right.facts.replicaId]),
    );
    expect(preview.canExecute).toBe(true);
    const purged = await left.workspace.execute({
      kind: "hard-delete",
      workspaceId: "workspace",
      invocationId: "multi-replica-purge",
      actorId: "maintainer",
      selection: preview.selection,
    });
    expect(purged, JSON.stringify(purged)).toMatchObject({ status: "published" });
    await syncPair(new FactReplication(left.facts.replication), new FactReplication(right.facts.replication));
    await right.workspace.reconcileAuthorityAdvance();
    expect(await projectionMap(right.workspace, "nodes")).not.toHaveProperty("task-supertag");
  });

  it("requires explicit retirement before an unavailable known Replica stops blocking purge", async () => {
    const left = await open(new InMemoryDocumentStore(), "606");
    const right = await open(new InMemoryDocumentStore(), "707");
    expect((await left.workspace.execute(setupCommand())).status).toBe("published");
    const deletion = await left.workspace.execute(deleteSupertagCommand("retirement-delete"));
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected retirement fixture deletion");
    }
    const deletionFactIds = [deletion.receipt.factIds[0]];
    await syncPair(new FactReplication(left.facts.replication), new FactReplication(right.facts.replication));
    await right.workspace.reconcileAuthorityAdvance();
    expect(
      (
        await right.workspace.execute({
          ...command("retiring-replica-presence"),
          mutations: nodeAtWorkspace("retiring-replica-node"),
        })
      ).status,
    ).toBe("published");
    await syncPair(new FactReplication(right.facts.replication), new FactReplication(left.facts.replication));
    await left.workspace.reconcileAuthorityAdvance();
    await acknowledge(left.workspace, "retirement-left-ack", deletionFactIds);
    expect((await previewHardDelete(left.workspace)).blockers).toContain("replica-unconfirmed");

    expect(
      (
        await left.workspace.execute({
          kind: "retire-replica",
          workspaceId: "workspace",
          invocationId: "retire-unavailable-replica",
          actorId: "maintainer",
          replicaId: right.facts.replicaId,
        })
      ).status,
    ).toBe("published");
    const preview = await previewHardDelete(left.workspace);
    expect(preview.selection.retiredReplicaIds).toEqual([right.facts.replicaId]);
    expect(preview.knownReplicaIds).toEqual([left.facts.replicaId]);
    expect(preview.canExecute).toBe(true);
  });
});

async function open(documents: InMemoryDocumentStore, peer: `${number}`, replicaId = createReplicaId()) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    replicaId,
    loroPeerId: peer,
    authorityJournal: documents,
    factReplication: documents,
    admitRecords: admitAuthorityRecords,
  });
  return {
    facts,
    workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }),
  };
}

function command(invocationId: string, intent: "direct" | "proposal" = "direct"): MutationCommand {
  return {
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "maintenance-test",
    mutations: nodeAtWorkspace(invocationId),
  };
}

function setupCommand(): MutationCommand {
  return {
    ...command("hard-delete-setup"),
    mutations: [
      {
        kind: "node-create",
        occurrenceId: "supertag-reference",
        nodeId: "task-supertag",
        parentNodeId: "workspace",
        anchor: end,
        intrinsicNodeType: "supertag-definition",
      },
      {
        kind: "node-create",
        occurrenceId: "task-original",
        nodeId: "task",
        parentNodeId: "workspace",
        anchor: end,
      },
      createSupertagApplication("task", "task-supertag"),
    ],
  };
}

function nodeAtWorkspace(nodeId: string) {
  return [
    {
      kind: "node-create" as const,
      occurrenceId: `${nodeId}-original`,
      nodeId,
      parentNodeId: "workspace",
      anchor: end,
    },
  ];
}

function deleteSupertagCommand(invocationId: string): MutationCommand {
  return { ...command(invocationId), mutations: [{ kind: "node-delete", nodeId: "task-supertag" }] };
}

async function previewHardDelete(workspace: Workspace, nodeId = "task-supertag"): Promise<HardDeletePreview> {
  const result = await workspace.query({
    kind: "hard-delete-preview",
    workspaceId: "workspace",
    nodeId,
  });
  if (!("blockers" in result)) {
    throw new Error("Expected Hard Delete preview");
  }
  return result;
}

async function acknowledge(
  workspace: Workspace,
  invocationId: string,
  deletionFactIds: readonly string[],
): Promise<void> {
  expect(
    (
      await workspace.execute({
        kind: "acknowledge-deletion",
        workspaceId: "workspace",
        invocationId,
        actorId: "maintainer",
        nodeId: "task-supertag",
        deletionFactIds,
      })
    ).status,
  ).toBe("published");
}

async function projectionMap(workspace: Workspace, section: "nodes" | "supertagApplications") {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section,
  });
  if (!("section" in result) || result.section !== section || !(section in result)) {
    throw new Error(`Expected ${section} Projection`);
  }
  return result.section === "nodes" ? result.nodes : result.supertagApplications;
}
