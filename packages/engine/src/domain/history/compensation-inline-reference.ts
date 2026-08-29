import type { FactAction } from "../fact/index.js";
import { locateInlineReference, type InterpretedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateInlineReferenceAction(
  target: FactAction,
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep | null {
  const authoredAction = target.action;
  if (
    authoredAction.kind !== "inline-reference-create" &&
    authoredAction.kind !== "inline-reference-remove" &&
    authoredAction.kind !== "inline-alias-attach" &&
    authoredAction.kind !== "inline-alias-detach"
  ) {
    return null;
  }
  const location = locateInlineReference(projection.nodes, authoredAction.inlineReferenceId);
  switch (authoredAction.kind) {
    case "inline-reference-create":
      return location?.reference.factActionId !== target.id
        ? noCompensation()
        : {
            kind: "ready",
            actions: [
              {
                kind: "inline-reference-remove",
                inlineReferenceId: authoredAction.inlineReferenceId,
              },
            ],
          };
    case "inline-reference-remove": {
      const previousLocation = locateInlineReference(counterfactual.nodes, authoredAction.inlineReferenceId);
      const restored =
        previousLocation === null
          ? null
          : {
              kind: "inline-reference-create" as const,
              inlineReferenceId: authoredAction.inlineReferenceId,
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
                inlineReferenceId: authoredAction.inlineReferenceId,
                hostNodeId: restored.hostNodeId,
                targetNodeId: restored.targetNodeId,
                anchor: restored.anchor,
              },
            ],
          };
    }
    case "inline-alias-attach":
      return location?.reference.aliasNodeId !== authoredAction.aliasNodeId
        ? noCompensation()
        : {
            kind: "ready",
            actions: [
              {
                kind: "inline-alias-detach",
                inlineReferenceId: authoredAction.inlineReferenceId,
                aliasNodeId: authoredAction.aliasNodeId,
              },
            ],
          };
    case "inline-alias-detach":
      return location === null ||
        location.reference.aliasNodeId !== null ||
        projection.nodes[authoredAction.aliasNodeId] === undefined
        ? noCompensation()
        : {
            kind: "ready",
            actions: [
              {
                kind: "inline-alias-attach",
                inlineReferenceId: authoredAction.inlineReferenceId,
                aliasNodeId: authoredAction.aliasNodeId,
              },
            ],
          };
  }
}
