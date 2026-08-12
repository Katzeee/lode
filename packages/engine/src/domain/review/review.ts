import { createHmac, randomBytes } from "node:crypto";

import {
  canonicalDigest,
  canonicalJson,
  frontierEquals,
  stableStringCompare,
  type ContributionFact,
  type FactSnapshot,
  type ResolutionDecision,
} from "../fact/index.js";
import type { ProjectionGeneration } from "../reconcile/index.js";
import { candidateImpacts, collectReviewCandidates, type HunkCandidate } from "./candidates.js";
import {
  createReviewEvidenceContext,
  evidenceForTargets,
  type ReviewEvidenceContext,
} from "./evidence.js";
import type {
  DecisionEvidence,
  ReviewHunk,
  ReviewQuery,
  ReviewSelection,
  SelectionValidation,
} from "./types.js";

const DEFAULT_REVIEW_CAPABILITY_KEY = randomBytes(32).toString("hex");

export function queryReview(
  workspaceId: string,
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  capabilityKey = DEFAULT_REVIEW_CAPABILITY_KEY,
  page?: Readonly<{
    pending: ReadonlyMap<string, ContributionFact>;
    context?: ReviewEvidenceContext;
    next: string | null;
  }>,
): ReviewQuery {
  assertGeneration(snapshot, generation);
  const context = page?.context ?? createReviewEvidenceContext(snapshot);
  const pending = page?.pending ?? context.pending;
  const evidenceCache = new Map<string, DecisionEvidence>();
  const hunks = collectReviewCandidates(snapshot, generation, pending).map((candidate) =>
    candidateToHunk(
      workspaceId,
      snapshot,
      generation,
      candidate,
      capabilityKey,
      context,
      evidenceCache,
    ),
  );
  return {
    generationId: generation.identity.generationId,
    frontier: generation.identity.frontier,
    hunks: linkAssociatedHunks(hunks),
    next: page?.next ?? null,
  };
}

export function validateReviewSelection(
  workspaceId: string,
  selection: ReviewSelection,
  decision: ResolutionDecision,
  actorId: string,
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  capabilityKey = DEFAULT_REVIEW_CAPABILITY_KEY,
): SelectionValidation {
  if (selection.workspaceId !== workspaceId) {
    return stale(generation, "selection belongs to another Workspace");
  }
  if (
    selection.token !==
    selectionToken(workspaceId, selection.generationId, selection.evidence, capabilityKey)
  ) {
    return stale(generation, "selection token is invalid");
  }
  if (
    selection.evidence.rulesVersion !== generation.identity.rulesVersion ||
    selection.evidence.schemaVersion !== generation.identity.schemaVersion
  ) {
    return stale(generation, "interpretation version changed");
  }
  const current = evidenceForTargets(
    snapshot,
    generation,
    selection.evidence.proposalTargets,
    createReviewEvidenceContext(snapshot),
  );
  if (!current || canonicalJson(current) !== canonicalJson(selection.evidence)) {
    return stale(generation, "decision evidence changed");
  }
  return {
    kind: "valid",
    resolution: {
      kind: "resolution",
      adjudicatesResolutionIds: [],
      actorId,
      decision,
      proposalContributionIds: current.supportClosure,
    },
  };
}

function candidateToHunk(
  workspaceId: string,
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  candidate: HunkCandidate,
  capabilityKey: string,
  context: ReviewEvidenceContext,
  cache: Map<string, DecisionEvidence>,
): ReviewHunk {
  const cacheKey = [...candidate.targets].sort(stableStringCompare).join("\u0000");
  const evidence =
    cache.get(cacheKey) ?? evidenceForTargets(snapshot, generation, candidate.targets, context);
  if (!evidence) {
    throw new Error("Review candidate has no decision evidence");
  }
  const completeEvidence = cache.get(cacheKey) ?? {
    ...evidence,
    associatedImpactIds: candidateImpacts(candidate, generation, context.pending),
  };
  cache.set(cacheKey, completeEvidence);
  const selection = makeSelection(workspaceId, generation, completeEvidence, capabilityKey);
  return {
    id: canonicalDigest({ diffSpace: candidate.diffSpace, evidence: completeEvidence }),
    diffSpace: candidate.diffSpace,
    proposalContributionIds: completeEvidence.proposalTargets,
    neutralBridgeAtomIds: candidate.bridges,
    linkedHunkIds: [],
    selection,
  };
}

function makeSelection(
  workspaceId: string,
  generation: ProjectionGeneration,
  evidence: DecisionEvidence,
  capabilityKey: string,
): ReviewSelection {
  return {
    token: selectionToken(workspaceId, generation.identity.generationId, evidence, capabilityKey),
    workspaceId,
    frontier: generation.identity.frontier,
    generationId: generation.identity.generationId,
    evidence,
  } as ReviewSelection;
}

function selectionToken(
  workspaceId: string,
  generationId: string,
  evidence: DecisionEvidence,
  capabilityKey: string,
): string {
  return createHmac("sha256", capabilityKey)
    .update(canonicalJson({ workspaceId, generationId, evidence }))
    .digest("hex");
}

function linkAssociatedHunks(hunks: readonly ReviewHunk[]): readonly ReviewHunk[] {
  const groups = new Map<string, ReviewHunk[]>();
  for (const hunk of hunks) {
    const signature = hunk.selection.evidence.associatedImpactIds.join("\u0000");
    const group = groups.get(signature) ?? [];
    group.push(hunk);
    groups.set(signature, group);
  }
  const linkedById = new Map(hunks.map((hunk) => [hunk.id, new Set<string>()]));
  const signaturesByImpact = new Map<string, Set<string>>();
  for (const [signature, group] of groups) {
    const groupIds = group.map((hunk) => hunk.id);
    for (const hunk of group) {
      const linked = linkedById.get(hunk.id)!;
      groupIds.forEach((id) => {
        if (id !== hunk.id) {
          linked.add(id);
        }
      });
    }
    for (const impact of group[0]?.selection.evidence.associatedImpactIds ?? []) {
      const signatures = signaturesByImpact.get(impact) ?? new Set<string>();
      signatures.add(signature);
      signaturesByImpact.set(impact, signatures);
    }
  }
  for (const signatures of signaturesByImpact.values()) {
    if (signatures.size < 2) {
      continue;
    }
    const related = [...signatures].flatMap((signature) => groups.get(signature) ?? []);
    for (const hunk of related) {
      const linked = linkedById.get(hunk.id)!;
      related.forEach((candidate) => {
        if (candidate.id !== hunk.id) {
          linked.add(candidate.id);
        }
      });
    }
  }
  return hunks.map((hunk) => ({
    ...hunk,
    linkedHunkIds: [...linkedById.get(hunk.id)!].sort(stableStringCompare),
  }));
}

function assertGeneration(snapshot: FactSnapshot, generation: ProjectionGeneration): void {
  if (!frontierEquals(generation.identity.frontier, snapshot.frontier)) {
    throw new Error("Review query requires the complete generation at the FactSnapshot frontier");
  }
}

function stale(generation: ProjectionGeneration, reason: string): SelectionValidation {
  return { kind: "stale", currentGenerationId: generation.identity.generationId, reason };
}
