import { describe, expect, it } from "vitest";
import {
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_CONFIGURATION_DEFINITION_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  FIELD_OPTIONALITY_NODE_IDS,
  type Mutation,
} from "../../domain/fact/index.js";

import type { MutationCommand } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactReplication } from "./fact-replication.js";
import { syncPair } from "../../../tests/support/sync.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Field Definition configuration", () => {
  it("keeps typed configuration identities across Proposal and History", async () => {
    const workspace = await setup();
    await execute(
      workspace,
      command("field-fixture", "setup", [
        nodeAt("status", "workspace", "status-original"),
        { kind: "intrinsic-node-type-declare", nodeId: "status", intrinsicNodeType: "field-definition" },
      ]),
    );

    await execute(
      workspace,
      command("field-configurations", "field-config", [
        {
          kind: "field-datatype-configuration-create",
          fieldDefinitionId: "status",
          configurationNodeId: "status-datatype",
          configurationOccurrenceId: "status-datatype-occurrence",
          definitionOccurrenceId: "status-datatype-definition-occurrence",
          valueOccurrenceId: "status-datatype-value-occurrence",
          datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
          anchor: end,
        },
        {
          kind: "field-cardinality-configuration-create",
          fieldDefinitionId: "status",
          configurationNodeId: "status-cardinality",
          configurationOccurrenceId: "status-cardinality-occurrence",
          definitionOccurrenceId: "status-cardinality-definition-occurrence",
          valueOccurrenceId: "status-cardinality-value-occurrence",
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
          anchor: end,
        },
        {
          kind: "field-optionality-configuration-create",
          fieldDefinitionId: "status",
          configurationNodeId: "status-optionality",
          configurationOccurrenceId: "status-optionality-occurrence",
          definitionOccurrenceId: "status-optionality-definition-occurrence",
          valueOccurrenceId: "status-optionality-value-occurrence",
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
          anchor: end,
        },
        {
          kind: "field-initialization-expression-configuration-create",
          fieldDefinitionId: "status",
          configurationNodeId: "status-initialization",
          configurationOccurrenceId: "status-initialization-occurrence",
          definitionOccurrenceId: "status-initialization-definition-occurrence",
          expression: {
            kind: "find-field-values",
            expressionNodeId: "status-initialization-expression",
            expressionOccurrenceId: "status-initialization-expression-occurrence",
            sourceFieldDefinitionId: "status",
            sourceFieldDefinitionOccurrenceId: "status-initialization-source-occurrence",
            contextNodeId: "status-initialization-above",
            contextOccurrenceId: "status-initialization-above-occurrence",
          },
          anchor: end,
        },
      ]),
    );

    expect(await configurations(workspace, "origin")).toMatchObject({
      status: [
        {
          kind: "datatype",
          configurationNodeId: "status-datatype",
          definitionNodeId: FIELD_CONFIGURATION_DEFINITION_NODE_IDS.datatype,
          datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
        },
        {
          kind: "cardinality",
          configurationNodeId: "status-cardinality",
          definitionNodeId: FIELD_CONFIGURATION_DEFINITION_NODE_IDS.cardinality,
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
        },
        {
          kind: "optionality",
          configurationNodeId: "status-optionality",
          definitionNodeId: FIELD_CONFIGURATION_DEFINITION_NODE_IDS.optionality,
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
        },
        {
          kind: "initialization-expression",
          configurationNodeId: "status-initialization",
          definitionNodeId: FIELD_CONFIGURATION_DEFINITION_NODE_IDS.initializationExpression,
          expression: {
            kind: "find-field-values",
            expressionNodeId: "status-initialization-expression",
            sourceFieldDefinitionId: "status",
            contextNodeId: "status-initialization-above",
          },
        },
      ],
    });
    expect(await projectionSection(workspace, "childOccurrences")).toMatchObject({
      status: [
        "status-datatype-occurrence",
        "status-cardinality-occurrence",
        "status-optionality-occurrence",
        "status-initialization-occurrence",
      ],
      "status-datatype": ["status-datatype-definition-occurrence", "status-datatype-value-occurrence"],
      "status-cardinality": ["status-cardinality-definition-occurrence", "status-cardinality-value-occurrence"],
      "status-optionality": ["status-optionality-definition-occurrence", "status-optionality-value-occurrence"],
      "status-initialization": [
        "status-initialization-definition-occurrence",
        "status-initialization-expression-occurrence",
      ],
      "status-initialization-expression": [
        "status-initialization-source-occurrence",
        "status-initialization-above-occurrence",
      ],
    });
    expect(await projectionSection(workspace, "nodeOwners")).toMatchObject({
      "status-datatype": "status",
      "status-cardinality": "status",
      "status-optionality": "status",
      "status-initialization": "status",
      "status-initialization-expression": "status-initialization",
      "status-initialization-above": "status-initialization-expression",
    });
    expect(await projectionSection(workspace, "metanodes")).not.toHaveProperty("status");

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
            datatypeNodeId: FIELD_DATATYPE_NODE_IDS.options,
            valueOccurrenceId: "status-datatype-options-occurrence",
          },
        ],
        "proposal",
      ),
    );
    expect((await configurations(workspace, "origin")).status?.[0]).toMatchObject({
      datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
    });
    expect((await configurations(workspace, "review")).status?.[0]).toMatchObject({
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
          configurationNodeId: "status-optionality",
          configurationOccurrenceId: "status-optionality-occurrence",
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.yes,
          valueOccurrenceId: "status-optionality-yes-occurrence",
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
    expect((await configurations(workspace, "origin")).status?.[2]).toMatchObject({
      configurationNodeId: "status-optionality",
      optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
    });

    await execute(
      workspace,
      command("cardinality-list", "cardinality", [
        {
          kind: "field-cardinality-configure",
          fieldDefinitionId: "status",
          configurationNodeId: "status-cardinality",
          configurationOccurrenceId: "status-cardinality-occurrence",
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.list,
          valueOccurrenceId: "status-cardinality-list-occurrence",
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
      cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
    });
  });

  it("round-trips Optionality through Fact Sync without broadening its transaction authority", async () => {
    const left = await open("701");
    const right = await open("702");
    await execute(
      left.workspace,
      command("sync-field-fixture", "sync-setup", [
        nodeAt("status", "workspace", "status-original"),
        { kind: "intrinsic-node-type-declare", nodeId: "status", intrinsicNodeType: "field-definition" },
      ]),
    );
    await execute(
      left.workspace,
      command("sync-field-configurations", "sync-setup", [
        {
          kind: "field-cardinality-configuration-create",
          fieldDefinitionId: "status",
          configurationNodeId: "status-cardinality",
          configurationOccurrenceId: "status-cardinality-occurrence",
          definitionOccurrenceId: "status-cardinality-definition-occurrence",
          valueOccurrenceId: "status-cardinality-value-occurrence",
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
          anchor: end,
        },
        {
          kind: "field-optionality-configuration-create",
          fieldDefinitionId: "status",
          configurationNodeId: "status-optionality",
          configurationOccurrenceId: "status-optionality-occurrence",
          definitionOccurrenceId: "status-optionality-definition-occurrence",
          valueOccurrenceId: "status-optionality-value-occurrence",
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
          anchor: end,
        },
      ]),
    );
    await execute(
      left.workspace,
      command("sync-optionality-yes", "sync-optionality", [
        {
          kind: "field-optionality-configure",
          fieldDefinitionId: "status",
          configurationNodeId: "status-optionality",
          configurationOccurrenceId: "status-optionality-occurrence",
          optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.yes,
          valueOccurrenceId: "status-optionality-yes-occurrence",
        },
      ]),
    );

    await syncPair(new FactReplication(left.facts.replication), new FactReplication(right.facts.replication));
    await left.workspace.reconcileAuthorityAdvance();
    await right.workspace.reconcileAuthorityAdvance();
    expect((await configurations(right.workspace, "origin")).status?.[1]).toMatchObject({
      kind: "optionality",
      configurationNodeId: "status-optionality",
      optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.yes,
    });

    const optionality = (await configurations(left.workspace, "origin")).status?.find(
      (configuration) => configuration.kind === "optionality",
    );
    if (!optionality || optionality.kind !== "optionality") {
      throw new Error("Expected synchronized Field Optionality");
    }
    const observedValueFactIds = left.facts
      .snapshot()
      .facts.filter(
        (fact) =>
          fact.body.kind === "contribution" &&
          fact.body.mutation.kind === "field-optionality-configure" &&
          fact.body.mutation.configurationNodeId === "status-optionality" &&
          fact.body.mutation.optionalityNodeId === FIELD_OPTIONALITY_NODE_IDS.no,
      )
      .map((fact) => fact.id);
    await expect(
      smuggleOptionalityAuthority(left.facts, "smuggle-field-definition", observedValueFactIds, {
        kind: "node-owner-set",
        nodeId: "status",
        ownerNodeId: null,
        previousOwnerNodeId: "workspace",
      }),
    ).rejects.toThrow(/Field Definition configuration structure is invalid: status-optionality/);
    await expect(
      smuggleOptionalityAuthority(left.facts, "smuggle-intrinsic-type", observedValueFactIds, {
        kind: "intrinsic-node-type-declare",
        nodeId: "status",
        intrinsicNodeType: "supertag-definition",
      }),
    ).rejects.toThrow(/Structural role requires a typed mutation: Intrinsic Node Type status/);
    await expect(
      smuggleOptionalityAuthority(left.facts, "smuggle-other-configuration", observedValueFactIds, {
        kind: "text-splice",
        nodeId: "status-cardinality",
        deleteAtomIds: [],
        deletedAtoms: [],
        anchor: end,
        insert: "tampered",
      }),
    ).rejects.toThrow(/Structural role requires a typed mutation: Node status-cardinality/);
  });
});

async function setup(): Promise<Workspace> {
  return (await open("601")).workspace;
}

async function open(loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId,
    authorityJournal: new InMemoryDocumentStore(),
    factReplication: new InMemoryDocumentStore(),
    admitRecords: admitAuthorityRecords,
  });
  return { facts, workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }) };
}

function smuggleOptionalityAuthority(
  facts: FactAuthority,
  invocationId: string,
  observedValueFactIds: readonly string[],
  extraMutation: Mutation,
) {
  const candidateOccurrenceId = `${invocationId}-value-occurrence`;
  const contribution = (mutation: Mutation) => ({
    kind: "contribution" as const,
    actorId: "remote",
    intent: "direct" as const,
    mutation,
  });
  return facts.commit({
    invocationId,
    request: { command: invocationId },
    writes: [
      {
        kind: "transaction",
        bodies: [
          contribution({
            kind: "occurrence-delete",
            occurrenceId: "status-optionality-yes-occurrence",
            previousParentNodeId: "status-optionality",
            previousAnchor: {
              after: "status-optionality-definition-occurrence",
              before: null,
              affinity: "after",
              fallback: "end",
            },
          }),
          contribution({
            kind: "occurrence-create",
            occurrenceId: candidateOccurrenceId,
            nodeId: FIELD_OPTIONALITY_NODE_IDS.no,
            parentNodeId: "status-optionality",
            anchor: end,
          }),
          contribution({
            kind: "field-optionality-configure",
            fieldDefinitionId: "status",
            configurationNodeId: "status-optionality",
            configurationOccurrenceId: "status-optionality-occurrence",
            optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
            previousOptionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
            observedValueFactIds,
          }),
          contribution(extraMutation),
        ],
      },
    ],
    lineage: null,
    publishedFrontier: facts.snapshot().frontier,
  });
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

async function projectionSection(workspace: Workspace, section: "childOccurrences" | "nodeOwners" | "metanodes") {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section,
  });
  const page = result as unknown as Readonly<Record<string, unknown>>;
  if (!(section in page)) {
    throw new Error(`Expected ${section} Projection`);
  }
  return page[section];
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

async function execute(workspace: Workspace, command: Parameters<Workspace["execute"]>[0]) {
  const result = await workspace.execute(command);
  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  expect(result.status, JSON.stringify(result)).toBe("published");
  return result;
}
