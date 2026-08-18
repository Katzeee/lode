import type { EditMutation, FieldDefinitionConfiguration, MaterializedField, TypedFieldValue } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { descriptor, resolveNodeTarget } from "../target/index.js";
import { executeWrite, identity, writeResult, workspaceIdOf } from "../intent/index.js";
import { datatypeOfEndpoint, FIELD_DATATYPES } from "../value/field-values.js";
import {
  cardinalityConfiguration,
  definitionConfigurationMutations,
  optionalityConfiguration,
} from "./supertag-field-mutations.js";
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

const TYPE_ENUM = [...FIELD_DATATYPES] as unknown as readonly string[];
const BOOLEAN_ENUM = ["true", "false"] as const;
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

const fieldCreate: CommandDefinition = {
  path: ["field", "create"],
  summary: "Create a workspace Field Definition.",
  positionals: [["name", "Field name"]],
  options: [
    {
      name: "--type",
      description: "Field datatype (default plain)",
      value: { kind: "enum" as const, enum: TYPE_ENUM },
    },
    {
      name: "--cardinality",
      description: "single (default) or list",
      value: { kind: "enum" as const, enum: ["single", "list"] as const },
    },
    {
      name: "--required",
      description: "Required toggle (default false)",
      value: { kind: "enum" as const, enum: BOOLEAN_ENUM },
    },
    {
      name: "--options-from",
      description: "Supertag providing options (only with --type options-from-supertag)",
      value: { kind: "string" as const },
    },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
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
      optionsFrom === undefined
        ? undefined
        : (await resolveNodeTarget(context.session, workspaceId, context.perspective, optionsFrom, ["supertag"]))
            .nodeId;
    const datatype = (rawDatatype ?? "plain") as (typeof FIELD_DATATYPES)[number];
    const fieldDefinitionId = identity(context.requestId, "field-definition");
    const mutations: EditMutation[] = [
      {
        kind: "node-create",
        nodeId: fieldDefinitionId,
        occurrenceId: `${fieldDefinitionId}-original`,
        parentNodeId: `workspace-schema:v1:${encodeURIComponent(workspaceId)}`,
        anchor: end,
        intrinsicNodeType: "field-definition",
        seed: { text: [{ value: name, attributes: {} }] },
      },
      ...definitionConfigurationMutations(context.requestId, fieldDefinitionId, datatype, optionsSupertagId),
    ];
    if (args.option("--cardinality") === "list") {
      mutations.push(
        cardinalityConfiguration(context.requestId, fieldDefinitionId, "system-field-cardinality:v1:list"),
      );
    }
    if (args.option("--required") !== undefined) {
      mutations.push(
        optionalityConfiguration(
          context.requestId,
          fieldDefinitionId,
          requiredEndpoint(args.option("--required") === "true"),
        ),
      );
    }
    const { result, data } = await executeWrite(context, "field.create", mutations);
    const resource = descriptor(workspaceId, "field", fieldDefinitionId, name);
    return writeResult(data, result, { extra: { target: resource }, view: writeView("Created", resource) });
  },
};

const fieldShow: CommandDefinition = {
  path: ["field", "show"],
  summary: "Show a Field Definition's configuration, or the instance field on a node (--on).",
  positionals: [["field", "Field Definition target"]],
  options: [{ name: "--on", description: "Node whose instance field to show", value: { kind: "string" as const } }],
  kind: "read",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const field = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("field"), [
      "field",
    ]);
    const configurations = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "fieldDefinitionConfigurations",
    )) as Record<string, readonly FieldDefinitionConfiguration[]>;
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
      const templateFields = (await context.session.readProjection(
        workspaceId,
        context.perspective,
        "templateFields",
      )) as Record<string, readonly { fieldDefinitionId: string; visibility: string }[]>;
      const uses = Object.entries(templateFields).flatMap(([supertagId, fields]) =>
        fields
          .filter((candidate) => candidate.fieldDefinitionId === field.nodeId)
          .map((candidate) => ({ supertagId, visibility: candidate.visibility })),
      );
      return okOutcome(
        {
          ...definitionData,
          uses: uses.map((use) => ({
            supertag: descriptor(workspaceId, "supertag", use.supertagId, use.supertagId),
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
    const owner = await resolveNodeTarget(context.session, workspaceId, context.perspective, ownerToken, ["node"]);
    const [materialized, typed, effective] = await Promise.all([
      context.session.readProjection(workspaceId, context.perspective, "materializedFields") as Promise<
        Record<string, readonly MaterializedField[]>
      >,
      context.session.readProjection(workspaceId, context.perspective, "typedFieldValues") as Promise<
        Record<string, readonly TypedFieldValue[]>
      >,
      context.session.readProjection(workspaceId, context.perspective, "effectiveFields") as Promise<
        Record<string, readonly { fieldDefinitionId: string }[]>
      >,
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
};

function describeTypedValue(value: unknown): string {
  if (typeof value === "object" && value !== null && "value" in value) {
    return String(value.value);
  }
  if (typeof value === "object" && value !== null && "targetNodeId" in value) {
    return String(value.targetNodeId);
  }
  return String(value);
}

const fieldMakeDiscoverable: CommandDefinition = {
  path: ["field", "make-discoverable"],
  summary: "Move a template-owned field definition into the workspace schema for reuse.",
  positionals: [["field", "Field Definition target"]],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const field = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("field"), [
      "field",
    ]);
    const templateFields = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "templateFields",
    )) as Record<
      string,
      readonly { fieldDefinitionId: string; templateFieldNodeId: string; fieldDefinitionOwner: string }[]
    >;
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
    const templateFieldNodeId = use.find(
      (candidate) => candidate.fieldDefinitionId === field.nodeId,
    )?.templateFieldNodeId;
    if (supertagId === undefined || templateFieldNodeId === undefined) {
      throw new CliError("unsupported", `Field ${field.descriptor.ref} has no owning template field.`);
    }
    const { result, data } = await executeWrite(context, "field.make-discoverable", [
      {
        kind: "supertag-template-field-make-discoverable",
        supertagId,
        templateFieldNodeId,
        fieldDefinitionId: field.nodeId,
      },
    ]);
    return writeResult(data, result, {
      extra: { target: field.descriptor },
      view: writeView("Made discoverable", field.descriptor),
    });
  },
};

function requiredEndpoint(required: boolean): string {
  return required ? "system-field-optionality:v1:required" : "system-field-optionality:v1:not-required";
}
