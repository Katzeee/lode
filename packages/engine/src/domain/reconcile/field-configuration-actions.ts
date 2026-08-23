import { causalMaxima, isFieldDefinitionConfigAction, type FactAction, type FactActionOf } from "../fact/index.js";

export function activeFieldConfigurationActions(
  active: readonly FactAction[],
): readonly FactActionOf<"field-configuration-set">[] {
  return causalMaxima(
    active.filter((action): action is FactActionOf<"field-configuration-set"> =>
      isFieldDefinitionConfigAction(action.action),
    ),
    (left, right) =>
      left.action.fieldDefinitionId === right.action.fieldDefinitionId &&
      left.action.configuration.kind === right.action.configuration.kind,
  );
}
