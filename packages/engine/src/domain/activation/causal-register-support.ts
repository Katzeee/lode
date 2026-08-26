import { canonicalJson, factActionContributions, type FactAction } from "../fact/index.js";

export function indexCausalRegisterFacts(actions: readonly FactAction[]): ReadonlyMap<string, readonly FactAction[]> {
  const result = new Map<string, FactAction[]>();
  for (const action of actions) {
    for (const key of causalRegisterKeys(action)) {
      const candidates = result.get(key) ?? [];
      candidates.push(action);
      result.set(key, candidates);
    }
  }
  return result;
}

export function causalRegisterKeys(action: FactAction): readonly string[] {
  return factActionContributions(action).flatMap((contribution) => {
    if (contribution.kind === "causal-register-write") {
      return [contribution.registerKey];
    }
    return contribution.kind === "causal-collection" && contribution.operation === "register"
      ? [canonicalJson([contribution.collection, contribution.entryId, contribution.register])]
      : [];
  });
}
