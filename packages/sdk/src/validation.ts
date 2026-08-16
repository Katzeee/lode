import type { EngineCommand, EngineQuery } from "./contract.js";
import { COMMAND_KINDS, DECISION_EFFECT_KINDS, MUTATION_KINDS, QUERY_KINDS } from "./protocol-cases.js";
import { editIntent } from "./protocol-enums/engine.js";
import { projectionPerspective } from "./protocol-enums/projection.js";
import { resolutionDecision } from "./protocol-enums/review.js";
import { PROJECTION_PAGE_SECTIONS } from "./projection.js";
import { validateHardDeleteSelection } from "./maintenance-validation.js";

const PREPARED_EVIDENCE = [
  "deletedAtoms",
  "observedConfigFactIds",
  "observedInitializationFactIds",
  "observedModeFactIds",
  "previous",
  "previousAnchor",
  "previousConfig",
  "previousOwnerNodeId",
  "previousParentNodeId",
  "previousHostNodeId",
  "previousViewType",
  "previousTargetNodeId",
  "sourceApplicationSupertagIds",
  "sourceSupertagIds",
  "sourceTemplateOccurrenceIds",
] as const;

export function parseEngineCommand(value: unknown): EngineCommand {
  const command = record(value, "Engine command");
  nonempty(command.workspaceId, "Engine command workspaceId");
  const kind = enumString(command.kind, COMMAND_KINDS, "Engine command kind");
  nonempty(command.invocationId, "Invocation identity");
  nonempty(command.actorId, "Actor identity");
  if (kind === "mutate") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "intent", "historyChannelId", "mutations"]);
    enumString(command.intent, editIntent.values, "Edit intent");
    nonempty(command.historyChannelId, "History channel");
    if (!Array.isArray(command.mutations) || command.mutations.length === 0) {
      throw new Error("Edit command requires a non-empty mutation batch");
    }
    for (const value of command.mutations) {
      const mutation = record(value, "Edit mutation");
      enumString(mutation.kind, MUTATION_KINDS, "Edit mutation kind");
      const evidence = PREPARED_EVIDENCE.find((key) => key in mutation);
      if (evidence) {
        throw new Error(`Prepared Fact evidence is not accepted by the edit interface: ${evidence}`);
      }
    }
  } else if (kind === "adjudicate-resolution") {
    exact(command, [
      "kind",
      "workspaceId",
      "invocationId",
      "actorId",
      "decision",
      "proposalContributionIds",
      "resolutionIds",
    ]);
    enumString(command.decision, resolutionDecision.values, "Resolution decision");
    identities(command.proposalContributionIds, "Proposal targets");
    identities(command.resolutionIds, "Resolution targets");
  } else if (kind === "resolve-review") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "decision", "selection"]);
    enumString(command.decision, resolutionDecision.values, "Resolution decision");
    reviewSelection(command.selection);
  } else if (kind === "undo" || kind === "redo") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "selection"]);
    historySelection(command.selection, kind);
  } else if (kind === "acknowledge-deletion") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "nodeId", "deletionFactIds"]);
    nonempty(command.nodeId, "Deleted Node identity");
    identities(command.deletionFactIds, "Deletion Fact identities");
  } else if (kind === "retire-replica") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "replicaId"]);
    const replicaId = nonempty(command.replicaId, "Retired Replica identity");
    if (!/^[a-z2-7]{26}$/.test(replicaId)) {
      throw new Error("Retired Replica identity is invalid");
    }
  } else if (kind === "hard-delete") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "selection"]);
    validateHardDeleteSelection(command.selection);
  }
  return command as EngineCommand;
}

export function parseEngineQuery(value: unknown): EngineQuery {
  const query = record(value, "Engine query");
  nonempty(query.workspaceId, "Engine query workspaceId");
  const kind = enumString(query.kind, QUERY_KINDS, "Engine query kind");
  const pagination = ["kind", "workspaceId", "after", "limit"];
  if (kind === "projection") {
    exact(query, [...pagination, "perspective", "section"]);
    enumString(query.perspective, projectionPerspective.values, "Projection perspective");
    if (query.section !== undefined) {
      enumString(query.section, PROJECTION_PAGE_SECTIONS, "Projection section");
    }
    paginationValues(query, 100, "Projection");
  } else if (kind === "supertag-instances") {
    exact(query, [...pagination, "perspective", "supertagId"]);
    enumString(query.perspective, projectionPerspective.values, "Supertag Instances perspective");
    nonempty(query.supertagId, "Supertag identity");
    paginationValues(query, 99, "Supertag Instances");
  } else if (kind === "backlinks") {
    exact(query, [...pagination, "perspective", "targetNodeId"]);
    enumString(query.perspective, projectionPerspective.values, "Backlinks perspective");
    nonempty(query.targetNodeId, "Backlink target Node identity");
    paginationValues(query, 100, "Backlinks");
  } else if (kind === "search-results") {
    exact(query, [...pagination, "perspective", "searchNodeId"]);
    enumString(query.perspective, projectionPerspective.values, "Search Results perspective");
    nonempty(query.searchNodeId, "Search Node identity");
    paginationValues(query, 100, "Search Results");
  } else if (kind === "view-rows") {
    exact(query, [...pagination, "perspective", "hostNodeId", "viewDefinitionNodeId"]);
    enumString(query.perspective, projectionPerspective.values, "View Rows perspective");
    nonempty(query.hostNodeId, "View host Node identity");
    if (query.viewDefinitionNodeId !== undefined) {
      nonempty(query.viewDefinitionNodeId, "View Definition Node identity");
    }
    paginationValues(query, 100, "View Rows");
  } else if (kind === "review" || kind === "conflicts") {
    exact(query, pagination);
    paginationValues(query, 100, kind === "review" ? "Review" : "Conflict");
  } else if (kind === "history") {
    exact(query, ["kind", "workspaceId", "channelId"]);
    nonempty(query.channelId, "History channel");
  } else if (kind === "invocation") {
    exact(query, ["kind", "workspaceId", "invocationId"]);
    nonempty(query.invocationId, "Invocation identity");
  } else {
    exact(query, ["kind", "workspaceId", "nodeId"]);
    nonempty(query.nodeId, "Node identity");
  }
  return query as EngineQuery;
}

function reviewSelection(value: unknown): void {
  const selection = record(value, "Review selection");
  nonempty(selection.token, "Review token");
  const evidence = record(selection.evidence, "Review evidence");
  if (!Array.isArray(evidence.effects)) {
    throw new Error("Review effects must be an array");
  }
  for (const value of evidence.effects) {
    const effect = record(value, "Review effect");
    enumString(effect.kind, DECISION_EFFECT_KINDS, "Review effect kind");
  }
}

function historySelection(value: unknown, operation: "undo" | "redo"): void {
  const selection = record(value, "History selection");
  if (selection.operation !== operation) {
    throw new Error("History selection operation does not match command");
  }
  const evidence = record(selection.evidence, "History evidence");
  if (!Array.isArray(evidence.compensations)) {
    throw new Error("History compensations must be an array");
  }
}

function paginationValues(value: Record<string, unknown>, maximum: number, label: string): void {
  if (value.after !== undefined && value.after !== null) {
    nonempty(value.after, `${label} cursor`);
  }
  if (
    value.limit !== undefined &&
    (!Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > maximum)
  ) {
    throw new Error(`${label} page limit must be between 1 and ${maximum}`);
  }
}

function identities(value: unknown, label: string): readonly string[] {
  const result = identityArray(value, label);
  if (result.length === 0) {
    throw new Error(`${label} must be a non-empty identity array`);
  }
  return result;
}

function identityArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an identity array`);
  }
  const result = value.map((item) => nonempty(item, label));
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} contains duplicate identities`);
  }
  return result;
}

function exact(value: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) {
    throw new Error(`Unknown input field: ${extra}`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function enumString<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
