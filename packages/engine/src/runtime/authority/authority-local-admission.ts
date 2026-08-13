import { frontierEquals, type Admission, type Fact } from "../../domain/fact/index.js";

export function assertLocalFactsAdmitted(
  planned: Admission,
  policy: Admission,
  facts: readonly Fact[],
): void {
  const admittedFactIds = new Set(policy.snapshot.facts.map((fact) => fact.id));
  if (
    policy.kind === "fault" ||
    !frontierEquals(policy.snapshot.frontier, planned.snapshot.frontier) ||
    facts.some((fact) => !admittedFactIds.has(fact.id))
  ) {
    throw new Error(policy.fault ?? "Local Fact transactions violate admission policy");
  }
}
