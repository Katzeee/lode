import type { DesktopClient } from "@lode/desktop-client";
import type { EditMutation, TextAtomId } from "@lode/sdk";

import {
  booleanInput,
  datatypeNodeId,
  end,
  finiteNumber,
  optionalFlag,
  projection,
  required,
  requiredFlag,
  requiredString,
  searchExpression,
  viewOptions,
} from "./domain-command-support.js";

export async function dataDomainMutations(
  client: DesktopClient,
  workspaceId: string,
  argv: readonly string[],
): Promise<readonly EditMutation[]> {
  const action = required(argv[0], "domain action");
  if (action === "field-configure") {
    const fieldDefinitionId = required(argv[1], "Field Definition identity");
    const datatype = required(argv[2], "Field datatype");
    const configurationNodeId = `${fieldDefinitionId}-datatype-configuration`;
    return [
      {
        kind: "field-datatype-configuration-create",
        fieldDefinitionId,
        configurationNodeId,
        configurationOccurrenceId: `${configurationNodeId}-occurrence`,
        definitionOccurrenceId: `${configurationNodeId}-definition`,
        valueOccurrenceId: `${configurationNodeId}-value`,
        datatypeNodeId: datatypeNodeId(datatype),
        ...(datatype === "options-from-supertag"
          ? {
              optionsSupertagId: requiredFlag(argv, "--options-supertag"),
              optionsSupertagOccurrenceId: `${configurationNodeId}-options-supertag`,
            }
          : {}),
        anchor: end,
      },
    ];
  }
  if (action === "field-plain-set") {
    return plainFieldSet(client, workspaceId, argv);
  }
  if (action === "field-date-set" || action === "field-number-set" || action === "field-checkbox-set") {
    return [typedFieldMutation(action, argv)];
  }
  if (action === "field-option-set") {
    const ownerNodeId = required(argv[1], "Field owner Node identity");
    const fieldDefinitionId = required(argv[2], "Field Definition identity");
    const identity = optionalFlag(argv, "--field-node") ?? `${ownerNodeId}-${fieldDefinitionId}`;
    return [
      {
        kind: "field-options-from-supertag-value-set",
        ownerNodeId,
        fieldDefinitionId,
        fieldNodeId: identity,
        fieldOccurrenceId: `${identity}-occurrence`,
        valueOccurrenceId: `${identity}-value-occurrence`,
        targetNodeId: required(argv[3], "option target Node identity"),
      },
    ];
  }
  if (action === "search-create") {
    const searchNodeId = required(argv[1], "Search Node identity");
    const expressionNodeId = optionalFlag(argv, "--expression") ?? `${searchNodeId}-expression`;
    return [
      {
        kind: "search-expression-create",
        searchNodeId,
        metanodeId: optionalFlag(argv, "--metanode") ?? `${searchNodeId}-metanode`,
        expressionNodeId,
        expressionOccurrenceId: `${expressionNodeId}-occurrence`,
        definitionOccurrenceId: `${expressionNodeId}-definition`,
        expression: searchExpression(argv, expressionNodeId),
        anchor: end,
      },
    ];
  }
  if (action === "search-update") {
    const searchNodeId = required(argv[1], "Search Node identity");
    const expressions = await projection(client, workspaceId, "searchExpressions");
    const current = expressions[searchNodeId] as { expressionNodeId?: unknown } | undefined;
    const expressionNodeId = requiredString(current?.expressionNodeId, "current Search Expression identity");
    return [{ kind: "search-expression-update", searchNodeId, expression: searchExpression(argv, expressionNodeId) }];
  }
  if (action === "view-create") {
    return viewCreation(client, workspaceId, argv);
  }
  if (action === "view-options") {
    const hostNodeId = required(argv[1], "View host Node identity");
    const viewDefinitionNodeId = required(argv[2], "View Definition identity");
    return [
      {
        kind: "shared-default-view-definition-options-update",
        hostNodeId,
        viewDefinitionNodeId,
        options: viewOptions(argv, viewDefinitionNodeId),
      },
    ];
  }
  throw new Error(`Unknown domain action: ${action}`);
}

function typedFieldMutation(
  action: "field-date-set" | "field-number-set" | "field-checkbox-set",
  argv: readonly string[],
): EditMutation {
  const ownerNodeId = required(argv[1], "Field owner Node identity");
  const fieldDefinitionId = required(argv[2], "Field Definition identity");
  const identity = optionalFlag(argv, "--field-node") ?? `${ownerNodeId}-${fieldDefinitionId}`;
  const base = {
    ownerNodeId,
    fieldDefinitionId,
    fieldNodeId: identity,
    fieldOccurrenceId: `${identity}-occurrence`,
    valueOccurrenceId: `${identity}-value-occurrence`,
  };
  const value = required(argv[3], "Field value");
  return action === "field-date-set"
    ? { kind: "field-date-value-set", ...base, valueNodeId: `${identity}-value`, value }
    : action === "field-number-set"
      ? { kind: "field-number-value-set", ...base, valueNodeId: `${identity}-value`, value: finiteNumber(value) }
      : { kind: "field-checkbox-value-set", ...base, value: booleanInput(value) };
}

async function viewCreation(
  client: DesktopClient,
  workspaceId: string,
  argv: readonly string[],
): Promise<readonly EditMutation[]> {
  const hostNodeId = required(argv[1], "View host Node identity");
  const viewDefinitionNodeId = required(argv[2], "View Definition identity");
  const viewType = required(argv[3], "View type");
  if (viewType !== "outline" && viewType !== "table") {
    throw new Error("View type must be outline or table");
  }
  const metanodes = await projection(client, workspaceId, "metanodes");
  const existingMetanodeId = metanodes[hostNodeId];
  return [
    {
      kind: "shared-default-view-definition-create",
      hostNodeId,
      metanodeId:
        optionalFlag(argv, "--metanode") ??
        (typeof existingMetanodeId === "string" ? existingMetanodeId : `${hostNodeId}-metanode`),
      attachmentNodeId: `${viewDefinitionNodeId}-attachment`,
      attachmentOccurrenceId: `${viewDefinitionNodeId}-attachment-occurrence`,
      relationDefinitionOccurrenceId: `${viewDefinitionNodeId}-attachment-definition`,
      viewDefinitionNodeId,
      viewDefinitionOccurrenceId: `${viewDefinitionNodeId}-occurrence`,
      viewType,
      anchor: end,
    },
  ];
}

async function plainFieldSet(
  client: DesktopClient,
  workspaceId: string,
  argv: readonly string[],
): Promise<readonly EditMutation[]> {
  const ownerNodeId = required(argv[1], "Field owner Node identity");
  const fieldDefinitionId = required(argv[2], "Field Definition identity");
  const value = required(argv[3], "Plain Field value");
  const fields = await projection(client, workspaceId, "materializedFields");
  const existing = ((fields[ownerNodeId] as readonly Record<string, unknown>[] | undefined) ?? []).find(
    (field) => field.fieldDefinitionId === fieldDefinitionId,
  );
  if (existing === undefined) {
    const fieldNodeId = optionalFlag(argv, "--field-node") ?? `${ownerNodeId}-${fieldDefinitionId}`;
    const valueNodeId = `${fieldNodeId}-value`;
    return [
      {
        kind: "node-create",
        nodeId: fieldNodeId,
        occurrenceId: `${fieldNodeId}-occurrence`,
        parentNodeId: ownerNodeId,
        anchor: end,
      },
      {
        kind: "node-create",
        nodeId: valueNodeId,
        occurrenceId: `${valueNodeId}-occurrence`,
        parentNodeId: fieldNodeId,
        anchor: end,
        seed: { text: [{ value, attributes: {} }] },
      },
      {
        kind: "field-materialize",
        ownerNodeId,
        fieldDefinitionId,
        fieldNodeId,
        fieldOccurrenceId: `${fieldNodeId}-occurrence`,
      },
    ];
  }
  const valueOccurrenceIds = existing.valueOccurrenceIds as readonly string[];
  const occurrences = await projection(client, workspaceId, "occurrences");
  const occurrenceId = required(valueOccurrenceIds[0], "existing Plain Field value Occurrence");
  const valueNodeId = requiredString(
    (occurrences[occurrenceId] as Record<string, unknown>)?.nodeId,
    "existing Plain Field value Node identity",
  );
  const nodes = await projection(client, workspaceId, "nodes");
  const content =
    ((nodes[valueNodeId] as Record<string, unknown>)?.content as readonly Record<string, unknown>[]) ?? [];
  const deleteAtomIds = content.flatMap((item) =>
    item.kind === "text" && typeof item.id === "string" ? [item.id as TextAtomId] : [],
  );
  return [{ kind: "text-splice", nodeId: valueNodeId, deleteAtomIds, anchor: end, insert: value }];
}
