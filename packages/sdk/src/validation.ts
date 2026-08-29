import { OUTLINE_MAX_DEPTH, type EngineCommand, type EngineQuery } from "./contract.js";
import { ACTION_KINDS, COMMAND_KINDS, QUERY_KINDS } from "./protocol-cases.js";
import { editIntent } from "./protocol-enums/engine.js";
import { projectionPerspective } from "./protocol-enums/projection.js";
import { resolutionDecision } from "./protocol-enums/review.js";
import { PROJECTION_PAGE_SECTIONS } from "./projection.js";
import { factActionIds, factIds } from "./fact-identities.js";

export function parseEngineCommand(value: unknown): EngineCommand {
  const command = record(value, "Engine command");
  nonempty(command.workspaceId, "Engine command workspaceId");
  const kind = enumString(command.kind, COMMAND_KINDS, "Engine command kind");
  nonempty(command.invocationId, "Invocation identity");
  nonempty(command.actorId, "Actor identity");
  if (kind === "edit") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "intent", "historyChannelId", "actions"]);
    enumString(command.intent, editIntent.values, "Edit intent");
    nonempty(command.historyChannelId, "History channel");
    if (!Array.isArray(command.actions) || command.actions.length === 0) {
      throw new Error("Edit command requires a non-empty action batch");
    }
    for (const value of command.actions) {
      const action = record(value, "Edit action");
      enumString(action.kind, ACTION_KINDS, "Edit action kind");
    }
  } else if (kind === "adjudicate-resolution") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "decision", "proposalFactIds", "resolutionIds"]);
    enumString(command.decision, resolutionDecision.values, "Resolution decision");
    factIds(command.proposalFactIds, "Proposal targets");
    factIds(command.resolutionIds, "Resolution targets");
  } else if (kind === "resolve-review") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "decision", "selection"]);
    enumString(command.decision, resolutionDecision.values, "Resolution decision");
    reviewSelection(command.selection);
  } else if (kind === "undo" || kind === "redo") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "selection"]);
    historySelection(command.selection, kind);
  } else if (kind === "finalize-deletions") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "nodeIds"]);
    if (!Array.isArray(command.nodeIds) || command.nodeIds.length === 0) {
      throw new Error("Deletion Finalization requires at least one Trash root");
    }
    const nodeIds = command.nodeIds.map((nodeId) => nonempty(nodeId, "Deletion Finalization Node identity"));
    if (new Set(nodeIds).size !== nodeIds.length) {
      throw new Error("Deletion Finalization roots must be unique");
    }
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
  } else if (kind === "outline") {
    exact(query, [...pagination, "perspective", "rootNodeId", "maxDepth"]);
    enumString(query.perspective, projectionPerspective.values, "Outline perspective");
    nonempty(query.rootNodeId, "Outline root Node identity");
    if (
      !Number.isSafeInteger(query.maxDepth) ||
      (query.maxDepth as number) < 1 ||
      (query.maxDepth as number) > OUTLINE_MAX_DEPTH
    ) {
      throw new Error(`Outline maximum depth must be between 1 and ${OUTLINE_MAX_DEPTH}`);
    }
    paginationValues(query, 100, "Outline");
  } else if (kind === "debug-node") {
    exact(query, ["kind", "workspaceId", "perspective", "nodeId"]);
    enumString(query.perspective, projectionPerspective.values, "Debug Node perspective");
    nonempty(query.nodeId, "Debug Node identity");
  } else if (kind === "trash-evidence") {
    exact(query, ["kind", "workspaceId", "perspective", "nodeId"]);
    enumString(query.perspective, projectionPerspective.values, "Trash Evidence perspective");
    nonempty(query.nodeId, "Trash Evidence Node identity");
  } else if (kind === "review" || kind === "conflicts") {
    exact(query, pagination);
    paginationValues(query, 100, kind === "review" ? "Review" : "Conflict");
  } else if (kind === "history") {
    exact(query, ["kind", "workspaceId", "channelId"]);
    nonempty(query.channelId, "History channel");
  } else if (kind === "invocation") {
    exact(query, ["kind", "workspaceId", "invocationId"]);
    nonempty(query.invocationId, "Invocation identity");
  }
  return query as EngineQuery;
}

function reviewSelection(value: unknown): void {
  const selection = record(value, "Review selection");
  nonempty(selection.evidenceId, "Review evidence identity");
  factActionIds(selection.proposalActionIds, "Review proposal actions");
}

function historySelection(value: unknown, operation: "undo" | "redo"): void {
  const selection = record(value, "History selection");
  nonempty(selection.token, `${operation} History token`);
  nonempty(selection.channelId, "History channel");
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
