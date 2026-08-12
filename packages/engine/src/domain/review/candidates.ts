import {
  compareFacts,
  type ContributionFact,
  type Fact,
  type FactSnapshot,
  type TextAtomId,
} from "../fact/index.js";
import type { ProjectionGeneration } from "../reconcile/index.js";
import { normalizedEffects } from "./evidence.js";
import { associatedImpacts } from "./impacts.js";
import { nonTextCandidates } from "./non-text-candidates.js";
import { mergeLocalStructureCandidates } from "./structure-candidates.js";
import type { ReviewHunk } from "./types.js";

export type HunkCandidate = Readonly<{
  diffSpace: ReviewHunk["diffSpace"];
  targets: readonly string[];
  bridges: readonly TextAtomId[];
}>;

export function collectReviewCandidates(
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  return mergeLocalStructureCandidates(
    [...textCandidates(snapshot, generation, pending), ...nonTextCandidates(generation, pending)],
    snapshot,
    generation,
  );
}

function textCandidates(
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  allPending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const pending = [...allPending.values()].filter((fact) =>
    ["text-splice", "text-mark"].includes(fact.body.mutation.kind),
  );
  const byNode = new Map<string, ContributionFact[]>();
  for (const fact of pending) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "text-splice" && mutation.kind !== "text-mark") {
      continue;
    }
    const nodeFacts = byNode.get(mutation.nodeId) ?? [];
    nodeFacts.push(fact);
    byNode.set(mutation.nodeId, nodeFacts);
  }
  const result: HunkCandidate[] = [];
  for (const [nodeId, nodeFacts] of byNode) {
    const visible = nodeFacts.filter((fact) => normalizedEffects([fact], generation).length > 0);
    const markGroups = overlappingMarkGroups(visible);
    const groupedMarkIds = new Set(markGroups.flatMap((group) => group.map((fact) => fact.id)));
    for (const group of markGroups) {
      if (normalizedEffects(group, generation).length > 0) {
        result.push({
          diffSpace: { kind: "node-content", identity: nodeId },
          targets: group.map((fact) => fact.id),
          bridges: [],
        });
      }
    }
    for (const group of textContinuityGroups(
      visible.filter((fact) => !groupedMarkIds.has(fact.id)),
      snapshot,
      generation,
      nodeId,
    )) {
      result.push({
        diffSpace: { kind: "node-content", identity: nodeId },
        targets: group.targets.map((fact) => fact.id),
        bridges: group.bridges,
      });
    }
  }
  return result;
}

function overlappingMarkGroups(facts: readonly ContributionFact[]): readonly ContributionFact[][] {
  const marks = facts.filter((fact) => fact.body.mutation.kind === "text-mark");
  const remaining = new Set(marks.map((fact) => fact.id));
  const groups: ContributionFact[][] = [];
  while (remaining.size > 0) {
    const firstId = remaining.values().next().value as string;
    const groupIds = new Set([firstId]);
    remaining.delete(firstId);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const candidate of marks) {
        if (!remaining.has(candidate.id)) {
          continue;
        }
        const mutation = candidate.body.mutation;
        if (mutation.kind !== "text-mark") {
          continue;
        }
        const overlaps = marks.some((member) => {
          if (!groupIds.has(member.id) || member.body.mutation.kind !== "text-mark") {
            return false;
          }
          return (
            member.body.mutation.key === mutation.key &&
            member.body.mutation.atomIds.some((id) => mutation.atomIds.includes(id))
          );
        });
        if (overlaps) {
          groupIds.add(candidate.id);
          remaining.delete(candidate.id);
          expanded = true;
        }
      }
    }
    groups.push(marks.filter((fact) => groupIds.has(fact.id)).sort(compareFacts));
  }
  return groups.filter((group) => group.length > 1);
}

function textContinuityGroups(
  facts: readonly ContributionFact[],
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  nodeId: string,
): readonly Readonly<{ targets: readonly ContributionFact[]; bridges: readonly TextAtomId[] }>[] {
  const atoms = generation.review.nodes[nodeId]?.text ?? [];
  const pendingIds = new Set(facts.map((fact) => fact.id));
  const indexed = facts
    .map((fact) => ({
      fact,
      positions: atoms
        .map((atom, index) => (atom.contributionId === fact.id ? index : -1))
        .filter((index) => index >= 0),
    }))
    .filter(
      ({ positions, fact }) =>
        positions.length > 0 || normalizedEffects([fact], generation).length > 0,
    )
    .sort(
      (left, right) =>
        (left.positions[0] ?? Number.MAX_SAFE_INTEGER) -
        (right.positions[0] ?? Number.MAX_SAFE_INTEGER),
    );
  const first = indexed[0];
  if (!first) {
    return [];
  }
  const factsById = new Map(snapshot.facts.map((fact) => [fact.id, fact]));
  const groups: { targets: ContributionFact[]; bridges: TextAtomId[] }[] = [];
  let current = {
    targets: [first.fact],
    bridges: bridgesWithin(first, atoms, pendingIds, factsById),
  };
  let previousEnd = first.positions.at(-1) ?? -1;
  for (const entry of indexed.slice(1)) {
    const nextStart = entry.positions[0] ?? Number.MAX_SAFE_INTEGER;
    const between = atoms.slice(previousEnd + 1, nextStart);
    const left = current.targets.at(-1);
    if (!left) {
      throw new Error("Text continuity group lost its left Proposal target");
    }
    const bridges = between.filter(
      (atom) =>
        !pendingIds.has(atom.contributionId) &&
        isNeutralBridge(atom.contributionId, left, entry.fact, factsById),
    );
    const canJoin = between.every(
      (atom) =>
        pendingIds.has(atom.contributionId) || bridges.some((bridge) => bridge.id === atom.id),
    );
    if (canJoin) {
      current.targets.push(entry.fact);
      current.bridges.push(...bridges.map((atom) => atom.id));
    } else {
      groups.push(current);
      current = {
        targets: [entry.fact],
        bridges: bridgesWithin(entry, atoms, pendingIds, factsById),
      };
    }
    previousEnd = entry.positions.at(-1) ?? previousEnd;
  }
  groups.push(current);
  return groups;
}

function bridgesWithin(
  entry: Readonly<{ fact: ContributionFact; positions: readonly number[] }>,
  atoms: readonly Readonly<{ id: TextAtomId; contributionId: string }>[],
  pendingIds: ReadonlySet<string>,
  factsById: ReadonlyMap<string, Fact>,
): TextAtomId[] {
  const start = entry.positions[0];
  const end = entry.positions.at(-1);
  if (start === undefined || end === undefined || start === end) {
    return [];
  }
  return atoms
    .slice(start + 1, end)
    .filter(
      (atom) =>
        !pendingIds.has(atom.contributionId) &&
        isNeutralBridge(atom.contributionId, entry.fact, entry.fact, factsById),
    )
    .map((atom) => atom.id);
}

function isNeutralBridge(
  directContributionId: string,
  left: ContributionFact,
  right: ContributionFact,
  factsById: ReadonlyMap<string, Fact>,
): boolean {
  const direct = factsById.get(directContributionId);
  if (!direct || direct.body.kind !== "contribution" || direct.body.intent !== "direct") {
    return false;
  }
  return !observes(left, direct) && !observes(right, direct);
}

function observes(observer: Fact, observed: Fact): boolean {
  return (
    (observer.coordinate.observed[observed.coordinate.dot.replicaId] ?? 0) >=
    observed.coordinate.dot.sequence
  );
}

export function candidateImpacts(
  candidate: HunkCandidate,
  generation: ProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly string[] {
  const targets = candidate.targets.flatMap((id) => {
    const fact = pending.get(id);
    return fact ? [fact] : [];
  });
  return associatedImpacts(targets, generation);
}
