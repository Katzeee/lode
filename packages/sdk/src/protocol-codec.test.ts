import { describe, expect, it } from "vitest";
import {
  file_lode_daemon,
  file_lode_edit,
  file_lode_engine,
  file_lode_fact,
  file_lode_history,
  file_lode_maintenance,
  file_lode_model,
  file_lode_projection,
  file_lode_replica_sync,
  file_lode_review,
} from "@lode/protocol/proto";

import {
  decodeEngineCommand,
  decodeEngineEvent,
  decodeEngineQueryResult,
  decodeWriteResult,
  encodeEngineCommand,
  encodeEngineEvent,
  encodeEngineQueryResult,
  encodeWriteResult,
} from "./protocol-codec.js";
import type { EngineCommand, EngineEvent, EngineQueryResult, WriteResult } from "./contract.js";
import { protocolEnumCodecs } from "./protocol-enum-codecs.js";

describe("generated protobuf SDK codec", () => {
  it("has an ergonomic adapter for every protocol-owned enum", () => {
    expect(() =>
      assertProtocolEnumAdapters([
        file_lode_daemon,
        file_lode_edit,
        file_lode_engine,
        file_lode_fact,
        file_lode_history,
        file_lode_maintenance,
        file_lode_model,
        file_lode_projection,
        file_lode_replica_sync,
        file_lode_review,
      ]),
    ).not.toThrow();
  });

  it("round-trips commands without a JSON payload contract", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "invocation",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "node-create",
          nodeId: "node",
          occurrenceId: "node-occurrence",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    };

    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);
  });

  it("round-trips typed results and events", () => {
    const write: WriteResult = {
      status: "rejected",
      error: { code: "invalid-input", message: "invalid", currentGenerationId: null },
    };
    expect(decodeWriteResult(encodeWriteResult(write))).toEqual(write);

    const query = { kind: "invocation", workspaceId: "workspace", invocationId: "invocation" } as const;
    const result: EngineQueryResult<typeof query> = { status: "ok", value: { status: "absent" } };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(query, result), query)).toEqual(result);

    const event: EngineEvent = {
      kind: "projection-published",
      workspaceId: "workspace",
      frontier: { replica: 3 },
      generationId: "generation",
    };
    expect(decodeEngineEvent(encodeEngineEvent(event))).toEqual(event);
  });

  it("round-trips prepared History compensation evidence independently from edit mutations", () => {
    const query = { kind: "history", workspaceId: "workspace", channelId: "desktop" } as const;
    const selection = {
      token: "token",
      channelId: "desktop",
      operation: "undo",
      targetInvocationId: "target",
      headInvocationId: "target",
      headOrdinal: 1,
      frontier: { replica: 2 },
      evidence: {
        targetInvocationId: "target",
        targetFactIds: ["replica:1"],
        compensations: [
          {
            kind: "text-splice",
            nodeId: "node",
            deleteAtomIds: ["replica:1#0"],
            deletedAtoms: [{ id: "replica:1#0", value: "old", attributes: { bold: true } }],
            anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            insert: "new",
            attributes: {},
          },
        ],
      },
    } as const;
    const result: EngineQueryResult<typeof query> = {
      status: "ok",
      value: { channelId: "desktop", undo: selection, redo: null },
    };

    expect(decodeEngineQueryResult(encodeEngineQueryResult(query, result), query)).toEqual(result);
  });

  it("round-trips Inline Reference content, Alias edits, and Backlinks without opaque payloads", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "inline-reference",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "inline-reference-create",
          inlineReferenceId: "inline-1",
          hostNodeId: "host",
          targetNodeId: "target",
          anchor: { after: "atom-a", before: "atom-b", affinity: "after", fallback: "end" },
        },
        {
          kind: "inline-reference-alias-create",
          inlineReferenceId: "inline-1",
          hostNodeId: "host",
          metanodeId: "host-configuration",
          aliasNodeId: "alias",
          aliasOccurrenceId: "alias-occurrence",
          seed: { text: [{ value: "A", attributes: {} }] },
        },
      ],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);

    const projectionQuery = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
    } as const;
    const projectionResult: EngineQueryResult<typeof projectionQuery> = {
      status: "ok",
      value: {
        identity: {
          workspaceNodeId: "workspace",
          generationId: "generation",
          frontier: { replica: 2 },
          rulesVersion: "rules",
          schemaVersion: "projection-schema",
        },
        perspective: "origin",
        section: "nodes",
        next: null,
        nodes: {
          host: {
            nodeId: "host",
            nodeType: null,
            content: [
              {
                kind: "inline-reference",
                id: "inline-1",
                targetNodeId: "target",
                aliasNodeId: "alias",
                targetStatus: "active",
                contributionId: "replica:1",
              },
            ],
          },
        },
      },
    };
    expect(
      decodeEngineQueryResult(encodeEngineQueryResult(projectionQuery, projectionResult), projectionQuery),
    ).toEqual(projectionResult);

    const backlinksQuery = {
      kind: "backlinks",
      workspaceId: "workspace",
      perspective: "review",
      targetNodeId: "target",
    } as const;
    const backlinksResult: EngineQueryResult<typeof backlinksQuery> = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: { replica: 2 },
        perspective: "review",
        targetNodeId: "target",
        backlinks: [
          {
            sourceKind: "inline",
            sourceIdentity: "inline-1",
            hostNodeId: "host",
            targetStatus: "active",
          },
        ],
        next: null,
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(backlinksQuery, backlinksResult), backlinksQuery)).toEqual(
      backlinksResult,
    );
  });

  it("round-trips Search clauses, their Projection, and derived result References", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "search-clause",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "search-supertag-clause-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          clauseNodeId: "supertag-clause",
          clauseOccurrenceId: "supertag-clause-occurrence",
          supertagId: "supertag",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "search-field-clause-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          clauseNodeId: "field-clause",
          clauseOccurrenceId: "field-clause-occurrence",
          fieldDefinitionId: "field-definition",
          anchor: { after: "supertag-clause-occurrence", before: null, affinity: "after", fallback: "end" },
        },
      ],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);

    const projectionQuery = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "searchClauses",
    } as const;
    const projectionResult: EngineQueryResult<typeof projectionQuery> = {
      status: "ok",
      value: {
        identity: {
          workspaceNodeId: "workspace",
          generationId: "generation",
          frontier: { replica: 4 },
          rulesVersion: "rules",
          schemaVersion: "projection-schema",
        },
        perspective: "origin",
        section: "searchClauses",
        next: null,
        searchClauses: {
          search: [
            {
              kind: "supertag-instance-of",
              clauseNodeId: "supertag-clause",
              clauseOccurrenceId: "supertag-clause-occurrence",
              supertagId: "supertag",
            },
            {
              kind: "field-defined",
              clauseNodeId: "field-clause",
              clauseOccurrenceId: "field-clause-occurrence",
              fieldDefinitionId: "field-definition",
            },
          ],
        },
      },
    };
    expect(
      decodeEngineQueryResult(encodeEngineQueryResult(projectionQuery, projectionResult), projectionQuery),
    ).toEqual(projectionResult);

    const searchQuery = {
      kind: "search-results",
      workspaceId: "workspace",
      perspective: "review",
      searchNodeId: "search",
    } as const;
    const searchResult: EngineQueryResult<typeof searchQuery> = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: { replica: 4 },
        perspective: "review",
        searchNodeId: "search",
        available: true,
        results: [{ rowKey: "row", searchNodeId: "search", targetNodeId: "target" }],
        next: null,
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(searchQuery, searchResult), searchQuery)).toEqual(
      searchResult,
    );
  });

  it("round-trips shared default View Definitions and rows without turning Search results into Occurrences", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "view-definition",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "shared-default-view-definition-create",
          hostNodeId: "search",
          metanodeId: "search-configuration",
          viewDefinitionNodeId: "search-view",
          viewDefinitionOccurrenceId: "search-view-occurrence",
          viewType: "table",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "shared-default-view-definition-mode-set",
          viewDefinitionNodeId: "search-view",
          viewType: "outline",
        },
      ],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);

    const projectionQuery = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "sharedDefaultViewDefinitions",
    } as const;
    const projectionResult: EngineQueryResult<typeof projectionQuery> = {
      status: "ok",
      value: {
        identity: {
          workspaceNodeId: "workspace",
          generationId: "generation",
          frontier: { replica: 5 },
          rulesVersion: "rules",
          schemaVersion: "projection-schema",
        },
        perspective: "origin",
        section: "sharedDefaultViewDefinitions",
        next: null,
        sharedDefaultViewDefinitions: {
          search: [
            {
              hostNodeId: "search",
              viewDefinitionNodeId: "search-view",
              viewDefinitionOccurrenceId: "search-view-occurrence",
              viewType: "table",
              modeContributionIds: ["replica:5"],
            },
          ],
        },
      },
    };
    expect(
      decodeEngineQueryResult(encodeEngineQueryResult(projectionQuery, projectionResult), projectionQuery),
    ).toEqual(projectionResult);

    const viewQuery = {
      kind: "view-rows",
      workspaceId: "workspace",
      perspective: "review",
      hostNodeId: "search",
    } as const;
    const viewResult: EngineQueryResult<typeof viewQuery> = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: { replica: 5 },
        perspective: "review",
        hostNodeId: "search",
        viewDefinitionNodeId: "search-view",
        viewType: "table",
        rows: [
          {
            rowKey: "view-row",
            targetNodeId: "target",
            sourceKind: "search-result",
            sourceIdentity: "search-row",
          },
        ],
        next: null,
        available: true,
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(viewQuery, viewResult), viewQuery)).toEqual(viewResult);
  });

  it("round-trips Field Definition configuration identities, expressions, and review evidence", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "field-configuration",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "field",
      mutations: [
        {
          kind: "field-datatype-configuration-create",
          fieldDefinitionId: "field",
          metanodeId: "field-metanode",
          configurationNodeId: "datatype",
          configurationOccurrenceId: "datatype-occurrence",
          datatype: "plain",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "field-initialization-expression-configuration-create",
          fieldDefinitionId: "field",
          metanodeId: "field-metanode",
          configurationNodeId: "initialization",
          configurationOccurrenceId: "initialization-occurrence",
          expression: { kind: "ancestor-field-values", sourceFieldDefinitionId: "field" },
          anchor: { after: "datatype-occurrence", before: null, affinity: "after", fallback: "end" },
        },
      ],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);

    const projectionQuery = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "fieldDefinitionConfigurations",
    } as const;
    const projectionResult: EngineQueryResult<typeof projectionQuery> = {
      status: "ok",
      value: {
        identity: {
          workspaceNodeId: "workspace",
          generationId: "generation",
          frontier: { replica: 2 },
          rulesVersion: "rules",
          schemaVersion: "schema",
        },
        perspective: "origin",
        section: "fieldDefinitionConfigurations",
        next: null,
        fieldDefinitionConfigurations: {
          field: [
            {
              kind: "datatype",
              configurationNodeId: "datatype",
              configurationOccurrenceId: "datatype-occurrence",
              contributionId: "replica:1",
              datatype: "plain",
            },
            {
              kind: "initialization-expression",
              configurationNodeId: "initialization",
              configurationOccurrenceId: "initialization-occurrence",
              contributionId: "replica:2",
              expression: { kind: "ancestor-field-values", sourceFieldDefinitionId: "field" },
            },
          ],
        },
      },
    };
    expect(
      decodeEngineQueryResult(encodeEngineQueryResult(projectionQuery, projectionResult), projectionQuery),
    ).toEqual(projectionResult);

    const reviewQuery = { kind: "review", workspaceId: "workspace" } as const;
    const reviewResult: EngineQueryResult<typeof reviewQuery> = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: { replica: 3 },
        next: null,
        hunks: [
          {
            id: "hunk",
            diffSpace: { kind: "field-definition-configuration", identity: "datatype" },
            proposalContributionIds: ["replica:3"],
            neutralBridgeAtomIds: [],
            linkedHunkIds: [],
            selection: {
              token: "token",
              workspaceId: "workspace",
              frontier: { replica: 3 },
              generationId: "generation",
              evidence: {
                proposalTargets: ["replica:3"],
                supportClosure: [],
                effects: [
                  {
                    kind: "field-definition-configuration",
                    fieldDefinitionId: "field",
                    configurationNodeId: "datatype",
                    origin: { kind: "datatype", datatype: "plain" },
                    review: { kind: "datatype", datatype: "options" },
                  },
                ],
                associatedImpactIds: ["field", "datatype"],
                rulesVersion: "rules",
                schemaVersion: "schema",
              },
            },
          },
        ],
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(reviewQuery, reviewResult), reviewQuery)).toEqual(
      reviewResult,
    );
  });

  it("rejects fields outside the generated mutation schema", () => {
    const command = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "invocation",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [{ kind: "node-delete", nodeId: "node", future: true }],
    } as const;

    expect(() => encodeEngineCommand(command as never)).toThrow("Unknown input field: future");
  });
});

type ProtocolEnum = Readonly<{ typeName: string }>;
type ProtocolMessage = Readonly<{
  nestedEnums: readonly ProtocolEnum[];
  nestedMessages: readonly ProtocolMessage[];
}>;
type ProtocolFile = Readonly<{
  enums: readonly ProtocolEnum[];
  messages: readonly ProtocolMessage[];
}>;

function assertProtocolEnumAdapters(files: readonly ProtocolFile[]): void {
  const missing = new Set<string>();
  const inspectMessage = (message: ProtocolMessage): void => {
    for (const nested of message.nestedEnums) {
      if (!protocolEnumCodecs.has(nested.typeName)) {
        missing.add(nested.typeName);
      }
    }
    message.nestedMessages.forEach(inspectMessage);
  };
  for (const file of files) {
    for (const protocolEnum of file.enums) {
      if (protocolEnum.typeName.startsWith("lode.") && !protocolEnumCodecs.has(protocolEnum.typeName)) {
        missing.add(protocolEnum.typeName);
      }
    }
    file.messages.forEach(inspectMessage);
  }
  if (missing.size > 0) {
    throw new Error(`SDK has no enum adapter for ${[...missing].sort().join(", ")}`);
  }
}
