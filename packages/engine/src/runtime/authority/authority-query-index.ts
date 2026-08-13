import {
  compareFacts,
  stableStringCompare,
  type AuthorityReceipt,
  type AuthorityRecord,
  type Fact,
  type Mutation,
  TEMPLATE_INSTANCE_NODE_PREFIX,
  type TextAtomId,
} from "../../domain/fact/index.js";

export class AuthorityQueryIndex {
  private readonly factsById = new Map<string, Fact>();
  private readonly factIdsByScope = new Map<string, Set<string>>();
  private readonly factIdsByTransaction = new Map<string, Set<string>>();
  private readonly receiptsByChannel = new Map<string, AuthorityReceipt[]>();
  private readonly historyReceiptByInvocation = new Map<string, AuthorityReceipt>();
  private readonly historyInvocationIdsByFact = new Map<string, Set<string>>();
  private readonly occurrenceNodes = new Map<string, string>();
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
        (left.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) -
          (right.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) ||
        stableStringCompare(left.invocationId, right.invocationId),
    );
  }

  lastReceiptForChannel(channelId: string): AuthorityReceipt | null {
    return this.receiptsForChannel(channelId).at(-1) ?? null;
  }

  occurrenceNodeId(occurrenceId: string): string | null {
    return this.occurrenceNodes.get(occurrenceId) ?? null;
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
        return receipt?.lineage
          ? [{ channelId: receipt.lineage.channelId, invocationId: receipt.invocationId }]
          : [];
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
    const transactionFacts =
      this.factIdsByTransaction.get(fact.transaction.transactionId) ?? new Set<string>();
    transactionFacts.add(fact.id);
    this.factIdsByTransaction.set(fact.transaction.transactionId, transactionFacts);
    this.maximumLamportValue = Math.max(this.maximumLamportValue, fact.coordinate.lamport);
    if (fact.body.kind === "contribution" && fact.body.mutation.kind === "occurrence-create") {
      this.occurrenceNodes.set(fact.body.mutation.occurrenceId, fact.body.mutation.nodeId);
    }
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
  } else {
    mutationScopeKeys(fact.body.mutation).forEach((key) => keys.add(key));
  }
  return [...keys];
}

function mutationScopeKeys(mutation: Mutation): readonly string[] {
  const keys = new Set<string>();
  if ("nodeId" in mutation) {
    keys.add(nodeKey(mutation.nodeId));
  }
  if ("schemaId" in mutation) {
    keys.add(nodeKey(mutation.schemaId));
  }
  if ("baseSchemaId" in mutation) {
    keys.add(nodeKey(mutation.baseSchemaId));
  }
  if ("fieldDefinitionId" in mutation) {
    keys.add(nodeKey(mutation.fieldDefinitionId));
  }
  if ("templateNodeId" in mutation) {
    keys.add(nodeKey(mutation.templateNodeId));
  }
  if ("ownerNodeId" in mutation) {
    keys.add(nodeKey(mutation.ownerNodeId));
  }
  if ("fieldNodeId" in mutation) {
    keys.add(nodeKey(mutation.fieldNodeId));
  }
  if (mutation.kind === "template-node-detach") {
    keys.add(
      nodeKey(
        `${TEMPLATE_INSTANCE_NODE_PREFIX}${encodeURIComponent(mutation.ownerNodeId)}:${encodeURIComponent(mutation.templateNodeId)}`,
      ),
    );
  }
  if ("occurrenceId" in mutation) {
    keys.add(occurrenceKey(mutation.occurrenceId));
  }
  if ("fieldOccurrenceId" in mutation) {
    keys.add(occurrenceKey(mutation.fieldOccurrenceId));
  }
  if ("valueOccurrenceId" in mutation) {
    keys.add(occurrenceKey(mutation.valueOccurrenceId));
  }
  if ("parentNodeId" in mutation) {
    keys.add(nodeKey(mutation.parentNodeId));
  }
  if ("previousParentNodeId" in mutation && mutation.previousParentNodeId !== undefined) {
    keys.add(nodeKey(mutation.previousParentNodeId));
  }
  if ("anchor" in mutation) {
    addAnchorKeys(keys, mutation.anchor);
  }
  if ("previousAnchor" in mutation && mutation.previousAnchor) {
    addAnchorKeys(keys, mutation.previousAnchor);
  }
  if (mutation.kind === "node-restore" || mutation.kind === "occurrence-restore") {
    keys.add(factKey(mutation.deletionFactId));
  }
  if (mutation.kind === "text-splice") {
    mutation.deleteAtomIds.forEach((id) => keys.add(factKey(atomContributionId(id))));
  } else if (mutation.kind === "text-mark") {
    mutation.atomIds.forEach((id) => keys.add(factKey(atomContributionId(id))));
  } else if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
    keys.add(
      mutation.target.kind === "occurrence"
        ? occurrenceKey(mutation.target.id)
        : nodeKey(mutation.target.id),
    );
  } else if (mutation.kind === "field-initialize") {
    mutation.values.forEach((value) => {
      if (value.kind === "reference") {
        keys.add(nodeKey(value.nodeId));
      }
    });
    mutation.observedInitializationFactIds?.forEach((id) => keys.add(factKey(id)));
  } else if (mutation.kind === "schema-field-configure") {
    mutation.observedConfigFactIds?.forEach((id) => keys.add(factKey(id)));
  }
  return [...keys];
}

function addAnchorKeys(
  keys: Set<string>,
  anchor: Readonly<{ after: string | null; before: string | null }>,
): void {
  if (anchor.after) {
    keys.add(occurrenceKey(anchor.after));
  }
  if (anchor.before) {
    keys.add(occurrenceKey(anchor.before));
  }
}

function atomContributionId(atomId: TextAtomId): string {
  return atomId.slice(0, atomId.lastIndexOf("#"));
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
