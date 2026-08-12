import type { ConflictIssue } from "../domain/conflict/index.js";
import type { FactFrontier, SequenceAnchor } from "../domain/fact/index.js";
import { parseFieldTemplateConfig, parseFieldValueSeeds } from "./schema-projection-validation.js";

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
    return {
      kind,
      identity: string(issue.identity, "Conflict identity"),
      contributionId: string(issue.contributionId, "Contribution identity"),
      mutationKind: string(issue.mutationKind, "Mutation kind"),
      actorId: string(issue.actorId, "Actor identity"),
      replicaId: string(issue.replicaId, "Replica identity"),
      observedFrontier: frontier(issue.observedFrontier),
      missingSupportContributionIds: strings(
        issue.missingSupportContributionIds,
        "Missing support Contributions",
      ),
      requiredNodeIds: strings(issue.requiredNodeIds, "Required Node identities"),
      recoveryActions: ["restore-support"],
    };
  }
  if (kind === "placement-conflict") {
    return parsePlacementConflict(issue);
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
  exact(
    issue,
    ["kind", "identity", "proposalContributionIds", "candidates"],
    "Resolution conflict",
  );
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

function parsePlacementConflict(issue: Record<string, unknown>): ConflictIssue {
  exact(
    issue,
    ["kind", "identity", "occurrenceId", "canonicalParentOccurrenceId", "candidates"],
    "Placement conflict",
  );
  if (!Array.isArray(issue.candidates)) {
    throw new Error("Placement candidates must be an array");
  }
  return {
    kind: "placement-conflict",
    identity: string(issue.identity, "Conflict identity"),
    occurrenceId: string(issue.occurrenceId, "Occurrence identity"),
    canonicalParentOccurrenceId: nullableString(
      issue.canonicalParentOccurrenceId,
      "canonical parent Occurrence identity",
    ),
    candidates: issue.candidates.map((value) => {
      const candidate = record(value, "Placement candidate");
      exact(
        candidate,
        [
          "contributionId",
          "parentOccurrenceId",
          "anchor",
          "actorId",
          "replicaId",
          "observedFrontier",
        ],
        "Placement candidate",
      );
      return {
        contributionId: string(candidate.contributionId, "Contribution identity"),
        parentOccurrenceId: nullableString(
          candidate.parentOccurrenceId,
          "parent Occurrence identity",
        ),
        anchor: sequenceAnchor(candidate.anchor),
        actorId: string(candidate.actorId, "Actor identity"),
        replicaId: string(candidate.replicaId, "Replica identity"),
        observedFrontier: frontier(candidate.observedFrontier),
      };
    }),
  };
}

function sequenceAnchor(value: unknown): SequenceAnchor {
  const anchor = record(value, "Sequence anchor");
  exact(anchor, ["after", "before", "affinity", "fallback"], "Sequence anchor");
  if (
    (anchor.affinity !== "after" && anchor.affinity !== "before") ||
    (anchor.fallback !== "start" && anchor.fallback !== "end")
  ) {
    throw new Error("Sequence anchor policy is invalid");
  }
  return {
    after: nullableString(anchor.after, "anchor after identity"),
    before: nullableString(anchor.before, "anchor before identity"),
    affinity: anchor.affinity,
    fallback: anchor.fallback,
  };
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function parseFieldConfigConflict(issue: Record<string, unknown>): ConflictIssue {
  exact(
    issue,
    [
      "kind",
      "identity",
      "ownerNodeId",
      "fieldDefinitionId",
      "schemaIds",
      "templateItemIds",
      "candidates",
    ],
    "Field config conflict",
  );
  if (!Array.isArray(issue.candidates)) {
    throw new Error("Field config candidates must be an array");
  }
  return {
    kind: "field-config-conflict",
    identity: string(issue.identity, "Conflict identity"),
    ownerNodeId:
      issue.ownerNodeId === null ? null : string(issue.ownerNodeId, "Field owner identity"),
    fieldDefinitionId: string(issue.fieldDefinitionId, "Field Definition identity"),
    schemaIds: strings(issue.schemaIds, "conflicting Schemas"),
    templateItemIds: strings(issue.templateItemIds, "conflicting Template Items"),
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
  exact(
    issue,
    ["kind", "identity", "ownerNodeId", "fieldDefinitionId", "candidates"],
    "Field initialization conflict",
  );
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
  exact(
    candidate,
    ["initializationId", "schemaId", "source", "values"],
    "Field initialization candidate",
  );
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

function frontier(value: unknown): FactFrontier {
  const result = record(value, "Fact frontier");
  if (
    Object.entries(result).some(
      ([replicaId, sequence]) =>
        !/^[a-z2-7]{26}$/.test(replicaId) ||
        !Number.isSafeInteger(sequence) ||
        (sequence as number) < 0,
    )
  ) {
    throw new Error("Invalid Fact frontier");
  }
  return result as FactFrontier;
}

function strings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item) => string(item, label));
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}
