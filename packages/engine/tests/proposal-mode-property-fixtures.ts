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
  type ProjectionGeneration,
} from "../src/domain/reconcile/index.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/workspace/generation-checkpoint.js";
import { end, Facts } from "../src/domain/reconcile/reconcile-test-helpers.js";
import { managedNodeId } from "../src/domain/reconcile/managed-identity.js";

const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-5" } as const;
const CHECKPOINT_KEY = "property-fixture-key";

export function assertGeneratedPathEquivalence(facts: readonly Fact[], seed: number): void {
  const failure = equivalenceFailure(facts, seed);
  if (!failure) {
    return;
  }
  const shrunk = shrinkCausalFailure(
    facts,
    (candidate) => equivalenceFailure(candidate, seed) !== null,
  );
  const minimalFacts = shrunk
    .map(
      (fact) =>
        `${fact.body.kind}/${
          fact.body.kind === "contribution" ? fact.body.mutation.kind : fact.body.decision
        }@${fact.id}`,
    )
    .join(", ");
  throw new Error(`seed ${seed}: ${failure}; minimal causal prefix ${minimalFacts}`);
}

export function generatedDomainGraph(seed: number): readonly Fact[] {
  const facts = new Facts();
  for (const nodeId of ["root", "shared", "container", "child"]) {
    facts.add({ kind: "node-create", nodeId });
  }
  occurrence(facts, "root-occurrence", "root", null, "cascade");
  occurrence(facts, "shared-a", "shared", "root-occurrence", "cascade");
  occurrence(facts, "shared-b", "shared", "root-occurrence", "rehome");
  occurrence(facts, "self-reference", "shared", "shared-a", "cascade");
  occurrence(facts, "cascade-parent", "container", "root-occurrence", "cascade");
  occurrence(facts, "rehome-parent", "container", "root-occurrence", "rehome");
  occurrence(facts, "cascade-child", "child", "cascade-parent", "cascade");
  occurrence(facts, "rehome-child", "child", "rehome-parent", "rehome");
  facts.add({
    kind: "canonical-occurrence-set",
    nodeId: "shared",
    occurrenceId: "shared-b",
    previousOccurrenceId: "shared-a",
  });
  facts.add({
    kind: "value-set",
    owner: { kind: "node", id: "shared" },
    namespace: "property",
    key: "schemaId",
    value: "generated-schema",
    previous: { kind: "unset" },
  });
  facts.add({
    kind: "value-set",
    owner: { kind: "schema", id: "generated-schema" },
    namespace: "schema",
    key: "first",
    value: seed % 3,
    previous: { kind: "unset" },
  });
  facts.add({
    kind: "value-set",
    owner: { kind: "schema", id: "generated-schema" },
    namespace: "schema",
    key: "second",
    value: (seed + 1) % 3,
    previous: { kind: "unset" },
  });
  facts.add({
    kind: "value-set",
    owner: { kind: "node", id: managedNodeId("shared", "generated-schema", "first") },
    namespace: "property",
    key: "generated",
    value: seed,
    previous: { kind: "unset" },
  });
  const text = facts.add({
    kind: "text-splice",
    nodeId: "shared",
    deleteAtomIds: [],
    deletedAtoms: [],
    anchor: end,
    insert: "ABCDE".slice(0, 2 + (seed % 4)),
  });
  const atomCount = 2 + (seed % 4);
  const marked = Array.from(
    { length: atomCount },
    (_, index): TextAtomId => `${text.id}#${index}`,
  ).filter((_, index) => (index + seed) % 2 === 0);
  facts.add({
    kind: "text-mark",
    nodeId: "shared",
    atomIds: marked,
    key: "emphasis",
    value: { kind: "set", value: seed % 2 === 0 },
    previous: { kind: "unset" },
  });
  const propertyProposal = facts.add(
    {
      kind: "value-set",
      owner: { kind: "node", id: "shared" },
      namespace: "metadata",
      key: "proposal-seed",
      value: seed,
      previous: { kind: "unset" },
    },
    "proposal",
  );
  const createProposal = facts.add({ kind: "node-create", nodeId: `proposal-${seed}` }, "proposal");
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
      parentOccurrenceId: "rehome-parent",
      anchor: end,
      previousParentOccurrenceId: "root-occurrence",
      previousAnchor: end,
    },
    "proposal",
  );
  facts.resolve(
    seed % 2 === 0
      ? [propertyProposal.id, createProposal.id]
      : [createProposal.id, propertyProposal.id],
    seed % 3 === 0 ? "reject" : "accept",
  );
  return facts.values;
}

function occurrence(
  facts: Facts,
  occurrenceId: string,
  nodeId: string,
  parentOccurrenceId: string | null,
  parentPolicy: "cascade" | "rehome",
): void {
  facts.add({
    kind: "occurrence-create",
    occurrenceId,
    nodeId,
    parentOccurrenceId,
    parentPolicy,
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
    const incremental = advanceGeneration(
      "workspace",
      prefix,
      snapshot,
      versions,
      prefixGeneration,
    ).generation;
    if (normalized(incremental) !== expected) {
      return `incremental path differs at cut ${cut}`;
    }
    const checkpoint = createGenerationCheckpoint(
      "workspace",
      prefix,
      prefixGeneration,
      CHECKPOINT_KEY,
    );
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
  const delivered = shuffle(
    [...facts, ...facts.filter((_, index) => (index + seed) % 3 === 0)],
    seed,
  ).map((fact) => ({ recordKind: "fact" as const, fact }));
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
