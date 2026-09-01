import type { TemplateField } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { stringOption, writeCommand, type ProductCommandRun } from "../command/index.js";
import { resolveTarget } from "../target/index.js";
import { readTemplateFields } from "./supertag-field-state.js";
import { runWrite } from "../intent/index.js";

const fieldSetDefault = writeCommand({
  path: ["supertag", "field", "set-default"],
  summary: "Set the Static Default text copied into fresh instances.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    stringOption("--field", "Field Definition target", { required: true }),
    stringOption("--value", "Default text", { required: true }),
  ],
  run: runWrite("supertag.field.set-default", async (context, args) => {
    const resolved = await templateUseOf(context, args.positional("supertag"), args.requiredOption("--field"));
    return {
      actions: [
        {
          kind: "supertag-template-field-static-default-set",
          supertagId: resolved.supertag.nodeId,
          templateFieldId: resolved.use.factActionId,
          value: args.requiredOption("--value"),
        },
      ],
      extra: { target: resolved.supertag.descriptor, field: resolved.field.descriptor },
      view: writeView("Set default", resolved.field.descriptor, `on ${resolved.supertag.label}`),
    };
  }),
});

const fieldClearDefault = writeCommand({
  path: ["supertag", "field", "clear-default"],
  summary: "Clear the Static Default text.",
  positionals: [["supertag", "Supertag target"]],
  options: [stringOption("--field", "Field Definition target", { required: true })],
  run: runWrite("supertag.field.clear-default", async (context, args) => {
    const resolved = await templateUseOf(context, args.positional("supertag"), args.requiredOption("--field"));
    return {
      actions: [
        {
          kind: "supertag-template-field-static-default-set",
          supertagId: resolved.supertag.nodeId,
          templateFieldId: resolved.use.factActionId,
          value: "",
        },
      ],
      extra: { target: resolved.supertag.descriptor, field: resolved.field.descriptor },
      view: writeView("Cleared default", resolved.field.descriptor, `on ${resolved.supertag.label}`),
    };
  }),
});

type TemplateUse = Readonly<{
  supertag: Readonly<{ nodeId: string; label: string; descriptor: Readonly<{ ref: string; label: string }> }>;
  field: Readonly<{ nodeId: string; descriptor: Readonly<{ ref: string; label: string; link: string }> }>;
  use: TemplateField;
}>;

async function templateUseOf(
  context: Parameters<ProductCommandRun>[0],
  supertagToken: string,
  fieldToken: string,
): Promise<TemplateUse> {
  const supertag = await resolveTarget(context, supertagToken, ["supertag"]);
  const field = await resolveTarget(context, fieldToken, ["field"]);
  const use = (await readTemplateFields(context, supertag.nodeId)).find(
    (candidate) => candidate.fieldDefinitionId === field.nodeId,
  );
  if (use === undefined) {
    throw new CliError(
      "target-not-found",
      `Supertag ${supertag.descriptor.ref} does not have field ${field.descriptor.ref} in its template.`,
    );
  }
  return {
    supertag: {
      nodeId: supertag.nodeId,
      label: supertag.label,
      descriptor: { ref: supertag.descriptor.ref, label: supertag.label },
    },
    field,
    use,
  };
}

export function registerSupertagFieldDefaultCommands(catalog: CommandCatalog): void {
  catalog.register(fieldSetDefault);
  catalog.register(fieldClearDefault);
}
