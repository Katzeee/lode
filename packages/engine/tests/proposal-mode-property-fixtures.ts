import { buildFactSnapshot } from "../src/domain/fact/index.js";
import { canonicalJson, frontierOf, type Fact, type FactSnapshot, type TextAtomId } from "../src/domain/fact/index.js";
import {
  advanceGeneration,
  rebuildGeneration,
  CURRENT_PROJECTION_VERSIONS as versions,
  type ProjectionGeneration,
} from "../src/domain/reconcile/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import { addDefinitionNode } from "./support/reconcile/placed-node-test-helpers.js";
import { uniqueFacts } from "./support/facts.js";

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
          fact.body.kind === "edit"
            ? fact.body.actions.map((authoredAction) => authoredAction.kind).join("+")
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
  addDefinitionNode(facts, "generated-supertag", "supertag-definition");
  facts.applySupertag("shared", "generated-supertag");
  const text = facts.add({
    kind: "rich-text-splice",
    nodeId: "shared",
    deleteAtomIds: [],
    anchor: end,
    insert: "ABCDE".slice(0, 2 + (seed % 4)),
  });
  const atomCount = 2 + (seed % 4);
  const marked = Array.from({ length: atomCount }, (_, index): TextAtomId => `${text.id}#${index}`).filter(
    (_, index) => (index + seed) % 2 === 0,
  );
  facts.add({
    kind: "rich-text-mark",
    nodeId: "shared",
    atomIds: marked,
    key: "emphasis",
    value: { kind: "set", value: seed % 2 === 0 },
  });
  const contentProposal = facts.add(
    {
      kind: "rich-text-splice",
      nodeId: "shared",
      deleteAtomIds: [],
      anchor: end,
      insert: String(seed),
    },
    "proposal",
  );
  const createProposal = facts.addPlaced(`proposal-${seed}`, "workspace", undefined, "proposal");
  facts.add({
    kind: "rich-text-splice",
    nodeId: `proposal-${seed}`,
    deleteAtomIds: [],
    anchor: end,
    insert: "dependent",
  });
  facts.add(
    {
      kind: "placement-move",
      placementId: "shared-b",
      parentNodeId: "container-b",
      anchor: end,
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
    kind: "placement-create",
    placementId: occurrenceId,
    nodeId,
    parentNodeId,
    anchor: end,
  });
}

function equivalenceFailure(facts: readonly Fact[], seed: number): string | null {
  const snapshot = factSnapshot(facts);
  const full = rebuildGeneration("workspace", snapshot, versions);
  const expected = normalized(full);
  const cuts = [...new Set([0, Math.floor(facts.length / 2), seed % Math.max(1, facts.length)])];
  for (const cut of cuts) {
    const prefix = factSnapshot(facts.slice(0, cut));
    const prefixGeneration = rebuildGeneration("workspace", prefix, versions);
    const incremental = advanceGeneration("workspace", prefix, snapshot, versions, prefixGeneration);
    if (normalized(incremental) !== expected) {
      return `incremental path differs at cut ${cut}`;
    }
    const shuffledIncremental = advanceGeneration(
      "workspace",
      prefix,
      { facts: shuffle(facts, seed + cut), frontier: snapshot.frontier },
      versions,
      prefixGeneration,
    );
    if (normalized(shuffledIncremental) !== expected) {
      return `shuffled incremental path differs at cut ${cut}`;
    }
  }
  const expectedFactSnapshot = buildFactSnapshot("workspace", uniqueFacts(records(facts)));
  const delivered = shuffle([...facts, ...facts.filter((_, index) => (index + seed) % 3 === 0)], seed);
  const received: Fact[] = [];
  let offset = 0;
  while (offset < delivered.length) {
    const batchSize = 1 + ((seed + offset) % 5);
    received.push(...delivered.slice(offset, offset + batchSize));
    buildFactSnapshot("workspace", uniqueFacts(received));
    offset += batchSize;
  }
  const actualFactSnapshot = buildFactSnapshot("workspace", uniqueFacts(received));
  return canonicalJson(actualFactSnapshot) === canonicalJson(expectedFactSnapshot)
    ? null
    : `arrival order, duplicate count, or batch boundaries changed the authoritative snapshot: expected ${canonicalJson(
        expectedFactSnapshot,
      )}, actual ${canonicalJson(actualFactSnapshot)}`;
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

function records(facts: readonly Fact[]): readonly Fact[] {
  return facts;
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
