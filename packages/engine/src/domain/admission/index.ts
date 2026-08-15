import {
  admitAuthorityRecordShapes,
  type Admission,
  type Fact,
  type FactSnapshot,
  type WorkspaceId,
} from "../fact/index.js";
import { validateMutationEvidence } from "../mutation-evidence/index.js";
import { CURRENT_PROJECTION_VERSIONS, rebuildGeneration, type Projection } from "../reconcile/index.js";
import { validateDomainTransaction } from "./transaction-validation.js";

export function admitAuthorityRecords(workspaceId: WorkspaceId, records: readonly unknown[]): Admission {
  return admitAuthorityRecordShapes(workspaceId, records, {
    validateFact: validateSemanticEvidence,
    validateTransaction: validateDomainTransaction,
  });
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
