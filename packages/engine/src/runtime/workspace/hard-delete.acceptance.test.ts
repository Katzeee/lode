import { describe, expect, it } from "vitest";

import type { HardDeletePreview, MutationCommand } from "../../application/contract.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, LoroFactStore } from "../authority/loro-fact-store.js";
import { FactSyncComposite } from "../sync/fact-sync.js";
import { syncPair } from "../sync/sync-exchange.js";
import { ProposalWorkspace } from "./proposal-workspace.js";

const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Hard Delete maintenance", () => {
  it("requires a current acknowledgement, rejects stale evidence, and leaves an anti-resurrection marker", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open(documents, "101");
    expect((await opened.workspace.execute(setupCommand())).status).toBe("published");
    const deletion = await opened.workspace.execute(deleteSchemaCommand("delete-schema"));
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected durable Schema tombstone");
    }
    const deletionFactIds = [deletion.receipt.factIds[0]];
    let preview = await previewHardDelete(opened.workspace);
    expect(preview).toMatchObject({
      canExecute: false,
      blockers: ["replica-unconfirmed"],
      referenceOccurrenceIds: ["schema-reference"],
      schemaApplicationNodeIds: ["task"],
    });
    expect(preview.historyImpact).toMatchObject({
      affectedChannelIds: ["maintenance-test"],
      truncated: false,
    });
    expect(preview.historyImpact.affectedInvocationIds).toEqual(
      expect.arrayContaining(["hard-delete-setup", "delete-schema"]),
    );

    expect(
      (
        await opened.workspace.execute({
          kind: "acknowledge-deletion",
          workspaceId: "workspace",
          invocationId: "acknowledge-schema-deletion",
          actorId: "maintainer",
          nodeId: "task-schema",
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
          mutations: [{ kind: "node-create", nodeId: "unrelated" }],
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
      invocationId: "purge-task-schema",
      actorId: "maintainer",
      selection: preview.selection,
    });
    expect(purged.status).toBe("published");
    expect(
      await opened.workspace.execute({
        kind: "hard-delete",
        workspaceId: "workspace",
        invocationId: "purge-task-schema",
        actorId: "maintainer",
        selection: preview.selection,
      }),
    ).toEqual(purged);
    expect(await projectionMap(opened.workspace, "definitionStatuses")).not.toHaveProperty(
      "task-schema",
    );
    expect(await projectionMap(opened.workspace, "schemaApplications")).not.toHaveProperty("task");

    await opened.workspace.close();
    const restarted = await open(documents, "202", opened.facts.replicaId);
    expect(await projectionMap(restarted.workspace, "definitionStatuses")).not.toHaveProperty(
      "task-schema",
    );
    const restartedPreview = await previewHardDelete(restarted.workspace);
    expect(restartedPreview.canExecute).toBe(false);
    expect(restartedPreview.blockers).toContain("already-purged");
    expect(restartedPreview.historyImpact.affectedInvocationIds).toEqual(
      expect.arrayContaining(["hard-delete-setup", "delete-schema"]),
    );
  });

  it("lists a related pending Proposal as a destructive blocker", async () => {
    const opened = await open(new InMemoryDocumentStore(), "303");
    expect((await opened.workspace.execute(setupCommand())).status).toBe("published");
    expect(
      (
        await opened.workspace.execute({
          ...command("pending-schema-edit", "proposal"),
          mutations: [
            {
              kind: "value-set",
              owner: { kind: "node", id: "task-schema" },
              namespace: "metadata",
              key: "color",
              value: "red",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (await opened.workspace.execute(deleteSchemaCommand("delete-with-pending"))).status,
    ).toBe("published");
    const preview = await previewHardDelete(opened.workspace);
    expect(preview.blockers).toEqual(
      expect.arrayContaining(["pending-proposal", "replica-unconfirmed"]),
    );
    expect(preview.pendingProposalContributionIds).toHaveLength(1);
  });

  it("requires every known Replica to causally acknowledge the tombstone", async () => {
    const left = await open(new InMemoryDocumentStore(), "404");
    const right = await open(new InMemoryDocumentStore(), "505");
    expect((await left.workspace.execute(setupCommand())).status).toBe("published");
    const deletion = await left.workspace.execute(deleteSchemaCommand("multi-delete"));
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected multi-Replica tombstone");
    }
    const deletionFactIds = [deletion.receipt.factIds[0]];
    await syncPair(new FactSyncComposite(left.facts), new FactSyncComposite(right.facts));
    await right.workspace.reconcileAuthorityAdvance();
    expect(
      (
        await right.workspace.execute({
          ...command("right-presence"),
          mutations: [{ kind: "node-create", nodeId: "right-node" }],
        })
      ).status,
    ).toBe("published");
    await syncPair(new FactSyncComposite(right.facts), new FactSyncComposite(left.facts));
    await left.workspace.reconcileAuthorityAdvance();

    await acknowledge(left.workspace, "left-ack", deletionFactIds);
    let preview = await previewHardDelete(left.workspace);
    expect(preview.knownReplicaIds).toEqual(
      expect.arrayContaining([left.facts.replicaId, right.facts.replicaId]),
    );
    expect(preview.blockers).toContain("replica-unconfirmed");

    await acknowledge(right.workspace, "right-ack", deletionFactIds);
    await syncPair(new FactSyncComposite(right.facts), new FactSyncComposite(left.facts));
    await left.workspace.reconcileAuthorityAdvance();
    preview = await previewHardDelete(left.workspace);
    expect(preview.acknowledgedReplicaIds).toEqual(
      expect.arrayContaining([left.facts.replicaId, right.facts.replicaId]),
    );
    expect(preview.canExecute).toBe(true);
    expect(
      (
        await left.workspace.execute({
          kind: "hard-delete",
          workspaceId: "workspace",
          invocationId: "multi-replica-purge",
          actorId: "maintainer",
          selection: preview.selection,
        })
      ).status,
    ).toBe("published");
    await syncPair(new FactSyncComposite(left.facts), new FactSyncComposite(right.facts));
    await right.workspace.reconcileAuthorityAdvance();
    expect(await projectionMap(right.workspace, "definitionStatuses")).not.toHaveProperty(
      "task-schema",
    );
  });

  it("requires explicit retirement before an unavailable known Replica stops blocking purge", async () => {
    const left = await open(new InMemoryDocumentStore(), "606");
    const right = await open(new InMemoryDocumentStore(), "707");
    expect((await left.workspace.execute(setupCommand())).status).toBe("published");
    const deletion = await left.workspace.execute(deleteSchemaCommand("retirement-delete"));
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected retirement fixture tombstone");
    }
    const deletionFactIds = [deletion.receipt.factIds[0]];
    await syncPair(new FactSyncComposite(left.facts), new FactSyncComposite(right.facts));
    await right.workspace.reconcileAuthorityAdvance();
    expect(
      (
        await right.workspace.execute({
          ...command("retiring-replica-presence"),
          mutations: [{ kind: "node-create", nodeId: "retiring-replica-node" }],
        })
      ).status,
    ).toBe("published");
    await syncPair(new FactSyncComposite(right.facts), new FactSyncComposite(left.facts));
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

async function open(
  documents: InMemoryDocumentStore,
  peer: `${number}`,
  replicaId = createReplicaId(),
) {
  const facts = await LoroFactStore.open({
    workspaceId: "workspace",
    replicaId,
    loroPeerId: peer,
    documents,
  });
  return {
    facts,
    workspace: await ProposalWorkspace.open({ workspaceId: "workspace", facts, versions }),
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
    mutations: [{ kind: "node-create", nodeId: invocationId }],
  };
}

function setupCommand(): MutationCommand {
  return {
    ...command("hard-delete-setup"),
    mutations: [
      { kind: "node-create", nodeId: "task-schema" },
      { kind: "node-create", nodeId: "task" },
      {
        kind: "occurrence-create",
        occurrenceId: "schema-reference",
        nodeId: "task-schema",
        parentOccurrenceId: null,
        parentPolicy: "cascade",
        anchor: end,
      },
      { kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end },
    ],
  };
}

function deleteSchemaCommand(invocationId: string): MutationCommand {
  return { ...command(invocationId), mutations: [{ kind: "node-delete", nodeId: "task-schema" }] };
}

async function previewHardDelete(workspace: ProposalWorkspace): Promise<HardDeletePreview> {
  const result = await workspace.query({
    kind: "hard-delete-preview",
    workspaceId: "workspace",
    nodeId: "task-schema",
  });
  if (!("blockers" in result)) {
    throw new Error("Expected Hard Delete preview");
  }
  return result;
}

async function acknowledge(
  workspace: ProposalWorkspace,
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
        nodeId: "task-schema",
        deletionFactIds,
      })
    ).status,
  ).toBe("published");
}

async function projectionMap(
  workspace: ProposalWorkspace,
  section: "definitionStatuses" | "schemaApplications",
) {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
    section,
  });
  if (!("entries" in result)) {
    throw new Error(`Expected ${section} Projection`);
  }
  return Object.fromEntries(result.entries.map((entry) => [entry.identity, entry.value]));
}
