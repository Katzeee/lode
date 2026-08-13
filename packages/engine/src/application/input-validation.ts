import type { EngineCommand, EngineQuery } from "./contract.js";
import { parseEditMutation } from "./edit-input-validation.js";
import {
  parseHistorySelectionContract,
  parseReviewSelectionContract,
} from "./selection-validation.js";
import { parseMaintenanceCommand, parseMaintenanceQuery } from "./maintenance-input-validation.js";

export function parseEngineCommand(value: unknown): EngineCommand {
  const command = object(value, "Engine command");
  const kind = nonempty(command.kind, "command kind");
  if (kind === "mutate") {
    keys(command, [
      "kind",
      "workspaceId",
      "invocationId",
      "actorId",
      "intent",
      "historyChannelId",
      "mutations",
    ]);
    if (command.intent !== "direct" && command.intent !== "proposal") {
      throw new Error("Invalid edit intent");
    }
    if (!Array.isArray(command.mutations) || command.mutations.length === 0) {
      throw new Error("Edit command requires a non-empty operation batch");
    }
    const workspaceId = nonempty(command.workspaceId, "Workspace identity");
    const mutations = command.mutations.map(parseEditMutation);
    if (
      mutations.some(
        (mutation) => mutation.kind === "node-create" && mutation.nodeId === workspaceId,
      )
    ) {
      throw new Error("Workspace identity is created only by Workspace genesis");
    }
    return {
      kind,
      workspaceId,
      invocationId: nonempty(command.invocationId, "Invocation identity"),
      actorId: nonempty(command.actorId, "Actor identity"),
      intent: command.intent,
      historyChannelId: nonempty(command.historyChannelId, "History channel"),
      mutations,
    };
  }
  if (kind === "resolve-review") {
    keys(command, ["kind", "workspaceId", "invocationId", "actorId", "decision", "selection"]);
    if (command.decision !== "accept" && command.decision !== "reject") {
      throw new Error("Invalid review decision");
    }
    return {
      kind,
      workspaceId: nonempty(command.workspaceId, "Workspace identity"),
      invocationId: nonempty(command.invocationId, "Invocation identity"),
      actorId: nonempty(command.actorId, "Actor identity"),
      decision: command.decision,
      selection: parseReviewSelectionContract(command.selection),
    };
  }
  if (kind === "adjudicate-resolution") {
    keys(command, [
      "kind",
      "workspaceId",
      "invocationId",
      "actorId",
      "decision",
      "proposalContributionIds",
      "resolutionIds",
    ]);
    if (command.decision !== "accept" && command.decision !== "reject") {
      throw new Error("Invalid adjudication decision");
    }
    return {
      kind,
      workspaceId: nonempty(command.workspaceId, "Workspace identity"),
      invocationId: nonempty(command.invocationId, "Invocation identity"),
      actorId: nonempty(command.actorId, "Actor identity"),
      decision: command.decision,
      proposalContributionIds: identities(command.proposalContributionIds, "Proposal targets"),
      resolutionIds: identities(command.resolutionIds, "Resolution targets"),
    };
  }
  const maintenance = parseMaintenanceCommand(kind, command);
  if (maintenance) {
    return maintenance;
  }
  if (kind === "undo" || kind === "redo") {
    keys(command, ["kind", "workspaceId", "invocationId", "actorId", "selection"]);
    return {
      kind,
      workspaceId: nonempty(command.workspaceId, "Workspace identity"),
      invocationId: nonempty(command.invocationId, "Invocation identity"),
      actorId: nonempty(command.actorId, "Actor identity"),
      selection: parseHistorySelectionContract(command.selection, kind),
    };
  }
  throw new Error(`Unknown Engine command kind: ${kind}`);
}

export function parseEngineQuery(value: unknown): EngineQuery {
  const query = object(value, "Engine query");
  const kind = nonempty(query.kind, "query kind");
  if (kind === "projection") {
    return parseProjectionQuery(query);
  }
  if (kind === "review") {
    keys(query, ["kind", "workspaceId", "after", "limit"]);
    const limit = query.limit === undefined ? 50 : query.limit;
    if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) {
      throw new Error("Review page limit must be between 1 and 100");
    }
    return {
      kind,
      workspaceId: nonempty(query.workspaceId, "Workspace identity"),
      after:
        query.after === undefined || query.after === null
          ? null
          : nonempty(query.after, "Review cursor"),
      limit: limit as number,
    };
  }
  if (kind === "history") {
    keys(query, ["kind", "workspaceId", "channelId"]);
    return {
      kind,
      workspaceId: nonempty(query.workspaceId, "Workspace identity"),
      channelId: nonempty(query.channelId, "History channel"),
    };
  }
  if (kind === "conflicts") {
    keys(query, ["kind", "workspaceId", "after", "limit"]);
    const limit = query.limit === undefined ? 50 : query.limit;
    if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) {
      throw new Error("Conflict page limit must be between 1 and 100");
    }
    return {
      kind,
      workspaceId: nonempty(query.workspaceId, "Workspace identity"),
      after:
        query.after === undefined || query.after === null
          ? null
          : nonempty(query.after, "Conflict cursor"),
      limit: limit as number,
    };
  }
  if (kind === "schema-search") {
    return parseSchemaSearch(query);
  }
  if (kind === "view") {
    return parseViewQuery(query);
  }
  const maintenance = parseMaintenanceQuery(kind, query);
  if (maintenance) {
    return maintenance;
  }
  if (kind === "invocation") {
    keys(query, ["kind", "workspaceId", "invocationId"]);
    return {
      kind,
      workspaceId: nonempty(query.workspaceId, "Workspace identity"),
      invocationId: nonempty(query.invocationId, "Invocation identity"),
    };
  }
  throw new Error(`Unknown Engine query kind: ${kind}`);
}

function parseViewQuery(query: Record<string, unknown>): EngineQuery {
  keys(query, ["kind", "workspaceId", "view", "viewNodeId", "after", "limit"]);
  if (query.view !== "origin" && query.view !== "review") {
    throw new Error("Invalid View projection mode");
  }
  const limit = query.limit === undefined ? 50 : query.limit;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 50) {
    throw new Error("View page limit must be between 1 and 50");
  }
  return {
    kind: "view",
    workspaceId: nonempty(query.workspaceId, "Workspace identity"),
    view: query.view,
    viewNodeId: nonempty(query.viewNodeId, "View Node identity"),
    after:
      query.after === undefined || query.after === null
        ? null
        : nonempty(query.after, "View cursor"),
    limit: limit as number,
  };
}

function parseProjectionQuery(query: Record<string, unknown>): EngineQuery {
  keys(query, ["kind", "workspaceId", "view", "section", "after", "limit"]);
  if (query.view !== "origin" && query.view !== "review") {
    throw new Error("Invalid projection view");
  }
  const sections = [
    "nodes",
    "occurrences",
    "children",
    "nodeOwners",
    "addressedValues",
    "schemaApplications",
    "schemaFields",
    "templateFields",
    "schemaTemplateNodes",
    "templateNodeInstances",
    "schemaExtensions",
    "schemaSearchMembers",
    "schemaExtensionConflicts",
    "nodeStatuses",
    "conflictIssues",
    "effectiveFields",
    "materializedFields",
  ] as const;
  const section =
    query.section === undefined ? "nodes" : oneOf(query.section, sections, "Projection section");
  const limit = query.limit === undefined ? 100 : query.limit;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) {
    throw new Error("Projection page limit must be between 1 and 100");
  }
  return {
    kind: "projection",
    workspaceId: nonempty(query.workspaceId, "Workspace identity"),
    view: query.view,
    section,
    after:
      query.after === undefined || query.after === null
        ? null
        : nonempty(query.after, "Projection cursor"),
    limit: limit as number,
  };
}

function parseSchemaSearch(query: Record<string, unknown>): EngineQuery {
  keys(query, ["kind", "workspaceId", "view", "schemaId", "after", "limit"]);
  if (query.view !== "origin" && query.view !== "review") {
    throw new Error("Invalid Schema Search view");
  }
  const limit = query.limit === undefined ? 50 : query.limit;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 99) {
    throw new Error("Schema Search page limit must be between 1 and 99");
  }
  return {
    kind: "schema-search",
    workspaceId: nonempty(query.workspaceId, "Workspace identity"),
    view: query.view,
    schemaId: nonempty(query.schemaId, "Schema identity"),
    after:
      query.after === undefined || query.after === null
        ? null
        : nonempty(query.after, "Schema Search cursor"),
    limit: limit as number,
  };
}

function identities(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty identity array`);
  }
  const result = value.map((item) => nonempty(item, label));
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} contains duplicate identities`);
  }
  return result;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new Error(`Unknown input field: ${unknown}`);
  }
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
