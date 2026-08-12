import { createHash } from "node:crypto";

import { LoroDoc } from "loro-crdt";

import type { DocStore } from "../../packages/engine/src/core/store/doc-store.js";

const AUTHORITY_DOC_ID = "facts";

export type FactFrontier = Readonly<Record<string, number>>;

export type FactDot = Readonly<{
  replicaId: string;
  sequence: number;
}>;

export type LifecycleMutation =
  | Readonly<{ kind: "node-create"; nodeId: string }>
  | Readonly<{ kind: "node-delete"; nodeId: string }>
  | Readonly<{ kind: "node-restore"; nodeId: string; deletionFactId: string }>
  | Readonly<{ kind: "occurrence-create"; occurrenceId: string; nodeId: string }>
  | Readonly<{ kind: "occurrence-delete"; occurrenceId: string }>
  | Readonly<{
      kind: "occurrence-restore";
      occurrenceId: string;
      deletionFactId: string;
    }>;

export type FactBody =
  | Readonly<{
      kind: "contribution";
      actorId: string;
      intent: "direct" | "proposal";
      mutation: LifecycleMutation;
    }>
  | Readonly<{
      kind: "resolution";
      actorId: string;
      decision: "accept" | "reject";
      proposalContributionIds: readonly string[];
    }>;

export type Fact = Readonly<{
  formatGeneration: 1;
  schemaVersion: 1;
  workspaceId: string;
  id: string;
  coordinate: Readonly<{
    dot: FactDot;
    observed: FactFrontier;
    lamport: number;
  }>;
  body: FactBody;
  contentDigest: string;
}>;

export type InvocationReceipt = Readonly<{
  workspaceId: string;
  replicaId: string;
  invocationId: string;
  requestDigest: string;
  factIds: readonly string[];
  committedFrontier: FactFrontier;
}>;

type StoredRecord =
  | Readonly<{ recordKind: "fact"; fact: Fact }>
  | Readonly<{ recordKind: "receipt"; receipt: InvocationReceipt }>;

export type Admission = Readonly<{
  kind: "ready" | "pending" | "fault";
  facts: readonly Fact[];
  frontier: FactFrontier;
  pendingFactIds: readonly string[];
  fault: string | null;
}>;

export type LifecycleProjection = Readonly<{
  nodeIds: readonly string[];
  occurrenceIds: readonly string[];
}>;

export type CommandRequest = Readonly<{
  body: FactBody;
}>;

export class InvocationConflictError extends Error {}
export class ProjectionUnavailableError extends Error {}
export class AuthorityFaultError extends Error {}

export class WorkspaceAuthoritySpike {
  private doc: LoroDoc;
  private publishedFrontier: FactFrontier;
  private publishedProjection: LifecycleProjection;
  private authorityAdvanced = 0;

  private constructor(
    readonly workspaceId: string,
    readonly replicaId: string,
    private readonly peerId: `${number}`,
    private readonly store: DocStore,
    doc: LoroDoc,
  ) {
    this.doc = doc;
    const admission = this.admission();
    this.publishedFrontier = admission.kind === "fault" ? {} : admission.frontier;
    this.publishedProjection =
      admission.kind === "fault"
        ? { nodeIds: [], occurrenceIds: [] }
        : projectLifecycle(admission.facts);
  }

  static async open(input: {
    workspaceId: string;
    replicaId: string;
    peerId: `${number}`;
    store: DocStore;
  }): Promise<WorkspaceAuthoritySpike> {
    const doc = new LoroDoc();
    doc.setPeerId(input.peerId);
    const loaded = await input.store.load(AUTHORITY_DOC_ID);
    if (loaded?.snapshot) doc.import(loaded.snapshot);
    for (const update of loaded?.updates ?? []) doc.import(update);
    return new WorkspaceAuthoritySpike(
      input.workspaceId,
      input.replicaId,
      input.peerId,
      input.store,
      doc,
    );
  }

  admission(): Admission {
    return admit(this.workspaceId, readRecords(this.doc));
  }

  projection(): LifecycleProjection {
    const admission = this.admission();
    if (admission.kind === "fault") {
      throw new AuthorityFaultError(admission.fault ?? "Authority admission fault");
    }
    return projectLifecycle(admission.facts);
  }

  publishCurrent(): void {
    const admission = this.admission();
    if (admission.kind === "fault") {
      throw new AuthorityFaultError(admission.fault ?? "Authority admission fault");
    }
    this.publishedFrontier = admission.frontier;
    this.publishedProjection = projectLifecycle(admission.facts);
  }

  published(): FactFrontier {
    return this.publishedFrontier;
  }

  publishedView(): LifecycleProjection {
    return this.publishedProjection;
  }

  authorityAdvancedCount(): number {
    return this.authorityAdvanced;
  }

  outcome(invocationId: string): InvocationReceipt | null {
    const receipts = receiptsByInvocation(this.workspaceId, this.replicaId, readRecords(this.doc));
    return receipts.get(invocationId) ?? null;
  }

  async commitCommand(invocationId: string, request: CommandRequest): Promise<InvocationReceipt> {
    const requestDigest = digest(request);
    const existing = this.outcome(invocationId);
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new InvocationConflictError(`InvocationId request conflict: ${invocationId}`);
      }
      return existing;
    }

    const before = this.admission();
    if (before.kind === "fault") {
      throw new AuthorityFaultError(before.fault ?? "Authority admission fault");
    }
    if (!frontierEquals(before.frontier, this.publishedFrontier)) {
      throw new ProjectionUnavailableError(
        "A new state-dependent command requires a complete generation at the admitted frontier",
      );
    }

    const sequence = nextStoredSequence(readRecords(this.doc), this.workspaceId, this.replicaId);
    const lamport = maxObservedLamport(before.facts, before.frontier) + 1;
    const fact = makeFact({
      workspaceId: this.workspaceId,
      replicaId: this.replicaId,
      sequence,
      observed: before.frontier,
      lamport,
      body: request.body,
    });
    const committedFrontier = { ...before.frontier, [this.replicaId]: sequence };
    const receipt: InvocationReceipt = {
      workspaceId: this.workspaceId,
      replicaId: this.replicaId,
      invocationId,
      requestDigest,
      factIds: [fact.id],
      committedFrontier: normalizedFrontier(committedFrontier),
    };
    await this.appendRecords([
      { recordKind: "fact", fact },
      { recordKind: "receipt", receipt },
    ]);
    return receipt;
  }

  async appendTestRecords(records: readonly StoredRecord[]): Promise<void> {
    await this.appendRecords(records);
  }

  async importFrom(other: WorkspaceAuthoritySpike): Promise<void> {
    const update = other.doc.export({ mode: "update", from: this.doc.version() });
    const before = this.admission();
    const staged = this.doc.fork();
    staged.setPeerId(this.peerId);
    staged.import(update);
    await this.store.appendUpdate(AUTHORITY_DOC_ID, update);
    this.doc = staged;
    this.noteAdmissionAdvance(before, this.admission());
  }

  exportAll(): Uint8Array {
    return this.doc.export({ mode: "update" });
  }

  private async appendRecords(records: readonly StoredRecord[]): Promise<void> {
    const beforeAdmission = this.admission();
    const beforeVersion = this.doc.version();
    const staged = this.doc.fork();
    staged.setPeerId(this.peerId);
    const list = staged.getList<string>("authority-records");
    for (const record of records) list.push(canonicalJson(record));
    staged.commit({ message: "authority-records" });
    const update = staged.export({ mode: "update", from: beforeVersion });

    // Publication adopts the staged document only after the byte owner durably accepts the update.
    await this.store.appendUpdate(AUTHORITY_DOC_ID, update);
    this.doc = staged;
    this.noteAdmissionAdvance(beforeAdmission, this.admission());
  }

  private noteAdmissionAdvance(before: Admission, after: Admission): void {
    if (after.kind !== "fault" && !frontierEquals(before.frontier, after.frontier)) {
      this.authorityAdvanced += 1;
    }
  }
}

export function makeFact(input: {
  workspaceId: string;
  replicaId: string;
  sequence: number;
  observed: FactFrontier;
  lamport: number;
  body: FactBody;
}): Fact {
  const id = `g1/${input.workspaceId}/${input.replicaId}/${input.sequence}`;
  const unsigned = {
    formatGeneration: 1 as const,
    schemaVersion: 1 as const,
    workspaceId: input.workspaceId,
    id,
    coordinate: {
      dot: { replicaId: input.replicaId, sequence: input.sequence },
      observed: normalizedFrontier(input.observed),
      lamport: input.lamport,
    },
    body: input.body,
  };
  return { ...unsigned, contentDigest: digest(unsigned) };
}

export function factRecord(fact: Fact): StoredRecord {
  return { recordKind: "fact", fact };
}

export function receiptRecord(receipt: InvocationReceipt): StoredRecord {
  return { recordKind: "receipt", receipt };
}

export function requestDigest(request: CommandRequest): string {
  return digest(request);
}

export function winningResolution(
  facts: readonly Fact[],
  proposalContributionId: string,
): Extract<FactBody, { kind: "resolution" }> | null {
  const candidates = facts.filter(
    (fact) =>
      fact.body.kind === "resolution" &&
      fact.body.proposalContributionIds.includes(proposalContributionId),
  );
  candidates.sort(compareFacts);
  const winner = candidates.at(-1);
  return winner?.body.kind === "resolution" ? winner.body : null;
}

export function deriveSupportEdges(facts: readonly Fact[]): ReadonlyMap<string, readonly string[]> {
  const nodeCreators = new Map<string, string>();
  const result = new Map<string, readonly string[]>();
  for (const fact of [...facts].sort(compareFacts)) {
    if (fact.body.kind !== "contribution") continue;
    const mutation = fact.body.mutation;
    if (mutation.kind === "node-create") nodeCreators.set(mutation.nodeId, fact.id);
    if (mutation.kind === "occurrence-create") {
      const creator = nodeCreators.get(mutation.nodeId);
      result.set(fact.id, creator ? [creator] : []);
    } else {
      result.set(fact.id, []);
    }
  }
  return result;
}

function admit(workspaceId: string, records: readonly StoredRecord[]): Admission {
  try {
    validateReceipts(workspaceId, records);
    const candidates = collectFacts(workspaceId, records);
    const admitted: Fact[] = [];
    const admittedIds = new Set<string>();
    const frontier: Record<string, number> = {};
    let progressed = true;
    while (progressed) {
      progressed = false;
      const ordered = [...candidates.values()].sort(compareFacts);
      for (const fact of ordered) {
        if (admittedIds.has(fact.id)) continue;
        const { replicaId, sequence } = fact.coordinate.dot;
        if (sequence !== (frontier[replicaId] ?? 0) + 1) continue;
        if (!frontierCovers(frontier, fact.coordinate.observed)) continue;
        validateAdmissibleFact(fact, admitted);
        admitted.push(fact);
        admittedIds.add(fact.id);
        frontier[replicaId] = sequence;
        progressed = true;
      }
    }
    admitted.sort(compareFacts);
    const pendingFactIds = [...candidates.keys()]
      .filter((id) => !admittedIds.has(id))
      .sort(stableStringCompare);
    return {
      kind: pendingFactIds.length === 0 ? "ready" : "pending",
      facts: admitted,
      frontier: normalizedFrontier(frontier),
      pendingFactIds,
      fault: null,
    };
  } catch (error) {
    return {
      kind: "fault",
      facts: [],
      frontier: {},
      pendingFactIds: [],
      fault: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectFacts(workspaceId: string, records: readonly StoredRecord[]): Map<string, Fact> {
  const facts = new Map<string, { canonical: string; fact: Fact }>();
  for (const record of records) {
    if (record.recordKind !== "fact") continue;
    validateStaticFact(workspaceId, record.fact);
    const canonical = canonicalJson(record.fact);
    const existing = facts.get(record.fact.id);
    if (existing && existing.canonical !== canonical) {
      throw new Error(`FactId content conflict: ${record.fact.id}`);
    }
    facts.set(record.fact.id, { canonical, fact: record.fact });
  }
  return new Map([...facts].map(([id, value]) => [id, value.fact]));
}

function validateStaticFact(workspaceId: string, fact: Fact): void {
  const { contentDigest, ...unsigned } = fact;
  const { replicaId, sequence } = fact.coordinate.dot;
  if (fact.workspaceId !== workspaceId) throw new Error(`Foreign workspace Fact: ${fact.id}`);
  if (fact.id !== `g1/${workspaceId}/${replicaId}/${sequence}`) {
    throw new Error(`FactId/dot/workspace mismatch: ${fact.id}`);
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`Invalid Fact sequence: ${fact.id}`);
  }
  if (contentDigest !== digest(unsigned)) throw new Error(`Fact digest mismatch: ${fact.id}`);
  for (const [observedReplica, observedSequence] of Object.entries(fact.coordinate.observed)) {
    if (!Number.isSafeInteger(observedSequence) || observedSequence < 0) {
      throw new Error(`Invalid observed frontier: ${fact.id}`);
    }
    if (observedReplica === replicaId && observedSequence >= sequence) {
      throw new Error(`Fact observes itself or its future: ${fact.id}`);
    }
  }
}

function validateAdmissibleFact(fact: Fact, admitted: readonly Fact[]): void {
  const expectedLamport = maxObservedLamport(admitted, fact.coordinate.observed) + 1;
  if (fact.coordinate.lamport !== expectedLamport) {
    throw new Error(`Invalid Lamport rank: ${fact.id}`);
  }
  if (fact.body.kind === "resolution") {
    for (const target of fact.body.proposalContributionIds) {
      const observedResolution = admitted.find(
        (candidate) =>
          candidate.body.kind === "resolution" &&
          candidate.body.proposalContributionIds.includes(target) &&
          dotIncluded(fact.coordinate.observed, candidate.coordinate.dot),
      );
      if (observedResolution) {
        throw new Error(`Resolution observes a terminal decision for ${target}`);
      }
    }
  }
  if (fact.body.kind === "contribution") {
    const mutation = fact.body.mutation;
    if (mutation.kind === "node-restore" || mutation.kind === "occurrence-restore") {
      const deletion = admitted.find(({ id }) => id === mutation.deletionFactId);
      const expectedKind = mutation.kind === "node-restore" ? "node-delete" : "occurrence-delete";
      if (
        !deletion ||
        deletion.body.kind !== "contribution" ||
        deletion.body.mutation.kind !== expectedKind ||
        !dotIncluded(fact.coordinate.observed, deletion.coordinate.dot)
      ) {
        throw new Error(`Restore does not observe its deletion: ${fact.id}`);
      }
    }
  }
}

function projectLifecycle(facts: readonly Fact[]): LifecycleProjection {
  const nodeCreates = new Map<string, Fact>();
  const nodeDeletes = new Map<string, Fact[]>();
  const restoredNodeDeletes = new Set<string>();
  const occurrenceCreates = new Map<string, Fact>();
  const occurrenceDeletes = new Map<string, Fact[]>();
  const restoredOccurrenceDeletes = new Set<string>();

  for (const fact of [...facts].sort(compareFacts)) {
    if (fact.body.kind !== "contribution") continue;
    const mutation = fact.body.mutation;
    switch (mutation.kind) {
      case "node-create":
        if (nodeCreates.has(mutation.nodeId)) {
          throw new Error(`Node identity created twice: ${mutation.nodeId}`);
        }
        nodeCreates.set(mutation.nodeId, fact);
        break;
      case "node-delete":
        nodeDeletes.set(mutation.nodeId, [...(nodeDeletes.get(mutation.nodeId) ?? []), fact]);
        break;
      case "node-restore":
        restoredNodeDeletes.add(mutation.deletionFactId);
        break;
      case "occurrence-create":
        if (occurrenceCreates.has(mutation.occurrenceId)) {
          throw new Error(`Occurrence identity created twice: ${mutation.occurrenceId}`);
        }
        occurrenceCreates.set(mutation.occurrenceId, fact);
        break;
      case "occurrence-delete":
        occurrenceDeletes.set(mutation.occurrenceId, [
          ...(occurrenceDeletes.get(mutation.occurrenceId) ?? []),
          fact,
        ]);
        break;
      case "occurrence-restore":
        restoredOccurrenceDeletes.add(mutation.deletionFactId);
        break;
    }
  }

  const activeNodes = [...nodeCreates.keys()].filter((nodeId) =>
    (nodeDeletes.get(nodeId) ?? []).every((fact) => restoredNodeDeletes.has(fact.id)),
  );
  const activeNodeSet = new Set(activeNodes);
  const activeOccurrences = [...occurrenceCreates]
    .filter(([, fact]) => {
      if (fact.body.kind !== "contribution" || fact.body.mutation.kind !== "occurrence-create") {
        return false;
      }
      return (
        activeNodeSet.has(fact.body.mutation.nodeId) &&
        (occurrenceDeletes.get(fact.body.mutation.occurrenceId) ?? []).every((deletion) =>
          restoredOccurrenceDeletes.has(deletion.id),
        )
      );
    })
    .map(([occurrenceId]) => occurrenceId);
  return {
    nodeIds: activeNodes.sort(stableStringCompare),
    occurrenceIds: activeOccurrences.sort(stableStringCompare),
  };
}

function validateReceipts(workspaceId: string, records: readonly StoredRecord[]): void {
  const seen = new Map<string, string>();
  for (const record of records) {
    if (record.recordKind !== "receipt") continue;
    const receipt = record.receipt;
    if (receipt.workspaceId !== workspaceId) {
      throw new Error(`Foreign workspace receipt: ${receipt.invocationId}`);
    }
    const key = `${receipt.replicaId}\u0000${receipt.invocationId}`;
    const canonical = canonicalJson(receipt);
    const existing = seen.get(key);
    if (existing && existing !== canonical) {
      throw new Error(`Invocation receipt conflict: ${receipt.invocationId}`);
    }
    seen.set(key, canonical);
  }
}

function receiptsByInvocation(
  workspaceId: string,
  replicaId: string,
  records: readonly StoredRecord[],
): Map<string, InvocationReceipt> {
  validateReceipts(workspaceId, records);
  const result = new Map<string, InvocationReceipt>();
  for (const record of records) {
    if (record.recordKind === "receipt" && record.receipt.replicaId === replicaId) {
      result.set(record.receipt.invocationId, record.receipt);
    }
  }
  return result;
}

function readRecords(doc: LoroDoc): StoredRecord[] {
  return doc
    .getList("authority-records")
    .toArray()
    .map((raw) => {
      if (typeof raw !== "string") throw new Error("Authority record is not canonical JSON text");
      return JSON.parse(raw) as StoredRecord;
    });
}

function nextStoredSequence(
  records: readonly StoredRecord[],
  workspaceId: string,
  replicaId: string,
): number {
  let maximum = 0;
  for (const record of records) {
    if (
      record.recordKind === "fact" &&
      record.fact.workspaceId === workspaceId &&
      record.fact.coordinate.dot.replicaId === replicaId
    ) {
      maximum = Math.max(maximum, record.fact.coordinate.dot.sequence);
    }
  }
  return maximum + 1;
}

function maxObservedLamport(facts: readonly Fact[], frontier: FactFrontier): number {
  let maximum = 0;
  for (const fact of facts) {
    if (dotIncluded(frontier, fact.coordinate.dot)) {
      maximum = Math.max(maximum, fact.coordinate.lamport);
    }
  }
  return maximum;
}

function compareFacts(left: Fact, right: Fact): number {
  return (
    left.coordinate.lamport - right.coordinate.lamport ||
    stableStringCompare(left.coordinate.dot.replicaId, right.coordinate.dot.replicaId) ||
    left.coordinate.dot.sequence - right.coordinate.dot.sequence
  );
}

function frontierCovers(have: FactFrontier, required: FactFrontier): boolean {
  return Object.entries(required).every(
    ([replicaId, sequence]) => (have[replicaId] ?? 0) >= sequence,
  );
}

function dotIncluded(frontier: FactFrontier, dot: FactDot): boolean {
  return (frontier[dot.replicaId] ?? 0) >= dot.sequence;
}

function frontierEquals(left: FactFrontier, right: FactFrontier): boolean {
  return canonicalJson(normalizedFrontier(left)) === canonicalJson(normalizedFrontier(right));
}

function normalizedFrontier(frontier: FactFrontier): FactFrontier {
  return Object.fromEntries(
    Object.entries(frontier)
      .filter(([, sequence]) => sequence > 0)
      .sort(([left], [right]) => stableStringCompare(left, right)),
  );
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
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => stableStringCompare(left, right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
}

function stableStringCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
