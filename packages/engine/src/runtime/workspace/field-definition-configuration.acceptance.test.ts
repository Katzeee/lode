import { describe, expect, it } from "vitest";

import type { MutationCommand } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthorityStore } from "../authority/fact-authority-store.js";
import { ProposalWorkspace } from "./proposal-workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Field Definition configuration", () => {
  it("keeps typed configuration identities across Proposal, History, values, and ancestor initialization", async () => {
    const workspace = await setup();
    await execute(
      workspace,
      command("field-fixture", "setup", [
        nodeAt("task-tag", "workspace", "task-tag-original"),
        nodeAt("status", "workspace", "status-original"),
        nodeAt("ancestor", "workspace", "ancestor-original"),
        { kind: "node-type-declare", nodeId: "task-tag", nodeType: "supertag-definition" },
        { kind: "node-type-declare", nodeId: "status", nodeType: "field-definition" },
        {
          kind: "supertag-field-add",
          supertagId: "task-tag",
          fieldDefinitionId: "status",
          fieldNodeId: "status-template-field",
          fieldOccurrenceId: "status-template-field-occurrence",
          anchor: end,
        },
        {
          kind: "supertag-field-configure",
          supertagId: "task-tag",
          fieldDefinitionId: "status",
          fieldNodeId: "status-template-field",
          config: { visibility: "pinned", staticDefault: null },
        },
        { kind: "supertag-apply", nodeId: "ancestor", supertagId: "task-tag", anchor: end },
      ]),
    );
    await execute(workspace, command("child", "setup", [nodeAt("child", "ancestor", "child-original")]));
    await execute(
      workspace,
      command("ancestor-field", "setup", [
        {
          kind: "field-materialize",
          ownerNodeId: "ancestor",
          fieldDefinitionId: "status",
          fieldNodeId: "ancestor-status-field",
          fieldOccurrenceId: "ancestor-status-field-occurrence",
        },
      ]),
    );
    await execute(
      workspace,
      command("ancestor-value", "setup", [
        nodeAt(
          "ancestor-status-value",
          "ancestor-status-field",
          "ancestor-status-value-occurrence",
          undefined,
          "Ready",
        ),
      ]),
    );

    await execute(
      workspace,
      command("field-configurations", "field-config", [
        {
          kind: "field-datatype-configuration-create",
          fieldDefinitionId: "status",
          metanodeId: "status-metanode",
          configurationNodeId: "status-datatype",
          configurationOccurrenceId: "status-datatype-occurrence",
          datatype: "plain",
          anchor: end,
        },
        {
          kind: "field-cardinality-configuration-create",
          fieldDefinitionId: "status",
          metanodeId: "status-metanode",
          configurationNodeId: "status-cardinality",
          configurationOccurrenceId: "status-cardinality-occurrence",
          cardinality: "single",
          anchor: end,
        },
        {
          kind: "field-initialization-expression-configuration-create",
          fieldDefinitionId: "status",
          metanodeId: "status-metanode",
          configurationNodeId: "status-initialization",
          configurationOccurrenceId: "status-initialization-occurrence",
          expression: { kind: "ancestor-field-values", sourceFieldDefinitionId: "status" },
          anchor: end,
        },
      ]),
    );

    expect(await configurations(workspace, "origin")).toMatchObject({
      status: [
        { kind: "datatype", configurationNodeId: "status-datatype", datatype: "plain" },
        { kind: "cardinality", configurationNodeId: "status-cardinality", cardinality: "single" },
        {
          kind: "initialization-expression",
          configurationNodeId: "status-initialization",
          expression: { kind: "ancestor-field-values", sourceFieldDefinitionId: "status" },
        },
      ],
    });

    await execute(
      workspace,
      command(
        "propose-options",
        "field-config",
        [
          {
            kind: "field-datatype-configure",
            fieldDefinitionId: "status",
            configurationNodeId: "status-datatype",
            configurationOccurrenceId: "status-datatype-occurrence",
            datatype: "options",
          },
        ],
        "proposal",
      ),
    );
    expect((await configurations(workspace, "origin")).status?.[0]).toMatchObject({ datatype: "plain" });
    expect((await configurations(workspace, "review")).status?.[0]).toMatchObject({ datatype: "options" });
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    const hunk =
      "hunks" in review
        ? review.hunks.find((candidate) => candidate.diffSpace.kind === "field-definition-configuration")
        : undefined;
    if (!hunk) {
      throw new Error("Expected Field Definition configuration Review Hunk");
    }
    await execute(workspace, {
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "accept-options",
      actorId: "reviewer",
      decision: "accept",
      selection: hunk.selection,
    });

    await execute(
      workspace,
      command("cardinality-list", "cardinality", [
        {
          kind: "field-cardinality-configure",
          fieldDefinitionId: "status",
          configurationNodeId: "status-cardinality",
          configurationOccurrenceId: "status-cardinality-occurrence",
          cardinality: "list",
        },
      ]),
    );
    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "cardinality" });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected Field cardinality Undo");
    }
    await execute(workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-cardinality",
      actorId: "actor",
      selection: history.undo,
    });
    expect((await configurations(workspace, "origin")).status?.[1]).toMatchObject({
      configurationNodeId: "status-cardinality",
      cardinality: "single",
    });

    await execute(
      workspace,
      command("apply-child", "child", [
        { kind: "supertag-apply", nodeId: "child", supertagId: "task-tag", anchor: end },
      ]),
    );
    const fields = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "effectiveFields",
    });
    if (!("effectiveFields" in fields)) {
      throw new Error("Expected Effective Fields");
    }
    expect(fields.effectiveFields.child?.[0]).toMatchObject({
      fieldDefinitionId: "status",
      initializedValues: [{ kind: "text", value: "Ready" }],
    });

    const nodes = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
    });
    if (!("nodes" in nodes)) {
      throw new Error("Expected Nodes");
    }
    expect(nodes.nodes["ancestor-status-value"]?.content).toMatchObject([{ kind: "text", value: "Ready" }]);
  });
});

async function setup(): Promise<ProposalWorkspace> {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId: "601",
    documents: new InMemoryDocumentStore(),
    admitRecords: admitAuthorityRecords,
  });
  return ProposalWorkspace.open({ workspaceId: "workspace", facts, versions });
}

async function configurations(workspace: ProposalWorkspace, perspective: "origin" | "review") {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: "fieldDefinitionConfigurations",
  });
  if (!("fieldDefinitionConfigurations" in result)) {
    throw new Error("Expected Field Definition configurations");
  }
  return result.fieldDefinitionConfigurations;
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  nodeType?: "supertag-definition" | "field-definition",
  text?: string,
) {
  return {
    kind: "node-create" as const,
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: end,
    ...(nodeType === undefined ? {} : { nodeType }),
    ...(text === undefined ? {} : { seed: { text: [{ value: text, attributes: {} }] } }),
  };
}

function command(
  invocationId: string,
  historyChannelId: string,
  mutations: MutationCommand["mutations"],
  intent: MutationCommand["intent"] = "direct",
): MutationCommand {
  return {
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId,
    mutations,
  };
}

async function execute(workspace: ProposalWorkspace, command: Parameters<ProposalWorkspace["execute"]>[0]) {
  const result = await workspace.execute(command);
  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  expect(result.status).toBe("published");
  return result;
}
