import {
  FIELD_CARDINALITIES,
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPES,
  type EditAction,
  type FieldDatatype,
} from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { resolveNodeTarget } from "../target/index.js";
import {
  cardinalityConfiguration,
  datatypeConfiguration,
  executeWrite,
  optionalityConfiguration,
  requiredEndpoint,
  writeResult,
  workspaceIdOf,
} from "../intent/index.js";
import { BOOLEAN_VALUES } from "../value/field-values.js";

const fieldConfigure: CommandDefinition = {
  path: ["field", "configure"],
  summary: "Reconfigure a Field Definition's datatype, cardinality, or required state.",
  positionals: [["field", "Field Definition target"]],
  options: [
    { name: "--type", description: "New datatype", value: { kind: "enum" as const, enum: FIELD_DATATYPES } },
    {
      name: "--cardinality",
      description: "single or list",
      value: { kind: "enum" as const, enum: FIELD_CARDINALITIES },
    },
    { name: "--required", description: "Required toggle", value: { kind: "enum" as const, enum: BOOLEAN_VALUES } },
    { name: "--options-from", description: "Supertag providing options", value: { kind: "string" as const } },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const field = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("field"), [
      "field",
    ]);
    const datatype = args.option("--type") as FieldDatatype | undefined;
    const optionsFrom = args.option("--options-from");
    const optionsSupertagId =
      optionsFrom === undefined
        ? undefined
        : (await resolveNodeTarget(context.session, workspaceId, context.perspective, optionsFrom, ["supertag"]))
            .nodeId;
    if (optionsFrom !== undefined && datatype !== "options-from-supertag") {
      throw new CliError("usage", "--options-from is only valid with --type options-from-supertag.");
    }
    if (
      args.option("--type") === undefined &&
      args.option("--cardinality") === undefined &&
      args.option("--required") === undefined
    ) {
      throw new CliError("usage", "field configure needs at least one of --type, --cardinality, --required.");
    }
    const actions: EditAction[] = [];
    if (datatype !== undefined) {
      actions.push(datatypeConfiguration(field.nodeId, datatype, optionsSupertagId));
    }
    if (args.option("--cardinality") !== undefined) {
      const endpoint =
        args.option("--cardinality") === "list" ? FIELD_CARDINALITY_NODE_IDS.list : FIELD_CARDINALITY_NODE_IDS.single;
      actions.push(cardinalityConfiguration(field.nodeId, endpoint));
    }
    if (args.option("--required") !== undefined) {
      const endpoint = requiredEndpoint(args.option("--required") === "true");
      actions.push(optionalityConfiguration(field.nodeId, endpoint));
    }
    const { result, data } = await executeWrite(context, "field.configure", actions);
    return writeResult(data, result, {
      extra: { target: field.descriptor },
      view: writeView("Configured", field.descriptor),
    });
  },
};

export function registerFieldConfigureCommands(catalog: CommandCatalog): void {
  catalog.register(fieldConfigure);
}
