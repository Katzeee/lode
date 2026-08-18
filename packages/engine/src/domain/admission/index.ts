import {
  admitAuthorityRecordShapes,
  type Admission,
  type Fact,
  type FactSnapshot,
  type GovernanceBody,
  type WorkspaceId,
} from "../fact/index.js";
import { projectGovernance, verifyFactAttribution } from "../governance/index.js";
import { validateMutationEvidence } from "../mutation-evidence/index.js";
import { CURRENT_PROJECTION_VERSIONS, rebuildGeneration, type Projection } from "../reconcile/index.js";
import { validateDomainTransaction } from "./transaction-validation.js";

/**
 * The production admission policy: shape and causality (fact admission) plus
 * domain evidence (mutation evidence and transaction validation) plus journal
 * governance — attribution and Actor membership. Governance is a property of
 * the whole candidate record set, so it is decided by a pre-scan before any
 * Fact is admitted; that keeps the verdict independent of merge order.
 */

export function admitAuthorityRecords(workspaceId: WorkspaceId, records: readonly unknown[]): Admission {
  const governance = scanGovernance(records);
  if (governance.establishCount > 1) {
    return {
      kind: "fault",
      snapshot: { facts: [], frontier: {} },
      pendingTransactionIds: [],
      fault: "Workspace journal carries more than one establish governance Fact",
    };
  }
  return admitAuthorityRecordShapes(workspaceId, records, {
    validateFact: (fact, observed) => {
      validateSemanticEvidence(fact, observed);
      validateJournalGovernance(fact, observed, governance.governed);
    },
    validateTransaction: (transaction, before, after) => {
      if (transaction.facts.every((fact) => fact.body.kind === "governance")) {
        return;
      }
      validateDomainTransaction(transaction, before, after);
    },
  });
}

function scanGovernance(records: readonly unknown[]): Readonly<{ governed: boolean; establishCount: number }> {
  let governed = false;
  let establishCount = 0;
  for (const record of records) {
    const body = governanceBodyOf(record);
    if (!body) {
      continue;
    }
    governed = true;
    if (body.action.kind === "workspace-establish") {
      establishCount += 1;
    }
  }
  return { governed, establishCount };
}

function governanceBodyOf(record: unknown): GovernanceBody | null {
  if (typeof record !== "object" || record === null) {
    return null;
  }
  const candidate = record as Readonly<{ recordKind?: unknown; fact?: { body?: unknown } }>;
  if (candidate.recordKind !== "fact" || typeof candidate.fact !== "object" || candidate.fact === null) {
    return null;
  }
  const body = candidate.fact.body;
  if (typeof body !== "object" || body === null || (body as Readonly<{ kind?: unknown }>).kind !== "governance") {
    return null;
  }
  return body as GovernanceBody;
}

function validateJournalGovernance(fact: Fact, observed: FactSnapshot, governed: boolean): void {
  if (!governed) {
    if (fact.attribution !== null) {
      throw new Error(`Fact carries Actor attribution outside a governed journal: ${fact.id}`);
    }
    return;
  }
  if (fact.attribution === null) {
    throw new Error(`Governed journal Fact lacks Actor attribution: ${fact.id}`);
  }
  if (!verifyFactAttribution(fact)) {
    throw new Error(`Fact attribution signature is invalid: ${fact.id}`);
  }
  if (fact.body.kind === "governance") {
    if (fact.body.action.kind === "workspace-establish" && fact.body.actorId !== fact.body.action.ownerActorId) {
      throw new Error(`Workspace establishment owner does not match its attributed Actor: ${fact.id}`);
    }
    // Authorization and epoch staleness are replay concerns: an unauthorized or
    // stale governance Fact stays in the journal with no governance effect.
    return;
  }
  const members = projectGovernance(observed.facts).members;
  if (!members.has(fact.body.actorId)) {
    throw new Error(`Fact actor is not a Workspace member at its observed state: ${fact.id}`);
  }
}

function validateSemanticEvidence(fact: Fact, observed: FactSnapshot): void {
  if (fact.body.kind !== "contribution") {
    return;
  }
  const contribution = fact.body;
  let projections: Readonly<{ previous: Projection; available: Projection }> | undefined;
  validateMutationEvidence(contribution.mutation, {
    snapshot: observed,
    projections: () => {
      if (!projections) {
        const generation = rebuildGeneration(fact.workspaceId, observed, CURRENT_PROJECTION_VERSIONS).generation;
        projections = {
          previous: contribution.intent === "direct" ? generation.origin : generation.review,
          available: generation.review,
        };
      }
      return projections;
    },
  });
}
