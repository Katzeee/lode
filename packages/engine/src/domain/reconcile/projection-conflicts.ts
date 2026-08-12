import {
  canonicalJson,
  stableStringCompare,
  type FactSnapshot,
  type ResolutionFact,
} from "../fact/index.js";
import type { ConflictIssue } from "../conflict/types.js";
import type { EffectiveField, SchemaFieldItem } from "./projection-types.js";
import { deriveActivation } from "./support.js";

export function projectConflictIssues(
  snapshot: FactSnapshot,
  extensionConflicts: Readonly<Record<string, readonly string[]>>,
  schemaFieldItems: Readonly<Record<string, readonly SchemaFieldItem[]>>,
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>,
): Readonly<Record<string, ConflictIssue>> {
  const issues = [
    ...resolutionConflicts(snapshot),
    ...schemaExtensionConflicts(extensionConflicts),
    ...fieldConfigConflicts(schemaFieldItems, effectiveFields),
  ];
  return Object.fromEntries(
    issues
      .sort((left, right) => stableStringCompare(left.identity, right.identity))
      .map((issue) => [issue.identity, issue]),
  );
}

function fieldConfigConflicts(
  schemaFieldItems: Readonly<Record<string, readonly SchemaFieldItem[]>>,
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>,
): readonly ConflictIssue[] {
  const issues: ConflictIssue[] = [];
  for (const items of Object.values(schemaFieldItems)) {
    for (const item of items) {
      if (item.configCandidates.length > 1) {
        issues.push(
          fieldConfigConflict(
            null,
            item.fieldDefinitionId,
            [item.schemaId],
            [item.templateItemId],
            item.configCandidates,
          ),
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
            field.sourceTemplateItemIds,
            field.configCandidates,
          ),
        );
      }
      const values = new Set(
        field.initializationCandidates.map((candidate) => canonicalJson(candidate.values)),
      );
      if (values.size > 1) {
        issues.push({
          kind: "field-initialization-conflict",
          identity: canonicalJson([
            "field-initialization-conflict",
            ownerNodeId,
            field.fieldDefinitionId,
          ]),
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
  templateItemIds: readonly string[],
  candidates: readonly EffectiveField["configCandidates"][number][],
): ConflictIssue {
  const identity = canonicalJson([
    "field-config-conflict",
    ownerNodeId,
    fieldDefinitionId,
    [...templateItemIds].sort(stableStringCompare),
  ]);
  return {
    kind: "field-config-conflict",
    identity,
    ownerNodeId,
    fieldDefinitionId,
    schemaIds: [...schemaIds].sort(stableStringCompare),
    templateItemIds: [...templateItemIds].sort(stableStringCompare),
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

function resolutionConflict(
  snapshot: FactSnapshot,
  key: string,
  targets: ReadonlySet<string>,
): ConflictIssue {
  const candidateIds = JSON.parse(key) as string[];
  const candidates = snapshot.facts.filter(
    (fact): fact is ResolutionFact =>
      fact.body.kind === "resolution" && candidateIds.includes(fact.id),
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

function schemaExtensionConflicts(
  conflicts: Readonly<Record<string, readonly string[]>>,
): readonly ConflictIssue[] {
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
