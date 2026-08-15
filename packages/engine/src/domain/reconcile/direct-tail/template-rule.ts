import type { TemplateMutation } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplyTemplateDirectTail(projection: Projection, mutation: TemplateMutation): boolean {
  return projection.templateNodeInstances.some(
    (instance) =>
      instance.ownerNodeId === mutation.ownerNodeId &&
      instance.templateNodeId === mutation.templateNodeId &&
      instance.state === "linked",
  );
}
