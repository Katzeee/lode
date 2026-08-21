import {
  compareFacts,
  stableStringCompare,
  type AuthorityReceipt,
  type AuthorityRecord,
  type Fact,
  mutationRelations,
} from "../../../domain/fact/index.js";

export class AuthorityQueryIndex {
  private readonly factsById = new Map<string, Fact>();
  private readonly factIdsByScope = new Map<string, Set<string>>();
  private readonly factIdsByTransaction = new Map<string, Set<string>>();
  private readonly receiptsByChannel = new Map<string, AuthorityReceipt[]>();
  private readonly historyReceiptByInvocation = new Map<string, AuthorityReceipt>();
  private readonly historyInvocationIdsByFact = new Map<string, Set<string>>();
  private maximumLamportValue = 0;

  static build(facts: readonly Fact[], receipts: readonly AuthorityReceipt[]): AuthorityQueryIndex {
    const index = new AuthorityQueryIndex();
    facts.forEach((fact) => index.addFact(fact));
    receipts.forEach((receipt) => index.addReceipt(receipt));
    return index;
  }

  append(records: readonly AuthorityRecord[]): void {
    for (const record of records) {
      if (record.recordKind === "fact") {
        this.addFact(record.fact);
      } else if (record.recordKind === "receipt") {
        this.addReceipt(record.receipt);
      }
    }
  }

  maximumLamport(): number {
    return this.maximumLamportValue;
  }

  facts(factIds: readonly string[]): readonly Fact[] {
    return [...new Set(factIds)]
      .flatMap((factId) => {
        const fact = this.factsById.get(factId);
        return fact ? [fact] : [];
      })
      .sort(compareFacts);
  }

  relatedFacts(seedFactIds: readonly string[]): readonly Fact[] {
    const selected = new Set<string>();
    const queue = [...new Set(seedFactIds)];
    while (queue.length > 0) {
      const factId = queue.shift()!;
      if (selected.has(factId)) {
        continue;
      }
      const fact = this.factsById.get(factId);
      if (!fact) {
        continue;
      }
      selected.add(factId);
      for (const relatedId of this.factIdsByTransaction.get(fact.transaction.transactionId) ?? []) {
        if (!selected.has(relatedId)) {
          queue.push(relatedId);
        }
      }
      for (const key of scopeKeys(fact)) {
        for (const relatedId of this.factIdsByScope.get(key) ?? []) {
          if (!selected.has(relatedId)) {
            queue.push(relatedId);
          }
        }
      }
    }
    return this.facts([...selected]);
  }

  receiptsForChannel(channelId: string): readonly AuthorityReceipt[] {
    return [...(this.receiptsByChannel.get(channelId) ?? [])].sort(
      (left, right) =>
        (left.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) ||
        stableStringCompare(left.invocationId, right.invocationId),
    );
  }

  lastReceiptForChannel(channelId: string): AuthorityReceipt | null {
    return this.receiptsForChannel(channelId).at(-1) ?? null;
  }

  historyImpacts(nodeId: string): readonly Readonly<{ channelId: string; invocationId: string }>[] {
    const seedFactIds = [...(this.factIdsByScope.get(nodeKey(nodeId)) ?? [])];
    const relatedFactIds = this.relatedFacts(seedFactIds).map((fact) => fact.id);
    const invocationIds = new Set(
      relatedFactIds.flatMap((factId) => [...(this.historyInvocationIdsByFact.get(factId) ?? [])]),
    );
    return [...invocationIds]
      .flatMap((invocationId) => {
        const receipt = this.historyReceiptByInvocation.get(invocationId);
        return receipt?.lineage ? [{ channelId: receipt.lineage.channelId, invocationId: receipt.invocationId }] : [];
      })
      .sort(
        (left, right) =>
          stableStringCompare(left.channelId, right.channelId) ||
          stableStringCompare(left.invocationId, right.invocationId),
      );
  }

  private addFact(fact: Fact): void {
    if (this.factsById.has(fact.id)) {
      return;
    }
    this.factsById.set(fact.id, fact);
    const transactionFacts = this.factIdsByTransaction.get(fact.transaction.transactionId) ?? new Set<string>();
    transactionFacts.add(fact.id);
    this.factIdsByTransaction.set(fact.transaction.transactionId, transactionFacts);
    this.maximumLamportValue = Math.max(this.maximumLamportValue, fact.coordinate.lamport);
    for (const key of scopeKeys(fact)) {
      const values = this.factIdsByScope.get(key) ?? new Set<string>();
      values.add(fact.id);
      this.factIdsByScope.set(key, values);
    }
  }

  private addReceipt(receipt: AuthorityReceipt): void {
    const channelId = receipt.lineage?.channelId;
    if (!channelId) {
      return;
    }
    const receipts = this.receiptsByChannel.get(channelId) ?? [];
    if (!receipts.some((candidate) => candidate.invocationId === receipt.invocationId)) {
      receipts.push(receipt);
      this.receiptsByChannel.set(channelId, receipts);
      this.historyReceiptByInvocation.set(receipt.invocationId, receipt);
      for (const factId of receipt.factIds) {
        const invocationIds = this.historyInvocationIdsByFact.get(factId) ?? new Set<string>();
        invocationIds.add(receipt.invocationId);
        this.historyInvocationIdsByFact.set(factId, invocationIds);
      }
    }
  }
}

function scopeKeys(fact: Fact): readonly string[] {
  const keys = new Set<string>([factKey(fact.id)]);
  if (fact.body.kind === "resolution") {
    fact.body.proposalContributionIds.forEach((id) => keys.add(factKey(id)));
    fact.body.adjudicatesResolutionIds.forEach((id) => keys.add(factKey(id)));
  } else if (fact.body.kind === "maintenance") {
    if ("nodeId" in fact.body.action) {
      keys.add(nodeKey(fact.body.action.nodeId));
    }
    if ("deletionFactIds" in fact.body.action) {
      fact.body.action.deletionFactIds.forEach((id) => keys.add(factKey(id)));
    }
    if (fact.body.action.kind === "node-purge") {
      fact.body.action.acknowledgementFactIds.forEach((id) => keys.add(factKey(id)));
    }
  } else if (fact.body.kind === "governance") {
    // Governance Facts index under their actor only; they carry no content keys.
    keys.add(nodeKey(fact.body.actorId));
  } else {
    const relations = mutationRelations(fact.body.mutation);
    relations.nodeIds.forEach((id) => keys.add(nodeKey(id)));
    relations.occurrenceIds.forEach((id) => keys.add(occurrenceKey(id)));
    relations.factIds.forEach((id) => keys.add(factKey(id)));
    relations.inlineReferenceIds.forEach((id) => keys.add(inlineReferenceKey(id)));
  }
  return [...keys];
}

function factKey(id: string): string {
  return `fact/${id}`;
}

function nodeKey(id: string): string {
  return `node/${id}`;
}

function occurrenceKey(id: string): string {
  return `occurrence/${id}`;
}

function inlineReferenceKey(id: string): string {
  return `inline-reference/${id}`;
}
