import { LoroDoc } from "loro-crdt";

export type ViewMode = "origin" | "review";
export type EditIntent = "direct" | "proposal";
export type Decision = "accept" | "reject";

export type CausalCoordinate = {
  replicaId: string;
  counter: number;
};

export type FactFrontier = readonly CausalCoordinate[];

export type TextMark = {
  id: string;
  from: number;
  to: number;
  kind: "bold" | "italic" | "link";
  value?: string;
};

export type DomainMutation =
  | { type: "create-node"; nodeId: string }
  | { type: "delete-node"; nodeId: string }
  | { type: "set-text"; nodeId: string; value: string }
  | { type: "add-mark"; nodeId: string; mark: TextMark }
  | { type: "set-property"; nodeId: string; key: string; value: unknown }
  | {
      type: "apply-schema";
      nodeId: string;
      schemaId: string;
      managedFields: readonly string[];
    }
  | {
      type: "create-occurrence";
      occurrenceId: string;
      nodeId: string;
      parentOccurrenceId: string | null;
      position: string;
      canonical: boolean;
    }
  | {
      type: "move-occurrence";
      occurrenceId: string;
      parentOccurrenceId: string | null;
      position: string;
    }
  | {
      type: "delete-occurrence";
      occurrenceId: string;
      policy: "cascade" | "rehome";
    };

export type ContributionFact = {
  kind: "contribution";
  id: string;
  coordinate: CausalCoordinate;
  observed: FactFrontier;
  intent: EditIntent;
  mutation: DomainMutation;
  supportIds: readonly string[];
};

export type ResolutionFact = {
  kind: "resolution";
  id: string;
  coordinate: CausalCoordinate;
  observed: FactFrontier;
  proposalIds: readonly string[];
  decision: Decision;
};

export type Fact = ContributionFact | ResolutionFact;

export type FactSnapshot = {
  facts: readonly Fact[];
  frontier: FactFrontier;
};

export type VisibleNode = {
  nodeId: string;
  text: string;
  marks: readonly TextMark[];
  properties: Readonly<Record<string, unknown>>;
  schemas: readonly string[];
  canonicalOccurrenceId: string | null;
  managed: boolean;
};

export type VisibleOccurrence = {
  occurrenceId: string;
  nodeId: string;
  parentOccurrenceId: string | null;
  position: string;
  managed: boolean;
};

export type Projection = {
  mode: ViewMode;
  frontier: FactFrontier;
  activeContributionIds: readonly string[];
  nodes: readonly VisibleNode[];
  occurrences: readonly VisibleOccurrence[];
};

export type RuleKey = string;

export type RuleContext = {
  facts: readonly Fact[];
  frontier: FactFrontier;
  mode: ViewMode;
  values: ReadonlyMap<RuleKey, unknown>;
};

export type Rule = {
  id: string;
  owner: string;
  output: RuleKey;
  after: readonly RuleKey[];
  evaluate(context: RuleContext): unknown;
};

export type SchedulerStats = {
  evaluations: number;
  evaluationsByRule: Readonly<Record<string, number>>;
};

export type SchedulerCheckpoint = {
  scheduler: string;
  ruleVersion: string;
  mode: ViewMode;
  snapshot: FactSnapshot;
  values: readonly [RuleKey, unknown][];
};

type EncodedCollection =
  | { __schedulerCollection: "map"; entries: readonly [unknown, unknown][] }
  | { __schedulerCollection: "set"; values: readonly unknown[] };

export type SchedulerResult = {
  projection: Projection;
  checkpoint: SchedulerCheckpoint;
  stats: SchedulerStats;
};

export interface ReconcileScheduler {
  readonly name: string;
  rebuild(snapshot: FactSnapshot, mode: ViewMode): SchedulerResult;
  advance(checkpoint: SchedulerCheckpoint, snapshot: FactSnapshot): SchedulerResult;
}

const RULE_VERSION = "proposal-reconcile-v1";
const FACTS_CONTAINER = "facts";

function parseFact(value: unknown): Fact {
  if (typeof value !== "string") throw new Error("FactStore contains a non-string fact");
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || typeof parsed.id !== "string") {
    throw new Error("FactStore contains an invalid fact envelope");
  }
  return parsed as Fact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encodeSchedulerCheckpoint(checkpointValue: SchedulerCheckpoint): string {
  return JSON.stringify(checkpointValue, (_key, value: unknown): unknown => {
    if (value instanceof Map) {
      return {
        __schedulerCollection: "map",
        entries: [...value],
      } satisfies EncodedCollection;
    }
    if (value instanceof Set) {
      return {
        __schedulerCollection: "set",
        values: [...value],
      } satisfies EncodedCollection;
    }
    return value;
  });
}

export function decodeSchedulerCheckpoint(encoded: string): SchedulerCheckpoint {
  return JSON.parse(encoded, (_key, value: unknown): unknown => {
    if (!isRecord(value)) return value;
    if (value.__schedulerCollection === "map" && Array.isArray(value.entries)) {
      return new Map(value.entries as [unknown, unknown][]);
    }
    if (value.__schedulerCollection === "set" && Array.isArray(value.values)) {
      return new Set(value.values);
    }
    return value;
  }) as SchedulerCheckpoint;
}

export class LoroFactStore {
  readonly doc: LoroDoc;
  private readonly records;

  constructor(doc: LoroDoc = new LoroDoc()) {
    this.doc = doc;
    this.records = doc.getMap(FACTS_CONTAINER);
  }

  append(fact: Fact): void {
    const encoded = JSON.stringify(fact);
    const current = this.records.get(fact.id);
    if (current !== undefined && current !== encoded) {
      throw new Error(`FactId collision: ${fact.id}`);
    }
    this.records.set(fact.id, encoded);
    this.doc.commit();
  }

  appendAll(facts: readonly Fact[]): void {
    for (const fact of facts) this.append(fact);
  }

  snapshot(): FactSnapshot {
    const facts = [...this.records.values()].map(parseFact).sort(compareFacts);
    return { facts, frontier: frontierOf(facts) };
  }

  exportSnapshot(): Uint8Array {
    return this.doc.export({ mode: "snapshot" });
  }

  import(bytes: Uint8Array): void {
    this.doc.import(bytes);
  }
}

export function compareCoordinates(left: CausalCoordinate, right: CausalCoordinate): number {
  return left.counter - right.counter || left.replicaId.localeCompare(right.replicaId);
}

export function compareFacts(left: Fact, right: Fact): number {
  return compareCoordinates(left.coordinate, right.coordinate) || left.id.localeCompare(right.id);
}

export function frontierOf(facts: readonly Fact[]): FactFrontier {
  const counters = new Map<string, number>();
  for (const fact of facts) {
    counters.set(
      fact.coordinate.replicaId,
      Math.max(counters.get(fact.coordinate.replicaId) ?? 0, fact.coordinate.counter),
    );
  }
  return [...counters]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([replicaId, counter]) => ({ replicaId, counter }));
}

export function contribution(
  id: string,
  counter: number,
  replicaId: string,
  intent: EditIntent,
  mutation: DomainMutation,
  supportIds: readonly string[] = [],
  observed: FactFrontier = [],
): ContributionFact {
  return {
    kind: "contribution",
    id,
    coordinate: { replicaId, counter },
    observed,
    intent,
    mutation,
    supportIds,
  };
}

export function resolution(
  id: string,
  counter: number,
  replicaId: string,
  proposalIds: readonly string[],
  decision: Decision,
  observed: FactFrontier = [],
): ResolutionFact {
  return {
    kind: "resolution",
    id,
    coordinate: { replicaId, counter },
    observed,
    proposalIds,
    decision,
  };
}

type Activation = {
  active: readonly ContributionFact[];
  activeIds: ReadonlySet<string>;
};

type NodeOutput = {
  live: ReadonlySet<string>;
  canonicalOccurrenceIds: ReadonlyMap<string, string>;
};

type OccurrenceOutput = ReadonlyMap<string, VisibleOccurrence>;

type TextOutput = ReadonlyMap<string, { text: string; marks: readonly TextMark[] }>;
type PropertyOutput = ReadonlyMap<string, Readonly<Record<string, unknown>>>;

type SchemaOutput = {
  schemas: ReadonlyMap<string, readonly string[]>;
  managedNodes: ReadonlyMap<string, VisibleNode>;
  managedOccurrences: ReadonlyMap<string, VisibleOccurrence>;
};

function value<T>(context: RuleContext, key: RuleKey): T {
  if (!context.values.has(key)) throw new Error(`missing rule input ${key}`);
  return context.values.get(key) as T;
}

function contributionIsActive(
  fact: ContributionFact,
  mode: ViewMode,
  resolutions: ReadonlyMap<string, ResolutionFact>,
): boolean {
  if (fact.intent === "direct") return true;
  const decision = resolutions.get(fact.id)?.decision;
  if (decision === "reject") return false;
  return decision === "accept" || mode === "review";
}

function activation(context: RuleContext): Activation {
  const resolutions = new Map<string, ResolutionFact>();
  for (const fact of context.facts) {
    if (fact.kind !== "resolution") continue;
    for (const proposalId of fact.proposalIds) {
      const current = resolutions.get(proposalId);
      if (!current || compareFacts(current, fact) < 0) resolutions.set(proposalId, fact);
    }
  }

  const candidates = context.facts.filter(
    (fact): fact is ContributionFact =>
      fact.kind === "contribution" && contributionIsActive(fact, context.mode, resolutions),
  );
  const activeIds = new Set(candidates.map((fact) => fact.id));

  // Semantic Support Dependency is a finite, contracting closure: an inactive support removes
  // its dependent. The set can shrink at most once per Contribution, which is the termination
  // argument used by every scheduler candidate.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of candidates) {
      if (
        activeIds.has(fact.id) &&
        fact.supportIds.some((supportId) => !activeIds.has(supportId))
      ) {
        activeIds.delete(fact.id);
        changed = true;
      }
    }
  }

  return {
    active: candidates.filter((fact) => activeIds.has(fact.id)),
    activeIds,
  };
}

function active(context: RuleContext): readonly ContributionFact[] {
  return value<Activation>(context, "activation").active;
}

function buildNodes(context: RuleContext): NodeOutput {
  const live = new Set<string>();
  const canonicalOccurrenceIds = new Map<string, string>();
  for (const fact of active(context)) {
    const mutation = fact.mutation;
    if (mutation.type === "create-node") live.add(mutation.nodeId);
    if (mutation.type === "delete-node") live.delete(mutation.nodeId);
    if (mutation.type === "create-occurrence" && mutation.canonical) {
      canonicalOccurrenceIds.set(mutation.nodeId, mutation.occurrenceId);
    }
  }
  return { live, canonicalOccurrenceIds };
}

function descendants(
  occurrences: ReadonlyMap<string, VisibleOccurrence>,
  parentId: string,
): string[] {
  const result: string[] = [];
  const pending = [parentId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const parent = pending.pop()!;
    if (visited.has(parent)) throw new Error(`stored occurrence cycle at ${parent}`);
    visited.add(parent);
    for (const occurrence of occurrences.values()) {
      if (occurrence.parentOccurrenceId !== parent) continue;
      result.push(occurrence.occurrenceId);
      pending.push(occurrence.occurrenceId);
    }
  }
  return result;
}

function buildOccurrences(context: RuleContext): OccurrenceOutput {
  const nodes = value<NodeOutput>(context, "nodes");
  const occurrences = new Map<string, VisibleOccurrence>();
  for (const fact of active(context)) {
    const mutation = fact.mutation;
    if (mutation.type === "create-occurrence" && nodes.live.has(mutation.nodeId)) {
      occurrences.set(mutation.occurrenceId, {
        occurrenceId: mutation.occurrenceId,
        nodeId: mutation.nodeId,
        parentOccurrenceId: mutation.parentOccurrenceId,
        position: mutation.position,
        managed: false,
      });
      continue;
    }
    if (mutation.type === "move-occurrence") {
      const current = occurrences.get(mutation.occurrenceId);
      if (current) {
        occurrences.set(mutation.occurrenceId, {
          ...current,
          parentOccurrenceId: mutation.parentOccurrenceId,
          position: mutation.position,
        });
      }
      continue;
    }
    if (mutation.type === "delete-occurrence") {
      const removed = occurrences.get(mutation.occurrenceId);
      if (!removed) continue;
      if (mutation.policy === "cascade") {
        for (const childId of descendants(occurrences, mutation.occurrenceId)) {
          occurrences.delete(childId);
        }
      } else {
        for (const child of occurrences.values()) {
          if (child.parentOccurrenceId === mutation.occurrenceId) {
            occurrences.set(child.occurrenceId, {
              ...child,
              parentOccurrenceId: removed.parentOccurrenceId,
            });
          }
        }
      }
      occurrences.delete(mutation.occurrenceId);
    }
  }

  for (const [id, occurrence] of occurrences) {
    if (!nodes.live.has(occurrence.nodeId)) occurrences.delete(id);
  }
  validateStoredTree(occurrences);
  return occurrences;
}

function validateStoredTree(occurrences: ReadonlyMap<string, VisibleOccurrence>): void {
  for (const occurrence of occurrences.values()) {
    const visited = new Set<string>([occurrence.occurrenceId]);
    let parentId = occurrence.parentOccurrenceId;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        throw new Error(`stored occurrence cycle at ${occurrence.occurrenceId}`);
      }
      visited.add(parentId);
      parentId = occurrences.get(parentId)?.parentOccurrenceId ?? null;
    }
  }
}

function buildText(context: RuleContext): TextOutput {
  const nodes = value<NodeOutput>(context, "nodes");
  const texts = new Map<string, { text: string; marks: TextMark[] }>();
  for (const nodeId of nodes.live) texts.set(nodeId, { text: "", marks: [] });
  for (const fact of active(context)) {
    const mutation = fact.mutation;
    if (mutation.type === "set-text" && nodes.live.has(mutation.nodeId)) {
      texts.set(mutation.nodeId, { text: mutation.value, marks: [] });
    }
    if (mutation.type === "add-mark" && nodes.live.has(mutation.nodeId)) {
      const current = texts.get(mutation.nodeId) ?? { text: "", marks: [] };
      if (
        mutation.mark.from < 0 ||
        mutation.mark.to < mutation.mark.from ||
        mutation.mark.to > current.text.length
      ) {
        throw new Error(`invalid text mark ${mutation.mark.id}`);
      }
      texts.set(mutation.nodeId, {
        text: current.text,
        marks: [...current.marks.filter((mark) => mark.id !== mutation.mark.id), mutation.mark],
      });
    }
  }
  return new Map(
    [...texts].map(([nodeId, output]) => [
      nodeId,
      { text: output.text, marks: [...output.marks].sort((a, b) => a.id.localeCompare(b.id)) },
    ]),
  );
}

function buildProperties(context: RuleContext): PropertyOutput {
  const nodes = value<NodeOutput>(context, "nodes");
  const properties = new Map<string, Record<string, unknown>>();
  for (const nodeId of nodes.live) properties.set(nodeId, {});
  for (const fact of active(context)) {
    const mutation = fact.mutation;
    if (mutation.type !== "set-property" || !nodes.live.has(mutation.nodeId)) continue;
    properties.set(mutation.nodeId, {
      ...(properties.get(mutation.nodeId) ?? {}),
      [mutation.key]: mutation.value,
    });
  }
  return properties;
}

function managedNodeId(nodeId: string, schemaId: string, field: string): string {
  return `managed-node:${nodeId}:${schemaId}:${field}`;
}

function managedOccurrenceId(nodeId: string, schemaId: string, field: string): string {
  return `managed-occurrence:${nodeId}:${schemaId}:${field}`;
}

function buildSchemas(context: RuleContext): SchemaOutput {
  const nodes = value<NodeOutput>(context, "nodes");
  const schemas = new Map<string, string[]>();
  const managedNodes = new Map<string, VisibleNode>();
  const managedOccurrences = new Map<string, VisibleOccurrence>();
  for (const fact of active(context)) {
    const mutation = fact.mutation;
    if (mutation.type !== "apply-schema" || !nodes.live.has(mutation.nodeId)) continue;
    const current = new Set(schemas.get(mutation.nodeId) ?? []);
    current.add(mutation.schemaId);
    schemas.set(mutation.nodeId, [...current].sort());
    const parentOccurrenceId = nodes.canonicalOccurrenceIds.get(mutation.nodeId) ?? null;
    for (const [index, field] of [...mutation.managedFields].sort().entries()) {
      const nodeId = managedNodeId(mutation.nodeId, mutation.schemaId, field);
      const occurrenceId = managedOccurrenceId(mutation.nodeId, mutation.schemaId, field);
      managedNodes.set(nodeId, {
        nodeId,
        text: field,
        marks: [],
        properties: { field },
        schemas: [],
        canonicalOccurrenceId: occurrenceId,
        managed: true,
      });
      managedOccurrences.set(occurrenceId, {
        occurrenceId,
        nodeId,
        parentOccurrenceId,
        position: `managed-${String(index).padStart(4, "0")}`,
        managed: true,
      });
    }
  }
  return { schemas, managedNodes, managedOccurrences };
}

function assembleProjection(context: RuleContext): Projection {
  const activationOutput = value<Activation>(context, "activation");
  const nodeOutput = value<NodeOutput>(context, "nodes");
  const occurrences = value<OccurrenceOutput>(context, "occurrences");
  const texts = value<TextOutput>(context, "text");
  const properties = value<PropertyOutput>(context, "properties");
  const schemaOutput = value<SchemaOutput>(context, "schemas");
  const visibleNodes: VisibleNode[] = [...nodeOutput.live].map((nodeId) => ({
    nodeId,
    text: texts.get(nodeId)?.text ?? "",
    marks: texts.get(nodeId)?.marks ?? [],
    properties: properties.get(nodeId) ?? {},
    schemas: schemaOutput.schemas.get(nodeId) ?? [],
    canonicalOccurrenceId: nodeOutput.canonicalOccurrenceIds.get(nodeId) ?? null,
    managed: false,
  }));
  visibleNodes.push(...schemaOutput.managedNodes.values());
  const visibleOccurrences = [...occurrences.values(), ...schemaOutput.managedOccurrences.values()];
  return {
    mode: context.mode,
    frontier: context.frontier,
    activeContributionIds: [...activationOutput.activeIds].sort(),
    nodes: visibleNodes.sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    occurrences: visibleOccurrences.sort(
      (left, right) =>
        (left.parentOccurrenceId ?? "").localeCompare(right.parentOccurrenceId ?? "") ||
        left.position.localeCompare(right.position) ||
        left.occurrenceId.localeCompare(right.occurrenceId),
    ),
  };
}

export function standardRules(): Rule[] {
  return [
    {
      id: "review.activation-and-support-closure",
      owner: "review",
      output: "activation",
      after: [],
      evaluate: activation,
    },
    {
      id: "node.materialize",
      owner: "node",
      output: "nodes",
      after: ["activation"],
      evaluate: buildNodes,
    },
    {
      id: "occurrence.materialize",
      owner: "occurrence",
      output: "occurrences",
      after: ["activation", "nodes"],
      evaluate: buildOccurrences,
    },
    {
      id: "text.materialize",
      owner: "text",
      output: "text",
      after: ["activation", "nodes"],
      evaluate: buildText,
    },
    {
      id: "property.materialize",
      owner: "property",
      output: "properties",
      after: ["activation", "nodes"],
      evaluate: buildProperties,
    },
    {
      id: "schema.materialize-managed-children",
      owner: "schema",
      output: "schemas",
      after: ["activation", "nodes", "occurrences"],
      evaluate: buildSchemas,
    },
    {
      id: "projection.assemble",
      owner: "projection",
      output: "projection",
      after: ["activation", "nodes", "occurrences", "text", "properties", "schemas"],
      evaluate: assembleProjection,
    },
  ];
}

function topologicalRules(rules: readonly Rule[]): Rule[] {
  const byOutput = new Map<RuleKey, Rule>();
  for (const rule of rules) {
    if (byOutput.has(rule.output)) {
      throw new Error(`cross-owner duplicate output ${rule.output}`);
    }
    byOutput.set(rule.output, rule);
  }
  const result: Rule[] = [];
  const visiting = new Set<RuleKey>();
  const visited = new Set<RuleKey>();
  const visit = (key: RuleKey): void => {
    if (visiting.has(key)) throw new Error(`illegal rule cycle at ${key}`);
    if (visited.has(key)) return;
    const rule = byOutput.get(key);
    if (!rule) throw new Error(`missing rule dependency ${key}`);
    visiting.add(key);
    for (const dependency of rule.after) visit(dependency);
    visiting.delete(key);
    visited.add(key);
    result.push(rule);
  };
  for (const key of [...byOutput.keys()].sort()) visit(key);
  return result;
}

function contextFor(
  snapshot: FactSnapshot,
  mode: ViewMode,
  values: ReadonlyMap<RuleKey, unknown>,
): RuleContext {
  return { facts: snapshot.facts, frontier: snapshot.frontier, mode, values };
}

function statsFromCounts(counts: ReadonlyMap<string, number>): SchedulerStats {
  return {
    evaluations: [...counts.values()].reduce((total, count) => total + count, 0),
    evaluationsByRule: Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function checkpoint(
  scheduler: string,
  mode: ViewMode,
  snapshot: FactSnapshot,
  values: ReadonlyMap<RuleKey, unknown>,
): SchedulerCheckpoint {
  return {
    scheduler,
    ruleVersion: RULE_VERSION,
    mode,
    snapshot,
    values: [...values],
  };
}

function result(
  scheduler: string,
  mode: ViewMode,
  snapshot: FactSnapshot,
  values: ReadonlyMap<RuleKey, unknown>,
  counts: ReadonlyMap<string, number>,
): SchedulerResult {
  return {
    projection: values.get("projection") as Projection,
    checkpoint: checkpoint(scheduler, mode, snapshot, values),
    stats: statsFromCounts(counts),
  };
}

function validateCheckpoint(
  name: string,
  checkpointValue: SchedulerCheckpoint,
  mode?: ViewMode,
): void {
  if (checkpointValue.scheduler !== name) {
    throw new Error(`checkpoint scheduler mismatch: ${checkpointValue.scheduler}`);
  }
  if (checkpointValue.ruleVersion !== RULE_VERSION) {
    throw new Error(`checkpoint rule version mismatch: ${checkpointValue.ruleVersion}`);
  }
  if (mode && checkpointValue.mode !== mode) {
    throw new Error(`checkpoint mode mismatch: ${checkpointValue.mode}`);
  }
}

export class PhaseDagScheduler implements ReconcileScheduler {
  readonly name = "phase-dag";
  private readonly ordered: readonly Rule[];

  constructor(rules: readonly Rule[] = standardRules()) {
    this.ordered = topologicalRules(rules);
  }

  rebuild(snapshot: FactSnapshot, mode: ViewMode): SchedulerResult {
    const values = new Map<RuleKey, unknown>();
    const counts = new Map<string, number>();
    for (const rule of this.ordered) {
      values.set(rule.output, rule.evaluate(contextFor(snapshot, mode, values)));
      counts.set(rule.id, 1);
    }
    return result(this.name, mode, snapshot, values, counts);
  }

  advance(checkpointValue: SchedulerCheckpoint, snapshot: FactSnapshot): SchedulerResult {
    validateCheckpoint(this.name, checkpointValue);
    return this.rebuild(snapshot, checkpointValue.mode);
  }
}

function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Map) {
      return [...item].sort(([left], [right]) => String(left).localeCompare(String(right)));
    }
    if (item instanceof Set) return [...item].sort();
    return item;
  });
}

export class GlobalWorklistScheduler implements ReconcileScheduler {
  readonly name = "global-worklist";
  private readonly rules: readonly Rule[];
  private readonly maxEvaluations: number;

  constructor(rules: readonly Rule[] = standardRules(), maxEvaluations = 1_000) {
    // Ownership and missing inputs are still validated. Global iteration is not permission for
    // multiple owners to write the same output.
    topologicalRules(rules);
    this.rules = [...rules].sort((left, right) => left.id.localeCompare(right.id));
    this.maxEvaluations = maxEvaluations;
  }

  rebuild(snapshot: FactSnapshot, mode: ViewMode): SchedulerResult {
    return this.run(snapshot, mode, new Map());
  }

  advance(checkpointValue: SchedulerCheckpoint, snapshot: FactSnapshot): SchedulerResult {
    validateCheckpoint(this.name, checkpointValue);
    return this.run(snapshot, checkpointValue.mode, new Map(checkpointValue.values));
  }

  private run(
    snapshot: FactSnapshot,
    mode: ViewMode,
    initial: ReadonlyMap<RuleKey, unknown>,
  ): SchedulerResult {
    const values = new Map(initial);
    values.delete("projection");
    const counts = new Map<string, number>();
    let evaluations = 0;
    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of this.rules) {
        if (rule.after.some((key) => !values.has(key))) continue;
        evaluations += 1;
        if (evaluations > this.maxEvaluations) {
          throw new Error("global worklist failed to converge");
        }
        const next = rule.evaluate(contextFor(snapshot, mode, values));
        counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
        if (stableValue(values.get(rule.output)) !== stableValue(next)) {
          values.set(rule.output, next);
          changed = true;
        }
      }
    }
    if (!values.has("projection")) {
      throw new Error("global worklist reached a partial projection");
    }
    return result(this.name, mode, snapshot, values, counts);
  }
}

function changedFacts(previous: readonly Fact[], current: readonly Fact[]): readonly Fact[] {
  const previousIds = new Set(previous.map((fact) => fact.id));
  return current.filter((fact) => !previousIds.has(fact.id));
}

function affectedOutputs(facts: readonly Fact[]): Set<RuleKey> {
  const outputs = new Set<RuleKey>(["activation", "projection"]);
  for (const fact of facts) {
    if (fact.kind === "resolution") {
      for (const output of ["nodes", "occurrences", "text", "properties", "schemas"] as const) {
        outputs.add(output);
      }
      continue;
    }
    switch (fact.mutation.type) {
      case "create-node":
      case "delete-node":
        for (const output of ["nodes", "occurrences", "text", "properties", "schemas"] as const) {
          outputs.add(output);
        }
        break;
      case "create-occurrence":
      case "move-occurrence":
      case "delete-occurrence":
        outputs.add("occurrences");
        outputs.add("schemas");
        break;
      case "set-text":
      case "add-mark":
        outputs.add("text");
        break;
      case "set-property":
        outputs.add("properties");
        break;
      case "apply-schema":
        outputs.add("schemas");
        break;
    }
    if (fact.supportIds.length > 0) {
      for (const output of ["nodes", "occurrences", "text", "properties", "schemas"] as const) {
        outputs.add(output);
      }
    }
  }
  return outputs;
}

export class OwnerDataflowScheduler implements ReconcileScheduler {
  readonly name = "owner-dataflow";
  private readonly ordered: readonly Rule[];

  constructor(rules: readonly Rule[] = standardRules()) {
    this.ordered = topologicalRules(rules);
  }

  rebuild(snapshot: FactSnapshot, mode: ViewMode): SchedulerResult {
    const values = new Map<RuleKey, unknown>();
    const counts = new Map<string, number>();
    for (const rule of this.ordered) {
      values.set(rule.output, rule.evaluate(contextFor(snapshot, mode, values)));
      counts.set(rule.id, 1);
    }
    return result(this.name, mode, snapshot, values, counts);
  }

  advance(checkpointValue: SchedulerCheckpoint, snapshot: FactSnapshot): SchedulerResult {
    validateCheckpoint(this.name, checkpointValue);
    const tail = changedFacts(checkpointValue.snapshot.facts, snapshot.facts);
    if (tail.length === 0) {
      return result(
        this.name,
        checkpointValue.mode,
        snapshot,
        new Map(checkpointValue.values),
        new Map(),
      );
    }
    const dirty = affectedOutputs(tail);
    const values = new Map(checkpointValue.values);
    const counts = new Map<string, number>();
    for (const rule of this.ordered) {
      if (!dirty.has(rule.output)) continue;
      values.set(rule.output, rule.evaluate(contextFor(snapshot, checkpointValue.mode, values)));
      counts.set(rule.id, 1);
    }
    return result(this.name, checkpointValue.mode, snapshot, values, counts);
  }
}

export function renderOutline(projection: Projection, rootOccurrenceId: string): readonly string[] {
  const occurrences = new Map(
    projection.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]),
  );
  const nodes = new Map(projection.nodes.map((node) => [node.nodeId, node]));
  const children = new Map<string, VisibleOccurrence[]>();
  for (const occurrence of projection.occurrences) {
    if (occurrence.parentOccurrenceId === null) continue;
    const list = children.get(occurrence.parentOccurrenceId) ?? [];
    list.push(occurrence);
    children.set(occurrence.parentOccurrenceId, list);
  }
  for (const list of children.values()) {
    list.sort(
      (left, right) =>
        left.position.localeCompare(right.position) ||
        left.occurrenceId.localeCompare(right.occurrenceId),
    );
  }
  const lines: string[] = [];
  const visit = (occurrenceId: string, depth: number, semanticPath: ReadonlySet<string>): void => {
    const occurrence = occurrences.get(occurrenceId);
    if (!occurrence) return;
    const node = nodes.get(occurrence.nodeId);
    if (!node) return;
    const prefix = "  ".repeat(depth);
    if (semanticPath.has(node.nodeId)) {
      lines.push(`${prefix}↻ ${node.text} [${node.nodeId}]`);
      return;
    }
    lines.push(`${prefix}${node.text} [${node.nodeId}]`);
    const nextPath = new Set(semanticPath);
    nextPath.add(node.nodeId);
    const canonicalId = node.canonicalOccurrenceId ?? occurrenceId;
    for (const child of children.get(canonicalId) ?? []) {
      visit(child.occurrenceId, depth + 1, nextPath);
    }
  };
  visit(rootOccurrenceId, 0, new Set());
  return lines;
}

export function schedulerCandidates(): readonly ReconcileScheduler[] {
  return [new PhaseDagScheduler(), new GlobalWorklistScheduler(), new OwnerDataflowScheduler()];
}
