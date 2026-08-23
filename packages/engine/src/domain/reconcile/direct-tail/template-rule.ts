import type { TemplateAction } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplyTemplateDirectTail(projection: Projection, action: TemplateAction): boolean {
  return projection.templateNodeInstances.some(
    (instance) =>
      instance.ownerNodeId === action.ownerNodeId &&
      instance.templateNodeId === action.templateNodeId &&
      instance.state === "linked",
  );
}
