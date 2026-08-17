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
import { fromContributionMutation, toContributionMutation } from "./protocol-fact-codec.js";

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

  it("round-trips an existing Field Definition as a new Template Field use", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "add-existing-template-field",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "template",
      mutations: [
        {
          kind: "supertag-template-field-add-existing",
          supertagId: "task-supertag",
          templateFieldNodeId: "new-template-use",
          templateFieldOccurrenceId: "new-template-use-occurrence",
          fieldDefinitionId: "status-definition",
          definitionOccurrenceId: "new-template-use-definition",
          staticDefaultValueNodeId: "new-template-use-default",
          staticDefaultValueOccurrenceId: "new-template-use-default-occurrence",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    };

    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);
  });

  it("round-trips the narrower Fact for attaching an existing Field Definition", () => {
    const mutation = {
      kind: "supertag-template-field-existing-attach",
      supertagId: "task-supertag",
      templateFieldNodeId: "new-template-use",
      templateFieldOccurrenceId: "new-template-use-occurrence",
      fieldDefinitionId: "status-definition",
      definitionOccurrenceId: "new-template-use-definition",
      staticDefaultValueNodeId: "new-template-use-default",
      staticDefaultValueOccurrenceId: "new-template-use-default-occurrence",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    } as const;

    expect(fromContributionMutation(toContributionMutation(mutation))).toEqual(mutation);
  });

  it("round-trips Template Field visibility edits, causal Facts, and optional suggestions", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "pin-template-field",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "template",
      mutations: [
        {
          kind: "supertag-template-field-visibility-set",
          supertagId: "task-supertag",
          templateFieldNodeId: "status-template",
          visibility: "pinned",
        },
      ],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);

    const mutation = {
      kind: "supertag-template-field-visibility-configure",
      supertagId: "task-supertag",
      templateFieldNodeId: "status-template",
      fieldDefinitionId: "status-definition",
      visibility: "pinned",
      previousVisibility: "normal",
      observedVisibilityFactIds: ["replica:1"],
    } as const;
    expect(fromContributionMutation(toContributionMutation(mutation))).toEqual(mutation);

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
              contributionId: "replica:1",
              visibility: "pinned",
              visibilityCandidates: [
                { visibility: "normal" as const, contributionId: "replica:1" },
                { visibility: "pinned" as const, contributionId: "replica:2" },
              ],
              visibilityConflicted: true,
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
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "set-template-field-static-default",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "template",
      mutations: [
        {
          kind: "supertag-template-field-static-default-set",
          supertagId: "task-supertag",
          templateFieldNodeId: "status-template",
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
            kind: "node-owner-set",
            nodeId: "relation",
            ownerNodeId: null,
            previousOwnerNodeId: "metanode",
          },
          {
            kind: "search-expression-detach",
            searchNodeId: "search",
            expressionNodeId: "expression",
            expressionOccurrenceId: "expression-occurrence",
            definitionOccurrenceId: "definition-occurrence",
            expression: {
              expressionNodeId: "expression",
              kind: "supertag",
              supertagId: "supertag",
            },
          },
          {
            kind: "shared-default-view-definition-detach",
            hostNodeId: "host",
            attachmentNodeId: "view-attachment",
            attachmentOccurrenceId: "view-attachment-occurrence",
            relationDefinitionOccurrenceId: "view-attachment-definition",
            viewDefinitionNodeId: "view-definition",
            viewDefinitionOccurrenceId: "view-definition-occurrence",
            detachedValueNodeId: "detached-view-value",
            detachedValueOccurrenceId: "detached-view-value-occurrence",
          },
          {
            kind: "shared-default-view-definition-sort-by-name-set",
            hostNodeId: "host",
            viewDefinitionNodeId: "view-definition",
            sortOrderFieldNodeId: "sort-order",
            sortOrderFieldOccurrenceId: "sort-order-occurrence",
            sortFieldNodeId: "sort-field",
            sortFieldOccurrenceId: "sort-field-occurrence",
            nodeNameOccurrenceId: "sort-node-name-occurrence",
            ascendingOccurrenceId: "sort-ascending-occurrence",
            enabled: false,
            previousEnabled: true,
          },
          {
            kind: "shared-default-view-definition-options-set",
            hostNodeId: "host",
            viewDefinitionNodeId: "view-definition",
            options: {
              columns: [{ columnNodeId: "column", fieldDefinitionId: "field" }],
              filter: {
                filterNodeId: "filter",
                expression: { expressionNodeId: "filter-expression", kind: "text", text: "active" },
              },
              sort: { sortNodeId: "sort", fieldDefinitionId: "field", direction: "descending" },
              group: { groupNodeId: "group", fieldDefinitionId: "field" },
            },
            previousOptions: { columns: [], filter: null, sort: null, group: null },
            observedOptionsFactIds: ["replica:2"],
          },
          {
            kind: "field-optionality-configure",
            fieldDefinitionId: "field",
            configurationNodeId: "optionality",
            configurationOccurrenceId: "optionality-occurrence",
            optionalityNodeId: "system-field-optionality:v1:no",
            previousOptionalityNodeId: "system-field-optionality:v1:yes",
            observedValueFactIds: ["replica:1"],
          },
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

  it("round-trips Search expressions, their Projection, and derived result References", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "search-expression",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          expressionNodeId: "supertag-expression",
          expressionOccurrenceId: "supertag-expression-occurrence",
          definitionOccurrenceId: "supertag-expression-definition",
          expression: {
            expressionNodeId: "supertag-expression",
            kind: "and",
            operands: [
              {
                expressionNodeId: "supertag-clause",
                kind: "supertag",
                supertagId: "supertag",
              },
              {
                expressionNodeId: "not-clause",
                kind: "not",
                operand: {
                  expressionNodeId: "excluded-text",
                  kind: "text",
                  text: "archived",
                },
              },
            ],
          },
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "search-expression-update",
          searchNodeId: "search",
          expression: {
            expressionNodeId: "supertag-expression",
            kind: "or",
            operands: [
              { expressionNodeId: "title-clause", kind: "text", text: "current" },
              { expressionNodeId: "supertag-clause", kind: "supertag", supertagId: "supertag" },
            ],
          },
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
              expressionNodeId: "supertag-expression",
              kind: "or",
              operands: [
                { expressionNodeId: "title-clause", kind: "text", text: "current" },
                { expressionNodeId: "supertag-clause", kind: "supertag", supertagId: "supertag" },
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
          attachmentNodeId: "search-view-attachment",
          attachmentOccurrenceId: "search-view-attachment-occurrence",
          relationDefinitionOccurrenceId: "search-view-attachment-definition",
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
        {
          kind: "shared-default-view-definition-options-update",
          hostNodeId: "search",
          viewDefinitionNodeId: "search-view",
          options: {
            columns: [{ columnNodeId: "column", fieldDefinitionId: "field" }],
            filter: {
              filterNodeId: "filter",
              expression: { expressionNodeId: "filter-expression", kind: "text", text: "active" },
            },
            sort: { sortNodeId: "sort", fieldDefinitionId: "field", direction: "descending" },
            group: { groupNodeId: "group", fieldDefinitionId: "field" },
          },
        },
        {
          kind: "shared-default-view-definition-remove",
          hostNodeId: "search",
          attachmentNodeId: "search-view-attachment",
          attachmentOccurrenceId: "search-view-attachment-occurrence",
          relationDefinitionOccurrenceId: "search-view-attachment-definition",
          viewDefinitionNodeId: "search-view",
          viewDefinitionOccurrenceId: "search-view-occurrence",
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
              attachmentNodeId: "search-view-attachment",
              attachmentOccurrenceId: "search-view-attachment-occurrence",
              relationDefinitionOccurrenceId: "search-view-attachment-definition",
              viewDefinitionNodeId: "search-view",
              viewDefinitionOccurrenceId: "search-view-occurrence",
              viewType: "table",
              modeContributionIds: ["replica:5"],
              options: {
                columns: [{ columnNodeId: "column", fieldDefinitionId: "field" }],
                filter: {
                  filterNodeId: "filter",
                  expression: { expressionNodeId: "filter-expression", kind: "text", text: "active" },
                },
                sort: { sortNodeId: "sort", fieldDefinitionId: "field", direction: "descending" },
                group: { groupNodeId: "group", fieldDefinitionId: "field" },
              },
              optionsContributionIds: ["replica:6"],
              optionsConflicted: false,
              sortByNameAscending: {
                sortOrderFieldNodeId: "sort-order",
                sortOrderFieldOccurrenceId: "sort-order-occ",
                sortFieldNodeId: "sort-field",
                sortFieldOccurrenceId: "sort-field-occ",
                nodeNameOccurrenceId: "node-name-occ",
                ascendingOccurrenceId: "ascending-occ",
              },
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
          columns: [{ columnNodeId: "column", fieldDefinitionId: "field" }],
          filter: {
            filterNodeId: "filter",
            expression: { expressionNodeId: "filter-expression", kind: "text", text: "active" },
          },
          sort: { sortNodeId: "sort", fieldDefinitionId: "field", direction: "descending" },
          group: { groupNodeId: "group", fieldDefinitionId: "field" },
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
          configurationNodeId: "datatype",
          configurationOccurrenceId: "datatype-occurrence",
          definitionOccurrenceId: "datatype-definition-occurrence",
          valueOccurrenceId: "datatype-value-occurrence",
          datatypeNodeId: "system-field-datatype:v1:plain",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "field-initialization-expression-configuration-create",
          fieldDefinitionId: "field",
          configurationNodeId: "initialization",
          configurationOccurrenceId: "initialization-occurrence",
          definitionOccurrenceId: "initialization-definition-occurrence",
          expression,
          anchor: { after: "datatype-occurrence", before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "field-optionality-configuration-create",
          fieldDefinitionId: "field",
          configurationNodeId: "optionality",
          configurationOccurrenceId: "optionality-occurrence",
          definitionOccurrenceId: "optionality-definition-occurrence",
          valueOccurrenceId: "optionality-value-occurrence",
          optionalityNodeId: "system-field-optionality:v1:no",
          anchor: { after: "initialization-occurrence", before: null, affinity: "after", fallback: "end" },
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
              contributionId: "replica:1",
              datatypeNodeId: "system-field-datatype:v1:plain",
              optionsSupertagId: null,
            },
            {
              kind: "initialization-expression",
              configurationNodeId: "initialization",
              configurationOccurrenceId: "initialization-occurrence",
              definitionNodeId: "system-field-configuration-definition:v1:initialization-expression",
              contributionId: "replica:2",
              expression,
            },
            {
              kind: "optionality",
              configurationNodeId: "optionality",
              configurationOccurrenceId: "optionality-occurrence",
              definitionNodeId: "system-field-configuration-definition:v1:optionality",
              contributionId: "replica:3",
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
                    configurationNodeId: "optionality",
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

  it("round-trips the breadth-first node, field, View Sort, Outline, and Debug contracts", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "breadth",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "breadth",
      mutations: [
        { kind: "debug-node-open", hostNodeId: "host", metanodeId: "meta" },
        {
          kind: "field-value-create",
          ownerNodeId: "host",
          fieldDefinitionId: "field-definition",
          fieldNodeId: "field",
          fieldOccurrenceId: "field-occ",
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
          urlFieldNodeId: "url-field",
          urlFieldOccurrenceId: "url-field-occ",
          urlValueNodeId: "url-value",
          urlValueOccurrenceId: "url-value-occ",
          url: "https://example.com",
        },
        {
          kind: "code-node-configure",
          nodeId: "code",
          languageFieldNodeId: "language-field",
          languageFieldOccurrenceId: "language-field-occ",
          languageValueNodeId: "language-value",
          languageValueOccurrenceId: "language-value-occ",
          language: "JavaScript",
        },
        {
          kind: "shared-default-view-definition-sort-by-name-create",
          hostNodeId: "host",
          viewDefinitionNodeId: "view",
          sortOrderFieldNodeId: "sort-order",
          sortOrderFieldOccurrenceId: "sort-order-occ",
          sortFieldNodeId: "sort-field",
          sortFieldOccurrenceId: "sort-field-occ",
          nodeNameOccurrenceId: "node-name-occ",
          ascendingOccurrenceId: "ascending-occ",
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
          content: [{ kind: "text", id: "replica:1#0", value: "Node", attributes: {}, contributionId: "replica:1" }],
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

  it("round-trips typed Field configuration, edits, and Projection", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "typed-fields",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "field-datatype-configuration-create",
          fieldDefinitionId: "options-field",
          configurationNodeId: "options-config",
          configurationOccurrenceId: "options-config-occurrence",
          definitionOccurrenceId: "options-definition-occurrence",
          valueOccurrenceId: "options-datatype-occurrence",
          datatypeNodeId: "system-field-datatype:v1:options-from-supertag",
          optionsSupertagId: "project",
          optionsSupertagOccurrenceId: "options-source-occurrence",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "field-number-value-set",
          ownerNodeId: "owner",
          fieldDefinitionId: "number-field",
          fieldNodeId: "number-field-node",
          fieldOccurrenceId: "number-field-occurrence",
          valueNodeId: "number-value",
          valueOccurrenceId: "number-value-occurrence",
          value: 12.5,
        },
        {
          kind: "field-date-value-set",
          ownerNodeId: "owner",
          fieldDefinitionId: "date-field",
          fieldNodeId: "date-field-node",
          fieldOccurrenceId: "date-field-occurrence",
          valueNodeId: "date-value",
          valueOccurrenceId: "date-value-occurrence",
          value: "2026-08-21",
        },
        {
          kind: "field-checkbox-value-set",
          ownerNodeId: "owner",
          fieldDefinitionId: "checkbox-field",
          fieldNodeId: "checkbox-field-node",
          fieldOccurrenceId: "checkbox-field-occurrence",
          valueOccurrenceId: "checkbox-value-occurrence",
          value: false,
        },
        {
          kind: "field-options-from-supertag-value-set",
          ownerNodeId: "owner",
          fieldDefinitionId: "options-field",
          fieldNodeId: "options-field-node",
          fieldOccurrenceId: "options-field-occurrence",
          valueOccurrenceId: "options-value-occurrence",
          targetNodeId: "target",
        },
        {
          kind: "typed-field-value-clear",
          ownerNodeId: "owner",
          fieldDefinitionId: "date-field",
          fieldNodeId: "date-field-node",
          fieldOccurrenceId: "date-field-occurrence",
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
