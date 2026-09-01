import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { EditAction } from "@lode/sdk";

import { okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { readCommand, stringOption, writeCommand } from "../command/index.js";
import { labelOf, resolveTarget, resource } from "../target/index.js";
import { identity, runWrite, workspaceIdOf } from "../intent/index.js";
import { registerSupertagFieldCommands } from "./supertag-field.js";
import { registerSupertagRelationCommands } from "./supertag-relations.js";

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

const supertagCreate = writeCommand({
  path: ["supertag", "create"],
  summary: "Create a Supertag Definition.",
  positionals: [["name", "Supertag name"]],
  options: [stringOption("--under", "Parent node target (default: workspace root)")],
  run: runWrite("supertag.create", async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const name = args.positional("name");
    const under = args.option("--under");
    const parentNodeId = under === undefined ? workspaceId : (await resolveTarget(context, under, ["node"])).nodeId;
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
    const created = resource(context, "supertag", supertagId, name);
    return { actions, extra: { target: created }, view: writeView("Created", created) };
  }),
});

const supertagShow = readCommand({
  path: ["supertag", "show"],
  summary: "Show a Supertag Definition: template fields, optional fields, and bases.",
  positionals: [["supertag", "Supertag target"]],
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const [templateFields, optional, extensions, nodes] = await Promise.all([
      context.session.readProjection(workspaceId, context.perspective, "templateFields"),
      context.session.readProjection(workspaceId, context.perspective, "optionalFieldContributions"),
      context.session.readProjection(workspaceId, context.perspective, "supertagExtensions"),
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
          field: resource(context, "field", field.fieldDefinitionId, fieldLabel(field.fieldDefinitionId)),
          templateFieldNodeId: field.templateFieldNodeId,
          visibility: field.visibility,
          owner: field.fieldDefinitionOwner,
        })),
        optionalFields: optionalFields.map((field) => ({
          field: resource(context, "field", field.fieldDefinitionId, fieldLabel(field.fieldDefinitionId)),
        })),
        extends: bases.map((base) => resource(context, "supertag", base, fieldLabel(base))),
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
});

const supertagApply = writeCommand({
  path: ["supertag", "apply"],
  summary: "Apply a Supertag to a node.",
  positionals: [["supertag", "Supertag target"]],
  options: [stringOption("--to", "Node receiving the Supertag", { required: true })],
  run: runWrite("supertag.apply", async (context, args) => {
    const supertag = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const host = await resolveTarget(context, args.requiredOption("--to"), ["node"]);
    const actions: readonly EditAction[] = [
      {
        kind: "supertag-application-create",
        hostNodeId: host.nodeId,
        supertagId: supertag.nodeId,
        anchor: end,
      },
    ];
    return {
      actions,
      extra: { target: supertag.descriptor, to: host.descriptor },
      view: writeView("Applied", supertag.descriptor, `to ${host.label}`),
    };
  }),
});

const supertagRemove = writeCommand({
  path: ["supertag", "remove"],
  summary: "Remove a Supertag application from a node.",
  positionals: [["supertag", "Supertag target"]],
  options: [stringOption("--to", "Node losing the Supertag", { required: true })],
  run: runWrite("supertag.remove", async (context, args) => {
    const supertag = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const host = await resolveTarget(context, args.requiredOption("--to"), ["node"]);
    const actions: readonly EditAction[] = [
      {
        kind: "supertag-remove",
        hostNodeId: host.nodeId,
        supertagId: supertag.nodeId,
      },
    ];
    return {
      actions,
      extra: { target: supertag.descriptor, to: host.descriptor },
      view: writeView("Removed", supertag.descriptor, `from ${host.label}`),
    };
  }),
});
