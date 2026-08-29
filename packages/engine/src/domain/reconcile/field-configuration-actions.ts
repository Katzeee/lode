import {
  canonicalJson,
  causalMaxima,
  compareCausalOrder,
  isFieldDefinitionConfigAction,
  type FactAction,
  type FactActionOf,
} from "../fact/index.js";

export function activeFieldConfigurationActions(
  active: readonly FactAction[],
): readonly FactActionOf<"field-configuration-set">[] {
  const maxima = [
    ...causalMaxima(
      active.filter((action): action is FactActionOf<"field-configuration-set"> =>
        isFieldDefinitionConfigAction(action.action),
      ),
      (left, right) =>
        left.action.fieldDefinitionId === right.action.fieldDefinitionId &&
        left.action.configuration.kind === right.action.configuration.kind,
    ),
  ].sort(compareCausalOrder);
  const bySemanticValue = new Map<string, FactActionOf<"field-configuration-set">>();
  for (const action of maxima) {
    const key = canonicalJson([
      action.action.fieldDefinitionId,
      action.action.configuration.kind,
      action.action.configuration,
    ]);
    if (!bySemanticValue.has(key)) {
      bySemanticValue.set(key, action);
    }
  }
  return [...bySemanticValue.values()];
}
