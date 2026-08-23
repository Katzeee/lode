import type { FactAction } from "../fact/index.js";

export function indexSemanticValueFacts(actions: readonly FactAction[]): ReadonlyMap<string, readonly FactAction[]> {
  const result = new Map<string, FactAction[]>();
  for (const action of actions) {
    const key = semanticValueKey(action.action);
    if (key === null) {
      continue;
    }
    const candidates = result.get(key) ?? [];
    candidates.push(action);
    result.set(key, candidates);
  }
  return result;
}

export function semanticValueKey(action: FactAction["action"]): string | null {
  if (action.kind === "field-materialize" || action.kind === "materialized-field-clear") {
    return `materialized-field/${action.ownerNodeId}/${action.fieldDefinitionId}`;
  }
  if (action.kind === "view-mode-set") {
    return `view-mode/${action.viewId}`;
  }
  if (action.kind === "view-sort-configure") {
    return `view-sort/${action.sortId}`;
  }
  if (
    action.kind === "field-definition-make-discoverable" ||
    action.kind === "field-definition-return-to-template-field"
  ) {
    return `field-discoverability/${action.fieldDefinitionId}`;
  }
  if (action.kind === "template-field-visibility-set") {
    return `template-field-visibility/${action.templateFieldId}`;
  }
  if (action.kind === "template-field-static-default-set") {
    return `template-field-static-default/${action.templateFieldId}`;
  }
  return null;
}
