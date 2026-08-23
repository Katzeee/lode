import { expect } from "vitest";

import { buildFactSnapshot } from "../src/domain/fact/index.js";
import {
  canonicalJson,
  makeFact,
  type Fact,
  type FactFrontier,
  type FactSnapshot,
  type AuthoredAction,
} from "../src/domain/fact/index.js";
import {
  advanceGeneration,
  rebuildGeneration,
  CURRENT_PROJECTION_VERSIONS as versions,
  type ProjectionGeneration,
} from "../src/domain/reconcile/index.js";
import { uniqueFacts } from "./support/facts.js";
import {
  withFieldDefinitionEndpoints,
  withInitialNodeRelations,
} from "./support/reconcile/placed-node-test-helpers.js";

export function remoteBranch(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  actions: readonly AuthoredAction[],
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
          body: { kind: "edit", actorId: replicaId, intent: "direct", actions: [first, ...rest] },
        }),
      ]
    : [];
}

function snapshotOf(facts: readonly Fact[]): FactSnapshot {
  const snapshot = buildFactSnapshot("workspace", uniqueFacts(facts));
  return snapshot;
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

    const tailLength = facts.length - prefixCount;
    const cut = prefixCount + (tailLength === 0 ? 0 : seed % tailLength);
    const beforeSnapshot = snapshotOf(facts.slice(0, cut));
    const before = rebuildGeneration("workspace", beforeSnapshot, versions);
    const incremental = advanceGeneration("workspace", beforeSnapshot, snapshot, versions, before);
    expect(canonicalJson(incremental)).toBe(expectedSummary);

    const restarted = rebuildGeneration("workspace", structuredClone(snapshot), versions);
    expect(canonicalJson(restarted)).toBe(expectedSummary);
    inspect(full);
  }
}

function shuffle(values: Fact[], seed: number): Fact[] {
  let state = seed >>> 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const selected = state % (index + 1);
    const current = values[index];
    const replacement = values[selected];
    if (!current || !replacement) {
      throw new Error("Shuffle selected an absent Fact");
    }
    values[index] = replacement;
    values[selected] = current;
  }
  return values;
}
