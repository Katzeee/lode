import { isOccurrenceMutation, stableStringCompare, type ContributionFact } from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";

type PlacementState = Readonly<{
  nodeId: string;
  parentNodeId: string;
}>;

export function projectNodeOwners(
  workspaceNodeId: string,
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  metanodes: Readonly<Record<string, string>>,
): Readonly<Record<string, string | null>> {
  const ownerPlacements = replayOwnerPlacements(active);
  const attachedOwners = new Map(Object.entries(metanodes).map(([hostNodeId, rootNodeId]) => [rootNodeId, hostNodeId]));
  const owners = selectRootedOwners(
    workspaceNodeId,
    nodes.keys(),
    occurrences.values(),
    ownerPlacements,
    attachedOwners,
  );
  return Object.fromEntries([...owners].sort(([left], [right]) => stableStringCompare(left, right)));
}

export function selectRootedOwners(
  workspaceNodeId: string,
  nodeIds: Iterable<string>,
  occurrences: Iterable<Readonly<{ occurrenceId: string; nodeId: string; parentNodeId: string }>>,
  originalOccurrenceIds: ReadonlyMap<string, string>,
  attachedOwners: ReadonlyMap<string, string> = new Map(),
): ReadonlyMap<string, string | null> {
  const known = new Set(nodeIds);
  if (!known.has(workspaceNodeId)) {
    return new Map();
  }
  const placements = new Map<string, Readonly<{ occurrenceId: string; nodeId: string; parentNodeId: string }>[]>();
  for (const occurrence of occurrences) {
    if (!known.has(occurrence.nodeId) || !known.has(occurrence.parentNodeId)) {
      continue;
    }
    const values = placements.get(occurrence.nodeId) ?? [];
    values.push(occurrence);
    placements.set(occurrence.nodeId, values);
  }
  for (const values of placements.values()) {
    values.sort((left, right) => stableStringCompare(left.occurrenceId, right.occurrenceId));
  }

  const owners = new Map<string, string | null>([[workspaceNodeId, null]]);
  const resolving = new Set<string>();
  const failed = new Set<string>();
  const resolve = (nodeId: string): boolean => {
    if (owners.has(nodeId)) {
      return true;
    }
    if (resolving.has(nodeId) || failed.has(nodeId)) {
      return false;
    }
    resolving.add(nodeId);
    const attachedOwner = attachedOwners.get(nodeId);
    if (attachedOwner !== undefined) {
      if (attachedOwner !== nodeId && resolve(attachedOwner)) {
        owners.set(nodeId, attachedOwner);
        resolving.delete(nodeId);
        return true;
      }
      resolving.delete(nodeId);
      failed.add(nodeId);
      return false;
    }
    const originalOccurrenceId = originalOccurrenceIds.get(nodeId);
    if (
      originalOccurrenceId !== undefined &&
      !(placements.get(nodeId) ?? []).some((occurrence) => occurrence.occurrenceId === originalOccurrenceId)
    ) {
      resolving.delete(nodeId);
      failed.add(nodeId);
      return false;
    }
    const candidates = [...(placements.get(nodeId) ?? [])].sort((left, right) => {
      const leftPreferred = left.occurrenceId === originalOccurrenceId ? 0 : 1;
      const rightPreferred = right.occurrenceId === originalOccurrenceId ? 0 : 1;
      return leftPreferred - rightPreferred || stableStringCompare(left.occurrenceId, right.occurrenceId);
    });
    for (const candidate of candidates) {
      if (candidate.parentNodeId !== nodeId && resolve(candidate.parentNodeId)) {
        owners.set(nodeId, candidate.parentNodeId);
        resolving.delete(nodeId);
        return true;
      }
    }
    resolving.delete(nodeId);
    failed.add(nodeId);
    return false;
  };
  for (const nodeId of [...known].sort(stableStringCompare)) {
    resolve(nodeId);
  }
  return owners;
}

function replayOwnerPlacements(active: readonly ContributionFact[]): ReadonlyMap<string, string> {
  const replayed = new Map<string, PlacementState>();
  const createdNodesByOccurrence = new Map<string, string>();
  const ownerPlacements = originalOccurrenceIds(active);

  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "node-owner-set") {
      const ownerPlacement = findOwnerPlacement(replayed, mutation.nodeId, mutation.ownerNodeId);
      if (ownerPlacement) {
        ownerPlacements.set(mutation.nodeId, ownerPlacement);
      }
      continue;
    }
    if (!isOccurrenceMutation(mutation)) {
      continue;
    }
    switch (mutation.kind) {
      case "occurrence-create":
        createdNodesByOccurrence.set(mutation.occurrenceId, mutation.nodeId);
        replayed.set(mutation.occurrenceId, {
          nodeId: mutation.nodeId,
          parentNodeId: mutation.parentNodeId,
        });
        break;
      case "occurrence-move": {
        const placement = replayed.get(mutation.occurrenceId);
        if (placement) {
          replayed.set(mutation.occurrenceId, {
            ...placement,
            parentNodeId: mutation.parentNodeId,
          });
        }
        break;
      }
      case "occurrence-delete":
        replayed.delete(mutation.occurrenceId);
        break;
      case "occurrence-restore": {
        const nodeId = createdNodesByOccurrence.get(mutation.occurrenceId);
        if (nodeId) {
          replayed.set(mutation.occurrenceId, {
            nodeId,
            parentNodeId: mutation.parentNodeId,
          });
        }
        break;
      }
    }
  }
  return ownerPlacements;
}

function originalOccurrenceIds(active: readonly ContributionFact[]): Map<string, string> {
  const originals = new Map<string, string>();
  const transactions = new Map<string, ContributionFact[]>();
  for (const fact of active) {
    const facts = transactions.get(fact.transaction.transactionId) ?? [];
    facts.push(fact);
    transactions.set(fact.transaction.transactionId, facts);
  }
  for (const facts of transactions.values()) {
    const createdNodeIds = new Set(
      facts.flatMap((fact) => (fact.body.mutation.kind === "node-create" ? [fact.body.mutation.nodeId] : [])),
    );
    for (const fact of facts) {
      const mutation = fact.body.mutation;
      if (mutation.kind === "occurrence-create" && createdNodeIds.has(mutation.nodeId)) {
        originals.set(mutation.nodeId, mutation.occurrenceId);
      }
    }
  }
  return originals;
}

function findOwnerPlacement(
  placements: ReadonlyMap<string, PlacementState>,
  nodeId: string,
  ownerNodeId: string,
): string | undefined {
  return [...placements]
    .filter(([, placement]) => placement.nodeId === nodeId && placement.parentNodeId === ownerNodeId)
    .sort(([left], [right]) => stableStringCompare(left, right))[0]?.[0];
}
