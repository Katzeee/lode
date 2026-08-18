import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { resolveNodeTarget } from "../target/index.js";
import { identity, workspaceIdOf } from "../intent/index.js";
import { parseExpression } from "../value/expression.js";
import { compileSpec, resolveAst } from "../value/expression-compile.js";
import { readHostView, writeOptions } from "./view.js";

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
    const existing = await readHostView(context, args.positional("node"));
    const ast = await resolveAst(parseExpression(args.requiredOption("--where")), async (token, role) => {
      const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, token, [role]);
      return target.nodeId;
    });
    let counter = 0;
    const expression = compileSpec(ast, existing?.options.filter?.expression ?? null, () =>
      identity(context.requestId, `filter-expr-${(counter += 1)}`),
    );
    return writeOptions(context, args.positional("node"), "view.filter.set", (current) => ({
      ...current,
      filter: { filterNodeId: current.filter?.filterNodeId ?? `view-filter:v1:${workspaceId}`, expression },
    }));
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
    writeOptions(context, args.positional("node"), "view.filter.clear", (current) => ({ ...current, filter: null })),
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
    return writeOptions(context, args.requiredOption("--on"), "view.sort.set", (current) => ({
      ...current,
      sort: {
        sortNodeId: current.sort?.sortNodeId ?? `view-sort:v1:${field.nodeId}`,
        fieldDefinitionId: field.nodeId,
        direction: args.requiredOption("--direction") === "descending" ? "descending" : "ascending",
      },
    }));
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
    writeOptions(context, args.positional("node"), "view.sort.clear", (current) => ({ ...current, sort: null })),
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
    return writeOptions(context, args.requiredOption("--on"), "view.group.set", (current) => ({
      ...current,
      group: {
        groupNodeId: current.group?.groupNodeId ?? `view-group:v1:${field.nodeId}`,
        fieldDefinitionId: field.nodeId,
      },
    }));
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
    writeOptions(context, args.positional("node"), "view.group.clear", (current) => ({ ...current, group: null })),
};

export function registerViewOptionCommands(catalog: CommandCatalog): void {
  catalog.register(viewFilterSet);
  catalog.register(viewFilterClear);
  catalog.register(viewSortSet);
  catalog.register(viewSortClear);
  catalog.register(viewGroupSet);
  catalog.register(viewGroupClear);
}
