import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { CliError } from "../outcome/index.js";
import { resolveNodeTarget } from "../target/index.js";
import { workspaceIdOf } from "../intent/index.js";
import { parseExpression } from "../value/expression.js";
import { compileDraft, resolveAst } from "../value/expression-compile.js";
import { writeViewActions } from "./view.js";

const viewFilterSet: CommandDefinition = {
  path: ["view", "filter", "set"],
  summary: "Set the host's View filter expression.",
  positionals: [["node", "View host target"]],
  options: [{ name: "--where", description: "Filter expression", value: { kind: "string" as const }, required: true }],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const ast = await resolveAst(parseExpression(args.requiredOption("--where")), async (token, role) => {
      const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, token, [role]);
      return target.nodeId;
    });
    const expression = compileDraft(ast);
    return writeViewActions(context, args.positional("node"), "view.filter.set", (current) => [
      ...(current.options.filter === null
        ? []
        : [{ kind: "view-filter-remove" as const, hostNodeId: current.hostNodeId, viewId: current.viewId }]),
      {
        kind: "view-filter-create",
        hostNodeId: current.hostNodeId,
        viewId: current.viewId,
        expression,
        anchor: end,
      },
    ]);
  },
};

const viewFilterClear: CommandDefinition = {
  path: ["view", "filter", "clear"],
  summary: "Clear the host's View filter.",
  positionals: [["node", "View host target"]],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) =>
    writeViewActions(context, args.positional("node"), "view.filter.clear", (current) => [
      {
        kind: "view-filter-remove",
        hostNodeId: current.hostNodeId,
        viewId: current.viewId,
      },
    ]),
};

const viewSortSet: CommandDefinition = {
  path: ["view", "sort", "set"],
  summary: "Sort the host's View by one field.",
  positionals: [["field", "Field Definition target"]],
  options: [
    { name: "--on", description: "View host target", value: { kind: "string" as const }, required: true },
    {
      name: "--direction",
      description: "ascending or descending",
      value: { kind: "enum" as const, enum: ["ascending", "descending"] as const },
      required: true,
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
    return writeViewActions(context, args.requiredOption("--on"), "view.sort.set", (current) => {
      const direction = args.requiredOption("--direction") === "descending" ? "descending" : "ascending";
      return current.options.sort === null
        ? [
            {
              kind: "view-sort-add",
              hostNodeId: current.hostNodeId,
              viewId: current.viewId,
              fieldDefinitionId: field.nodeId,
              direction,
            },
          ]
        : [
            {
              kind: "view-sort-configure",
              hostNodeId: current.hostNodeId,
              viewId: current.viewId,
              sortId: current.options.sort.sortId,
              fieldDefinitionId: field.nodeId,
              direction,
            },
          ];
    });
  },
};

const viewSortClear: CommandDefinition = {
  path: ["view", "sort", "clear"],
  summary: "Clear the host's View sort.",
  positionals: [["node", "View host target"]],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) =>
    writeViewActions(context, args.positional("node"), "view.sort.clear", (current) => [
      {
        kind: "view-sort-remove",
        hostNodeId: current.hostNodeId,
        viewId: current.viewId,
      },
    ]),
};

const viewGroupSet: CommandDefinition = {
  path: ["view", "group", "set"],
  summary: "Group the host's View by one field.",
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
    return writeViewActions(context, args.requiredOption("--on"), "view.group.set", (current) => {
      if (current.options.group?.fieldDefinitionId === field.nodeId) {
        throw new CliError("invalid-value", "View already groups by this Field Definition.");
      }
      return [
        ...(current.options.group === null
          ? []
          : [{ kind: "view-group-remove" as const, hostNodeId: current.hostNodeId, viewId: current.viewId }]),
        {
          kind: "view-group-add" as const,
          hostNodeId: current.hostNodeId,
          viewId: current.viewId,
          fieldDefinitionId: field.nodeId,
        },
      ];
    });
  },
};

const viewGroupClear: CommandDefinition = {
  path: ["view", "group", "clear"],
  summary: "Clear the host's View grouping.",
  positionals: [["node", "View host target"]],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) =>
    writeViewActions(context, args.positional("node"), "view.group.clear", (current) => [
      {
        kind: "view-group-remove",
        hostNodeId: current.hostNodeId,
        viewId: current.viewId,
      },
    ]),
};

export function registerViewOptionCommands(catalog: CommandCatalog): void {
  catalog.register(viewFilterSet);
  catalog.register(viewFilterClear);
  catalog.register(viewSortSet);
  catalog.register(viewSortClear);
  catalog.register(viewGroupSet);
  catalog.register(viewGroupClear);
}
