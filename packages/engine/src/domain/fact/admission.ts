import { canonicalJson, stableStringCompare } from "./canonical.js";
import { validateAdmissibleFact } from "./causal-validation.js";
import { compareFacts, frontierCovers, frontierEquals, normalizeFrontier } from "./frontier.js";
import { validatePlannedReceiptAppend, validateReceipts } from "./receipt-validation.js";
import { parseAuthorityRecords } from "./shape-validation.js";
import { validateStaticFact } from "./static-validation.js";
import {
  type Admission,
  type AuthorityReceipt,
  type AuthorityRecord,
  type Fact,
  type FactSnapshot,
  type WorkspaceId,
} from "./types.js";

export function admitAuthorityRecordShapes(
  workspaceId: WorkspaceId,
  records: readonly unknown[],
  validateSemanticEvidence?: (fact: Fact, observed: FactSnapshot) => void,
): Admission {
  try {
    const parsed = parseAuthorityRecords(records);
    const quarantine = parsed.find((record) => record.recordKind === "quarantine");
    if (quarantine?.recordKind === "quarantine") {
      throw new Error(`Quarantined sync update: ${quarantine.reason}`);
    }
    validateReceipts(workspaceId, parsed);
    const candidates = collectFacts(workspaceId, parsed);
    const admitted: Fact[] = [];
    const admittedIds = new Set<string>();
    const frontier: Record<string, number> = {};
    let progressed = true;

    while (progressed) {
      progressed = false;
      for (const fact of [...candidates.values()].sort(compareFacts)) {
        if (admittedIds.has(fact.id)) {
          continue;
        }
        const { replicaId, sequence } = fact.coordinate.dot;
        if (sequence !== (frontier[replicaId] ?? 0) + 1) {
          continue;
        }
        if (!frontierCovers(frontier, fact.coordinate.observed)) {
          continue;
        }
        validateAdmissibleFact(fact, admitted);
        validateSemanticEvidence?.(fact, observedSnapshot(admitted, fact));
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
      snapshot: { facts: admitted, frontier: normalizeFrontier(frontier) },
      pendingFactIds,
      fault: null,
    };
  } catch (error) {
    return {
      kind: "fault",
      snapshot: { facts: [], frontier: {} },
      pendingFactIds: [],
      fault: error instanceof Error ? error.message : String(error),
    };
  }
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
    for (const record of appended) {
      if (record.recordKind !== "fact") {
        continue;
      }
      const fact = record.fact;
      validateStaticFact(workspaceId, fact);
      const { replicaId, sequence } = fact.coordinate.dot;
      if (
        sequence !== (frontier[replicaId] ?? 0) + 1 ||
        !frontierEquals(fact.coordinate.observed, frontier)
      ) {
        throw new Error(`Planned Fact does not extend the admitted frontier: ${fact.id}`);
      }
      validateAdmissibleFact(fact, admitted, observedMaximumLamport);
      admitted.push(fact);
      frontier[replicaId] = sequence;
      observedMaximumLamport = fact.coordinate.lamport;
    }
    return {
      kind: "ready",
      snapshot: { facts: admitted.sort(compareFacts), frontier: normalizeFrontier(frontier) },
      pendingFactIds: [],
      fault: null,
    };
  } catch (error) {
    return {
      kind: "fault",
      snapshot: base,
      pendingFactIds: [],
      fault: error instanceof Error ? error.message : String(error),
    };
  }
}

function observedSnapshot(admitted: readonly Fact[], fact: Fact): FactSnapshot {
  return {
    facts: admitted.filter(
      (candidate) =>
        candidate.coordinate.dot.sequence <=
        (fact.coordinate.observed[candidate.coordinate.dot.replicaId] ?? 0),
    ),
    frontier: fact.coordinate.observed,
  };
}

function collectFacts(
  workspaceId: WorkspaceId,
  records: readonly AuthorityRecord[],
): Map<string, Fact> {
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
