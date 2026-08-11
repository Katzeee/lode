import { createHash } from "node:crypto";

import { LoroDoc } from "loro-crdt";

export type FactFrontier = Readonly<Record<string, number>>;

export type FactDot = Readonly<{
  replicaId: string;
  sequence: number;
}>;

export type CausalCoordinate = Readonly<{
  dot: FactDot;
  observed: FactFrontier;
  lamport: number;
}>;

export type TextAtomId = `${string}#${number}`;

export type SequenceAnchor = Readonly<{
  after: string | null;
  before: string | null;
  affinity: "after" | "before";
  fallback: "start" | "end";
}>;

export type Mutation =
  | Readonly<{ kind: "node-create"; nodeId: string }>
  | Readonly<{ kind: "node-delete"; nodeId: string }>
  | Readonly<{
      kind: "occurrence-create";
      occurrenceId: string;
      nodeId: string;
      parentOccurrenceId: string | null;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "occurrence-move";
      occurrenceId: string;
      parentOccurrenceId: string | null;
      anchor: SequenceAnchor;
    }>
  | Readonly<{ kind: "occurrence-delete"; occurrenceId: string }>
  | Readonly<{
      kind: "canonical-occurrence-set";
      nodeId: string;
      occurrenceId: string;
    }>
  | Readonly<{
      kind: "text-splice";
      nodeId: string;
      deleteAtomIds: readonly TextAtomId[];
      anchor: SequenceAnchor;
      insert: string;
      attributes?: Readonly<Record<string, JsonValue>>;
    }>
  | Readonly<{
      kind: "text-mark";
      nodeId: string;
      atomIds: readonly TextAtomId[];
      key: string;
      value: JsonValue | null;
    }>
  | Readonly<{
      kind: "value-set";
      owner: Readonly<{ kind: "node" | "occurrence"; id: string }>;
      namespace: "property" | "metadata";
      key: string;
      value: JsonValue;
    }>
  | Readonly<{
      kind: "value-unset";
      owner: Readonly<{ kind: "node" | "occurrence"; id: string }>;
      namespace: "property" | "metadata";
      key: string;
    }>;

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export type ContributionFact = Readonly<{
  formatGeneration: 1;
  schemaVersion: 1;
  kind: "contribution";
  id: string;
  coordinate: CausalCoordinate;
  actorId: string;
  intent: "direct" | "proposal";
  dependencies: readonly string[];
  mutation: Mutation;
  contentDigest: string;
}>;

export type InvocationReceipt = Readonly<{
  replicaId: string;
  invocationId: string;
  factIds: readonly string[];
  committedFrontier: FactFrontier;
}>;

type UnsignedFact = Omit<ContributionFact, "contentDigest">;

type StoredRecord =
  | Readonly<{ recordKind: "fact"; fact: ContributionFact }>
  | Readonly<{ recordKind: "receipt"; receipt: InvocationReceipt }>;

export type FactSnapshot = Readonly<{
  facts: readonly ContributionFact[];
  frontier: FactFrontier;
}>;

export function makeContribution(input: {
  replicaId: string;
  sequence: number;
  observed: FactFrontier;
  lamport: number;
  actorId?: string;
  intent?: "direct" | "proposal";
  dependencies?: readonly string[];
  mutation: Mutation;
}): ContributionFact {
  const id = `g1/${input.replicaId}/${input.sequence}`;
  const unsigned: UnsignedFact = {
    formatGeneration: 1,
    schemaVersion: 1,
    kind: "contribution",
    id,
    coordinate: {
      dot: { replicaId: input.replicaId, sequence: input.sequence },
      observed: input.observed,
      lamport: input.lamport,
    },
    actorId: input.actorId ?? input.replicaId,
    intent: input.intent ?? "direct",
    dependencies: input.dependencies ?? [],
    mutation: input.mutation,
  };
  return { ...unsigned, contentDigest: digest(unsigned) };
}

export class LoroFactStoreSpike {
  readonly doc: LoroDoc;

  constructor(peerId: `${number}`, doc = new LoroDoc()) {
    this.doc = doc;
    this.doc.setPeerId(peerId);
  }

  appendAuthorityCommit(facts: readonly ContributionFact[], receipt: InvocationReceipt): void {
    const records = this.doc.getList<string>("authority-records");
    for (const fact of facts) {
      records.push(canonicalJson({ recordKind: "fact", fact } satisfies StoredRecord));
    }
    records.push(canonicalJson({ recordKind: "receipt", receipt } satisfies StoredRecord));
    this.doc.commit({ message: "authority-commit" });
  }

  appendReceiptOnly(receipt: InvocationReceipt): void {
    const records = this.doc.getList<string>("authority-records");
    records.push(canonicalJson({ recordKind: "receipt", receipt } satisfies StoredRecord));
    this.doc.commit({ message: "invocation-receipt" });
  }

  importAll(other: LoroDoc): void {
    this.doc.import(other.export({ mode: "update" }));
  }

  snapshot(): FactSnapshot {
    const byId = new Map<string, { canonical: string; fact: ContributionFact }>();
    for (const raw of this.doc.getList("authority-records").toArray()) {
      if (typeof raw !== "string") {
        throw new Error("Authority record is not canonical JSON text");
      }
      const record = JSON.parse(raw) as StoredRecord;
      if (record.recordKind !== "fact") {
        continue;
      }
      validateFact(record.fact);
      const canonical = canonicalJson(record.fact);
      const existing = byId.get(record.fact.id);
      if (existing && existing.canonical !== canonical) {
        throw new Error(`FactId content conflict: ${record.fact.id}`);
      }
      byId.set(record.fact.id, { canonical, fact: record.fact });
    }
    const facts = [...byId.values()].map(({ fact }) => fact);
    validateCausality(facts);
    facts.sort(compareFacts);
    return { facts, frontier: frontierOf(facts) };
  }
}

export type Projection = Readonly<{
  nodeIds: readonly string[];
  text: Readonly<Record<string, readonly TextAtom[]>>;
  occurrences: Readonly<Record<string, OccurrenceState>>;
  children: Readonly<Record<string, readonly string[]>>;
  canonicalOccurrences: Readonly<Record<string, string>>;
  values: Readonly<Record<string, JsonValue>>;
}>;

export type TextAtom = Readonly<{
  id: TextAtomId;
  value: string;
  attributes: Readonly<Record<string, JsonValue>>;
}>;

type OccurrenceState = Readonly<{
  nodeId: string;
  parentOccurrenceId: string | null;
}>;

export type ProjectionCheckpoint = Readonly<{
  frontier: FactFrontier;
  orderedFacts: readonly ContributionFact[];
  projection: Projection;
}>;

export function rebuild(facts: readonly ContributionFact[]): Projection {
  const ordered = [...facts].sort(compareFacts);
  const nodes = new Set<string>();
  const deletedNodes = new Set<string>();
  const text = new Map<string, TextAtom[]>();
  const occurrences = new Map<string, OccurrenceState>();
  const deletedOccurrences = new Set<string>();
  const children = new Map<string, string[]>();
  const canonicals = new Map<string, string>();
  const values = new Map<string, JsonValue>();

  const childKey = (parent: string | null): string => parent ?? "$root";
  const listFor = (parent: string | null): string[] => {
    const key = childKey(parent);
    const found = children.get(key);
    if (found) return found;
    const created: string[] = [];
    children.set(key, created);
    return created;
  };
  const removePlacement = (occurrenceId: string): void => {
    for (const list of children.values()) {
      const index = list.indexOf(occurrenceId);
      if (index >= 0) list.splice(index, 1);
    }
  };
  const createsCycle = (occurrenceId: string, parent: string | null): boolean => {
    let cursor = parent;
    while (cursor) {
      if (cursor === occurrenceId) return true;
      cursor = occurrences.get(cursor)?.parentOccurrenceId ?? null;
    }
    return false;
  };

  for (const fact of ordered) {
    const mutation = fact.mutation;
    switch (mutation.kind) {
      case "node-create":
        if (!deletedNodes.has(mutation.nodeId)) {
          nodes.add(mutation.nodeId);
          if (!text.has(mutation.nodeId)) text.set(mutation.nodeId, []);
        }
        break;
      case "node-delete":
        deletedNodes.add(mutation.nodeId);
        nodes.delete(mutation.nodeId);
        break;
      case "occurrence-create":
        if (
          nodes.has(mutation.nodeId) &&
          !deletedOccurrences.has(mutation.occurrenceId) &&
          !occurrences.has(mutation.occurrenceId)
        ) {
          occurrences.set(mutation.occurrenceId, {
            nodeId: mutation.nodeId,
            parentOccurrenceId: mutation.parentOccurrenceId,
          });
          insertAtAnchor(
            listFor(mutation.parentOccurrenceId),
            mutation.occurrenceId,
            mutation.anchor,
          );
        }
        break;
      case "occurrence-move": {
        const existing = occurrences.get(mutation.occurrenceId);
        if (
          existing &&
          !deletedOccurrences.has(mutation.occurrenceId) &&
          !createsCycle(mutation.occurrenceId, mutation.parentOccurrenceId)
        ) {
          removePlacement(mutation.occurrenceId);
          occurrences.set(mutation.occurrenceId, {
            ...existing,
            parentOccurrenceId: mutation.parentOccurrenceId,
          });
          insertAtAnchor(
            listFor(mutation.parentOccurrenceId),
            mutation.occurrenceId,
            mutation.anchor,
          );
        }
        break;
      }
      case "occurrence-delete":
        deletedOccurrences.add(mutation.occurrenceId);
        removePlacement(mutation.occurrenceId);
        occurrences.delete(mutation.occurrenceId);
        break;
      case "canonical-occurrence-set":
        if (occurrences.get(mutation.occurrenceId)?.nodeId === mutation.nodeId) {
          canonicals.set(mutation.nodeId, mutation.occurrenceId);
        }
        break;
      case "text-splice": {
        const atoms = text.get(mutation.nodeId);
        if (!atoms || !nodes.has(mutation.nodeId)) break;
        if (!isWellFormedUnicode(mutation.insert)) {
          throw new Error(`Text mutation contains an unpaired surrogate: ${fact.id}`);
        }
        const deleted = new Set(mutation.deleteAtomIds);
        for (let index = atoms.length - 1; index >= 0; index -= 1) {
          if (deleted.has(atoms[index]!.id)) atoms.splice(index, 1);
        }
        const newAtoms = [...mutation.insert].map((value, index): TextAtom => ({
          id: `${fact.id}#${index}`,
          value,
          attributes: mutation.attributes ?? {},
        }));
        insertManyAtAnchor(atoms, newAtoms, mutation.anchor, (atom) => atom.id);
        break;
      }
      case "text-mark": {
        const atoms = text.get(mutation.nodeId);
        if (!atoms || !nodes.has(mutation.nodeId)) break;
        const targets = new Set(mutation.atomIds);
        for (let index = 0; index < atoms.length; index += 1) {
          const atom = atoms[index]!;
          if (!targets.has(atom.id)) continue;
          const attributes = { ...atom.attributes };
          if (mutation.value === null) delete attributes[mutation.key];
          else attributes[mutation.key] = mutation.value;
          atoms[index] = { ...atom, attributes };
        }
        break;
      }
      case "value-set":
        values.set(valueAddress(mutation), mutation.value);
        break;
      case "value-unset":
        values.delete(valueAddress(mutation));
        break;
    }
  }

  const liveOccurrences = [...occurrences.entries()].filter(([, occurrence]) =>
    nodes.has(occurrence.nodeId),
  );
  return {
    nodeIds: [...nodes].sort(stableStringCompare),
    text: Object.fromEntries(
      [...text.entries()]
        .filter(([id]) => nodes.has(id))
        .sort(([a], [b]) => stableStringCompare(a, b)),
    ),
    occurrences: Object.fromEntries(liveOccurrences.sort(([a], [b]) => stableStringCompare(a, b))),
    children: Object.fromEntries(
      [...children.entries()]
        .map(([key, ids]) => [key, ids.filter((id) => occurrences.has(id))] as const)
        .filter(([, ids]) => ids.length > 0)
        .sort(([a], [b]) => stableStringCompare(a, b)),
    ),
    canonicalOccurrences: Object.fromEntries(
      [...canonicals.entries()].sort(([a], [b]) => stableStringCompare(a, b)),
    ),
    values: Object.fromEntries([...values.entries()].sort(([a], [b]) => stableStringCompare(a, b))),
  };
}

export function checkpoint(snapshot: FactSnapshot): ProjectionCheckpoint {
  return {
    frontier: snapshot.frontier,
    orderedFacts: snapshot.facts,
    projection: rebuild(snapshot.facts),
  };
}

export function advance(
  base: ProjectionCheckpoint,
  nextSnapshot: FactSnapshot,
): ProjectionCheckpoint {
  for (const [replicaId, sequence] of Object.entries(base.frontier)) {
    if ((nextSnapshot.frontier[replicaId] ?? 0) < sequence) {
      throw new Error("Checkpoint frontier is not contained in the next snapshot");
    }
  }
  const known = new Set(base.orderedFacts.map((fact) => fact.id));
  const orderedFacts = [
    ...base.orderedFacts,
    ...nextSnapshot.facts.filter((fact) => !known.has(fact.id)),
  ].sort(compareFacts);
  return {
    frontier: nextSnapshot.frontier,
    orderedFacts,
    projection: rebuild(orderedFacts),
  };
}

export function materializeWithLoro(projection: Projection): unknown {
  const doc = new LoroDoc();
  doc.setPeerId("9001");
  doc.configTextStyle({ bold: { expand: "none" }, italic: { expand: "none" } });

  for (const nodeId of projection.nodeIds) {
    const richText = doc.getText(`text:${nodeId}`);
    const atoms = projection.text[nodeId] ?? [];
    let offset = 0;
    for (const atom of atoms) {
      richText.insert(offset, atom.value);
      const end = offset + atom.value.length;
      for (const [key, value] of Object.entries(atom.attributes)) {
        richText.mark({ start: offset, end }, key, value);
      }
      offset = end;
    }
  }

  const tree = doc.getTree("occurrences");
  const materialized = new Map<string, ReturnType<typeof tree.createNode>>();
  const appendChildren = (parentOccurrenceId: string | null): void => {
    const key = parentOccurrenceId ?? "$root";
    for (const occurrenceId of projection.children[key] ?? []) {
      const parent = parentOccurrenceId ? materialized.get(parentOccurrenceId)?.id : undefined;
      if (parentOccurrenceId && !parent) continue;
      const node = tree.createNode(parent);
      node.data.set("occurrenceId", occurrenceId);
      node.data.set("nodeId", projection.occurrences[occurrenceId]!.nodeId);
      materialized.set(occurrenceId, node);
      appendChildren(occurrenceId);
    }
  };
  appendChildren(null);

  const values = doc.getMap("values");
  for (const [key, value] of Object.entries(projection.values)) {
    values.set(key, value as never);
  }
  doc.commit({ message: "derived-projection" });
  return doc.toJSON();
}

export function compareFacts(left: ContributionFact, right: ContributionFact): number {
  return (
    left.coordinate.lamport - right.coordinate.lamport ||
    stableStringCompare(left.coordinate.dot.replicaId, right.coordinate.dot.replicaId) ||
    left.coordinate.dot.sequence - right.coordinate.dot.sequence
  );
}

function validateFact(fact: ContributionFact): void {
  const { contentDigest: actual, ...unsigned } = fact;
  if (fact.id !== `g1/${fact.coordinate.dot.replicaId}/${fact.coordinate.dot.sequence}`) {
    throw new Error(`FactId/dot mismatch: ${fact.id}`);
  }
  if (actual !== digest(unsigned)) {
    throw new Error(`Fact digest mismatch: ${fact.id}`);
  }
}

function validateCausality(facts: readonly ContributionFact[]): void {
  const byReplica = new Map<string, Map<number, ContributionFact>>();
  for (const fact of facts) {
    const { replicaId, sequence } = fact.coordinate.dot;
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error(`Invalid fact sequence: ${fact.id}`);
    }
    const replicaFacts = byReplica.get(replicaId) ?? new Map<number, ContributionFact>();
    replicaFacts.set(sequence, fact);
    byReplica.set(replicaId, replicaFacts);
  }
  for (const [replicaId, replicaFacts] of byReplica) {
    const max = Math.max(...replicaFacts.keys());
    for (let sequence = 1; sequence <= max; sequence += 1) {
      if (!replicaFacts.has(sequence)) {
        throw new Error(`Fact sequence gap: ${replicaId}/${sequence}`);
      }
    }
  }
  for (const fact of facts) {
    let maxObservedLamport = 0;
    for (const [replicaId, sequence] of Object.entries(fact.coordinate.observed)) {
      if (!Number.isSafeInteger(sequence) || sequence < 0) {
        throw new Error(`Invalid observed frontier: ${fact.id}`);
      }
      if (replicaId === fact.coordinate.dot.replicaId && sequence >= fact.coordinate.dot.sequence) {
        throw new Error(`Fact observes itself or its future: ${fact.id}`);
      }
      for (let counter = 1; counter <= sequence; counter += 1) {
        const observed = byReplica.get(replicaId)?.get(counter);
        if (!observed) throw new Error(`Missing causal predecessor: ${replicaId}/${counter}`);
        maxObservedLamport = Math.max(maxObservedLamport, observed.coordinate.lamport);
      }
    }
    if (fact.coordinate.lamport !== maxObservedLamport + 1) {
      throw new Error(`Invalid Lamport rank: ${fact.id}`);
    }
  }
}

function frontierOf(facts: readonly ContributionFact[]): FactFrontier {
  const frontier: Record<string, number> = {};
  for (const fact of facts) {
    const { replicaId, sequence } = fact.coordinate.dot;
    frontier[replicaId] = Math.max(frontier[replicaId] ?? 0, sequence);
  }
  return Object.fromEntries(Object.entries(frontier).sort(([a], [b]) => stableStringCompare(a, b)));
}

function insertAtAnchor(list: string[], id: string, anchor: SequenceAnchor): void {
  insertManyAtAnchor(list, [id], anchor, (value) => value);
}

function insertManyAtAnchor<T>(
  list: T[],
  inserted: readonly T[],
  anchor: SequenceAnchor,
  idOf: (value: T) => string,
): void {
  const afterIndex =
    anchor.after === null ? -1 : list.findIndex((value) => idOf(value) === anchor.after);
  const beforeIndex =
    anchor.before === null ? -1 : list.findIndex((value) => idOf(value) === anchor.before);
  let index: number;
  if (afterIndex >= 0 && beforeIndex >= 0 && afterIndex < beforeIndex) {
    index = anchor.affinity === "after" ? afterIndex + 1 : beforeIndex;
  } else if (afterIndex >= 0) {
    index = afterIndex + 1;
  } else if (beforeIndex >= 0) {
    index = beforeIndex;
  } else {
    index = anchor.fallback === "start" ? 0 : list.length;
  }
  list.splice(index, 0, ...inserted);
}

function valueAddress(mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>): string {
  return `${mutation.owner.kind}/${mutation.owner.id}/${mutation.namespace}/${mutation.key}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON rejects non-finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => stableStringCompare(a, b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
}

function stableStringCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}
