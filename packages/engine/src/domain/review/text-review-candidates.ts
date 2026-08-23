import {
  compareCausalOrder,
  factActionsOfKind,
  factActionsOfKinds,
  factActionsFromFacts,
  factObserves,
  type FactAction,
  type Fact,
  type TextAtomId,
} from "../fact/index.js";
import { textAtoms, type ScopedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate } from "./review-family.js";
import { hasTextEffect, textEffect } from "./text-review-effect.js";

export function textCandidates(
  snapshot: Readonly<{ facts: readonly Fact[] }>,
  generation: ScopedProjectionGeneration,
  allPending: ReadonlyMap<FactAction["id"], FactAction>,
): readonly HunkCandidate[] {
  const pending = factActionsOfKinds([...allPending.values()], ["rich-text-splice", "rich-text-mark"]);
  const byNode = new Map<string, FactAction[]>();
  for (const fact of pending) {
    const action = fact.action;
    const nodeFacts = byNode.get(action.nodeId) ?? [];
    nodeFacts.push(fact);
    byNode.set(action.nodeId, nodeFacts);
  }
  const result: HunkCandidate[] = [];
  for (const [nodeId, nodeFacts] of byNode) {
    const visible = nodeFacts.filter((fact) => hasTextEffect(textEffect(nodeId, [fact], generation)));
    const markGroups = overlappingMarkGroups(visible);
    const groupedMarkIds = new Set(markGroups.flatMap((group) => group.map((fact) => fact.id)));
    for (const group of markGroups) {
      if (hasTextEffect(textEffect(nodeId, group, generation))) {
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

function overlappingMarkGroups(facts: readonly FactAction[]): readonly FactAction[][] {
  const marks = factActionsOfKind(facts, "rich-text-mark");
  const remaining = new Set(marks.map((fact) => fact.id));
  const groups: FactAction[][] = [];
  while (remaining.size > 0) {
    const firstId = remaining.values().next().value;
    if (firstId === undefined) {
      break;
    }
    const groupIds = new Set([firstId]);
    remaining.delete(firstId);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const candidate of marks) {
        if (!remaining.has(candidate.id)) {
          continue;
        }
        const action = candidate.action;
        const overlaps = marks.some((member) => {
          if (!groupIds.has(member.id)) {
            return false;
          }
          return member.action.key === action.key && member.action.atomIds.some((id) => action.atomIds.includes(id));
        });
        if (overlaps) {
          groupIds.add(candidate.id);
          remaining.delete(candidate.id);
          expanded = true;
        }
      }
    }
    groups.push(marks.filter((fact) => groupIds.has(fact.id)).sort(compareCausalOrder));
  }
  return groups.filter((group) => group.length > 1);
}

function textContinuityGroups(
  facts: readonly FactAction[],
  snapshot: Readonly<{ facts: readonly Fact[] }>,
  generation: ScopedProjectionGeneration,
  nodeId: string,
): readonly Readonly<{ targets: readonly FactAction[]; bridges: readonly TextAtomId[] }>[] {
  const atoms = textAtoms(generation.review.nodes[nodeId]);
  const pendingIds = new Set(facts.map((fact) => fact.id));
  const indexed = facts
    .map((fact) => ({
      fact,
      positions: atoms.map((atom, index) => (atom.factActionId === fact.id ? index : -1)).filter((index) => index >= 0),
    }))
    .filter(({ positions, fact }) => positions.length > 0 || hasTextEffect(textEffect(nodeId, [fact], generation)))
    .sort(
      (left, right) => (left.positions[0] ?? Number.MAX_SAFE_INTEGER) - (right.positions[0] ?? Number.MAX_SAFE_INTEGER),
    );
  const first = indexed[0];
  if (!first) {
    return [];
  }
  const factsById = new Map(factActionsFromFacts(snapshot.facts).map((fact) => [fact.id, fact]));
  const groups: { targets: FactAction[]; bridges: TextAtomId[] }[] = [];
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
      (atom) => !pendingIds.has(atom.factActionId) && isNeutralBridge(atom.factActionId, left, entry.fact, factsById),
    );
    const canJoin = between.every(
      (atom) => pendingIds.has(atom.factActionId) || bridges.some((bridge) => bridge.id === atom.id),
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
  entry: Readonly<{ fact: FactAction; positions: readonly number[] }>,
  atoms: readonly Readonly<{ id: TextAtomId; factActionId: FactAction["id"] }>[],
  pendingIds: ReadonlySet<FactAction["id"]>,
  factsById: ReadonlyMap<FactAction["id"], FactAction>,
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
        !pendingIds.has(atom.factActionId) && isNeutralBridge(atom.factActionId, entry.fact, entry.fact, factsById),
    )
    .map((atom) => atom.id);
}

function isNeutralBridge(
  directActionId: FactAction["id"],
  left: FactAction,
  right: FactAction,
  factsById: ReadonlyMap<FactAction["id"], FactAction>,
): boolean {
  const direct = factsById.get(directActionId);
  return direct?.intent === "direct" && !factObserves(left, direct) && !factObserves(right, direct);
}
