import type { EditMutation, FieldDefinitionConfiguration } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { resolveNodeTarget } from "../target/index.js";
import { executeWrite, identity, writeResult, workspaceIdOf } from "../intent/index.js";
import { datatypeEndpoint, FIELD_DATATYPES } from "../value/field-values.js";

const TYPE_ENUM = [...FIELD_DATATYPES] as unknown as readonly string[];
const BOOLEAN_ENUM = ["true", "false"] as const;
import {
  cardinalityConfiguration,
  definitionConfigurationMutations,
  optionalityConfiguration,
} from "./supertag-field-mutations.js";

const fieldConfigure: CommandDefinition = {
  path: ["field", "configure"],
  summary: "Reconfigure a Field Definition's datatype, cardinality, or required state.",
  positionals: [["field", "Field Definition target"]],
  options: [
    { name: "--type", description: "New datatype", value: { kind: "enum" as const, enum: TYPE_ENUM } },
    {
      name: "--cardinality",
      description: "single or list",
      value: { kind: "enum" as const, enum: ["single", "list"] as const },
    },
    { name: "--required", description: "Required toggle", value: { kind: "enum" as const, enum: BOOLEAN_ENUM } },
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
    const datatype = args.option("--type") as (typeof FIELD_DATATYPES)[number] | undefined;
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
    const configurations = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "fieldDefinitionConfigurations",
    )) as Record<string, readonly FieldDefinitionConfiguration[]>;
    const entries = configurations[field.nodeId] ?? [];
    const existing = (kind: FieldDefinitionConfiguration["kind"]) => entries.find((entry) => entry.kind === kind);
    const mutations: EditMutation[] = [];
    if (datatype !== undefined) {
      const current = existing("datatype");
      if (current === undefined) {
        mutations.push(
          ...definitionConfigurationMutations(context.requestId, field.nodeId, datatype, optionsSupertagId),
        );
      } else {
        mutations.push({
          kind: "field-datatype-configure",
          fieldDefinitionId: field.nodeId,
          configurationNodeId: current.configurationNodeId,
          configurationOccurrenceId: current.configurationOccurrenceId,
          datatypeNodeId: datatypeEndpoint(datatype),
          valueOccurrenceId: identity(context.requestId, "value-occurrence"),
          ...(datatype === "options-from-supertag" && optionsSupertagId !== undefined ? { optionsSupertagId } : {}),
        });
      }
    }
    if (args.option("--cardinality") !== undefined) {
      const list = args.option("--cardinality") === "list";
      const endpoint = list ? "system-field-cardinality:v1:list" : "system-field-cardinality:v1:single";
      const current = existing("cardinality");
      if (current === undefined) {
        mutations.push(cardinalityConfiguration(context.requestId, field.nodeId, endpoint));
      } else {
        mutations.push({
          kind: "field-cardinality-configure",
          fieldDefinitionId: field.nodeId,
          configurationNodeId: current.configurationNodeId,
          configurationOccurrenceId: current.configurationOccurrenceId,
          cardinalityNodeId: endpoint,
          valueOccurrenceId: identity(context.requestId, "value-occurrence"),
        });
      }
    }
    if (args.option("--required") !== undefined) {
      const endpoint = requiredEndpoint(args.option("--required") === "true");
      const current = existing("optionality");
      if (current === undefined) {
        mutations.push(optionalityConfiguration(context.requestId, field.nodeId, endpoint));
      } else {
        mutations.push({
          kind: "field-optionality-configure",
          fieldDefinitionId: field.nodeId,
          configurationNodeId: current.configurationNodeId,
          configurationOccurrenceId: current.configurationOccurrenceId,
          optionalityNodeId: endpoint,
          valueOccurrenceId: identity(context.requestId, "value-occurrence"),
        });
      }
    }
    const { result, data } = await executeWrite(context, "field.configure", mutations);
    return writeResult(data, result, {
      extra: { target: field.descriptor },
      view: writeView("Configured", field.descriptor),
    });
  },
};

function requiredEndpoint(required: boolean): string {
  return required ? "system-field-optionality:v1:required" : "system-field-optionality:v1:not-required";
}

export function registerFieldConfigureCommands(catalog: CommandCatalog): void {
  catalog.register(fieldConfigure);
}
