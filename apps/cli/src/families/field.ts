import {
  END_SEQUENCE_ANCHOR as end,
  FIELD_CARDINALITIES,
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPES,
  workspaceSchemaNodeId,
  type EditAction,
  type FieldDatatype,
} from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { enumOption, readCommand, stringOption, writeCommand, type CommandDefinition } from "../command/index.js";
import { resolveTarget, resource } from "../target/index.js";
import {
  cardinalityConfiguration,
  datatypeConfiguration,
  identity,
  optionalityConfiguration,
  requiredEndpoint,
  runWrite,
  workspaceIdOf,
} from "../intent/index.js";
import { BOOLEAN_VALUES, datatypeOfEndpoint } from "../value/field-values.js";
import { registerFieldValueCommands } from "./field-values.js";
import { registerFieldConfigureCommands } from "./field-configure.js";

/**
 * Field family: Field Definition lifecycle and configuration. `field show`
 * keeps Definition configuration and (with --on) instance Effective /
 * Materialized content distinct; configuration writes are formal Field
 * Definition edits.
 */

export function registerFieldCommands(catalog: CommandCatalog): void {
  catalog.register(fieldCreate);
  catalog.register(fieldShow);
  registerFieldConfigureCommands(catalog);
  catalog.register(fieldMakeDiscoverable);
  registerFieldValueCommands(catalog);
}

const fieldCreate = writeCommand({
  path: ["field", "create"],
  summary: "Create a workspace Field Definition.",
  positionals: [["name", "Field name"]],
  options: [
    enumOption("--type", FIELD_DATATYPES, "Field datatype (default plain)"),
    enumOption("--cardinality", FIELD_CARDINALITIES, "single (default) or list"),
    enumOption("--required", BOOLEAN_VALUES, "Required toggle (default false)"),
    stringOption("--options-from", "Supertag providing options (only with --type options-from-supertag)"),
  ],
  run: runWrite("field.create", async (context, args) => {
    const name = args.positional("name");
    const rawDatatype = args.option("--type");
    const optionsFrom = args.option("--options-from");
    if (optionsFrom !== undefined && rawDatatype !== "options-from-supertag") {
      throw new CliError("usage", "--options-from is only valid with --type options-from-supertag.");
    }
    if (rawDatatype === "options-from-supertag" && optionsFrom === undefined) {
      throw new CliError("usage", "--type options-from-supertag requires --options-from.");
    }
    const optionsSupertagId =
      optionsFrom === undefined ? undefined : (await resolveTarget(context, optionsFrom, ["supertag"])).nodeId;
    const datatype = (rawDatatype ?? "plain") as FieldDatatype;
    const fieldDefinitionId = identity(context.requestId, "field-definition");
    const actions: EditAction[] = [
      {
        kind: "node-create",
        nodeId: fieldDefinitionId,
        occurrenceId: `${fieldDefinitionId}-original`,
        parentNodeId: workspaceSchemaNodeId(workspaceIdOf(context)),
        anchor: end,
        intrinsicNodeType: "field-definition",
        seed: { text: [{ value: name, attributes: {} }] },
      },
      datatypeConfiguration(fieldDefinitionId, datatype, optionsSupertagId),
    ];
    if (args.option("--cardinality") === "list") {
      actions.push(cardinalityConfiguration(fieldDefinitionId, FIELD_CARDINALITY_NODE_IDS.list));
    }
    if (args.option("--required") !== undefined) {
      actions.push(optionalityConfiguration(fieldDefinitionId, requiredEndpoint(args.option("--required") === "true")));
    }
    const created = resource(context, "field", fieldDefinitionId, name);
    return { actions, extra: { target: created }, view: writeView("Created", created) };
  }),
});

const fieldShow: CommandDefinition = readCommand({
  path: ["field", "show"],
  summary: "Show a Field Definition's configuration, or the instance field on a node (--on).",
  positionals: [["field", "Field Definition target"]],
  options: [stringOption("--on", "Node whose instance field to show")],
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const field = await resolveTarget(context, args.positional("field"), ["field"]);
    const configurations = await context.session.readProjection(
      workspaceId,
      context.perspective,
      "fieldDefinitionConfigurations",
    );
    const entries = configurations[field.nodeId] ?? [];
    const datatype =
      datatypeOfEndpoint(entries.find((entry) => entry.kind === "datatype")?.datatypeNodeId ?? null) ?? "plain";
    const cardinality = (entries.find((entry) => entry.kind === "cardinality")?.cardinalityNodeId ?? "").endsWith(
      ":list",
    )
      ? "list"
      : "single";
    const definitionData = {
      resource: field.descriptor,
      datatype,
      cardinality,
      required: (entries.find((entry) => entry.kind === "optionality")?.optionalityNodeId ?? "").endsWith(":required"),
    };
    const ownerToken = args.option("--on");
    if (ownerToken === undefined) {
      const templateFields = await context.session.readProjection(workspaceId, context.perspective, "templateFields");
      const uses = Object.entries(templateFields).flatMap(([supertagId, fields]) =>
        fields
          .filter((candidate) => candidate.fieldDefinitionId === field.nodeId)
          .map((candidate) => ({ supertagId, visibility: candidate.visibility })),
      );
      return okOutcome(
        {
          ...definitionData,
          uses: uses.map((use) => ({
            supertag: resource(context, "supertag", use.supertagId, use.supertagId),
            visibility: use.visibility,
          })),
        },
        {
          view: {
            kind: "text",
            lines: [
              `Field ${field.label} (${datatype}, ${cardinality})`,
              `Ref: ${field.descriptor.ref}`,
              ...(uses.length === 0
                ? ["Not used in any template."]
                : uses.map((use) => `Used in supertag ${use.supertagId} (${use.visibility})`)),
            ],
          },
        },
      );
    }
    const owner = await resolveTarget(context, ownerToken, ["node"]);
    const [materialized, typed, effective] = await Promise.all([
      context.session.readProjection(workspaceId, context.perspective, "materializedFields"),
      context.session.readProjection(workspaceId, context.perspective, "typedFieldValues"),
      context.session.readProjection(workspaceId, context.perspective, "effectiveFields"),
    ]);
    const ownerMaterialized = (materialized[owner.nodeId] ?? []).find(
      (entry) => entry.fieldDefinitionId === field.nodeId,
    );
    const ownerTyped = (typed[owner.nodeId] ?? []).find((entry) => entry.fieldDefinitionId === field.nodeId);
    const ownerEffective = (effective[owner.nodeId] ?? []).find((entry) => entry.fieldDefinitionId === field.nodeId);
    return okOutcome(
      {
        ...definitionData,
        on: owner.descriptor,
        state:
          ownerMaterialized === undefined && ownerTyped === undefined
            ? ownerEffective === undefined
              ? "absent"
              : "effective"
            : "materialized",
        typedValue:
          ownerTyped === undefined
            ? null
            : { state: ownerTyped.state, value: "value" in ownerTyped ? ownerTyped.value : null },
      },
      {
        view: {
          kind: "text",
          lines: [
            `Field ${field.label} on ${owner.label}`,
            `Ref: ${field.descriptor.ref}`,
            `State: ${
              ownerMaterialized === undefined && ownerTyped === undefined
                ? ownerEffective === undefined
                  ? "absent"
                  : "effective placeholder"
                : "materialized"
            }`,
            ...(ownerTyped !== undefined && ownerTyped.state === "value" && "value" in ownerTyped
              ? [`Value: ${describeTypedValue(ownerTyped.value)}`]
              : []),
          ],
        },
      },
    );
  },
});

function describeTypedValue(value: unknown): string {
  if (typeof value === "object" && value !== null && "value" in value) {
    return String(value.value);
  }
  if (typeof value === "object" && value !== null && "targetNodeId" in value) {
    return String(value.targetNodeId);
  }
  return String(value);
}

const fieldMakeDiscoverable = writeCommand({
  path: ["field", "make-discoverable"],
  summary: "Move a template-owned field definition into the workspace schema for reuse.",
  positionals: [["field", "Field Definition target"]],
  run: runWrite("field.make-discoverable", async (context, args) => {
    const field = await resolveTarget(context, args.positional("field"), ["field"]);
    const templateFields = await context.session.readProjection(
      workspaceIdOf(context),
      context.perspective,
      "templateFields",
    );
    const owner = Object.entries(templateFields).find(([, fields]) =>
      fields.some(
        (candidate) =>
          candidate.fieldDefinitionId === field.nodeId && candidate.fieldDefinitionOwner === "template-field",
      ),
    );
    if (owner === undefined) {
      throw new CliError("unsupported", `Field ${field.descriptor.ref} is not owned by a template field.`);
    }
    const [supertagId, use] = owner;
    const templateField = use.find((candidate) => candidate.fieldDefinitionId === field.nodeId);
    if (supertagId === undefined || templateField === undefined) {
      throw new CliError("unsupported", `Field ${field.descriptor.ref} has no owning template field.`);
    }
    return {
      actions: [
        {
          kind: "supertag-template-field-make-discoverable",
          supertagId,
          templateFieldId: templateField.factActionId,
        },
      ],
      extra: { target: field.descriptor },
      view: writeView("Made discoverable", field.descriptor),
    };
  }),
});
