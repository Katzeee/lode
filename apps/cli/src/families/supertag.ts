import type { EditAction } from "@lode/sdk";

import { okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { descriptor, labelOf, resolveNodeTarget } from "../target/index.js";
import { executeWrite, identity, writeResult, workspaceIdOf } from "../intent/index.js";
import { registerSupertagFieldCommands } from "./supertag-field.js";
import { registerSupertagRelationCommands } from "./supertag-relations.js";
import type { TemplateField } from "@lode/sdk";

/**
 * Supertag family: definitions, applications, and extensions. Applications
 * and template uses are read from the projection before composing the formal
 * actions, so callers pass Supertag and Node targets, never relation ids.
 */

export function registerSupertagCommands(catalog: CommandCatalog): void {
  catalog.register(supertagCreate);
  catalog.register(supertagShow);
  catalog.register(supertagApply);
  catalog.register(supertagRemove);
  registerSupertagRelationCommands(catalog);
  registerSupertagFieldCommands(catalog);
}

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

const supertagCreate: CommandDefinition = {
  path: ["supertag", "create"],
  summary: "Create a Supertag Definition.",
  positionals: [["name", "Supertag name"]],
  options: [
    {
      name: "--under",
      description: "Parent node target (default: workspace root)",
      value: { kind: "string" as const },
    },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const name = args.positional("name");
    const under = args.option("--under");
    const parentNodeId =
      under === undefined
        ? workspaceId
        : (await resolveNodeTarget(context.session, workspaceId, context.perspective, under, ["node"])).nodeId;
    const supertagId = identity(context.requestId, "supertag");
    const actions: readonly EditAction[] = [
      {
        kind: "node-create",
        nodeId: supertagId,
        occurrenceId: `${supertagId}-original`,
        parentNodeId,
        anchor: end,
        intrinsicNodeType: "supertag-definition",
        seed: { text: [{ value: name, attributes: {} }] },
      },
    ];
    const { result, data } = await executeWrite(context, "supertag.create", actions);
    const resource = descriptor(workspaceId, "supertag", supertagId, name);
    return writeResult(data, result, { extra: { target: resource }, view: writeView("Created", resource) });
  },
};

const supertagShow: CommandDefinition = {
  path: ["supertag", "show"],
  summary: "Show a Supertag Definition: template fields, optional fields, and bases.",
  positionals: [["supertag", "Supertag target"]],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("supertag"),
      ["supertag"],
    );
    const [templateFields, optional, extensions, nodes] = await Promise.all([
      context.session.readProjection(workspaceId, context.perspective, "templateFields") as Promise<
        Record<string, TemplateField[]>
      >,
      context.session.readProjection(workspaceId, context.perspective, "optionalFieldContributions") as Promise<
        Record<string, readonly { fieldDefinitionId: string }[]>
      >,
      context.session.readProjection(workspaceId, context.perspective, "supertagExtensions") as Promise<
        Record<string, string[]>
      >,
      context.session.readProjection(workspaceId, context.perspective, "nodes"),
    ]);
    const fieldLabel = (fieldDefinitionId: string): string => labelOf(nodes, fieldDefinitionId);
    const fields = templateFields[target.nodeId] ?? [];
    const optionalFields = optional[target.nodeId] ?? [];
    const bases = extensions[target.nodeId] ?? [];
    return okOutcome(
      {
        resource: target.descriptor,
        templateFields: fields.map((field) => ({
          field: descriptor(workspaceId, "field", field.fieldDefinitionId, fieldLabel(field.fieldDefinitionId)),
          templateFieldNodeId: field.templateFieldNodeId,
          visibility: field.visibility,
          owner: field.fieldDefinitionOwner,
        })),
        optionalFields: optionalFields.map((field) => ({
          field: descriptor(workspaceId, "field", field.fieldDefinitionId, fieldLabel(field.fieldDefinitionId)),
        })),
        extends: bases.map((base) => descriptor(workspaceId, "supertag", base, fieldLabel(base))),
      },
      {
        view: {
          kind: "text",
          lines: [
            `Supertag ${target.label}`,
            `Ref: ${target.descriptor.ref}`,
            ...(bases.length === 0 ? [] : [`Extends: ${bases.map((base) => fieldLabel(base)).join(", ")}`]),
            ...(fields.length === 0
              ? ["No template fields."]
              : [
                  "Template fields:",
                  ...fields.map(
                    (field) =>
                      `  ${fieldLabel(field.fieldDefinitionId)} (${field.visibility}${field.fieldDefinitionOwner === "workspace-schema" ? ", discoverable" : ""})`,
                  ),
                ]),
            ...(optionalFields.length === 0
              ? []
              : ["Optional fields:", ...optionalFields.map((field) => `  ${fieldLabel(field.fieldDefinitionId)}`)]),
          ],
        },
      },
    );
  },
};

const supertagApply: CommandDefinition = {
  path: ["supertag", "apply"],
  summary: "Apply a Supertag to a node.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    { name: "--to", description: "Node receiving the Supertag", value: { kind: "string" as const }, required: true },
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
    const host = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--to"),
      ["node"],
    );
    const actions: readonly EditAction[] = [
      {
        kind: "supertag-application-create",
        hostNodeId: host.nodeId,
        supertagId: supertag.nodeId,
        anchor: end,
      },
    ];
    const { result, data } = await executeWrite(context, "supertag.apply", actions);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, to: host.descriptor },
      view: writeView("Applied", supertag.descriptor, `to ${host.label}`),
    });
  },
};

const supertagRemove: CommandDefinition = {
  path: ["supertag", "remove"],
  summary: "Remove a Supertag application from a node.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    { name: "--to", description: "Node losing the Supertag", value: { kind: "string" as const }, required: true },
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
    const host = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--to"),
      ["node"],
    );
    const actions: readonly EditAction[] = [
      {
        kind: "supertag-remove",
        hostNodeId: host.nodeId,
        supertagId: supertag.nodeId,
      },
    ];
    const { result, data } = await executeWrite(context, "supertag.remove", actions);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, to: host.descriptor },
      view: writeView("Removed", supertag.descriptor, `from ${host.label}`),
    });
  },
};
