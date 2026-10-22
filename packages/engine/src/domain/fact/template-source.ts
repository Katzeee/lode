import { exact, nonempty, object } from "../../decoding/index.js";
import { arrayField } from "./action-field-decoders.js";

export type TemplateSource = Readonly<{
  supertagId: string;
  appliedSupertagId: string;
  templateOccurrenceId: string;
}>;

export const templateSourcesField = arrayField<TemplateSource>((value) => {
  const source = object(value, "Template source");
  exact(source, ["supertagId", "appliedSupertagId", "templateOccurrenceId"], "Template source");
  return {
    supertagId: nonempty(source.supertagId, "Source Supertag"),
    appliedSupertagId: nonempty(source.appliedSupertagId, "Applied Supertag"),
    templateOccurrenceId: nonempty(source.templateOccurrenceId, "Source occurrence"),
  };
});
