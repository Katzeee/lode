import { compareFacts, type Fact } from "../../fact/index.js";

export function selectNeutralFactTail(
  facts: readonly Fact[],
  changed: readonly Fact[],
): readonly Fact[] | null {
  const changedIds = new Set(changed.map((fact) => fact.id));
  const ordered = [...facts].sort(compareFacts);
  const firstChanged = ordered.findIndex((fact) => changedIds.has(fact.id));
  if (
    firstChanged < 0 ||
    ordered.slice(0, firstChanged).some((fact) => changedIds.has(fact.id)) ||
    ordered.slice(firstChanged).some((fact) => !changedIds.has(fact.id))
  ) {
    return null;
  }
  return ordered.slice(firstChanged);
}
