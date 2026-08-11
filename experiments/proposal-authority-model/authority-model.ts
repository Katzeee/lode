export type Stamp = {
  counter: number;
  actor: string;
};

export type DomainOperation =
  | { type: "create-node"; nodeId: string }
  | { type: "delete-node"; nodeId: string }
  | { type: "set-text"; nodeId: string; value: string }
  | { type: "set-property"; nodeId: string; key: string; value: unknown }
  | {
      type: "apply-schema";
      nodeId: string;
      schemaId: string;
      defaults: Readonly<Record<string, unknown>>;
    }
  | {
      type: "create-occurrence";
      occurrenceId: string;
      nodeId: string;
      parentOccurrenceId: string | null;
      canonical: boolean;
    }
  | {
      type: "move-occurrence";
      occurrenceId: string;
      parentOccurrenceId: string | null;
    }
  | { type: "delete-occurrence"; occurrenceId: string };

type LegacyOperation =
  | Exclude<DomainOperation, { type: "set-property" }>
  | { type: "set-attribute"; nodeId: string; name: string; value: unknown };

export type ContributionFact = {
  kind: "contribution";
  id: string;
  stamp: Stamp;
  intent: "direct" | "proposal";
  schemaVersion: 1 | 2;
  operation: DomainOperation | LegacyOperation;
  supportIds?: readonly string[];
};

export type ResolutionFact = {
  kind: "resolution";
  id: string;
  stamp: Stamp;
  proposalId: string;
  decision: "accept" | "reject";
};

export type Fact = ContributionFact | ResolutionFact;
export type ViewMode = "origin" | "review";

type Register<T> = {
  value: T;
  stamp: Stamp;
};

type SchemaState = {
  defaults: Readonly<Record<string, unknown>>;
  stamp: Stamp;
};

type NodeState = {
  presence?: Register<boolean>;
  text?: Register<string>;
  canonicalOccurrenceId?: Register<string | null>;
  properties: Map<string, Register<unknown>>;
  schemas: Map<string, SchemaState>;
};

type OccurrenceState = {
  nodeId?: Register<string>;
  parentOccurrenceId?: Register<string | null>;
  presence?: Register<boolean>;
};

export type MaterializedState = {
  nodes: Map<string, NodeState>;
  occurrences: Map<string, OccurrenceState>;
};

export type VisibleNode = {
  nodeId: string;
  text: string;
  canonicalOccurrenceId: string | null;
  properties: Readonly<Record<string, unknown>>;
  schemas: readonly string[];
};

export type VisibleOccurrence = {
  occurrenceId: string;
  nodeId: string;
  parentOccurrenceId: string | null;
};

export type VisibleState = {
  nodes: readonly VisibleNode[];
  occurrences: readonly VisibleOccurrence[];
};

type EncodedState = {
  nodes: Array<{
    nodeId: string;
    presence?: Register<boolean>;
    text?: Register<string>;
    canonicalOccurrenceId?: Register<string | null>;
    properties: Array<[string, Register<unknown>]>;
    schemas: Array<[string, SchemaState]>;
  }>;
  occurrences: Array<{
    occurrenceId: string;
    nodeId?: Register<string>;
    parentOccurrenceId?: Register<string | null>;
    presence?: Register<boolean>;
  }>;
};

type SerializedFactFirst = {
  kind: "fact-first";
  generation: number;
  checkpoint: EncodedState;
  facts: Fact[];
  retiredProposalIds: string[];
};

type SerializedHybrid = {
  kind: "state-review";
  generation: number;
  checkpoint: EncodedState;
  materializedOrigin?: EncodedState;
  facts: Fact[];
  retiredProposalIds: string[];
  materializedResolutionIds: string[];
};

export type AuthorityStats = {
  durableWrites: number;
  projectionRebuilds: number;
  materializations: number;
};

function compareStamp(left: Stamp, right: Stamp): number {
  return left.counter - right.counter || left.actor.localeCompare(right.actor);
}

function compareFacts(left: Fact, right: Fact): number {
  return compareStamp(left.stamp, right.stamp) || left.id.localeCompare(right.id);
}

function shouldReplace<T>(current: Register<T> | undefined, stamp: Stamp): boolean {
  return current === undefined || compareStamp(current.stamp, stamp) < 0;
}

function setRegister<T>(
  current: Register<T> | undefined,
  value: T,
  stamp: Stamp,
): Register<T> | undefined {
  return shouldReplace(current, stamp) ? { value, stamp } : current;
}

export function emptyState(): MaterializedState {
  return { nodes: new Map(), occurrences: new Map() };
}

export function cloneState(state: MaterializedState): MaterializedState {
  return decodeState(encodeState(state));
}

function nodeFor(state: MaterializedState, nodeId: string): NodeState {
  const existing = state.nodes.get(nodeId);
  if (existing) return existing;
  const created: NodeState = { properties: new Map(), schemas: new Map() };
  state.nodes.set(nodeId, created);
  return created;
}

function occurrenceFor(state: MaterializedState, occurrenceId: string): OccurrenceState {
  const existing = state.occurrences.get(occurrenceId);
  if (existing) return existing;
  const created: OccurrenceState = {};
  state.occurrences.set(occurrenceId, created);
  return created;
}

function decodeOperation(fact: ContributionFact): DomainOperation {
  if (fact.schemaVersion === 1 && fact.operation.type === "set-attribute") {
    return {
      type: "set-property",
      nodeId: fact.operation.nodeId,
      key: fact.operation.name,
      value: fact.operation.value,
    };
  }
  if (fact.operation.type === "set-attribute") {
    throw new Error(`schema v2 fact ${fact.id} uses removed set-attribute operation`);
  }
  return fact.operation;
}

export function applyContribution(state: MaterializedState, fact: ContributionFact): void {
  const operation = decodeOperation(fact);
  const stamp = fact.stamp;
  switch (operation.type) {
    case "create-node": {
      const node = nodeFor(state, operation.nodeId);
      node.presence = setRegister(node.presence, true, stamp);
      break;
    }
    case "delete-node": {
      const node = nodeFor(state, operation.nodeId);
      node.presence = setRegister(node.presence, false, stamp);
      break;
    }
    case "set-text": {
      const node = nodeFor(state, operation.nodeId);
      node.text = setRegister(node.text, operation.value, stamp);
      break;
    }
    case "set-property": {
      const node = nodeFor(state, operation.nodeId);
      const current = node.properties.get(operation.key);
      const next = setRegister(current, operation.value, stamp);
      if (next) node.properties.set(operation.key, next);
      break;
    }
    case "apply-schema": {
      const node = nodeFor(state, operation.nodeId);
      const current = node.schemas.get(operation.schemaId);
      if (!current || compareStamp(current.stamp, stamp) < 0) {
        node.schemas.set(operation.schemaId, {
          defaults: operation.defaults,
          stamp,
        });
      }
      break;
    }
    case "create-occurrence": {
      const occurrence = occurrenceFor(state, operation.occurrenceId);
      occurrence.nodeId = setRegister(occurrence.nodeId, operation.nodeId, stamp);
      occurrence.parentOccurrenceId = setRegister(
        occurrence.parentOccurrenceId,
        operation.parentOccurrenceId,
        stamp,
      );
      occurrence.presence = setRegister(occurrence.presence, true, stamp);
      if (operation.canonical) {
        const node = nodeFor(state, operation.nodeId);
        node.canonicalOccurrenceId = setRegister(
          node.canonicalOccurrenceId,
          operation.occurrenceId,
          stamp,
        );
      }
      break;
    }
    case "move-occurrence": {
      const occurrence = occurrenceFor(state, operation.occurrenceId);
      occurrence.parentOccurrenceId = setRegister(
        occurrence.parentOccurrenceId,
        operation.parentOccurrenceId,
        stamp,
      );
      break;
    }
    case "delete-occurrence": {
      const occurrence = occurrenceFor(state, operation.occurrenceId);
      occurrence.presence = setRegister(occurrence.presence, false, stamp);
      break;
    }
  }
}

function latestResolutions(facts: Iterable<Fact>): Map<string, ResolutionFact> {
  const resolutions = new Map<string, ResolutionFact>();
  for (const fact of facts) {
    if (fact.kind !== "resolution") continue;
    const current = resolutions.get(fact.proposalId);
    if (!current || compareFacts(current, fact) < 0) {
      resolutions.set(fact.proposalId, fact);
    }
  }
  return resolutions;
}

function activeContributions(facts: Iterable<Fact>, mode: ViewMode): ContributionFact[] {
  const all = [...facts];
  const resolutions = latestResolutions(all);
  let active = all
    .filter((fact): fact is ContributionFact => {
      if (fact.kind !== "contribution") return false;
      if (fact.intent === "direct") return true;
      const decision = resolutions.get(fact.id)?.decision;
      if (decision === "reject") return false;
      return mode === "review" || decision === "accept";
    })
    .sort(compareFacts);
  let changed = true;
  while (changed) {
    const activeIds = new Set(active.map((fact) => fact.id));
    const filtered = active.filter((fact) =>
      (fact.supportIds ?? []).every((supportId) => activeIds.has(supportId)),
    );
    changed = filtered.length !== active.length;
    active = filtered;
  }
  return active;
}

export function project(
  checkpoint: MaterializedState,
  facts: Iterable<Fact>,
  mode: ViewMode,
): MaterializedState {
  const state = cloneState(checkpoint);
  for (const fact of activeContributions(facts, mode)) applyContribution(state, fact);
  return state;
}

export function visibleState(state: MaterializedState): VisibleState {
  const nodes = [...state.nodes]
    .filter(([, node]) => node.presence?.value === true)
    .map(([nodeId, node]): VisibleNode => {
      const properties: Record<string, unknown> = {};
      for (const [, schema] of [...node.schemas].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        for (const [key, value] of Object.entries(schema.defaults)) {
          if (!(key in properties)) properties[key] = value;
        }
      }
      for (const [key, register] of [...node.properties].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        properties[key] = register.value;
      }
      return {
        nodeId,
        text: node.text?.value ?? "",
        canonicalOccurrenceId: node.canonicalOccurrenceId?.value ?? null,
        properties,
        schemas: [...node.schemas.keys()].sort(),
      };
    })
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const liveNodeIds = new Set(nodes.map((node) => node.nodeId));
  const occurrences = [...state.occurrences]
    .filter(
      ([, occurrence]) =>
        occurrence.presence?.value === true &&
        occurrence.nodeId !== undefined &&
        liveNodeIds.has(occurrence.nodeId.value),
    )
    .map(([occurrenceId, occurrence]): VisibleOccurrence => ({
      occurrenceId,
      nodeId: occurrence.nodeId!.value,
      parentOccurrenceId: occurrence.parentOccurrenceId?.value ?? null,
    }))
    .sort((left, right) => left.occurrenceId.localeCompare(right.occurrenceId));
  return { nodes, occurrences };
}

function visibleStateJson(state: MaterializedState): string {
  return JSON.stringify(visibleState(state));
}

function encodeState(state: MaterializedState): EncodedState {
  return {
    nodes: [...state.nodes]
      .map(([nodeId, node]) => ({
        nodeId,
        presence: node.presence,
        text: node.text,
        canonicalOccurrenceId: node.canonicalOccurrenceId,
        properties: [...node.properties].sort(([left], [right]) => left.localeCompare(right)),
        schemas: [...node.schemas].sort(([left], [right]) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    occurrences: [...state.occurrences]
      .map(([occurrenceId, occurrence]) => ({
        occurrenceId,
        nodeId: occurrence.nodeId,
        parentOccurrenceId: occurrence.parentOccurrenceId,
        presence: occurrence.presence,
      }))
      .sort((left, right) => left.occurrenceId.localeCompare(right.occurrenceId)),
  };
}

function decodeState(encoded: EncodedState): MaterializedState {
  return {
    nodes: new Map(
      encoded.nodes.map((node) => [
        node.nodeId,
        {
          presence: node.presence,
          text: node.text,
          canonicalOccurrenceId: node.canonicalOccurrenceId,
          properties: new Map(node.properties),
          schemas: new Map(node.schemas),
        },
      ]),
    ),
    occurrences: new Map(
      encoded.occurrences.map((occurrence) => [
        occurrence.occurrenceId,
        {
          nodeId: occurrence.nodeId,
          parentOccurrenceId: occurrence.parentOccurrenceId,
          presence: occurrence.presence,
        },
      ]),
    ),
  };
}

function assertCompactable(facts: Iterable<Fact>, causallyStable: boolean): void {
  if (!causallyStable) {
    throw new Error("compaction requires an externally established causal-stability frontier");
  }
  const all = [...facts];
  const resolutions = latestResolutions(all);
  const pending = all.find(
    (fact) =>
      fact.kind === "contribution" && fact.intent === "proposal" && !resolutions.has(fact.id),
  );
  if (pending?.kind === "contribution") {
    throw new Error(`cannot compact unresolved proposal ${pending.id}`);
  }
}

function isRetiredResolution(fact: Fact, retiredProposalIds: ReadonlySet<string>): boolean {
  return fact.kind === "resolution" && retiredProposalIds.has(fact.proposalId);
}

export class FactFirstAuthority {
  private generation = 0;
  private checkpoint = emptyState();
  private readonly facts = new Map<string, Fact>();
  private readonly retiredProposalIds = new Set<string>();
  private originCache = emptyState();
  private reviewCache = emptyState();
  private readonly mutableStats: AuthorityStats = {
    durableWrites: 0,
    projectionRebuilds: 0,
    materializations: 0,
  };

  constructor() {
    this.rebuild();
  }

  static hydrate(serialized: string): FactFirstAuthority {
    const encoded = JSON.parse(serialized) as SerializedFactFirst;
    if (encoded.kind !== "fact-first") throw new Error("not a fact-first snapshot");
    const model = new FactFirstAuthority();
    model.generation = encoded.generation;
    model.checkpoint = decodeState(encoded.checkpoint);
    model.facts.clear();
    for (const fact of encoded.facts) model.facts.set(fact.id, fact);
    model.retiredProposalIds.clear();
    for (const proposalId of encoded.retiredProposalIds) {
      model.retiredProposalIds.add(proposalId);
    }
    model.rebuild();
    model.mutableStats.durableWrites = 0;
    return model;
  }

  ingest(fact: Fact): void {
    if (this.facts.has(fact.id) || isRetiredResolution(fact, this.retiredProposalIds)) return;
    if (fact.kind === "contribution") decodeOperation(fact);
    this.facts.set(fact.id, fact);
    this.mutableStats.durableWrites += 1;
    if (fact.kind === "resolution") {
      this.rebuild();
      return;
    }
    if ((fact.supportIds?.length ?? 0) > 0) {
      this.rebuild();
      return;
    }
    if (
      fact.intent === "proposal" &&
      [...this.facts.values()].some(
        (candidate) =>
          candidate.kind === "contribution" && (candidate.supportIds ?? []).includes(fact.id),
      )
    ) {
      this.rebuild();
      return;
    }
    if (fact.intent === "direct") {
      applyContribution(this.originCache, fact);
      applyContribution(this.reviewCache, fact);
      return;
    }
    const decision = latestResolutions(this.facts.values()).get(fact.id)?.decision;
    if (decision === "accept") {
      applyContribution(this.originCache, fact);
      applyContribution(this.reviewCache, fact);
    } else if (decision !== "reject") {
      applyContribution(this.reviewCache, fact);
    }
  }

  ingestAll(facts: Iterable<Fact>): void {
    const incoming = [...facts];
    for (const fact of incoming) {
      if (fact.kind === "contribution") decodeOperation(fact);
    }
    let added = 0;
    for (const fact of incoming) {
      if (this.facts.has(fact.id) || isRetiredResolution(fact, this.retiredProposalIds)) continue;
      this.facts.set(fact.id, fact);
      added += 1;
    }
    this.mutableStats.durableWrites += added;
    if (added > 0) this.rebuild();
  }

  merge(other: FactFirstAuthority): void {
    this.ingestAll(other.facts.values());
  }

  origin(): MaterializedState {
    return cloneState(this.originCache);
  }

  review(): MaterializedState {
    return cloneState(this.reviewCache);
  }

  rebuildProjection(mode: ViewMode): MaterializedState {
    return project(this.checkpoint, this.facts.values(), mode);
  }

  compact(causallyStable: boolean): void {
    assertCompactable(this.facts.values(), causallyStable);
    const origin = this.rebuildProjection("origin");
    for (const fact of this.facts.values()) {
      if (fact.kind === "contribution" && fact.intent === "proposal") {
        this.retiredProposalIds.add(fact.id);
      }
    }
    this.checkpoint = origin;
    this.facts.clear();
    this.generation += 1;
    this.rebuild();
    this.mutableStats.durableWrites += 1;
  }

  serialize(): string {
    const encoded: SerializedFactFirst = {
      kind: "fact-first",
      generation: this.generation,
      checkpoint: encodeState(this.checkpoint),
      facts: [...this.facts.values()].sort(compareFacts),
      retiredProposalIds: [...this.retiredProposalIds].sort(),
    };
    return JSON.stringify(encoded);
  }

  exportSync(knownFactIds: ReadonlySet<string>): string {
    return JSON.stringify({
      generation: this.generation,
      facts: [...this.facts.values()]
        .filter((fact) => !knownFactIds.has(fact.id))
        .sort(compareFacts),
    });
  }

  factIds(): ReadonlySet<string> {
    return new Set(this.facts.keys());
  }

  stats(): AuthorityStats {
    return { ...this.mutableStats };
  }

  private rebuild(): void {
    this.originCache = project(this.checkpoint, this.facts.values(), "origin");
    this.reviewCache = project(this.checkpoint, this.facts.values(), "review");
    this.mutableStats.projectionRebuilds += 1;
  }
}

export class StateReviewAuthority {
  private generation = 0;
  private checkpoint = emptyState();
  private materializedOrigin = emptyState();
  private readonly facts = new Map<string, Fact>();
  private readonly retiredProposalIds = new Set<string>();
  private readonly materializedResolutionIds = new Set<string>();
  private readonly mutableStats: AuthorityStats = {
    durableWrites: 0,
    projectionRebuilds: 0,
    materializations: 0,
  };

  static hydrate(serialized: string): StateReviewAuthority {
    const encoded = JSON.parse(serialized) as SerializedHybrid;
    if (encoded.kind !== "state-review") throw new Error("not a state-review snapshot");
    const model = new StateReviewAuthority();
    model.generation = encoded.generation;
    model.checkpoint = decodeState(encoded.checkpoint);
    model.materializedOrigin = decodeState(encoded.materializedOrigin ?? encoded.checkpoint);
    for (const fact of encoded.facts) model.facts.set(fact.id, fact);
    for (const proposalId of encoded.retiredProposalIds) {
      model.retiredProposalIds.add(proposalId);
    }
    for (const resolutionId of encoded.materializedResolutionIds) {
      model.materializedResolutionIds.add(resolutionId);
    }
    return model;
  }

  ingest(fact: Fact, heal = true): void {
    if (this.facts.has(fact.id) || isRetiredResolution(fact, this.retiredProposalIds)) return;
    if (fact.kind === "contribution") decodeOperation(fact);
    this.facts.set(fact.id, fact);
    this.mutableStats.durableWrites += 1;
    if (fact.kind === "contribution" && fact.intent === "direct") {
      applyContribution(this.materializedOrigin, fact);
      this.mutableStats.durableWrites += 1;
    }
    if (
      heal &&
      (fact.kind === "resolution" ||
        (fact.kind === "contribution" &&
          ((fact.supportIds?.length ?? 0) > 0 ||
            (fact.intent === "proposal" && latestResolutions(this.facts.values()).has(fact.id)))))
    ) {
      this.healMaterializations();
    }
  }

  ingestAll(facts: Iterable<Fact>, heal = true): void {
    const incoming = [...facts];
    for (const fact of incoming) {
      if (fact.kind === "contribution") decodeOperation(fact);
    }
    let added = false;
    for (const fact of incoming) {
      if (this.facts.has(fact.id) || isRetiredResolution(fact, this.retiredProposalIds)) continue;
      this.facts.set(fact.id, fact);
      this.mutableStats.durableWrites += 1;
      if (fact.kind === "contribution" && fact.intent === "direct") {
        applyContribution(this.materializedOrigin, fact);
        this.mutableStats.durableWrites += 1;
      }
      added = true;
    }
    if (added && heal) this.healMaterializations();
  }

  merge(other: StateReviewAuthority): void {
    this.ingestAll(other.facts.values(), true);
  }

  origin(): MaterializedState {
    return cloneState(this.materializedOrigin);
  }

  review(): MaterializedState {
    this.mutableStats.projectionRebuilds += 1;
    return project(this.checkpoint, this.facts.values(), "review");
  }

  healMaterializations(): void {
    const desired = project(this.checkpoint, this.facts.values(), "origin");
    this.mutableStats.projectionRebuilds += 1;
    const changed = visibleStateJson(desired) !== visibleStateJson(this.materializedOrigin);
    this.materializedOrigin = desired;
    const resolutions = latestResolutions(this.facts.values());
    let newResolutionMarker = false;
    for (const resolution of resolutions.values()) {
      if (!this.materializedResolutionIds.has(resolution.id)) {
        this.materializedResolutionIds.add(resolution.id);
        newResolutionMarker = true;
      }
    }
    if (changed || newResolutionMarker) {
      this.mutableStats.materializations += 1;
      this.mutableStats.durableWrites += 1;
    }
  }

  compact(causallyStable: boolean): void {
    assertCompactable(this.facts.values(), causallyStable);
    this.healMaterializations();
    for (const fact of this.facts.values()) {
      if (fact.kind === "contribution" && fact.intent === "proposal") {
        this.retiredProposalIds.add(fact.id);
      }
    }
    this.checkpoint = cloneState(this.materializedOrigin);
    this.facts.clear();
    this.materializedResolutionIds.clear();
    this.generation += 1;
    this.mutableStats.durableWrites += 2;
  }

  serialize(): string {
    const materializedMatchesCheckpoint =
      visibleStateJson(this.materializedOrigin) === visibleStateJson(this.checkpoint);
    const encoded: SerializedHybrid = {
      kind: "state-review",
      generation: this.generation,
      checkpoint: encodeState(this.checkpoint),
      materializedOrigin: materializedMatchesCheckpoint
        ? undefined
        : encodeState(this.materializedOrigin),
      facts: [...this.facts.values()].sort(compareFacts),
      retiredProposalIds: [...this.retiredProposalIds].sort(),
      materializedResolutionIds: [...this.materializedResolutionIds].sort(),
    };
    return JSON.stringify(encoded);
  }

  exportSync(knownFactIds: ReadonlySet<string>): string {
    const reviewFacts = [...this.facts.values()]
      .filter((fact) => !knownFactIds.has(fact.id))
      .sort(compareFacts);
    const resolutions = latestResolutions(this.facts.values());
    const originUpdates = reviewFacts.filter(
      (fact) =>
        fact.kind === "contribution" &&
        (fact.intent === "direct" || resolutions.get(fact.id)?.decision === "accept"),
    );
    return JSON.stringify({
      generation: this.generation,
      originUpdates,
      reviewFacts,
      materializedResolutionIds: [...this.materializedResolutionIds].sort(),
    });
  }

  factIds(): ReadonlySet<string> {
    return new Set(this.facts.keys());
  }

  stats(): AuthorityStats {
    return { ...this.mutableStats };
  }
}

export function outlineFromOccurrence(
  state: MaterializedState,
  rootOccurrenceId: string,
  maxDepth = 8,
): string[] {
  const visible = visibleState(state);
  const nodes = new Map(visible.nodes.map((node) => [node.nodeId, node]));
  const occurrences = new Map(
    visible.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]),
  );
  const childrenByParent = new Map<string, VisibleOccurrence[]>();
  for (const occurrence of visible.occurrences) {
    if (occurrence.parentOccurrenceId === null) continue;
    const children = childrenByParent.get(occurrence.parentOccurrenceId) ?? [];
    children.push(occurrence);
    childrenByParent.set(occurrence.parentOccurrenceId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.occurrenceId.localeCompare(right.occurrenceId));
  }
  const lines: string[] = [];
  const visit = (occurrenceId: string, depth: number, nodePath: ReadonlySet<string>): void => {
    const occurrence = occurrences.get(occurrenceId);
    if (!occurrence) return;
    const node = nodes.get(occurrence.nodeId);
    if (!node) return;
    const prefix = "  ".repeat(depth);
    if (nodePath.has(node.nodeId)) {
      lines.push(`${prefix}↻ ${node.text} [${node.nodeId}]`);
      return;
    }
    lines.push(`${prefix}${node.text} [${node.nodeId}]`);
    if (depth >= maxDepth) {
      lines.push(`${prefix}  …`);
      return;
    }
    const nextPath = new Set(nodePath);
    nextPath.add(node.nodeId);
    const semanticParent = node.canonicalOccurrenceId ?? occurrenceId;
    for (const child of childrenByParent.get(semanticParent) ?? []) {
      visit(child.occurrenceId, depth + 1, nextPath);
    }
  };
  visit(rootOccurrenceId, 0, new Set());
  return lines;
}

export function contribution(
  id: string,
  counter: number,
  actor: string,
  intent: "direct" | "proposal",
  operation: DomainOperation | LegacyOperation,
  schemaVersion: 1 | 2 = 2,
  supportIds?: readonly string[],
): ContributionFact {
  return {
    kind: "contribution",
    id,
    stamp: { counter, actor },
    intent,
    schemaVersion,
    operation,
    supportIds,
  };
}

export function resolution(
  id: string,
  counter: number,
  actor: string,
  proposalId: string,
  decision: "accept" | "reject",
): ResolutionFact {
  return {
    kind: "resolution",
    id,
    stamp: { counter, actor },
    proposalId,
    decision,
  };
}
