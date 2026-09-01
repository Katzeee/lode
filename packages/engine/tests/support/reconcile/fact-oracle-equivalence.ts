import {
  buildFactSnapshot,
  canonicalJson,
  stableStringCompare,
  type Fact,
  type FactSnapshot,
} from "../../../src/domain/fact/index.js";
import {
  CURRENT_PROJECTION_VERSIONS as versions,
  rebuildGeneration,
  type ProjectionGeneration,
} from "../../../src/domain/reconcile/index.js";
import { queryHistory } from "../../../src/domain/history/index.js";
import { historySteps } from "../../../src/domain/history/state.js";
import { projectGovernance } from "../../../src/domain/governance/index.js";
import { uniqueFacts } from "../facts.js";
import { shuffle } from "../permutation.js";

export { canonicalPublicDomainState } from "./fact-oracle-public-query.js";

const WORKSPACE_ID = "workspace";

export function assertFactOracleEquivalence(facts: readonly Fact[], seed: number): void {
  const failure = projectionPathFailure(facts, seed);
  if (failure) {
    throw new Error(failureMessage(seed, failure, facts));
  }
}

function projectionPathFailure(facts: readonly Fact[], seed: number): string | null {
  const snapshot = authoritySnapshot(facts);
  const full = rebuildGeneration(WORKSPACE_ID, snapshot, versions);
  const expected = observableDomain(snapshot, full);
  const shuffledFull = rebuildGeneration(
    WORKSPACE_ID,
    { facts: shuffle(snapshot.facts, seed), frontier: snapshot.frontier },
    versions,
  );
  if (observableDomain(snapshot, shuffledFull) !== expected) {
    return "shuffled Fact-only rebuild differs from the canonical Fact-only rebuild";
  }

  for (const width of [1, 2, 5]) {
    const delivered = shuffle([...facts, ...facts.filter((_, index) => (index + seed) % 3 === 0)], seed + width);
    const received: Fact[] = [];
    for (let offset = 0; offset < delivered.length; offset += width) {
      received.push(...delivered.slice(offset, offset + width));
      authoritySnapshot(received);
    }
    const receivedSnapshot = authoritySnapshot(received);
    if (canonicalJson(receivedSnapshot) !== canonicalJson(snapshot)) {
      return `arrival order, duplicate delivery, or batch width ${width} changed the authoritative Fact snapshot`;
    }
    const receivedGeneration = rebuildGeneration(WORKSPACE_ID, receivedSnapshot, versions);
    if (observableDomain(receivedSnapshot, receivedGeneration) !== expected) {
      return `arrival order, duplicate delivery, or batch width ${width} changed the Fact-only domain result`;
    }
  }
  return null;
}

function authoritySnapshot(facts: readonly Fact[]): FactSnapshot {
  return buildFactSnapshot(WORKSPACE_ID, uniqueFacts(facts));
}

function observableDomain(snapshot: FactSnapshot, generation: ProjectionGeneration): string {
  const channels = [...new Set(historySteps(snapshot).map((step) => step.body.channelId))].sort(stableStringCompare);
  const governance = projectGovernance(snapshot.facts);
  return canonicalJson({
    origin: generation.origin,
    review: generation.review,
    history: channels.map((channelId) => queryHistory(channelId, snapshot)),
    governance: {
      established: governance.established,
      ownerActorId: governance.ownerActorId,
      memberActorIds: [...governance.members].sort(stableStringCompare),
      epoch: governance.epoch,
      peers: [...governance.peers.values()].sort((left, right) => stableStringCompare(left.peerId, right.peerId)),
    },
  });
}

function failureMessage(seed: number, failure: string, facts: readonly Fact[]): string {
  const minimalFacts = facts.map(factLabel).join(", ");
  return `seed ${seed}: ${failure}; causal Fact prefix ${minimalFacts}`;
}

function factLabel(fact: Fact): string {
  const semantic =
    fact.body.kind === "action"
      ? fact.body.actions.map((action) => action.kind).join("+")
      : fact.body.kind === "resolution"
        ? fact.body.decision
        : fact.body.kind === "governance"
          ? fact.body.action.kind
          : fact.body.operation;
  return `${fact.body.kind}/${semantic}@${fact.id}`;
}
