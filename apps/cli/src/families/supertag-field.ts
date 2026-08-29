import {
  END_SEQUENCE_ANCHOR as end,
  FIELD_CARDINALITIES,
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPES,
  type EditAction,
  type FieldDatatype,
} from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { descriptor, resolveNodeTarget } from "../target/index.js";
import {
  cardinalityConfiguration,
  datatypeConfiguration,
  executeWrite,
  identity,
  optionalityConfiguration,
  optionalContributionActions,
  requiredEndpoint,
  templateFieldCreateAction,
  writeResult,
  workspaceIdOf,
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

const FIELD_OPTION = {
  name: "--field",
  description: "Field name (new) or Field Definition target (existing)",
  value: { kind: "string" as const },
  required: true,
};

const fieldAddNew: CommandDefinition = {
  path: ["supertag", "field", "add-new"],
  summary: "Add a new field to a Supertag template.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    FIELD_OPTION,
    { name: "--type", description: "Field datatype", value: { kind: "enum" as const, enum: FIELD_DATATYPES } },
    {
      name: "--cardinality",
      description: "single or list",
      value: { kind: "enum" as const, enum: FIELD_CARDINALITIES },
    },
    { name: "--required", description: "Required toggle", value: { kind: "enum" as const, enum: BOOLEAN_VALUES } },
    {
      name: "--options-from",
      description: "Supertag providing options (only with --type options-from-supertag)",
      value: { kind: "string" as const },
    },
    {
      name: "--optional",
      description: "Add as an Optional Field Contribution instead of a template placement",
      value: { kind: "enum" as const, enum: BOOLEAN_VALUES },
    },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const supertag = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("supertag"),
      ["supertag"],
    );
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
      optionsFrom === undefined
        ? undefined
        : (await resolveNodeTarget(context.session, workspaceId, context.perspective, optionsFrom, ["supertag"]))
            .nodeId;
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
    const { result, data } = await executeWrite(context, "supertag.field.add-new", actions);
    const resource = descriptor(workspaceId, "field", fieldDefinitionId, name);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, field: resource },
      view: writeView("Added field", resource, `to ${supertag.label}`),
    });
  },
};

const fieldAddExisting: CommandDefinition = {
  path: ["supertag", "field", "add-existing"],
  summary: "Add a discoverable field definition to a Supertag template.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    {
      name: "--field",
      description: "Existing discoverable Field Definition target",
      value: { kind: "string" as const },
      required: true,
    },
    {
      name: "--optional",
      description: "Add as an Optional Field Contribution instead of a template placement",
      value: { kind: "enum" as const, enum: BOOLEAN_VALUES },
    },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const supertag = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("supertag"),
      ["supertag"],
    );
    const field = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--field"),
      ["field"],
    );
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
    const { result, data } = await executeWrite(context, "supertag.field.add-existing", actions);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, field: field.descriptor },
      view: writeView("Added field", field.descriptor, `to ${supertag.label}`),
    });
  },
};
