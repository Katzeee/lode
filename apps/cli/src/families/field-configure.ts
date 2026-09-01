import {
  FIELD_CARDINALITIES,
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPES,
  type EditAction,
  type FieldDatatype,
} from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { enumOption, stringOption, writeCommand } from "../command/index.js";
import { resolveTarget } from "../target/index.js";
import {
  cardinalityConfiguration,
  datatypeConfiguration,
  optionalityConfiguration,
  requiredEndpoint,
  runWrite,
} from "../intent/index.js";
import { BOOLEAN_VALUES } from "../value/field-values.js";

const fieldConfigure = writeCommand({
  path: ["field", "configure"],
  summary: "Reconfigure a Field Definition's datatype, cardinality, or required state.",
  positionals: [["field", "Field Definition target"]],
  options: [
    enumOption("--type", FIELD_DATATYPES, "New datatype"),
    enumOption("--cardinality", FIELD_CARDINALITIES, "single or list"),
    enumOption("--required", BOOLEAN_VALUES, "Required toggle"),
    stringOption("--options-from", "Supertag providing options"),
  ],
  run: runWrite("field.configure", async (context, args) => {
    const field = await resolveTarget(context, args.positional("field"), ["field"]);
    const datatype = args.option("--type") as FieldDatatype | undefined;
    const optionsFrom = args.option("--options-from");
    const optionsSupertagId =
      optionsFrom === undefined ? undefined : (await resolveTarget(context, optionsFrom, ["supertag"])).nodeId;
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
    return {
      actions,
      extra: { target: field.descriptor },
      view: writeView("Configured", field.descriptor),
    };
  }),
});

export function registerFieldConfigureCommands(catalog: CommandCatalog): void {
  catalog.register(fieldConfigure);
}
