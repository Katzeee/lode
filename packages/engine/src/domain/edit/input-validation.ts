import { parseMutation } from "../fact/index.js";
import { isFactMutationEdit, PREPARED_MUTATION_EVIDENCE_KEYS, type EditMutation } from "./types.js";

export function parseEditMutation(value: unknown): EditMutation {
  const edit = object(value);
  if (edit.kind === "reference-promote") {
    exactKeys(edit, ["kind", "occurrenceId"]);
    if (typeof edit.occurrenceId !== "string" || edit.occurrenceId.length === 0) {
      throw new Error("Reference Occurrence identity is invalid");
    }
    return { kind: "reference-promote", occurrenceId: edit.occurrenceId };
  }
  if (edit.kind === "inline-reference-alias-create") {
    exactKeys(edit, [
      "kind",
      "inlineReferenceId",
      "hostNodeId",
      "metanodeId",
      "aliasNodeId",
      "aliasOccurrenceId",
      "seed",
    ]);
    const inlineReferenceId = nonemptyString(edit.inlineReferenceId, "Inline Reference identity");
    const hostNodeId = nonemptyString(edit.hostNodeId, "Inline Reference host Node identity");
    const metanodeId = nonemptyString(edit.metanodeId, "Metanode Node identity");
    const aliasNodeId = nonemptyString(edit.aliasNodeId, "Inline Alias Node identity");
    const aliasOccurrenceId = nonemptyString(edit.aliasOccurrenceId, "Inline Alias Occurrence identity");
    const aliasNode = parseMutation({
      kind: "node-create",
      nodeId: aliasNodeId,
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    });
    return {
      kind: "inline-reference-alias-create",
      inlineReferenceId,
      hostNodeId,
      metanodeId,
      aliasNodeId,
      aliasOccurrenceId,
      ...(aliasNode.seed === undefined ? {} : { seed: aliasNode.seed }),
    };
  }
  if (edit.kind === "search-supertag-clause-create" || edit.kind === "search-field-clause-create") {
    return parseSearchClauseCreate(edit);
  }
  if (edit.kind === "shared-default-view-definition-create") {
    return parseSharedDefaultViewDefinitionCreate(edit);
  }
  if (
    edit.kind === "field-datatype-configuration-create" ||
    edit.kind === "field-cardinality-configuration-create" ||
    edit.kind === "field-initialization-expression-configuration-create"
  ) {
    return parseFieldDefinitionConfigurationCreate(edit);
  }
  if (edit.kind !== "node-create") {
    rejectPreparedEvidence(edit);
    const parsed = parseMutation(value);
    if (!isFactMutationEdit(parsed)) {
      throw new Error(`${parsed.kind} is not a public edit operation`);
    }
    return parsed;
  }
  exactKeys(edit, ["kind", "nodeId", "occurrenceId", "parentNodeId", "anchor", "seed", "nodeType"]);
  const identity = parseMutation({
    kind: "node-create",
    nodeId: edit.nodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: edit.occurrenceId,
    nodeId: edit.nodeId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
  const nodeType =
    edit.nodeType === undefined
      ? undefined
      : parseMutation({
          kind: "node-type-declare",
          nodeId: edit.nodeId,
          nodeType: edit.nodeType,
        });
  return {
    ...identity,
    occurrenceId: placement.occurrenceId,
    parentNodeId: placement.parentNodeId,
    anchor: placement.anchor,
    ...(nodeType === undefined ? {} : { nodeType: nodeType.nodeType }),
  };
}

function parseFieldDefinitionConfigurationCreate(edit: Record<string, unknown>): EditMutation {
  const valueKey =
    edit.kind === "field-datatype-configuration-create"
      ? "datatype"
      : edit.kind === "field-cardinality-configuration-create"
        ? "cardinality"
        : "expression";
  exactKeys(edit, [
    "kind",
    "fieldDefinitionId",
    "metanodeId",
    "configurationNodeId",
    "configurationOccurrenceId",
    "anchor",
    "seed",
    valueKey,
  ]);
  const fieldDefinitionId = nonemptyString(edit.fieldDefinitionId, "Field Definition identity");
  const metanodeId = nonemptyString(edit.metanodeId, "Metanode Node identity");
  const configurationNodeId = nonemptyString(edit.configurationNodeId, "Field configuration Node identity");
  const configurationOccurrenceId = nonemptyString(
    edit.configurationOccurrenceId,
    "Field configuration Occurrence identity",
  );
  const node = parseMutation({
    kind: "node-create",
    nodeId: configurationNodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: configurationOccurrenceId,
    nodeId: configurationNodeId,
    parentNodeId: metanodeId,
    anchor: edit.anchor,
  });
  const common = {
    fieldDefinitionId,
    metanodeId,
    configurationNodeId,
    configurationOccurrenceId,
    anchor: placement.anchor,
    ...(node.seed === undefined ? {} : { seed: node.seed }),
  };
  if (edit.kind === "field-datatype-configuration-create") {
    const config = parseMutation({
      kind: "field-datatype-configure",
      fieldDefinitionId,
      configurationNodeId,
      configurationOccurrenceId,
      datatype: edit.datatype,
    });
    return { kind: edit.kind, ...common, datatype: config.datatype };
  }
  if (edit.kind === "field-cardinality-configuration-create") {
    const config = parseMutation({
      kind: "field-cardinality-configure",
      fieldDefinitionId,
      configurationNodeId,
      configurationOccurrenceId,
      cardinality: edit.cardinality,
    });
    return { kind: edit.kind, ...common, cardinality: config.cardinality };
  }
  const config = parseMutation({
    kind: "field-initialization-expression-configure",
    fieldDefinitionId,
    configurationNodeId,
    configurationOccurrenceId,
    expression: edit.expression,
  });
  return { kind: "field-initialization-expression-configuration-create", ...common, expression: config.expression };
}

function parseSharedDefaultViewDefinitionCreate(edit: Record<string, unknown>): EditMutation {
  exactKeys(edit, [
    "kind",
    "hostNodeId",
    "metanodeId",
    "viewDefinitionNodeId",
    "viewDefinitionOccurrenceId",
    "viewType",
    "anchor",
    "seed",
  ]);
  const hostNodeId = nonemptyString(edit.hostNodeId, "View host Node identity");
  const metanodeId = nonemptyString(edit.metanodeId, "Metanode Node identity");
  const viewDefinitionNodeId = nonemptyString(edit.viewDefinitionNodeId, "View Definition Node identity");
  const viewDefinitionOccurrenceId = nonemptyString(
    edit.viewDefinitionOccurrenceId,
    "View Definition Occurrence identity",
  );
  const viewDefinition = parseMutation({
    kind: "node-create",
    nodeId: viewDefinitionNodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: viewDefinitionOccurrenceId,
    nodeId: viewDefinitionNodeId,
    parentNodeId: metanodeId,
    anchor: edit.anchor,
  });
  const mode = parseMutation({
    kind: "shared-default-view-definition-mode-set",
    viewDefinitionNodeId,
    viewType: edit.viewType,
  });
  return {
    kind: "shared-default-view-definition-create",
    hostNodeId,
    metanodeId,
    viewDefinitionNodeId,
    viewDefinitionOccurrenceId,
    viewType: mode.viewType,
    anchor: placement.anchor,
    ...(viewDefinition.seed === undefined ? {} : { seed: viewDefinition.seed }),
  };
}

function parseSearchClauseCreate(edit: Record<string, unknown>): EditMutation {
  const supertagClause = edit.kind === "search-supertag-clause-create";
  exactKeys(edit, [
    "kind",
    "searchNodeId",
    "metanodeId",
    "clauseNodeId",
    "clauseOccurrenceId",
    "anchor",
    "seed",
    supertagClause ? "supertagId" : "fieldDefinitionId",
  ]);
  const searchNodeId = nonemptyString(edit.searchNodeId, "Search Node identity");
  const metanodeId = nonemptyString(edit.metanodeId, "Metanode Node identity");
  const clauseNodeId = nonemptyString(edit.clauseNodeId, "Search clause Node identity");
  const clauseOccurrenceId = nonemptyString(edit.clauseOccurrenceId, "Search clause Occurrence identity");
  const clauseNode = parseMutation({
    kind: "node-create",
    nodeId: clauseNodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: clauseOccurrenceId,
    nodeId: clauseNodeId,
    parentNodeId: metanodeId,
    anchor: edit.anchor,
  });
  const common = {
    searchNodeId,
    metanodeId,
    clauseNodeId,
    clauseOccurrenceId,
    anchor: placement.anchor,
    ...(clauseNode.seed === undefined ? {} : { seed: clauseNode.seed }),
  };
  return supertagClause
    ? {
        kind: "search-supertag-clause-create",
        ...common,
        supertagId: nonemptyString(edit.supertagId, "Search clause Supertag identity"),
      }
    : {
        kind: "search-field-clause-create",
        ...common,
        fieldDefinitionId: nonemptyString(edit.fieldDefinitionId, "Search clause Field Definition identity"),
      };
}

function rejectPreparedEvidence(edit: Record<string, unknown>): void {
  const evidence = PREPARED_MUTATION_EVIDENCE_KEYS.find((key) => key in edit);
  if (evidence) {
    throw new Error(`Prepared Fact evidence is not accepted by the edit interface: ${evidence}`);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Edit mutation must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new Error(`Unknown input field: ${unknown}`);
  }
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
