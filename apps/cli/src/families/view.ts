import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { ViewOptionsSpec, ViewType } from "@lode/sdk";

import { CliError, okOutcome } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { descriptor, resolveNodeTarget } from "../target/index.js";
import { workspaceIdOf } from "../intent/index.js";
import { registerViewPresentationCommands } from "./view-presentation.js";
import { registerViewOptionCommands } from "./view-options.js";
import { writeViewActions } from "./view-actions.js";

/**
 * View family: the shared default View authority. Each command emits the
 * semantic View edit that corresponds to the user's operation.
 */

export function registerViewCommands(catalog: CommandCatalog): void {
  catalog.register(viewShow);
  registerViewOptionCommands(catalog);
  registerViewPresentationCommands(catalog);
  catalog.register(viewColumnAdd);
  catalog.register(viewColumnRemove);
  catalog.register(viewColumnMove);
}

const viewShow: CommandDefinition = {
  path: ["view", "show"],
  summary: "Show the host's shared default View: type and options.",
  positionals: [["node", "View host target"]],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const host = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
      "search",
    ]);
    const definitions = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "sharedDefaultViewDefinitions",
    )) as Record<string, readonly { viewType: ViewType; viewDefinitionNodeId: string; options: ViewOptionsSpec }[]>;
    const current = (definitions[host.nodeId] ?? []).at(0);
    if (current === undefined) {
      return okOutcome(
        { resource: host.descriptor, viewType: null, options: null },
        { view: { kind: "text", lines: [`${host.label} uses the Implicit Outline (no shared default View).`] } },
      );
    }
    return okOutcome(
      {
        resource: descriptor(workspaceId, "view", current.viewDefinitionNodeId, `${host.label} view`),
        on: host.descriptor,
        viewType: current.viewType,
        options: current.options,
      },
      {
        view: {
          kind: "text",
          lines: [
            `${host.label} — ${current.viewType} view`,
            `Columns: ${current.options.columns.length === 0 ? "(none)" : current.options.columns.map((column) => column.fieldDefinitionId).join(", ")}`,
            `Filter: ${current.options.filter === null ? "(none)" : "set"}`,
            `Sort: ${current.options.sort === null ? "(none)" : `${current.options.sort.fieldDefinitionId} ${current.options.sort.direction}`}`,
            `Group: ${current.options.group === null ? "(none)" : current.options.group.fieldDefinitionId}`,
          ],
        },
      },
    );
  },
};

const viewColumnAdd: CommandDefinition = {
  path: ["view", "column", "add"],
  summary: "Append a field column to the host's View.",
  positionals: [["field", "Field Definition target"]],
  options: [{ name: "--on", description: "View host target", value: { kind: "string" as const }, required: true }],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const field = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("field"), [
      "field",
    ]);
    return writeViewActions(context, args.requiredOption("--on"), "view.column.add", (current) => {
      if (current.options.columns.some((column) => column.fieldDefinitionId === field.nodeId)) {
        throw new CliError("invalid-value", `Column for ${field.descriptor.ref} already exists.`);
      }
      return [
        {
          kind: "view-column-add",
          hostNodeId: current.hostNodeId,
          viewId: current.viewId,
          fieldDefinitionId: field.nodeId,
          anchor: end,
        },
      ];
    });
  },
};

const viewColumnRemove: CommandDefinition = {
  path: ["view", "column", "remove"],
  summary: "Remove a field column from the host's View.",
  positionals: [["field", "Field Definition target"]],
  options: [{ name: "--on", description: "View host target", value: { kind: "string" as const }, required: true }],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const field = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("field"), [
      "field",
    ]);
    return writeViewActions(context, args.requiredOption("--on"), "view.column.remove", (current) => [
      {
        kind: "view-column-remove",
        hostNodeId: current.hostNodeId,
        viewId: current.viewId,
        fieldDefinitionId: field.nodeId,
      },
    ]);
  },
};

const viewColumnMove: CommandDefinition = {
  path: ["view", "column", "move"],
  summary: "Reorder a field column before or after another.",
  positionals: [["field", "Field Definition target"]],
  options: [
    { name: "--on", description: "View host target", value: { kind: "string" as const }, required: true },
    {
      name: "--before",
      description: "Move before this field column",
      value: { kind: "string" as const },
      conflicts: ["--after"],
    },
    {
      name: "--after",
      description: "Move after this field column",
      value: { kind: "string" as const },
      conflicts: ["--before"],
    },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const field = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("field"), [
      "field",
    ]);
    const anchorToken = args.option("--before") ?? args.option("--after");
    if (anchorToken === undefined) {
      throw new CliError("usage", "view column move needs --before or --after.");
    }
    const anchor = await resolveNodeTarget(context.session, workspaceId, context.perspective, anchorToken, ["field"]);
    return writeViewActions(context, args.requiredOption("--on"), "view.column.move", (current) => {
      const moved = current.options.columns.find((column) => column.fieldDefinitionId === field.nodeId);
      const target = current.options.columns.find((column) => column.fieldDefinitionId === anchor.nodeId);
      if (moved === undefined || target === undefined) {
        throw new CliError("target-not-found", "Both columns must already exist in the View.");
      }
      return [
        {
          kind: "view-column-move",
          hostNodeId: current.hostNodeId,
          viewId: current.viewId,
          columnId: moved.columnId,
          anchor:
            args.option("--after") !== undefined
              ? { after: target.columnId, before: null, affinity: "after", fallback: "end" }
              : { after: null, before: target.columnId, affinity: "before", fallback: "start" },
        },
      ];
    });
  },
};
