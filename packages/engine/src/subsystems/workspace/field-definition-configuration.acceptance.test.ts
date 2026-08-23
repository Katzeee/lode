import { describe, expect, it } from "vitest";
import {
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_CONFIGURATION_DEFINITION_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  FIELD_OPTIONALITY_NODE_IDS,
} from "../../domain/fact/index.js";

import type { EditCommand } from "@lode/sdk";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactReplication } from "./fact-replication.js";
import { syncPair } from "../../../tests/support/sync.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Field Definition configuration", () => {
  it("projects semantic configurations across Proposal and History and rejects ordinary values", async () => {
    const workspace = await setup();
    await execute(
      workspace,
      command("field-fixture", "setup", [
        nodeAt("status", "workspace", "status-original", "field-definition"),
        nodeAt("ordinary", "workspace", "ordinary-original"),
      ]),
    );

    expect(
      await workspace.execute(
        command("reject-ordinary-datatype", "field-config", [
          {
            kind: "field-datatype-configure",
            fieldDefinitionId: "status",
            datatypeNodeId: "ordinary",
          },
        ]),
      ),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });

    await execute(
      workspace,
      command("field-configurations", "field-config", [
        {
          kind: "field-datatype-configure",
          fieldDefinitionId: "status",
          datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
        },
        {
          kind: "field-cardinality-configure",
          fieldDefinitionId: "status",
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
        },
        {
          kind: "field-optionality-configure",
          fieldDefinitionId: "status",
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
        },
        {
          kind: "field-initialization-expression-configure",
          fieldDefinitionId: "status",
          expression: {
            kind: "find-field-values",
            sourceFieldDefinitionId: "status",
          },
        },
      ]),
    );

    expect(await configurations(workspace, "origin")).toMatchObject({
      status: [
        {
          kind: "datatype",
          definitionNodeId: FIELD_CONFIGURATION_DEFINITION_NODE_IDS.datatype,
          datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
        },
        {
          kind: "cardinality",
          definitionNodeId: FIELD_CONFIGURATION_DEFINITION_NODE_IDS.cardinality,
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
        },
        {
          kind: "optionality",
          definitionNodeId: FIELD_CONFIGURATION_DEFINITION_NODE_IDS.optionality,
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
        },
        {
          kind: "initialization-expression",
          definitionNodeId: FIELD_CONFIGURATION_DEFINITION_NODE_IDS.initializationExpression,
          expression: {
            kind: "find-field-values",
            sourceFieldDefinitionId: "status",
          },
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
            datatypeNodeId: FIELD_DATATYPE_NODE_IDS.options,
          },
        ],
        "proposal",
      ),
    );
    expect(configurationOfKind(await configurations(workspace, "origin"), "datatype")).toMatchObject({
      datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
    });
    expect(configurationOfKind(await configurations(workspace, "review"), "datatype")).toMatchObject({
      datatypeNodeId: FIELD_DATATYPE_NODE_IDS.options,
    });
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
      command("optionality-yes", "optionality", [
        {
          kind: "field-optionality-configure",
          fieldDefinitionId: "status",
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.yes,
        },
      ]),
    );
    const optionalityHistory = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "optionality",
    });
    if (!("undo" in optionalityHistory) || !optionalityHistory.undo) {
      throw new Error("Expected Field optionality Undo");
    }
    await execute(workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-optionality",
      actorId: "actor",
      selection: optionalityHistory.undo,
    });
    expect(configurationOfKind(await configurations(workspace, "origin"), "optionality")).toMatchObject({
      optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
    });

    await execute(
      workspace,
      command("cardinality-list", "cardinality", [
        {
          kind: "field-cardinality-configure",
          fieldDefinitionId: "status",
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.list,
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
    expect(configurationOfKind(await configurations(workspace, "origin"), "cardinality")).toMatchObject({
      cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
    });
  });

  it("round-trips Optionality through Fact Sync without broadening its transaction authority", async () => {
    const left = await open("701");
    const right = await open("702");
    await execute(
      left.workspace,
      command("sync-field-fixture", "sync-setup", [
        nodeAt("status", "workspace", "status-original", "field-definition"),
      ]),
    );
    await execute(
      left.workspace,
      command("sync-field-configurations", "sync-setup", [
        {
          kind: "field-cardinality-configure",
          fieldDefinitionId: "status",
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
        },
        {
          kind: "field-optionality-configure",
          fieldDefinitionId: "status",
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
        },
      ]),
    );
    await execute(
      left.workspace,
      command("sync-optionality-yes", "sync-optionality", [
        {
          kind: "field-optionality-configure",
          fieldDefinitionId: "status",
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.yes,
        },
      ]),
    );

    await syncPair(new FactReplication(left.facts.replication), new FactReplication(right.facts.replication));
    await left.workspace.reconcileAuthorityAdvance();
    await right.workspace.reconcileAuthorityAdvance();
    expect(configurationOfKind(await configurations(right.workspace, "origin"), "optionality")).toMatchObject({
      kind: "optionality",
      optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.yes,
    });
  });

  it("lets a later direct semantic value supersede a pending Proposal without depending on it", async () => {
    const workspace = await setup();
    await execute(
      workspace,
      command("field", "setup", [nodeAt("status", "workspace", "status-original", "field-definition")]),
    );
    await execute(
      workspace,
      command("plain", "field-config", [
        {
          kind: "field-datatype-configure",
          fieldDefinitionId: "status",
          datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
        },
      ]),
    );
    await execute(
      workspace,
      command(
        "proposed-options",
        "field-config",
        [
          {
            kind: "field-datatype-configure",
            fieldDefinitionId: "status",
            datatypeNodeId: FIELD_DATATYPE_NODE_IDS.options,
          },
        ],
        "proposal",
      ),
    );
    await execute(
      workspace,
      command("date", "field-config", [
        { kind: "field-datatype-configure", fieldDefinitionId: "status", datatypeNodeId: FIELD_DATATYPE_NODE_IDS.date },
      ]),
    );

    for (const perspective of ["origin", "review"] as const) {
      expect(configurationOfKind(await configurations(workspace, perspective), "datatype")).toMatchObject({
        datatypeNodeId: FIELD_DATATYPE_NODE_IDS.date,
      });
    }
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    expect("hunks" in review ? review.hunks : []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ diffSpace: { kind: "field-definition-configuration" } })]),
    );
  });
});

async function setup(): Promise<Workspace> {
  return (await open("601")).workspace;
}

async function open(loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId,
    documents: new InMemoryDocumentStore(),
  });
  return { facts, workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }) };
}

async function configurations(workspace: Workspace, perspective: "origin" | "review") {
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

function configurationOfKind(
  values: Awaited<ReturnType<typeof configurations>>,
  kind: "datatype" | "cardinality" | "optionality" | "initialization-expression",
) {
  return values.status?.find((configuration) => configuration.kind === kind);
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  intrinsicNodeType?: "supertag-definition" | "field-definition",
  text?: string,
) {
  return {
    kind: "node-create" as const,
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: end,
    ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType }),
    ...(text === undefined ? {} : { seed: { text: [{ value: text, attributes: {} }] } }),
  };
}

function command(
  invocationId: string,
  historyChannelId: string,
  actions: EditCommand["actions"],
  intent: EditCommand["intent"] = "direct",
): EditCommand {
  return {
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId,
    actions,
  };
}

async function execute(workspace: Workspace, command: Parameters<Workspace["execute"]>[0]) {
  const result = await workspace.execute(command);
  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  expect(result.status, JSON.stringify(result)).toBe("published");
  return result;
}
