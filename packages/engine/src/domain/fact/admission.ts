import { canonicalJson, stableStringCompare } from "./canonical.js";
import { validateAdmissibleFact } from "./causal-validation.js";
import { compareFacts, frontierCovers, frontierEquals, normalizeFrontier } from "./frontier.js";
import { validatePlannedReceiptAppend, validateReceipts } from "./receipt-validation.js";
import { parseAuthorityRecords } from "./shape-validation.js";
import { validateStaticFact } from "./static-validation.js";
import { collectFactTransactions } from "./transaction.js";
import {
  type Admission,
  type AuthorityReceipt,
  type AuthorityRecord,
  type Fact,
  type FactSnapshot,
  type FactTransaction,
  type WorkspaceId,
} from "./types.js";

export type FactAdmissionValidation = Readonly<{
  validateFact?: (fact: Fact, observed: FactSnapshot) => void;
  validateTransaction?: (transaction: FactTransaction, before: FactSnapshot, after: FactSnapshot) => void;
}>;

export function admitAuthorityRecordShapes(
  workspaceId: WorkspaceId,
  records: readonly unknown[],
  validation: FactAdmissionValidation = {},
): Admission {
  try {
    const parsed = parseAuthorityRecords(records);
    const quarantine = parsed.find((record) => record.recordKind === "quarantine");
    if (quarantine?.recordKind === "quarantine") {
      throw new Error(`Quarantined sync update: ${quarantine.reason}`);
    }
    validateReceipts(workspaceId, parsed);
    const candidates = collectFacts(workspaceId, parsed);
    const transactions = collectFactTransactions(candidates.values());
    const admitted: Fact[] = [];
    const admittedTransactionIds = new Set<string>();
    const frontier: Record<string, number> = {};
    let progressed = true;

    while (progressed) {
      progressed = false;
      for (const transaction of transactions.complete) {
        if (admittedTransactionIds.has(transaction.transactionId)) {
          continue;
        }
        const first = transaction.facts[0];
        if (!first) {
          throw new Error(`Fact transaction is empty: ${transaction.transactionId}`);
        }
        const { replicaId, sequence } = first.coordinate.dot;
        if (sequence !== (frontier[replicaId] ?? 0) + 1) {
          continue;
        }
        if (!frontierCovers(frontier, first.coordinate.observed)) {
          continue;
        }
        const transactionFacts: Fact[] = [];
        const before = snapshot(admitted, frontier);
        for (const fact of transaction.facts) {
          const available = [...admitted, ...transactionFacts];
          validateAdmissibleFact(fact, available);
          validation.validateFact?.(fact, observedSnapshot(available, fact));
          transactionFacts.push(fact);
        }
        const transactionFrontier = normalizeFrontier({
          ...frontier,
          [replicaId]: transaction.facts.at(-1)!.coordinate.dot.sequence,
        });
        validation.validateTransaction?.(
          transaction,
          before,
          snapshot([...admitted, ...transactionFacts], transactionFrontier),
        );
        admitted.push(...transactionFacts);
        admittedTransactionIds.add(transaction.transactionId);
        frontier[replicaId] = transactionFrontier[replicaId]!;
        progressed = true;
      }
    }

    admitted.sort(compareFacts);
    const pendingTransactionIds = [
      ...transactions.pendingTransactionIds,
      ...transactions.complete
        .filter((transaction) => !admittedTransactionIds.has(transaction.transactionId))
        .map((transaction) => transaction.transactionId),
    ].sort(stableStringCompare);
    return {
      kind: pendingTransactionIds.length === 0 ? "ready" : "pending",
      snapshot: { facts: admitted, frontier: normalizeFrontier(frontier) },
      pendingTransactionIds,
      fault: null,
    };
  } catch (error) {
    return {
      kind: "fault",
      snapshot: { facts: [], frontier: {} },
      pendingTransactionIds: [],
      fault: error instanceof Error ? error.message : String(error),
    };
  }
}

function snapshot(facts: readonly Fact[], frontier: FactSnapshot["frontier"]): FactSnapshot {
  return { facts: [...facts].sort(compareFacts), frontier: normalizeFrontier(frontier) };
}

export function admitPlannedAuthorityAppend(
  workspaceId: WorkspaceId,
  base: FactSnapshot,
  appendedRecords: readonly unknown[],
  maximumLamport: number,
  previousHistoryReceipt: AuthorityReceipt | null,
): Admission {
  try {
    const appended = parseAuthorityRecords(appendedRecords);
    const quarantine = appended.find((record) => record.recordKind === "quarantine");
    if (quarantine?.recordKind === "quarantine") {
      throw new Error(`Quarantined local append: ${quarantine.reason}`);
    }
    validatePlannedReceiptAppend(workspaceId, appended, previousHistoryReceipt);
    const admitted = [...base.facts];
    const frontier = { ...base.frontier };
    let observedMaximumLamport = maximumLamport;
    const facts = appended.flatMap((record) => (record.recordKind === "fact" ? [record.fact] : []));
    const transactions = collectFactTransactions(facts);
    if (transactions.pendingTransactionIds.length > 0) {
      throw new Error(`Planned append contains incomplete Fact transactions`);
    }
    for (const transaction of transactions.complete) {
      for (const fact of transaction.facts) {
        validateStaticFact(workspaceId, fact);
        const { replicaId, sequence } = fact.coordinate.dot;
        if (sequence !== (frontier[replicaId] ?? 0) + 1 || !frontierEquals(fact.coordinate.observed, frontier)) {
          throw new Error(`Planned Fact does not extend the admitted frontier: ${fact.id}`);
        }
        validateAdmissibleFact(fact, admitted, observedMaximumLamport);
        admitted.push(fact);
        frontier[replicaId] = sequence;
        observedMaximumLamport = fact.coordinate.lamport;
      }
    }
    return {
      kind: "ready",
      snapshot: { facts: admitted.sort(compareFacts), frontier: normalizeFrontier(frontier) },
      pendingTransactionIds: [],
      fault: null,
    };
  } catch (error) {
    return {
      kind: "fault",
      snapshot: base,
      pendingTransactionIds: [],
      fault: error instanceof Error ? error.message : String(error),
    };
  }
}

function observedSnapshot(admitted: readonly Fact[], fact: Fact): FactSnapshot {
  return {
    facts: admitted.filter(
      (candidate) =>
        candidate.coordinate.dot.sequence <= (fact.coordinate.observed[candidate.coordinate.dot.replicaId] ?? 0),
    ),
    frontier: fact.coordinate.observed,
  };
}

function collectFacts(workspaceId: WorkspaceId, records: readonly AuthorityRecord[]): Map<string, Fact> {
  const facts = new Map<string, { canonical: string; fact: Fact }>();
  for (const record of records) {
    if (record.recordKind !== "fact") {
      continue;
    }
    validateStaticFact(workspaceId, record.fact);
    const canonical = canonicalJson(record.fact);
    const existing = facts.get(record.fact.id);
    if (existing && existing.canonical !== canonical) {
      throw new Error(`FactId content conflict: ${record.fact.id}`);
    }
    facts.set(record.fact.id, { canonical, fact: record.fact });
  }
  return new Map([...facts].map(([id, entry]) => [id, entry.fact]));
}
