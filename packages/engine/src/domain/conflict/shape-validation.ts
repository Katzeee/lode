import {
  isIntrinsicNodeType,
  isAuthoredActionKind,
  isGraphActionKind,
  parseFactFrontier as frontier,
  parseSequenceAnchor as sequenceAnchor,
  requireFactActionId,
  requireFactActionIds,
  requireFactId,
  requireFactIds,
} from "../fact/index.js";
import { exact, nonempty as string, object as record, stringArray as strings } from "../../decoding/index.js";
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
        "factActionId",
        "actionKind",
        "actorId",
        "replicaId",
        "observedFrontier",
        "missingSupportActionIds",
        "requiredNodeIds",
        "recoveryActions",
      ],
      "Unsupported Direct intent",
    );
    const recoveryActions = strings(issue.recoveryActions, "Recovery actions");
    if (recoveryActions.length !== 1 || recoveryActions[0] !== "restore-support") {
      throw new Error("Unsupported Direct intent recovery actions are invalid");
    }
    if (!isAuthoredActionKind(issue.actionKind) || !isGraphActionKind(issue.actionKind)) {
      throw new Error("Unsupported Direct intent AuthoredAction kind is invalid");
    }
    return {
      kind,
      identity: string(issue.identity, "Conflict identity"),
      factActionId: requireFactActionId(issue.factActionId, "FactAction identity"),
      actionKind: issue.actionKind,
      actorId: string(issue.actorId, "Actor identity"),
      replicaId: string(issue.replicaId, "Replica identity"),
      observedFrontier: frontier(issue.observedFrontier),
      missingSupportActionIds: requireFactActionIds(issue.missingSupportActionIds, "Missing support actions"),
      requiredNodeIds: strings(issue.requiredNodeIds, "Required Node identities"),
      recoveryActions: ["restore-support"],
    };
  }
  if (kind === "placement-conflict") {
    return parsePlacementConflict(issue);
  }
  if (kind === "intrinsic-node-type-conflict") {
    return parseIntrinsicNodeTypeConflict(issue);
  }
  if (kind === "supertag-extension-cycle") {
    exact(issue, ["kind", "identity", "supertagIds"], "Supertag Extension conflict");
    return {
      kind,
      identity: string(issue.identity, "Conflict identity"),
      supertagIds: strings(issue.supertagIds, "conflicting Supertags"),
    };
  }
  if (kind !== "resolution-conflict") {
    throw new Error(`Unknown Conflict issue kind: ${kind}`);
  }
  exact(issue, ["kind", "identity", "proposalFactIds", "candidates"], "Resolution conflict");
  if (!Array.isArray(issue.candidates)) {
    throw new Error("Resolution candidates must be an array");
  }
  return {
    kind,
    identity: string(issue.identity, "Conflict identity"),
    proposalFactIds: requireFactIds(issue.proposalFactIds, "Proposal targets"),
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
        resolutionId: requireFactId(candidate.resolutionId, "Resolution identity"),
        decision: candidate.decision,
        actorId: string(candidate.actorId, "Actor identity"),
        replicaId: string(candidate.replicaId, "Replica identity"),
        observedFrontier: frontier(candidate.observedFrontier),
      };
    }),
  };
}

function parseIntrinsicNodeTypeConflict(
  issue: Record<string, unknown>,
): Extract<ConflictIssue, { kind: "intrinsic-node-type-conflict" }> {
  exact(issue, ["kind", "identity", "nodeId", "candidates"], "Intrinsic Node Type conflict");
  if (!Array.isArray(issue.candidates)) {
    throw new Error("Intrinsic Node Type candidates must be an array");
  }
  return {
    kind: "intrinsic-node-type-conflict",
    identity: string(issue.identity, "Conflict identity"),
    nodeId: string(issue.nodeId, "Node identity"),
    candidates: issue.candidates.map((value) => {
      const candidate = record(value, "Intrinsic Node Type candidate");
      exact(
        candidate,
        ["factActionId", "intrinsicNodeType", "actorId", "replicaId", "observedFrontier"],
        "Intrinsic Node Type candidate",
      );
      if (!isIntrinsicNodeType(candidate.intrinsicNodeType)) {
        throw new Error("Intrinsic Node Type candidate is invalid");
      }
      return {
        factActionId: requireFactActionId(candidate.factActionId, "FactAction identity"),
        intrinsicNodeType: candidate.intrinsicNodeType,
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
        ["factActionId", "parentNodeId", "anchor", "actorId", "replicaId", "observedFrontier"],
        "Placement candidate",
      );
      return {
        factActionId: requireFactActionId(candidate.factActionId, "FactAction identity"),
        parentNodeId: string(candidate.parentNodeId, "parent Node identity"),
        anchor: sequenceAnchor(candidate.anchor),
        actorId: string(candidate.actorId, "Actor identity"),
        replicaId: string(candidate.replicaId, "Replica identity"),
        observedFrontier: frontier(candidate.observedFrontier),
      };
    }),
  };
}
