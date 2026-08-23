import type { TemplateField } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition, ProductCommandRun } from "../catalog/index.js";
import { resolveNodeTarget } from "../target/index.js";
import { readTemplateFields } from "./supertag-field.js";
import { executeWrite, writeResult, workspaceIdOf } from "../intent/index.js";

const fieldSetDefault: CommandDefinition = {
  path: ["supertag", "field", "set-default"],
  summary: "Set the Static Default text copied into fresh instances.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    { name: "--field", description: "Field Definition target", value: { kind: "string" as const }, required: true },
    { name: "--value", description: "Default text", value: { kind: "string" as const }, required: true },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const resolved = await templateUseOf(context, args.positional("supertag"), args.requiredOption("--field"));
    const { result, data } = await executeWrite(context, "supertag.field.set-default", [
      {
        kind: "supertag-template-field-static-default-set",
        supertagId: resolved.supertag.nodeId,
        templateFieldId: resolved.use.factActionId,
        value: args.requiredOption("--value"),
      },
    ]);
    return writeResult(data, result, {
      extra: { target: resolved.supertag.descriptor, field: resolved.field.descriptor },
      view: writeView("Set default", resolved.field.descriptor, `on ${resolved.supertag.label}`),
    });
  },
};

const fieldClearDefault: CommandDefinition = {
  path: ["supertag", "field", "clear-default"],
  summary: "Clear the Static Default text.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    { name: "--field", description: "Field Definition target", value: { kind: "string" as const }, required: true },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const resolved = await templateUseOf(context, args.positional("supertag"), args.requiredOption("--field"));
    const { result, data } = await executeWrite(context, "supertag.field.clear-default", [
      {
        kind: "supertag-template-field-static-default-set",
        supertagId: resolved.supertag.nodeId,
        templateFieldId: resolved.use.factActionId,
        value: "",
      },
    ]);
    return writeResult(data, result, {
      extra: { target: resolved.supertag.descriptor, field: resolved.field.descriptor },
      view: writeView("Cleared default", resolved.field.descriptor, `on ${resolved.supertag.label}`),
    });
  },
};

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
  const workspaceId = workspaceIdOf(context);
  const supertag = await resolveNodeTarget(context.session, workspaceId, context.perspective, supertagToken, [
    "supertag",
  ]);
  const field = await resolveNodeTarget(context.session, workspaceId, context.perspective, fieldToken, ["field"]);
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
