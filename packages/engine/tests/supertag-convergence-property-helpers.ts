import { expect } from "vitest";

import { canonicalJson, makeFact, type Fact, type FactFrontier, type GraphAction } from "../src/domain/fact/index.js";
import {
  rebuildGeneration,
  CURRENT_PROJECTION_VERSIONS as versions,
  type ProjectionGeneration,
} from "../src/domain/reconcile/index.js";
import { snapshotOf } from "./support/facts.js";
import { shuffle } from "./support/permutation.js";
import {
  withFieldDefinitionEndpoints,
  withInitialNodeRelations,
} from "./support/reconcile/placed-node-test-helpers.js";

export function remoteBranch(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  actions: readonly GraphAction[],
): readonly Fact[] {
  const ownedActions = withFieldDefinitionEndpoints(withInitialNodeRelations(actions));
  const [first, ...rest] = ownedActions;
  return first
    ? [
        makeFact({
          workspaceId: "workspace",
          replicaId,
          sequence: 1,
          observed,
          lamport,
          body: { kind: "action", actorId: replicaId, intent: "direct", actions: [first, ...rest] },
        }),
      ]
    : [];
}

export function assertSupertagConvergence(
  prefixCount: number,
  facts: readonly Fact[],
  inspect: (generation: ProjectionGeneration) => void,
): void {
  const expectedSnapshot = snapshotOf(facts);
  const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
  const expectedSummary = canonicalJson(expected);
  inspect(expected);

  for (let seed = 1; seed <= 32; seed += 1) {
    const duplicates = facts.filter((_, index) => index >= prefixCount && index % 2 === seed % 2);
    const delivered = shuffle([...facts, ...duplicates], seed);
    const snapshot = snapshotOf(delivered);
    const full = rebuildGeneration("workspace", snapshot, versions);
    expect(canonicalJson(full)).toBe(expectedSummary);

    const restarted = rebuildGeneration("workspace", structuredClone(snapshot), versions);
    expect(canonicalJson(restarted)).toBe(expectedSummary);
    inspect(full);
  }
}
