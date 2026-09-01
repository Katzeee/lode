import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { ViewType } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { readCommand, writeCommand, type ProductCommandRun } from "../command/index.js";
import { labelOf, readNodeUniverse, resolveTarget, resource } from "../target/index.js";
import { executeWrite, writeResult, workspaceIdOf } from "../intent/index.js";
import { readHostView } from "./view-actions.js";

const viewOutlineMode = writeCommand({
  path: ["view", "outline"],
  summary: "Set the host's shared default View Type to Outline.",
  positionals: [["node", "View host target"]],
  run: (context, args) => setMode(context, args.positional("node"), "outline"),
});

const viewTableMode = writeCommand({
  path: ["view", "table"],
  summary: "Set the host's shared default View Type to Table.",
  positionals: [["node", "View host target"]],
  run: (context, args) => setMode(context, args.positional("node"), "table"),
});

async function setMode(context: Parameters<ProductCommandRun>[0], hostToken: string, viewType: ViewType) {
  const host = await resolveTarget(context, hostToken, ["node", "search"]);
  const existing = await readHostView(context, hostToken);
  if (existing === null) {
    const { result, data } = await executeWrite(context, `view.${viewType}`, [
      {
        kind: "shared-default-view-create",
        hostNodeId: host.nodeId,
        viewType,
        anchor: end,
      },
    ]);
    return writeResult(data, result, {
      extra: {
        target: host.descriptor,
        on: host.descriptor,
        viewType,
      },
      view: writeView(`Set ${viewType} view`, host.descriptor),
    });
  }
  const { result, data } = await executeWrite(context, `view.${viewType}`, [
    { kind: "view-mode-set", hostNodeId: existing.hostNodeId, viewId: existing.viewId, viewType },
  ]);
  return writeResult(data, result, {
    extra: {
      target: resource(context, "view", existing.viewDefinitionNodeId, `${host.label} view`),
      on: host.descriptor,
      viewType,
    },
    view: writeView(
      `Set ${viewType} view`,
      resource(context, "view", existing.viewDefinitionNodeId, `${host.label} view`),
      `on ${host.label}`,
    ),
  });
}

const viewRows = readCommand({
  path: ["view", "rows"],
  summary: "Read the host's View rows (table or outline presentation).",
  positionals: [["node", "View host target"]],
  paginated: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const host = await resolveTarget(context, args.positional("node"), ["node", "search"]);
    const result = await context.session.application.query({
      kind: "view-rows",
      workspaceId,
      perspective: context.perspective,
      hostNodeId: host.nodeId,
      limit: context.limit,
      after: context.cursor,
    });
    if (result.status !== "ok") {
      throw new CliError("unavailable", `View rows are unavailable: ${result.error.message}`);
    }
    const rows = result.value;
    const { nodes } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    return okOutcome(
      {
        resource: host.descriptor,
        viewType: rows.viewType,
        items: rows.rows.map((row) => resource(context, "node", row.targetNodeId, labelOf(nodes, row.targetNodeId))),
      },
      {
        view: {
          kind: "table",
          columns: ["label", "ref"],
          rows: rows.rows.map((row) => [labelOf(nodes, row.targetNodeId), `node:${row.targetNodeId}`]),
        },
        page: { count: rows.rows.length, next: rows.next },
      },
    );
  },
});

export function registerViewPresentationCommands(catalog: CommandCatalog): void {
  catalog.register(viewOutlineMode);
  catalog.register(viewTableMode);
  catalog.register(viewRows);
}
