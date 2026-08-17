import type { FactTransaction } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";
import type { OwnedRoles } from "./structural-role-ownership.js";

export function addFieldValueReorderRoles(
  transaction: FactTransaction,
  projections: readonly Projection[],
  roles: OwnedRoles,
): void {
  for (const fact of transaction.facts) {
    if (fact.body.kind !== "contribution" || fact.body.mutation.kind !== "occurrence-move") {
      continue;
    }
    const mutation = fact.body.mutation;
    if (mutation.previousParentNodeId !== mutation.parentNodeId) {
      continue;
    }
    const isFieldValue = projections.some((projection) =>
      Object.values(projection.materializedFields)
        .flat()
        .some(
          (field) =>
            field.fieldNodeId === mutation.parentNodeId && field.valueOccurrenceIds.includes(mutation.occurrenceId),
        ),
    );
    if (isFieldValue) {
      roles.occurrences.add(mutation.occurrenceId);
    }
  }
}
