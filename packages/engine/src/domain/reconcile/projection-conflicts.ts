import {
  canonicalJson,
  factObserves,
  stableStringCompare,
  type ContributionFact,
  type FactSnapshot,
  type ResolutionFact,
} from "../fact/index.js";
import type { ConflictIssue } from "../conflict/types.js";
import type { EffectiveField, TemplateField } from "./projection-types.js";
import type { MutableOccurrence } from "./projection-state.js";
import { deriveActivation } from "../activation/index.js";
import { nodeTypeConflicts } from "./node-type-conflicts.js";

export function projectConflictIssues(
  snapshot: FactSnapshot,
  extensionConflicts: Readonly<Record<string, readonly string[]>>,
  templateFields: Readonly<Record<string, readonly TemplateField[]>>,
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>,
  active: readonly ContributionFact[],
  occurrences: ReadonlyMap<string, MutableOccurrence>,
): Readonly<Record<string, ConflictIssue>> {
  const issues = [
    ...unsupportedDirectIntents(snapshot),
    ...resolutionConflicts(snapshot),
    ...schemaExtensionConflicts(extensionConflicts),
    ...nodeTypeConflicts(active),
    ...fieldConfigConflicts(templateFields, effectiveFields),
    ...placementConflicts(active, occurrences),
  ];
  return Object.fromEntries(
    issues
      .sort((left, right) => stableStringCompare(left.identity, right.identity))
      .map((issue) => [issue.identity, issue]),
  );
}

function unsupportedDirectIntents(snapshot: FactSnapshot): readonly ConflictIssue[] {
  const activation = deriveActivation(snapshot.facts, "origin");
  const contributions = new Map<string, ContributionFact>(
    snapshot.facts
      .filter((fact): fact is ContributionFact => fact.body.kind === "contribution")
      .map((fact) => [fact.id, fact] as const),
  );
  return snapshot.facts.flatMap((fact): readonly ConflictIssue[] => {
    if (
      fact.body.kind !== "contribution" ||
      fact.body.intent !== "direct" ||
      activation.activeContributionIds.has(fact.id)
    ) {
      return [];
    }
    const missingSupportContributionIds = (activation.supportByContribution.get(fact.id) ?? [])
      .filter((supportId) => !activation.activeContributionIds.has(supportId))
      .filter((supportId) => rejectedProposalSupport(activation, supportId))
      .sort(stableStringCompare);
    if (missingSupportContributionIds.length === 0) {
      return [];
    }
    return [
      {
        kind: "unsupported-direct-intent",
        identity: canonicalJson(["unsupported-direct-intent", fact.id]),
        contributionId: fact.id,
        mutationKind: fact.body.mutation.kind,
        actorId: fact.body.actorId,
        replicaId: fact.coordinate.dot.replicaId,
        observedFrontier: fact.coordinate.observed,
        missingSupportContributionIds,
        requiredNodeIds: missingSupportContributionIds
          .flatMap((supportId) => {
            const support = contributions.get(supportId);
            return support?.body.mutation.kind === "node-create" ? [support.body.mutation.nodeId] : [];
          })
          .sort(stableStringCompare),
        recoveryActions: ["restore-support"],
      },
    ];
  });
}

function rejectedProposalSupport(activation: ReturnType<typeof deriveActivation>, contributionId: string): boolean {
  const decisions = new Set(
    (activation.resolutionByContribution.get(contributionId) ?? []).map((resolution) => resolution.body.decision),
  );
  return decisions.size === 1 && decisions.has("reject");
}

function placementConflicts(
  active: readonly ContributionFact[],
  occurrences: ReadonlyMap<string, MutableOccurrence>,
): readonly ConflictIssue[] {
  const moves = new Map<string, ContributionFact[]>();
  for (const fact of active) {
    if (fact.body.mutation.kind === "occurrence-move" && occurrences.has(fact.body.mutation.occurrenceId)) {
      const candidates = moves.get(fact.body.mutation.occurrenceId) ?? [];
      candidates.push(fact);
      moves.set(fact.body.mutation.occurrenceId, candidates);
    }
  }
  const issues: ConflictIssue[] = [];
  for (const [occurrenceId, candidates] of moves) {
    const maximal = candidates.filter(
      (candidate) => !candidates.some((other) => other.id !== candidate.id && factObserves(other, candidate)),
    );
    if (new Set(maximal.map((fact) => moveOf(fact).parentNodeId)).size < 2) {
      continue;
    }
    const ordered = maximal.sort((left, right) => stableStringCompare(left.id, right.id));
    issues.push({
      kind: "placement-conflict",
      identity: canonicalJson(["placement-conflict", occurrenceId, ordered.map((fact) => fact.id)]),
      occurrenceId,
      canonicalParentNodeId: occurrences.get(occurrenceId)!.parentNodeId,
      candidates: ordered.map((fact) => ({
        contributionId: fact.id,
        parentNodeId: moveOf(fact).parentNodeId,
        anchor: moveOf(fact).anchor,
        actorId: fact.body.actorId,
        replicaId: fact.coordinate.dot.replicaId,
        observedFrontier: fact.coordinate.observed,
      })),
    });
  }
  return issues;
}

function moveOf(fact: ContributionFact) {
  const mutation = fact.body.mutation;
  if (mutation.kind !== "occurrence-move") {
    throw new Error("Placement candidate is not an Occurrence move");
  }
  return mutation;
}

function fieldConfigConflicts(
  templateFields: Readonly<Record<string, readonly TemplateField[]>>,
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>,
): readonly ConflictIssue[] {
  const issues: ConflictIssue[] = [];
  for (const items of Object.values(templateFields)) {
    for (const item of items) {
      if (item.configCandidates.length > 1) {
        issues.push(
          fieldConfigConflict(null, item.fieldDefinitionId, [item.schemaId], [item.fieldNodeId], item.configCandidates),
        );
      }
    }
  }
  for (const [ownerNodeId, fields] of Object.entries(effectiveFields)) {
    for (const field of fields) {
      if (field.configCandidates.length > 1) {
        issues.push(
          fieldConfigConflict(
            ownerNodeId,
            field.fieldDefinitionId,
            field.sourceSchemaIds,
            field.sourceFieldNodeIds,
            field.configCandidates,
          ),
        );
      }
      const values = new Set(field.initializationCandidates.map((candidate) => canonicalJson(candidate.values)));
      if (values.size > 1) {
        issues.push({
          kind: "field-initialization-conflict",
          identity: canonicalJson(["field-initialization-conflict", ownerNodeId, field.fieldDefinitionId]),
          ownerNodeId,
          fieldDefinitionId: field.fieldDefinitionId,
          candidates: field.initializationCandidates,
        });
      }
    }
  }
  return issues;
}

function fieldConfigConflict(
  ownerNodeId: string | null,
  fieldDefinitionId: string,
  schemaIds: readonly string[],
  templateOccurrenceIds: readonly string[],
  candidates: readonly EffectiveField["configCandidates"][number][],
): ConflictIssue {
  const identity = canonicalJson([
    "field-config-conflict",
    ownerNodeId,
    fieldDefinitionId,
    [...templateOccurrenceIds].sort(stableStringCompare),
  ]);
  return {
    kind: "field-config-conflict",
    identity,
    ownerNodeId,
    fieldDefinitionId,
    schemaIds: [...schemaIds].sort(stableStringCompare),
    templateOccurrenceIds: [...templateOccurrenceIds].sort(stableStringCompare),
    candidates: candidates.map((candidate) => ({
      config: candidate.config,
      contributionIds: candidate.contributionIds,
    })),
  };
}

function resolutionConflicts(snapshot: FactSnapshot): readonly ConflictIssue[] {
  const resolutions = deriveActivation(snapshot.facts, "review").resolutionByContribution;
  const groups = new Map<string, Set<string>>();
  for (const [contributionId, candidates] of resolutions) {
    if (new Set(candidates.map((candidate) => candidate.body.decision)).size < 2) {
      continue;
    }
    const key = canonicalJson(candidates.map((candidate) => candidate.id).sort());
    const targets = groups.get(key) ?? new Set<string>();
    targets.add(contributionId);
    groups.set(key, targets);
  }
  return [...groups].map(([key, targets]) => resolutionConflict(snapshot, key, targets));
}

function resolutionConflict(snapshot: FactSnapshot, key: string, targets: ReadonlySet<string>): ConflictIssue {
  const candidateIds = JSON.parse(key) as string[];
  const candidates = snapshot.facts.filter(
    (fact): fact is ResolutionFact => fact.body.kind === "resolution" && candidateIds.includes(fact.id),
  );
  return {
    kind: "resolution-conflict",
    identity: canonicalJson(["resolution-conflict", candidateIds]),
    proposalContributionIds: [...targets].sort(stableStringCompare),
    candidates: candidates
      .sort((left, right) => stableStringCompare(left.id, right.id))
      .map((candidate) => ({
        resolutionId: candidate.id,
        decision: candidate.body.decision,
        actorId: candidate.body.actorId,
        replicaId: candidate.coordinate.dot.replicaId,
        observedFrontier: candidate.coordinate.observed,
      })),
  };
}

function schemaExtensionConflicts(conflicts: Readonly<Record<string, readonly string[]>>): readonly ConflictIssue[] {
  const groups = new Map<string, readonly string[]>();
  for (const schemaIds of Object.values(conflicts)) {
    const ordered = [...schemaIds].sort(stableStringCompare);
    groups.set(canonicalJson(ordered), ordered);
  }
  return [...groups.values()].map((schemaIds) => ({
    kind: "schema-extension-cycle",
    identity: canonicalJson(["schema-extension-cycle", schemaIds]),
    schemaIds,
  }));
}
