import { describe, expect, it } from "vitest";
import {
  file_lode_daemon,
  file_lode_edit,
  file_lode_engine,
  file_lode_history,
  file_lode_model,
  file_lode_projection,
  file_lode_replica_sync,
  file_lode_review,
} from "@lode/protocol/proto";

import {
  decodeEngineCommand,
  decodeEngineEvent,
  decodeEngineQuery,
  decodeEngineQueryResult,
  decodeWriteResult,
  encodeEngineCommand,
  encodeEngineEvent,
  encodeEngineQuery,
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
        file_lode_history,
        file_lode_model,
        file_lode_projection,
        file_lode_replica_sync,
        file_lode_review,
      ]),
    ).not.toThrow();
  });

  it("round-trips commands without a JSON payload contract", () => {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "invocation",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      actions: [
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

    const finalization: EngineCommand = {
      kind: "finalize-deletions",
      workspaceId: "workspace",
      invocationId: "finalize",
      actorId: "actor",
      nodeIds: ["node", "owned-child"],
    };
    expect(decodeEngineCommand(encodeEngineCommand(finalization))).toEqual(finalization);
  });

  it("round-trips an existing Field Definition as a new Template Field use", () => {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "add-existing-template-field",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "template",
      actions: [
        {
          kind: "supertag-template-field-add-existing",
          supertagId: "task-supertag",
          fieldDefinitionId: "status-definition",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    };

    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);
  });

  it("round-trips Template Field visibility edits and optional suggestions", () => {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "pin-template-field",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "template",
      actions: [
        {
          kind: "supertag-template-field-visibility-set",
          supertagId: "task-supertag",
          templateFieldId: "g1/workspace/replica/1/actions/0",
          visibility: "pinned",
        },
        {
          kind: "supertag-optional-field-contribution-remove",
          supertagId: "task-supertag",
          fieldDefinitionId: "status-definition",
        },
      ],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);

    const query = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "optionalFieldSuggestions",
    } as const;
    const projectionIdentity = {
      workspaceNodeId: "workspace",
      generationId: "generation",
      frontier: { replica: 2 },
      rulesVersion: "rules",
      schemaVersion: "projection-schema",
    } as const;
    const result: EngineQueryResult<typeof query> = {
      status: "ok",
      value: {
        identity: projectionIdentity,
        perspective: "origin",
        section: "optionalFieldSuggestions",
        next: null,
        optionalFieldSuggestions: {
          task: [
            {
              ownerNodeId: "task",
              fieldDefinitionId: "status-definition",
              sources: [
                {
                  kind: "optional",
                  applicationNodeId: "task-application",
                  appliedSupertagId: "task-supertag",
                  sourceSupertagId: "task-supertag",
                  extensionPath: ["task-supertag"],
                  optionalContributionNodeId: "status-contribution",
                },
              ],
            },
          ],
        },
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(query, result), query)).toEqual(result);

    const effectiveQuery = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "effectiveFields",
    } as const;
    const effectiveResult: EngineQueryResult<typeof effectiveQuery> = {
      status: "ok",
      value: {
        identity: projectionIdentity,
        perspective: "origin",
        section: "effectiveFields",
        next: null,
        effectiveFields: {
          task: [
            {
              ownerNodeId: "task",
              fieldDefinitionId: "status-definition",
              sources: [
                {
                  kind: "template",
                  applicationNodeId: "task-application",
                  appliedSupertagId: "derived-supertag",
                  sourceSupertagId: "base-supertag",
                  extensionPath: ["derived-supertag", "base-supertag"],
                  templateFieldNodeId: "status-template",
                  staticDefaultValueNodeId: "status-default",
                  visibility: "pinned",
                },
                {
                  kind: "optional",
                  applicationNodeId: "task-application",
                  appliedSupertagId: "derived-supertag",
                  sourceSupertagId: "base-supertag",
                  extensionPath: ["derived-supertag", "base-supertag"],
                  optionalContributionNodeId: "status-contribution",
                },
              ],
              staticDefault: {
                state: "conflict",
                candidates: [
                  { value: "Alpha", sourceTemplateFieldNodeIds: ["alpha-template"] },
                  { value: "Beta", sourceTemplateFieldNodeIds: ["beta-template"] },
                ],
              },
              visibility: "pinned",
              materializedFieldNodeId: null,
              visibilityConflicted: false,
            },
          ],
        },
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(effectiveQuery, effectiveResult), effectiveQuery)).toEqual(
      effectiveResult,
    );

    const templateQuery = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "templateFields",
    } as const;
    const templateResult: EngineQueryResult<typeof templateQuery> = {
      status: "ok",
      value: {
        identity: projectionIdentity,
        perspective: "origin",
        section: "templateFields",
        next: null,
        templateFields: {
          "task-supertag": [
            {
              supertagId: "task-supertag",
              templateFieldNodeId: "status-template",
              templateFieldOccurrenceId: "status-template-occurrence",
              fieldDefinitionId: "status-definition",
              definitionOccurrenceId: "status-definition-occurrence",
              staticDefaultValueNodeId: "status-default",
              staticDefaultValueOccurrenceId: "status-default-occurrence",
              fieldDefinitionOwner: "workspace-schema",
              factActionId: "g1/workspace/1/1/actions/0",
              visibility: "pinned",
              visibilityCandidates: [
                { visibility: "normal" as const, factActionId: "g1/workspace/1/1/actions/0" },
                { visibility: "pinned" as const, factActionId: "g1/workspace/1/2/actions/0" },
              ],
              visibilityConflicted: true,
              staticDefaultCandidates: [],
              staticDefaultConflicted: false,
            },
          ],
        },
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(templateQuery, templateResult), templateQuery)).toEqual(
      templateResult,
    );
  });

  it("round-trips a Template Field Static Default set or clear edit", () => {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "set-template-field-static-default",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "template",
      actions: [
        {
          kind: "supertag-template-field-static-default-set",
          supertagId: "task-supertag",
          templateFieldId: "g1/workspace/replica/1/actions/0",
          value: "",
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

  it("round-trips an opaque History selection without exposing local inverse actions", () => {
    const query = { kind: "history", workspaceId: "workspace", channelId: "desktop" } as const;
    const selection = {
      token: "token",
      channelId: "desktop",
    } as const;
    const result: EngineQueryResult<typeof query> = {
      status: "ok",
      value: { channelId: "desktop", undo: selection, redo: null },
    };

    expect(decodeEngineQueryResult(encodeEngineQueryResult(query, result), query)).toEqual(result);
  });

  it("round-trips Inline Reference content, Alias edits, and Backlinks without opaque payloads", () => {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "inline-reference",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      actions: [
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
          aliasNodeId: "alias",
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
            intrinsicNodeType: null,
            content: [
              {
                kind: "inline-reference",
                id: "inline-1",
                targetNodeId: "target",
                aliasNodeId: "alias",
                targetStatus: "active",
                factActionId: "g1/workspace/1/1/actions/0",
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

  it("round-trips Search expressions, their Projection, and derived result References", () => {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "search-expression",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      actions: [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          expression: {
            kind: "and",
            operands: [
              {
                kind: "supertag",
                supertagId: "supertag",
              },
              {
                kind: "not",
                operand: {
                  kind: "text",
                  text: "archived",
                },
              },
            ],
          },
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "search-expression-configure",
          searchNodeId: "search",
          expressionId: "g1/workspace/1/1/actions/0",
          clause: { kind: "or" },
        },
        {
          kind: "search-expression-add",
          searchNodeId: "search",
          parentExpressionId: "g1/workspace/1/1/actions/0",
          expression: {
            kind: "not",
            operand: { kind: "field-defined", fieldDefinitionId: "field", defined: true },
          },
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);

    const projectionQuery = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "searchExpressions",
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
        section: "searchExpressions",
        next: null,
        searchExpressions: {
          search: {
            expressionNodeId: "supertag-expression",
            expressionOccurrenceId: "supertag-expression-occurrence",
            definitionOccurrenceId: "supertag-expression-definition",
            expression: {
              expressionId: "g1/workspace/1/1/actions/0",
              expressionNodeId: "supertag-expression",
              kind: "or",
              operands: [
                {
                  expressionId: "g1/workspace/1/1/actions/1",
                  expressionNodeId: "title-clause",
                  kind: "text",
                  text: "current",
                },
                {
                  expressionId: "g1/workspace/1/1/actions/2",
                  expressionNodeId: "supertag-clause",
                  kind: "supertag",
                  supertagId: "supertag",
                },
              ],
            },
          },
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
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "view-definition",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      actions: [
        {
          kind: "shared-default-view-create",
          hostNodeId: "search",
          viewType: "table",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "view-mode-set",
          hostNodeId: "search",
          viewId: "g1/workspace/1/1/actions/0",
          viewType: "outline",
        },
        {
          kind: "view-column-add",
          hostNodeId: "search",
          viewId: "g1/workspace/1/1/actions/0",
          fieldDefinitionId: "field",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "view-filter-create",
          hostNodeId: "search",
          viewId: "g1/workspace/1/1/actions/0",
          expression: { kind: "text", text: "active" },
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "view-filter-expression-configure",
          hostNodeId: "search",
          viewId: "g1/workspace/1/1/actions/0",
          filterId: "g1/workspace/1/2/actions/0",
          expressionId: "g1/workspace/1/2/actions/1",
          clause: { kind: "text", text: "current" },
        },
        {
          kind: "view-filter-expression-add",
          hostNodeId: "search",
          viewId: "g1/workspace/1/1/actions/0",
          filterId: "g1/workspace/1/2/actions/0",
          parentExpressionId: "g1/workspace/1/2/actions/1",
          expression: {
            kind: "or",
            operands: [
              { kind: "text", text: "current" },
              { kind: "text", text: "active" },
            ],
          },
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "view-sort-by-node-name",
          hostNodeId: "search",
          viewId: "g1/workspace/1/1/actions/0",
          direction: "descending",
        },
        {
          kind: "shared-default-view-remove",
          hostNodeId: "search",
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
              viewId: "g1/workspace/1/1/actions/0",
              attachmentNodeId: "search-view-attachment",
              attachmentOccurrenceId: "search-view-attachment-occurrence",
              relationDefinitionOccurrenceId: "search-view-attachment-definition",
              viewDefinitionNodeId: "search-view",
              viewDefinitionOccurrenceId: "search-view-occurrence",
              viewType: "table",
              modeActionIds: ["g1/workspace/1/2/actions/0"],
              options: {
                columns: [
                  { columnId: "g1/workspace/1/3/actions/0", columnNodeId: "column", fieldDefinitionId: "field" },
                ],
                filter: {
                  filterId: "g1/workspace/1/4/actions/0",
                  filterNodeId: "filter",
                  expression: {
                    expressionId: "g1/workspace/1/4/actions/1",
                    expressionNodeId: "filter-expression",
                    kind: "text",
                    text: "active",
                  },
                },
                sort: {
                  sortId: "g1/workspace/1/5/actions/0",
                  sortNodeId: "sort",
                  fieldDefinitionId: "field",
                  direction: "descending",
                },
                group: {
                  groupId: "g1/workspace/1/6/actions/0",
                  groupNodeId: "group",
                  fieldDefinitionId: "field",
                },
              },
              optionsActionIds: ["g1/workspace/1/3/actions/0"],
              optionsConflicted: false,
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
            cells: [
              {
                columnNodeId: "column",
                fieldDefinitionId: "field",
                fieldNodeId: "field-value",
                valueNodeIds: ["value"],
              },
            ],
            group: { groupNodeId: "group", fieldDefinitionId: "field", key: "active", valueNodeIds: ["value"] },
          },
        ],
        next: null,
        available: true,
        options: {
          columns: [{ columnId: "g1/workspace/1/3/actions/0", columnNodeId: "column", fieldDefinitionId: "field" }],
          filter: {
            filterId: "g1/workspace/1/4/actions/0",
            filterNodeId: "filter",
            expression: {
              expressionId: "g1/workspace/1/4/actions/1",
              expressionNodeId: "filter-expression",
              kind: "text",
              text: "active",
            },
          },
          sort: {
            sortId: "g1/workspace/1/5/actions/0",
            sortNodeId: "sort",
            fieldDefinitionId: "field",
            direction: "descending",
          },
          group: {
            groupId: "g1/workspace/1/6/actions/0",
            groupNodeId: "group",
            fieldDefinitionId: "field",
          },
        },
        optionsConflicted: false,
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(viewQuery, viewResult), viewQuery)).toEqual(viewResult);
  });

  it("round-trips Field Definition configuration identities, expressions, and review evidence", () => {
    const expression = {
      kind: "find-field-values",
      expressionNodeId: "expression",
      expressionOccurrenceId: "expression-occurrence",
      sourceFieldDefinitionId: "field",
      sourceFieldDefinitionOccurrenceId: "expression-field-occurrence",
      contextNodeId: "above",
      contextOccurrenceId: "above-occurrence",
    } as const;
    const authoredExpression = {
      kind: "find-field-values",
      sourceFieldDefinitionId: "field",
    } as const;
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "field-configuration",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "field",
      actions: [
        {
          kind: "field-datatype-configure",
          fieldDefinitionId: "field",
          datatypeNodeId: "system-field-datatype:v1:plain",
        },
        {
          kind: "field-initialization-expression-configure",
          fieldDefinitionId: "field",
          expression: authoredExpression,
        },
        {
          kind: "field-optionality-configure",
          fieldDefinitionId: "field",
          optionalityNodeId: "system-field-optionality:v1:no",
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
              definitionNodeId: "system-field-configuration-definition:v1:datatype",
              factActionId: "g1/workspace/1/1/actions/0",
              datatypeNodeId: "system-field-datatype:v1:plain",
              optionsSupertagId: null,
            },
            {
              kind: "initialization-expression",
              configurationNodeId: "initialization",
              configurationOccurrenceId: "initialization-occurrence",
              definitionNodeId: "system-field-configuration-definition:v1:initialization-expression",
              factActionId: "g1/workspace/1/2/actions/0",
              expression,
            },
            {
              kind: "optionality",
              configurationNodeId: "optionality",
              configurationOccurrenceId: "optionality-occurrence",
              definitionNodeId: "system-field-configuration-definition:v1:optionality",
              factActionId: "replica:3",
              optionalityNodeId: "system-field-optionality:v1:no",
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
            diffSpace: { kind: "field-definition-configuration", identity: "optionality" },
            neutralBridgeAtomIds: [],
            linkedHunkIds: [],
            evidence: {
              effects: [
                {
                  kind: "field-definition-configuration",
                  fieldDefinitionId: "field",
                  configurationKind: "optionality",
                  origin: {
                    kind: "optionality",
                    optionalityNodeId: "system-field-optionality:v1:yes",
                  },
                  review: {
                    kind: "optionality",
                    optionalityNodeId: "system-field-optionality:v1:no",
                  },
                },
              ],
              associatedImpactIds: ["field", "optionality"],
            },
            selection: {
              evidenceId: "evidence",
              proposalActionIds: ["g1/workspace/101/3/actions/0"],
            },
          },
        ],
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(reviewQuery, reviewResult), reviewQuery)).toEqual(
      reviewResult,
    );
  });

  it("round-trips the breadth-first node, field, View Sort, Outline, and Debug contracts", () => {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "breadth",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "breadth",
      actions: [
        {
          kind: "field-value-create",
          ownerNodeId: "host",
          fieldDefinitionId: "field-definition",
          valueNodeId: "value",
          valueOccurrenceId: "value-occ",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          seed: { text: [{ value: "Value", attributes: {} }] },
        },
        {
          kind: "url-node-create",
          nodeId: "url",
          occurrenceId: "url-occ",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          urlValueNodeId: "url-value",
          urlValueOccurrenceId: "url-value-occ",
          url: "https://example.com",
        },
        {
          kind: "code-node-configure",
          nodeId: "code",
          languageValueNodeId: "language-value",
          languageValueOccurrenceId: "language-value-occ",
          language: "JavaScript",
        },
        {
          kind: "view-sort-by-node-name",
          hostNodeId: "host",
          viewId: "g1/workspace/1/1/actions/0",
          direction: "ascending",
        },
      ],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);

    const outlineQuery = {
      kind: "outline",
      workspaceId: "workspace",
      perspective: "origin",
      rootNodeId: "root",
      maxDepth: 3,
      limit: 20,
    } as const;
    expect(decodeEngineQuery(encodeEngineQuery(outlineQuery))).toEqual(outlineQuery);
    const debugQuery = {
      kind: "debug-node",
      workspaceId: "workspace",
      perspective: "review",
      nodeId: "node",
    } as const;
    expect(decodeEngineQuery(encodeEngineQuery(debugQuery))).toEqual(debugQuery);

    const outlineResult: EngineQueryResult<typeof outlineQuery> = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: { replica: 1 },
        perspective: "origin",
        rootNodeId: "root",
        available: true,
        rows: [{ rowKey: "row", occurrenceId: "occ", nodeId: "child", parentNodeId: "root", depth: 1 }],
        next: null,
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(outlineQuery, outlineResult), outlineQuery)).toEqual(
      outlineResult,
    );
    const debugResult: EngineQueryResult<typeof debugQuery> = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: { replica: 1 },
        perspective: "review",
        nodeId: "node",
        available: true,
        node: {
          nodeId: "node",
          intrinsicNodeType: null,
          content: [
            {
              kind: "text",
              id: "g1/workspace/101/1/actions/0#0",
              value: "Node",
              attributes: {},
              factActionId: "g1/workspace/101/1/actions/0",
            },
          ],
        },
        ownerNodeId: "workspace",
        metanodeId: "meta",
        childOccurrenceIds: ["child-occ"],
        metanodeChildOccurrenceIds: [],
        materializedFields: [],
        url: null,
        codeLanguage: "JavaScript",
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(debugQuery, debugResult), debugQuery)).toEqual(debugResult);
  });

  it("rejects fields outside the generated action schema", () => {
    const command = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "invocation",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      actions: [{ kind: "node-delete", nodeId: "node", future: true }],
    } as const;

    expect(() => encodeEngineCommand(command as never)).toThrow("Unknown input field: future");
  });

  it("round-trips typed Field configuration, edits, and Projection", () => {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "typed-fields",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      actions: [
        {
          kind: "field-datatype-configure",
          fieldDefinitionId: "options-field",
          datatypeNodeId: "system-field-datatype:v1:options-from-supertag",
          optionsSupertagId: "project",
        },
        {
          kind: "field-number-value-set",
          ownerNodeId: "owner",
          fieldDefinitionId: "number-field",
          valueNodeId: "number-value",
          valueOccurrenceId: "number-value-occurrence",
          value: 12.5,
        },
        {
          kind: "field-date-value-set",
          ownerNodeId: "owner",
          fieldDefinitionId: "date-field",
          valueNodeId: "date-value",
          valueOccurrenceId: "date-value-occurrence",
          value: "2026-08-21",
        },
        {
          kind: "field-checkbox-value-set",
          ownerNodeId: "owner",
          fieldDefinitionId: "checkbox-field",
          valueOccurrenceId: "checkbox-value-occurrence",
          value: false,
        },
        {
          kind: "field-options-from-supertag-value-set",
          ownerNodeId: "owner",
          fieldDefinitionId: "options-field",
          valueOccurrenceId: "options-value-occurrence",
          targetNodeId: "target",
        },
        {
          kind: "typed-field-value-clear",
          ownerNodeId: "owner",
          fieldDefinitionId: "date-field",
          emptyValueNodeId: "date-empty",
          emptyValueOccurrenceId: "date-empty-occurrence",
        },
      ],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);

    const query = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "typedFieldValues",
    } as const;
    const result: EngineQueryResult<typeof query> = {
      status: "ok",
      value: {
        identity: {
          workspaceNodeId: "workspace",
          generationId: "generation",
          frontier: { replica: 1 },
          rulesVersion: "rules",
          schemaVersion: "schema",
        },
        perspective: "origin",
        section: "typedFieldValues",
        next: null,
        typedFieldValues: {
          owner: [
            {
              ownerNodeId: "owner",
              fieldDefinitionId: "number-field",
              fieldNodeId: "number-field-node",
              fieldOccurrenceId: "number-field-occurrence",
              datatypeNodeId: "system-field-datatype:v1:number",
              valueOccurrenceIds: ["number-value-occurrence"],
              state: "value",
              value: {
                kind: "number",
                valueNodeId: "number-value",
                valueOccurrenceId: "number-value-occurrence",
                value: 12.5,
              },
            },
            {
              ownerNodeId: "owner",
              fieldDefinitionId: "date-field",
              fieldNodeId: "date-field-node",
              fieldOccurrenceId: "date-field-occurrence",
              datatypeNodeId: "system-field-datatype:v1:date",
              valueOccurrenceIds: ["date-empty-occurrence"],
              state: "empty",
              value: null,
            },
          ],
        },
      },
    };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(query, result), query)).toEqual(result);
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
