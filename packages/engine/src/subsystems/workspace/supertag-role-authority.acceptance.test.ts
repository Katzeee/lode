import { describe, expect, it } from "vitest";
import { END_SEQUENCE_ANCHOR as anchor, type EditAction } from "@lode/sdk";
import { openTestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { graphActionBody } from "../../domain/fact/index.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { createFactDocument, appendFactRecords, importFactRecords } from "./authority/loro-fact-records.js";

describe("Supertag role structural authority", () => {
  it("rejects known typed subjects before commit and when importing raw Fact bytes", async () => {
    const facts = await FactAuthority.open({
      workspaceId: "workspace",
      documents: new InMemoryDocumentStore(),
      loroPeerId: "9980",
    });
    const workspace = await openTestWorkspace({ workspaceId: "workspace", facts, versions });
    expect(
      await workspace.execute({
        kind: "edit",
        workspaceId: "workspace",
        actorId: "setup",
        invocationId: "setup",
        intent: "direct",
        historyChannelId: "setup",
        actions: [
          nodeAt("owner", "workspace"),
          { kind: "node-convert-to-supertag", nodeId: "owner" },
          nodeAt("field", "workspace", undefined, { intrinsicNodeType: "field-definition" }),
          nodeAt("tag", "workspace", undefined, { intrinsicNodeType: "supertag-definition" }),
          {
            kind: "supertag-template-field-create",
            supertagId: "tag",
            fieldDefinitionId: "derived-definition",
            anchor,
          },
          {
            kind: "field-value-create",
            ownerNodeId: "owner",
            fieldDefinitionId: "field",
            valueNodeId: "value",
            valueOccurrenceId: "value-occ",
            anchor,
          },
        ],
      }),
    ).toMatchObject({ status: "published" });
    const templates = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "templateFields",
    });
    const fields = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "materializedFields",
    });
    if (!("templateFields" in templates) || !("materializedFields" in fields)) {
      throw new Error("Field projections absent");
    }
    const templateNodeId = templates.templateFields.tag?.[0]?.templateFieldNodeId;
    const fieldNodeId = fields.materializedFields.owner?.[0]?.fieldNodeId;
    if (!templateNodeId || !fieldNodeId) {
      throw new Error("Field identities absent");
    }
    const before = facts.snapshot();
    const validBytes = await facts.replication.exportUpdate();
    for (const nodeId of ["workspace", "field", "derived-definition", templateNodeId, fieldNodeId]) {
      const body = graphActionBody("raw", "direct", [{ kind: "supertag-role-add", nodeId }]);
      await expect(
        facts.commit({
          invocationId: `raw-${nodeId}`,
          request: { kind: "raw-role-audit", nodeId },
          writes: [body],
          lineage: null,
          publishedFrontier: before.frontier,
        }),
      ).rejects.toThrow("observed ordinary Node");
      expect(facts.snapshot()).toEqual(before);
      const untrusted = createFactDocument("9981");
      importFactRecords(untrusted, "workspace", validBytes);
      appendFactRecords(untrusted, "workspace", [body], 1);
      const receiver = await FactAuthority.open({
        workspaceId: "workspace",
        documents: new InMemoryDocumentStore(),
        loroPeerId: "9982",
      });
      await expect(receiver.replication.importUpdate(untrusted.export({ mode: "update" }))).rejects.toThrow(
        "observed ordinary Node",
      );
      expect(receiver.snapshot().facts).toEqual([]);
    }
    await workspace.close();
  });

  it("preserves unobserved incompatible declarations as a type conflict instead of selecting the first creator", async () => {
    const leftFacts = await FactAuthority.open({
      workspaceId: "workspace",
      documents: new InMemoryDocumentStore(),
      loroPeerId: "9983",
    });
    const left = await openTestWorkspace({ workspaceId: "workspace", facts: leftFacts, versions });
    const rightFacts = await FactAuthority.open({
      workspaceId: "workspace",
      documents: new InMemoryDocumentStore(),
      loroPeerId: "9984",
    });
    await rightFacts.replication.importUpdate(await leftFacts.replication.exportUpdate());
    const right = await openTestWorkspace({ workspaceId: "workspace", facts: rightFacts, versions });
    async function edit(workspace: typeof left, invocationId: string, actions: readonly EditAction[]) {
      expect(
        await workspace.execute({
          kind: "edit",
          workspaceId: "workspace",
          actorId: invocationId,
          invocationId,
          intent: "direct",
          historyChannelId: invocationId,
          actions,
        }),
      ).toMatchObject({ status: "published" });
    }
    await edit(left, "ordinary", [nodeAt("collision", "workspace")]);
    await edit(left, "convert", [{ kind: "node-convert-to-supertag", nodeId: "collision" }]);
    await edit(right, "field", [
      nodeAt("collision", "workspace", undefined, { intrinsicNodeType: "field-definition" }),
    ]);
    await leftFacts.replication.importUpdate(await rightFacts.replication.exportUpdate());
    await rightFacts.replication.importUpdate(await leftFacts.replication.exportUpdate());
    await left.reconcileAuthorityAdvance();
    await right.reconcileAuthorityAdvance();
    for (const workspace of [left, right]) {
      const nodes = await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "nodes",
      });
      if (!("nodes" in nodes)) {
        throw new Error("Nodes absent");
      }
      expect(nodes.nodes.collision?.intrinsicNodeType).toBe(null);
      expect(nodes.nodes.workspace?.intrinsicNodeType).toBe("workspace");
      const conflicts = await workspace.query({ kind: "conflicts", workspaceId: "workspace" });
      if (!("issues" in conflicts)) {
        throw new Error("Conflicts absent");
      }
      const issue = conflicts.issues.find(
        (item) => item.kind === "intrinsic-node-type-conflict" && item.nodeId === "collision",
      );
      expect(issue).toMatchObject({ kind: "intrinsic-node-type-conflict" });
    }
    await left.close();
    await right.close();
  });
});
