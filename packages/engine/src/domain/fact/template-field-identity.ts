import type { FactActionId } from "./fact-value-types.js";

export function templateFieldProjectionIdentity(actionId: FactActionId) {
  const root = `${actionId}/projection/template-field`;
  return {
    templateFieldNodeId: `${root}/node`,
    templateFieldOccurrenceId: `${root}/occurrence`,
    definitionOccurrenceId: `${root}/definition-occurrence`,
    staticDefaultValueNodeId: `${root}/static-default/node`,
    staticDefaultValueOccurrenceId: `${root}/static-default/occurrence`,
  };
}
