import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { EditAction } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { enumOption, stringOption, writeCommand, type ProductCommandRun } from "../command/index.js";
import { resolveTarget } from "../target/index.js";
import { executeWrite, optionalContributionActions, runWrite, writeResult } from "../intent/index.js";
import { BOOLEAN_VALUES } from "../value/field-values.js";
import { readOptionalContributions, readTemplateFields } from "./supertag-field-state.js";

const fieldRemove = writeCommand({
  path: ["supertag", "field", "remove"],
  summary: "Remove a template field use; the field definition and instance content stay.",
  positionals: [["supertag", "Supertag target"]],
  options: [stringOption("--field", "Field Definition target", { required: true })],
  run: async (context, args) => {
    const supertag = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const field = await resolveTarget(context, args.requiredOption("--field"), ["field"]);
    const use = (await readTemplateFields(context, supertag.nodeId)).find(
      (candidate) => candidate.fieldDefinitionId === field.nodeId,
    );
    if (use === undefined) {
      const contribution = (await readOptionalContributions(context, supertag.nodeId)).find(
        (candidate) => candidate.fieldDefinitionId === field.nodeId,
      );
      if (contribution === undefined) {
        throw new CliError(
          "target-not-found",
          `Supertag ${supertag.descriptor.ref} does not expose field ${field.descriptor.ref}.`,
        );
      }
      const { result, data } = await executeWrite(context, "supertag.field.remove", [
        {
          kind: "supertag-optional-field-contribution-remove",
          supertagId: supertag.nodeId,
          fieldDefinitionId: contribution.fieldDefinitionId,
        },
      ]);
      return writeResult(data, result, {
        extra: { target: supertag.descriptor, field: field.descriptor },
        view: writeView("Removed optional field", field.descriptor, `from ${supertag.label}`),
      });
    }
    const { result, data } = await executeWrite(context, "supertag.field.remove", [
      {
        kind: "supertag-template-field-remove",
        supertagId: supertag.nodeId,
        templateFieldId: use.factActionId,
      },
    ]);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, field: field.descriptor },
      view: writeView("Removed field", field.descriptor, `from ${supertag.label}`),
    });
  },
});

const fieldPin = writeCommand({
  path: ["supertag", "field", "pin"],
  summary: "Mark a template field as a primary dimension.",
  positionals: [["supertag", "Supertag target"]],
  options: [stringOption("--field", "Field Definition target", { required: true })],
  run: visibilitySet("pin", "pinned", "Pinned field"),
});

const fieldUnpin = writeCommand({
  path: ["supertag", "field", "unpin"],
  summary: "Return a pinned template field to normal placement.",
  positionals: [["supertag", "Supertag target"]],
  options: [stringOption("--field", "Field Definition target", { required: true })],
  run: visibilitySet("unpin", "normal", "Unpinned field"),
});

function visibilitySet(action: string, visibility: "pinned" | "normal", verb: string) {
  return async (context: Parameters<ProductCommandRun>[0], args: Parameters<ProductCommandRun>[1]) => {
    const supertag = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const field = await resolveTarget(context, args.requiredOption("--field"), ["field"]);
    const use = (await readTemplateFields(context, supertag.nodeId)).find(
      (candidate) => candidate.fieldDefinitionId === field.nodeId,
    );
    if (use === undefined) {
      throw new CliError(
        "target-not-found",
        `Supertag ${supertag.descriptor.ref} does not have field ${field.descriptor.ref} in its template.`,
      );
    }
    const { result, data } = await executeWrite(context, `supertag.field.${action}`, [
      {
        kind: "supertag-template-field-visibility-set",
        supertagId: supertag.nodeId,
        templateFieldId: use.factActionId,
        visibility,
      },
    ]);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, field: field.descriptor },
      view: writeView(verb, field.descriptor, `on ${supertag.label}`),
    });
  };
}

const fieldSetOptional = writeCommand({
  path: ["supertag", "field", "set-optional"],
  summary: "Move a field between the template and the Optional Field Contribution section.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    stringOption("--field", "Field Definition target", { required: true }),
    enumOption("--value", BOOLEAN_VALUES, "true to make optional, false to return to template", { required: true }),
  ],
  run: runWrite("supertag.field.set-optional", async (context, args) => {
    const supertag = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const field = await resolveTarget(context, args.requiredOption("--field"), ["field"]);
    const makeOptional = args.requiredOption("--value") === "true";
    const templateUse = (await readTemplateFields(context, supertag.nodeId)).find(
      (candidate) => candidate.fieldDefinitionId === field.nodeId,
    );
    const contribution = (await readOptionalContributions(context, supertag.nodeId)).find(
      (candidate) => candidate.fieldDefinitionId === field.nodeId,
    );
    const actions: EditAction[] = [];
    if (makeOptional) {
      if (templateUse === undefined) {
        throw new CliError(
          "unsupported",
          `Field ${field.descriptor.ref} is not a template field of ${supertag.descriptor.ref}.`,
        );
      }
      actions.push({
        kind: "supertag-template-field-remove",
        supertagId: supertag.nodeId,
        templateFieldId: templateUse.factActionId,
      });
      if (templateUse.fieldDefinitionOwner !== "workspace-schema") {
        throw new CliError(
          "unsupported",
          `Field ${field.descriptor.ref} must be made discoverable before it can become optional.`,
        );
      }
      actions.push(...optionalContributionActions(supertag.nodeId, field.nodeId));
    } else {
      if (contribution === undefined) {
        throw new CliError(
          "unsupported",
          `Field ${field.descriptor.ref} is not an optional contribution of ${supertag.descriptor.ref}.`,
        );
      }
      actions.push({
        kind: "supertag-optional-field-contribution-remove",
        supertagId: supertag.nodeId,
        fieldDefinitionId: contribution.fieldDefinitionId,
      });
      actions.push({
        kind: "supertag-template-field-add-existing",
        supertagId: supertag.nodeId,
        fieldDefinitionId: field.nodeId,
        anchor: end,
      });
    }
    return {
      actions,
      extra: { target: supertag.descriptor, field: field.descriptor },
      view: writeView(
        makeOptional ? "Made field optional" : "Returned field to template",
        field.descriptor,
        `on ${supertag.label}`,
      ),
    };
  }),
});

export function registerSupertagFieldPlacementCommands(catalog: CommandCatalog): void {
  catalog.register(fieldRemove);
  catalog.register(fieldPin);
  catalog.register(fieldUnpin);
  catalog.register(fieldSetOptional);
}
