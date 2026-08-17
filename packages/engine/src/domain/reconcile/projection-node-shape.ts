import { array, exact, nonempty, object, stringArray } from "../../shape-validation/index.js";
import type { ProjectedOccurrence, TemplateNodeInstance } from "./projection-types.js";

export function projectedOccurrence(value: unknown): ProjectedOccurrence {
  const item = object(value, "Projected Occurrence");
  exact(item, ["occurrenceId", "nodeId", "parentNodeId", "derived"], "Projected Occurrence");
  if (typeof item.derived !== "boolean") {
    throw new Error("Occurrence derived flag is invalid");
  }
  return {
    occurrenceId: nonempty(item.occurrenceId, "Occurrence identity"),
    nodeId: nonempty(item.nodeId, "Node identity"),
    parentNodeId: nonempty(item.parentNodeId, "Parent Node identity"),
    derived: item.derived,
  };
}

export function templateNodeInstance(value: unknown): TemplateNodeInstance {
  const item = object(value, "Template Node instance");
  exact(
    item,
    [
      "ownerNodeId",
      "templateNodeId",
      "instanceNodeId",
      "instanceOccurrenceId",
      "state",
      "sources",
      "detachmentContributionIds",
    ],
    "Template Node instance",
  );
  if (item.state !== "linked" && item.state !== "detached") {
    throw new Error("Template Node state is invalid");
  }
  return {
    ownerNodeId: nonempty(item.ownerNodeId, "Template owner"),
    templateNodeId: nonempty(item.templateNodeId, "Template Node"),
    instanceNodeId: item.instanceNodeId === null ? null : nonempty(item.instanceNodeId, "instance Node"),
    instanceOccurrenceId: nonempty(item.instanceOccurrenceId, "instance Occurrence"),
    state: item.state,
    sources: array(item.sources, "Template Node sources", (sourceValue) => {
      const source = object(sourceValue, "Template Node source");
      exact(source, ["supertagId", "appliedSupertagId", "templateOccurrenceId"], "Template Node source");
      return {
        supertagId: nonempty(source.supertagId, "source Supertag"),
        appliedSupertagId: nonempty(source.appliedSupertagId, "applied Supertag"),
        templateOccurrenceId: nonempty(source.templateOccurrenceId, "Template Occurrence"),
      };
    }),
    detachmentContributionIds: stringArray(item.detachmentContributionIds),
  };
}
