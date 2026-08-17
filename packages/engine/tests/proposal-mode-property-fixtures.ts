import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import {
  canonicalJson,
  frontierOf,
  type AuthorityRecord,
  type Fact,
  type FactSnapshot,
  type TextAtomId,
} from "../src/domain/fact/index.js";
import {
  advanceGeneration,
  rebuildGeneration,
  CURRENT_PROJECTION_VERSIONS as versions,
  type ProjectionGeneration,
} from "../src/domain/reconcile/index.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/materialization/generation-checkpoint.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";

const CHECKPOINT_KEY = "property-fixture-key";

export function assertGeneratedPathEquivalence(facts: readonly Fact[], seed: number): void {
  const failure = equivalenceFailure(facts, seed);
  if (!failure) {
    return;
  }
  const shrunk = shrinkCausalFailure(facts, (candidate) => equivalenceFailure(candidate, seed) !== null);
  const minimalFacts = shrunk
    .map(
      (fact) =>
        `${fact.body.kind}/${
          fact.body.kind === "contribution"
            ? fact.body.mutation.kind
            : fact.body.kind === "resolution"
              ? fact.body.decision
              : fact.body.action.kind
        }@${fact.id}`,
    )
    .join(", ");
  throw new Error(`seed ${seed}: ${failure}; minimal causal prefix ${minimalFacts}`);
}

export function generatedDomainGraph(seed: number): readonly Fact[] {
  const facts = new Facts();
  facts.addPlaced("root", "workspace", "root-occurrence");
  facts.addPlaced("shared", "root", "shared-a");
  facts.addPlaced("container-a", "root", "cascade-parent");
  facts.addPlaced("container-b", "root", "rehome-parent");
  facts.addPlaced("child-a", "container-a", "cascade-child");
  facts.addPlaced("child-b", "container-b", "rehome-child");
  occurrence(facts, "shared-b", "shared", "container-a");
  occurrence(facts, "self-reference", "shared", "shared");
  facts.add({
    kind: "node-owner-set",
    nodeId: "shared",
    ownerNodeId: "container-a",
    previousOwnerNodeId: "root",
  });
  facts.addPlaced("generated-supertag");
  facts.add({
    kind: "intrinsic-node-type-declare",
    nodeId: "generated-supertag",
    intrinsicNodeType: "supertag-definition",
  });
  facts.applySupertag("shared", "generated-supertag");
  const text = facts.add({
    kind: "text-splice",
    nodeId: "shared",
    deleteAtomIds: [],
    deletedAtoms: [],
    anchor: end,
    insert: "ABCDE".slice(0, 2 + (seed % 4)),
  });
  const atomCount = 2 + (seed % 4);
  const marked = Array.from({ length: atomCount }, (_, index): TextAtomId => `${text.id}#${index}`).filter(
    (_, index) => (index + seed) % 2 === 0,
  );
  facts.add({
    kind: "text-mark",
    nodeId: "shared",
    atomIds: marked,
    key: "emphasis",
    value: { kind: "set", value: seed % 2 === 0 },
    previous: { kind: "unset" },
  });
  const contentProposal = facts.add(
    {
      kind: "text-splice",
      nodeId: "shared",
      deleteAtomIds: [],
      anchor: end,
      insert: String(seed),
    },
    "proposal",
  );
  const createProposal = facts.addPlaced(`proposal-${seed}`, "workspace", undefined, "proposal");
  facts.add({
    kind: "text-splice",
    nodeId: `proposal-${seed}`,
    deleteAtomIds: [],
    deletedAtoms: [],
    anchor: end,
    insert: "dependent",
  });
  facts.add(
    {
      kind: "occurrence-move",
      occurrenceId: "shared-b",
      parentNodeId: "container-b",
      anchor: end,
      previousParentNodeId: "container-a",
      previousAnchor: end,
    },
    "proposal",
  );
  facts.resolve(
    seed % 2 === 0
      ? [contentProposal.id, ...createProposal.map((fact) => fact.id)]
      : [...createProposal.map((fact) => fact.id), contentProposal.id],
    seed % 3 === 0 ? "reject" : "accept",
  );
  return facts.values;
}

function occurrence(facts: Facts, occurrenceId: string, nodeId: string, parentNodeId: string): void {
  facts.add({
    kind: "occurrence-create",
    occurrenceId,
    nodeId,
    parentNodeId,
    anchor: end,
  });
}

function equivalenceFailure(facts: readonly Fact[], seed: number): string | null {
  const snapshot = factSnapshot(facts);
  const full = rebuildGeneration("workspace", snapshot, versions).generation;
  const expected = normalized(full);
  const cuts = [...new Set([0, Math.floor(facts.length / 2), seed % Math.max(1, facts.length)])];
  for (const cut of cuts) {
    const prefix = factSnapshot(facts.slice(0, cut));
    const prefixGeneration = rebuildGeneration("workspace", prefix, versions).generation;
    const incremental = advanceGeneration("workspace", prefix, snapshot, versions, prefixGeneration).generation;
    if (normalized(incremental) !== expected) {
      return `incremental path differs at cut ${cut}`;
    }
    const checkpoint = createGenerationCheckpoint("workspace", prefix, prefixGeneration, CHECKPOINT_KEY);
    const checkpointResult = reconcileFromCheckpoint(
      checkpoint,
      "workspace",
      { facts: shuffle(facts, seed + cut), frontier: snapshot.frontier },
      versions,
      CHECKPOINT_KEY,
    );
    if (!checkpointResult || normalized(checkpointResult.generation) !== expected) {
      return `checkpoint path differs at cut ${cut}`;
    }
  }
  const expectedAdmission = admitAuthorityRecords("workspace", records(facts));
  const delivered = shuffle([...facts, ...facts.filter((_, index) => (index + seed) % 3 === 0)], seed).map((fact) => ({
    recordKind: "fact" as const,
    fact,
  }));
  const received: AuthorityRecord[] = [];
  let offset = 0;
  while (offset < delivered.length) {
    const batchSize = 1 + ((seed + offset) % 5);
    received.push(...delivered.slice(offset, offset + batchSize));
    admitAuthorityRecords("workspace", received);
    offset += batchSize;
  }
  const actualAdmission = admitAuthorityRecords("workspace", received);
  return canonicalJson(actualAdmission) === canonicalJson(expectedAdmission)
    ? null
    : `arrival order, duplicate count, or batch boundaries changed admission: expected ${canonicalJson(
        expectedAdmission,
      )}, actual ${canonicalJson(actualAdmission)}`;
}

function shrinkCausalFailure(
  facts: readonly Fact[],
  stillFails: (candidate: readonly Fact[]) => boolean,
): readonly Fact[] {
  let low = 1;
  let high = facts.length;
  let result = [...facts];
  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const candidate = facts.slice(0, length);
    if (stillFails(candidate)) {
      result = candidate;
      high = length - 1;
    } else {
      low = length + 1;
    }
  }
  return result;
}

function normalized(generation: ProjectionGeneration): string {
  return canonicalJson({ origin: generation.origin, review: generation.review });
}

function factSnapshot(facts: readonly Fact[]): FactSnapshot {
  return { facts: [...facts], frontier: frontierOf(facts) };
}

function records(facts: readonly Fact[]): AuthorityRecord[] {
  return facts.map((fact) => ({ recordKind: "fact", fact }));
}

function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    const sourceValue = result[index];
    const targetValue = result[target];
    if (sourceValue === undefined || targetValue === undefined) {
      throw new Error("Generated shuffle index is outside its bounded input");
    }
    result[index] = targetValue;
    result[target] = sourceValue;
  }
  return result;
}
