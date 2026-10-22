import { array, exact, nonempty, object } from "../../decoding/index.js";
import { arrayField } from "./action-field-decoders.js";

export type TemplateNodeCopy = Readonly<{
  sourceNodeId: string;
  sourcePath: readonly string[];
  instanceNodeId: string;
  instanceOccurrenceId: string;
}>;

export type TemplateReferenceCopy = Readonly<{ sourceReferenceId: string; instanceReferenceId: string }>;

export const templateReferenceCopiesField = arrayField<TemplateReferenceCopy>((value) => {
  const copy = object(value, "Template Reference copy");
  exact(copy, ["sourceReferenceId", "instanceReferenceId"], "Template Reference copy");
  return {
    sourceReferenceId: nonempty(copy.sourceReferenceId, "Source Reference"),
    instanceReferenceId: nonempty(copy.instanceReferenceId, "Instance Reference"),
  };
});

export const templateCopiesField = arrayField<TemplateNodeCopy>((value) => {
  const copy = object(value, "Template Node copy");
  exact(copy, ["sourceNodeId", "sourcePath", "instanceNodeId", "instanceOccurrenceId"], "Template Node copy");
  return {
    sourceNodeId: nonempty(copy.sourceNodeId, "Source Node"),
    sourcePath: array(copy.sourcePath, "Owned source path", (item) => nonempty(item, "Source occurrence")),
    instanceNodeId: nonempty(copy.instanceNodeId, "Instance Node"),
    instanceOccurrenceId: nonempty(copy.instanceOccurrenceId, "Instance occurrence"),
  };
});
