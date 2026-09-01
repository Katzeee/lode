import { locateInlineReference } from "../reconcile/index.js";
import { noCompensation, type CompensationCatalog } from "./compensation-types.js";

export const INLINE_REFERENCE_COMPENSATIONS = {
  "inline-reference-create": ({ projection }, target) => {
    const location = locateInlineReference(projection.nodes, target.action.inlineReferenceId);
    return location?.reference.factActionId !== target.id
      ? noCompensation()
      : {
          kind: "ready",
          actions: [
            {
              kind: "inline-reference-remove",
              inlineReferenceId: target.action.inlineReferenceId,
            },
          ],
        };
  },
  "inline-reference-remove": ({ projection, counterfactual }, { action }) => {
    const location = locateInlineReference(projection.nodes, action.inlineReferenceId);
    const previousLocation = locateInlineReference(counterfactual.nodes, action.inlineReferenceId);
    const restored =
      previousLocation === null
        ? null
        : {
            kind: "inline-reference-create" as const,
            inlineReferenceId: action.inlineReferenceId,
            hostNodeId: previousLocation.hostNodeId,
            targetNodeId: previousLocation.reference.targetNodeId,
            anchor: previousLocation.anchor,
          };
    return location !== null || restored === null
      ? noCompensation()
      : {
          kind: "ready",
          actions: [
            {
              kind: "inline-reference-create",
              inlineReferenceId: action.inlineReferenceId,
              hostNodeId: restored.hostNodeId,
              targetNodeId: restored.targetNodeId,
              anchor: restored.anchor,
            },
          ],
        };
  },
  "inline-alias-attach": ({ projection }, { action }) => {
    const location = locateInlineReference(projection.nodes, action.inlineReferenceId);
    return location?.reference.aliasNodeId !== action.aliasNodeId
      ? noCompensation()
      : {
          kind: "ready",
          actions: [
            {
              kind: "inline-alias-detach",
              inlineReferenceId: action.inlineReferenceId,
              aliasNodeId: action.aliasNodeId,
            },
          ],
        };
  },
  "inline-alias-detach": ({ projection }, { action }) => {
    const location = locateInlineReference(projection.nodes, action.inlineReferenceId);
    return location === null ||
      location.reference.aliasNodeId !== null ||
      projection.nodes[action.aliasNodeId] === undefined
      ? noCompensation()
      : {
          kind: "ready",
          actions: [
            {
              kind: "inline-alias-attach",
              inlineReferenceId: action.inlineReferenceId,
              aliasNodeId: action.aliasNodeId,
            },
          ],
        };
  },
} satisfies Partial<CompensationCatalog>;
