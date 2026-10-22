import {
  END_SEQUENCE_ANCHOR as end,
  FIELD_CARDINALITIES,
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPES,
  type EditAction,
  type FieldDatatype,
} from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { enumOption, stringOption, writeCommand } from "../command/index.js";
import { resolveTarget, resource } from "../target/index.js";
import {
  cardinalityConfiguration,
  datatypeConfiguration,
  identity,
  optionalityConfiguration,
  optionalContributionActions,
  requiredEndpoint,
  runWrite,
  templateFieldCreateAction,
} from "../intent/index.js";
import { BOOLEAN_VALUES } from "../value/field-values.js";
import { registerSupertagFieldDefaultCommands } from "./supertag-field-default.js";
import { registerSupertagFieldPlacementCommands } from "./supertag-field-placement.js";

/**
 * Supertag field family: Template Field authoring in Tana's vocabulary —
 * add-new, add-existing, make-discoverable, pin, optional, and Static Default
 * — while keeping Definition, template use, and instance content distinct.
 */

export function registerSupertagFieldCommands(catalog: CommandCatalog): void {
  registerSupertagFieldDefaultCommands(catalog);
  catalog.register(fieldAddNew);
  catalog.register(fieldAddExisting);
  registerSupertagFieldPlacementCommands(catalog);
}

const FIELD_OPTION = stringOption("--field", "Field name (new) or Field Definition target (existing)", {
  required: true,
});

const fieldAddNew = writeCommand({
  path: ["supertag", "field", "add-new"],
  summary: "Add a new field to a Supertag template.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    FIELD_OPTION,
    enumOption("--type", FIELD_DATATYPES, "Field datatype"),
    enumOption("--cardinality", FIELD_CARDINALITIES, "single or list"),
    enumOption("--required", BOOLEAN_VALUES, "Required toggle"),
    stringOption("--options-from", "Supertag providing options (only with --type options-from-supertag)"),
    enumOption("--optional", BOOLEAN_VALUES, "Add as an Optional Field Contribution instead of a template placement"),
  ],
  run: runWrite("supertag.field.add-new", async (context, args) => {
    const supertag = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const name = args.requiredOption("--field");
    const datatype = args.option("--type") as FieldDatatype | undefined;
    const optionsFrom = args.option("--options-from");
    if (optionsFrom !== undefined && datatype !== "options-from-supertag") {
      throw new CliError("usage", "--options-from is only valid with --type options-from-supertag.");
    }
    if (datatype === "options-from-supertag" && optionsFrom === undefined) {
      throw new CliError("usage", "--type options-from-supertag requires --options-from.");
    }
    const optionsSupertagId =
      optionsFrom === undefined ? undefined : (await resolveTarget(context, optionsFrom, ["supertag"])).nodeId;
    if (args.option("--optional") === "true") {
      throw new CliError(
        "usage",
        "Optional Field Contributions take an existing discoverable field; use `supertag field add-existing --optional true`.",
      );
    }
    const fieldDefinitionId = identity(context.requestId, "field-definition");
    const actions: EditAction[] = [templateFieldCreateAction(supertag.nodeId, fieldDefinitionId, name)];
    if (datatype !== undefined) {
      actions.push(datatypeConfiguration(fieldDefinitionId, datatype, optionsSupertagId));
    }
    if (args.option("--cardinality") === "list") {
      actions.push(cardinalityConfiguration(fieldDefinitionId, FIELD_CARDINALITY_NODE_IDS.list));
    }
    if (args.option("--required") !== undefined) {
      actions.push(optionalityConfiguration(fieldDefinitionId, requiredEndpoint(args.option("--required") === "true")));
    }
    const added = resource(context, "field", fieldDefinitionId, name);
    return {
      actions,
      extra: { target: supertag.descriptor, field: added },
      view: writeView("Added field", added, `to ${supertag.label}`),
    };
  }),
});

const fieldAddExisting = writeCommand({
  path: ["supertag", "field", "add-existing"],
  summary: "Add a discoverable field definition to a Supertag template.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    stringOption("--field", "Existing discoverable Field Definition target", { required: true }),
    enumOption("--optional", BOOLEAN_VALUES, "Add as an Optional Field Contribution instead of a template placement"),
  ],
  run: runWrite("supertag.field.add-existing", async (context, args) => {
    const supertag = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const field = await resolveTarget(context, args.requiredOption("--field"), ["field"]);
    const optional = args.option("--optional") === "true";
    const actions: readonly EditAction[] = optional
      ? optionalContributionActions(supertag.nodeId, field.nodeId)
      : [
          {
            kind: "supertag-template-field-add-existing",
            supertagId: supertag.nodeId,
            fieldDefinitionId: field.nodeId,
            anchor: end,
          },
        ];
    return {
      actions,
      extra: { target: supertag.descriptor, field: field.descriptor },
      view: writeView("Added field", field.descriptor, `to ${supertag.label}`),
    };
  }),
});
