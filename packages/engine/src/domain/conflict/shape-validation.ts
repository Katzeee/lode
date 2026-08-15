import {
  isNodeType,
  isMutationKind,
  parseFactFrontier as frontier,
  parseFieldTemplateConfig,
  parseFieldValueSeeds,
  parseSequenceAnchor as sequenceAnchor,
} from "../fact/index.js";
import { exact, nonempty as string, object as record, stringArray as strings } from "../../shape-validation/index.js";
import type { ConflictIssue } from "./types.js";

export function parseConflictIssue(value: unknown): ConflictIssue {
  const issue = record(value, "Conflict issue");
  const kind = string(issue.kind, "Conflict kind");
  if (kind === "unsupported-direct-intent") {
    exact(
      issue,
      [
        "kind",
        "identity",
        "contributionId",
        "mutationKind",
        "actorId",
        "replicaId",
        "observedFrontier",
        "missingSupportContributionIds",
        "requiredNodeIds",
        "recoveryActions",
      ],
      "Unsupported Direct intent",
    );
    const recoveryActions = strings(issue.recoveryActions, "Recovery actions");
    if (recoveryActions.length !== 1 || recoveryActions[0] !== "restore-support") {
      throw new Error("Unsupported Direct intent recovery actions are invalid");
    }
    if (!isMutationKind(issue.mutationKind)) {
      throw new Error("Unsupported Direct intent Mutation kind is invalid");
    }
    return {
      kind,
      identity: string(issue.identity, "Conflict identity"),
      contributionId: string(issue.contributionId, "Contribution identity"),
      mutationKind: issue.mutationKind,
      actorId: string(issue.actorId, "Actor identity"),
      replicaId: string(issue.replicaId, "Replica identity"),
      observedFrontier: frontier(issue.observedFrontier),
      missingSupportContributionIds: strings(issue.missingSupportContributionIds, "Missing support Contributions"),
      requiredNodeIds: strings(issue.requiredNodeIds, "Required Node identities"),
      recoveryActions: ["restore-support"],
    };
  }
  if (kind === "placement-conflict") {
    return parsePlacementConflict(issue);
  }
  if (kind === "node-type-conflict") {
    return parseNodeTypeConflict(issue);
  }
  if (kind === "schema-extension-cycle") {
    exact(issue, ["kind", "identity", "schemaIds"], "Schema Extension conflict");
    return {
      kind,
      identity: string(issue.identity, "Conflict identity"),
      schemaIds: strings(issue.schemaIds, "conflicting Schemas"),
    };
  }
  if (kind === "field-config-conflict") {
    return parseFieldConfigConflict(issue);
  }
  if (kind === "field-initialization-conflict") {
    return parseFieldInitializationConflict(issue);
  }
  if (kind !== "resolution-conflict") {
    throw new Error(`Unknown Conflict issue kind: ${kind}`);
  }
  exact(issue, ["kind", "identity", "proposalContributionIds", "candidates"], "Resolution conflict");
  if (!Array.isArray(issue.candidates)) {
    throw new Error("Resolution candidates must be an array");
  }
  return {
    kind,
    identity: string(issue.identity, "Conflict identity"),
    proposalContributionIds: strings(issue.proposalContributionIds, "Proposal targets"),
    candidates: issue.candidates.map((value) => {
      const candidate = record(value, "Resolution candidate");
      exact(
        candidate,
        ["resolutionId", "decision", "actorId", "replicaId", "observedFrontier"],
        "Resolution candidate",
      );
      if (candidate.decision !== "accept" && candidate.decision !== "reject") {
        throw new Error("Resolution decision is invalid");
      }
      return {
        resolutionId: string(candidate.resolutionId, "Resolution identity"),
        decision: candidate.decision,
        actorId: string(candidate.actorId, "Actor identity"),
        replicaId: string(candidate.replicaId, "Replica identity"),
        observedFrontier: frontier(candidate.observedFrontier),
      };
    }),
  };
}

function parseNodeTypeConflict(issue: Record<string, unknown>): Extract<ConflictIssue, { kind: "node-type-conflict" }> {
  exact(issue, ["kind", "identity", "nodeId", "candidates"], "Node type conflict");
  if (!Array.isArray(issue.candidates)) {
    throw new Error("Node type candidates must be an array");
  }
  return {
    kind: "node-type-conflict",
    identity: string(issue.identity, "Conflict identity"),
    nodeId: string(issue.nodeId, "Node identity"),
    candidates: issue.candidates.map((value) => {
      const candidate = record(value, "Node type candidate");
      exact(
        candidate,
        ["contributionId", "nodeType", "actorId", "replicaId", "observedFrontier"],
        "Node type candidate",
      );
      if (!isNodeType(candidate.nodeType)) {
        throw new Error("Node type candidate is invalid");
      }
      return {
        contributionId: string(candidate.contributionId, "Contribution identity"),
        nodeType: candidate.nodeType,
        actorId: string(candidate.actorId, "Actor identity"),
        replicaId: string(candidate.replicaId, "Replica identity"),
        observedFrontier: frontier(candidate.observedFrontier),
      };
    }),
  };
}

function parsePlacementConflict(issue: Record<string, unknown>): ConflictIssue {
  exact(issue, ["kind", "identity", "occurrenceId", "canonicalParentNodeId", "candidates"], "Placement conflict");
  if (!Array.isArray(issue.candidates)) {
    throw new Error("Placement candidates must be an array");
  }
  return {
    kind: "placement-conflict",
    identity: string(issue.identity, "Conflict identity"),
    occurrenceId: string(issue.occurrenceId, "Occurrence identity"),
    canonicalParentNodeId: string(issue.canonicalParentNodeId, "canonical parent Node identity"),
    candidates: issue.candidates.map((value) => {
      const candidate = record(value, "Placement candidate");
      exact(
        candidate,
        ["contributionId", "parentNodeId", "anchor", "actorId", "replicaId", "observedFrontier"],
        "Placement candidate",
      );
      return {
        contributionId: string(candidate.contributionId, "Contribution identity"),
        parentNodeId: string(candidate.parentNodeId, "parent Node identity"),
        anchor: sequenceAnchor(candidate.anchor),
        actorId: string(candidate.actorId, "Actor identity"),
        replicaId: string(candidate.replicaId, "Replica identity"),
        observedFrontier: frontier(candidate.observedFrontier),
      };
    }),
  };
}

function parseFieldConfigConflict(issue: Record<string, unknown>): ConflictIssue {
  exact(
    issue,
    ["kind", "identity", "ownerNodeId", "fieldDefinitionId", "schemaIds", "templateOccurrenceIds", "candidates"],
    "Field config conflict",
  );
  if (!Array.isArray(issue.candidates)) {
    throw new Error("Field config candidates must be an array");
  }
  return {
    kind: "field-config-conflict",
    identity: string(issue.identity, "Conflict identity"),
    ownerNodeId: issue.ownerNodeId === null ? null : string(issue.ownerNodeId, "Field owner identity"),
    fieldDefinitionId: string(issue.fieldDefinitionId, "Field Definition identity"),
    schemaIds: strings(issue.schemaIds, "conflicting Schemas"),
    templateOccurrenceIds: strings(issue.templateOccurrenceIds, "conflicting Template Fields"),
    candidates: issue.candidates.map((value) => {
      const candidate = record(value, "Field config candidate");
      exact(candidate, ["config", "contributionIds"], "Field config candidate");
      return {
        config: parseFieldTemplateConfig(candidate.config),
        contributionIds: strings(candidate.contributionIds, "config Contributions"),
      };
    }),
  };
}

function parseFieldInitializationConflict(issue: Record<string, unknown>): ConflictIssue {
  exact(issue, ["kind", "identity", "ownerNodeId", "fieldDefinitionId", "candidates"], "Field initialization conflict");
  if (!Array.isArray(issue.candidates)) {
    throw new Error("Field initialization candidates must be an array");
  }
  return {
    kind: "field-initialization-conflict",
    identity: string(issue.identity, "Conflict identity"),
    ownerNodeId: string(issue.ownerNodeId, "Field owner identity"),
    fieldDefinitionId: string(issue.fieldDefinitionId, "Field Definition identity"),
    candidates: issue.candidates.map(parseInitializationCandidate),
  };
}

function parseInitializationCandidate(
  value: unknown,
): Extract<ConflictIssue, { kind: "field-initialization-conflict" }>["candidates"][number] {
  const candidate = record(value, "Field initialization candidate");
  exact(candidate, ["initializationId", "schemaId", "source", "values"], "Field initialization candidate");
  if (candidate.source !== "static-default" && candidate.source !== "auto-initialize") {
    throw new Error("Field initialization source is invalid");
  }
  return {
    initializationId: string(candidate.initializationId, "Initialization identity"),
    schemaId: string(candidate.schemaId, "Schema identity"),
    source: candidate.source,
    values: parseFieldValueSeeds(candidate.values),
  };
}
