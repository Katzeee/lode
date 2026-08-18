import type { EditMutation, ViewOptionsSpec, ViewType } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition, ProductCommandRun } from "../catalog/index.js";
import { descriptor, resolveNodeTarget } from "../target/index.js";
import { executeWrite, identity, writeResult, workspaceIdOf } from "../intent/index.js";
import { registerViewPresentationCommands } from "./view-presentation.js";
import { registerViewOptionCommands } from "./view-options.js";

/**
 * View family: the shared default View authority. Mode writes select the
 * View Type; column/filter/sort/group writes compose one options update with
 * stable option identities so unchanged options keep theirs.
 */

export function registerViewCommands(catalog: CommandCatalog): void {
  catalog.register(viewShow);
  registerViewOptionCommands(catalog);
  registerViewPresentationCommands(catalog);
  catalog.register(viewColumnAdd);
  catalog.register(viewColumnRemove);
  catalog.register(viewColumnMove);
}

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

type HostView = Readonly<{
  hostNodeId: string;
  hostLabel: string;
  viewDefinitionNodeId: string;
  options: ViewOptionsSpec;
}>;

export async function readHostView(
  context: Parameters<ProductCommandRun>[0],
  hostToken: string,
): Promise<HostView | null> {
  const workspaceId = workspaceIdOf(context);
  const host = await resolveNodeTarget(context.session, workspaceId, context.perspective, hostToken, [
    "node",
    "search",
  ]);
  const definitions = (await context.session.readProjection(
    workspaceId,
    context.perspective,
    "sharedDefaultViewDefinitions",
  )) as Record<string, readonly { viewDefinitionNodeId: string; options: ViewOptionsSpec }[]>;
  const current = (definitions[host.nodeId] ?? []).at(0);
  return current === undefined
    ? null
    : {
        hostNodeId: host.nodeId,
        hostLabel: host.label,
        viewDefinitionNodeId: current.viewDefinitionNodeId,
        options: current.options,
      };
}

export async function writeOptions(
  context: Parameters<ProductCommandRun>[0],
  hostToken: string,
  action: string,
  compose: (current: ViewOptionsSpec) => ViewOptionsSpec,
) {
  const workspaceId = workspaceIdOf(context);
  const host = await resolveNodeTarget(context.session, workspaceId, context.perspective, hostToken, [
    "node",
    "search",
  ]);
  const mutations: EditMutation[] = [];
  let viewDefinitionNodeId = identity(context.requestId, "view-definition");
  const existing = await readHostView(context, hostToken);
  if (existing === null) {
    const metanodes = (await context.session.readProjection(workspaceId, context.perspective, "metanodes")) as Record<
      string,
      string
    >;
    mutations.push({
      kind: "shared-default-view-definition-create",
      hostNodeId: host.nodeId,
      metanodeId: metanodes[host.nodeId] ?? `${host.nodeId}-metanode`,
      attachmentNodeId: `${viewDefinitionNodeId}-attachment`,
      attachmentOccurrenceId: `${viewDefinitionNodeId}-attachment-occurrence`,
      relationDefinitionOccurrenceId: `${viewDefinitionNodeId}-attachment-definition`,
      viewDefinitionNodeId,
      viewDefinitionOccurrenceId: `${viewDefinitionNodeId}-occurrence`,
      viewType: "outline",
      anchor: end,
    });
  } else {
    viewDefinitionNodeId = existing.viewDefinitionNodeId;
  }
  const options = compose(
    existing === null ? { columns: [], filter: null, sort: null, group: null } : existing.options,
  );
  mutations.push({
    kind: "shared-default-view-definition-options-update",
    hostNodeId: host.nodeId,
    viewDefinitionNodeId,
    options,
  });
  const { result, data } = await executeWrite(context, action, mutations);
  return writeResult(data, result, {
    extra: { target: descriptor(workspaceId, "view", viewDefinitionNodeId, `${host.label} view`), on: host.descriptor },
    view: writeView(
      "Updated view",
      descriptor(workspaceId, "view", viewDefinitionNodeId, `${host.label} view`),
      `on ${host.label}`,
    ),
  });
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
    return writeOptions(context, args.requiredOption("--on"), "view.column.add", (current) => {
      if (current.columns.some((column) => column.fieldDefinitionId === field.nodeId)) {
        throw new CliError("invalid-value", `Column for ${field.descriptor.ref} already exists.`);
      }
      const columnNodeId =
        current.columns.length === 0 ? `view-column:v1:${field.nodeId}` : `view-column:v1:${field.nodeId}`;
      return { ...current, columns: [...current.columns, { columnNodeId, fieldDefinitionId: field.nodeId }] };
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
    return writeOptions(context, args.requiredOption("--on"), "view.column.remove", (current) => ({
      ...current,
      columns: current.columns.filter((column) => column.fieldDefinitionId !== field.nodeId),
    }));
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
    return writeOptions(context, args.requiredOption("--on"), "view.column.move", (current) => {
      const columns = [...current.columns];
      const from = columns.findIndex((column) => column.fieldDefinitionId === field.nodeId);
      const to = columns.findIndex((column) => column.fieldDefinitionId === anchor.nodeId);
      if (from < 0 || to < 0) {
        throw new CliError("target-not-found", "Both columns must already exist in the View.");
      }
      const [moved] = columns.splice(from, 1);
      if (moved === undefined) {
        throw new CliError("target-not-found", "Column disappeared during composition.");
      }
      const target = columns.findIndex((column) => column.fieldDefinitionId === anchor.nodeId);
      columns.splice(args.option("--after") !== undefined ? target + 1 : target, 0, moved);
      return { ...current, columns };
    });
  },
};
