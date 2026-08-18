import type { OutlineResult, ProjectedNode } from "@lode/sdk";

import { CliError, okOutcome, type CommandResult, type HumanView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import type { CommandContext, ParsedArgs } from "../invocation/index.js";
import { descriptor, nodeLabel, resolveWorkspaceFromList } from "../target/index.js";

/**
 * Workspace family: create/list/show over the formal host capability. Knowledge
 * commands select their Workspace explicitly with --workspace.
 */

export function registerWorkspaceCommands(catalog: CommandCatalog): void {
  catalog.register(workspaceCreate);
  catalog.register(workspaceList);
  catalog.register(workspaceShow);
}

const workspaceCreate: CommandDefinition = {
  path: ["workspace", "create"],
  summary: "Create a workspace with the given name.",
  positionals: [["name", "Name of the new workspace"]],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: false,
  run: async (context, args) => {
    const name = args.positional("name");
    const workspaceId = `ws-${crypto.randomUUID()}`;
    await context.session.workspaces.create(workspaceId, name);
    const resource = descriptor(workspaceId, "workspace", workspaceId, name);
    return okOutcome(
      { workspace: resource },
      {
        view: {
          kind: "text",
          lines: [
            `Created workspace ${resource.label}`,
            `Ref: ${resource.ref}`,
            `Link: ${resource.link}`,
            "Use it with --workspace <label|ref>.",
          ],
        },
      },
    );
  },
};

const workspaceList: CommandDefinition = {
  path: ["workspace", "list"],
  summary: "List workspaces known to the daemon.",
  positionals: [],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: false,
  run: async (context) => {
    const workspaces = await context.session.workspaces.list();
    const view: HumanView = {
      kind: "table",
      columns: ["ref", "label"],
      rows: workspaces.map((entry) => [`workspace:${entry.workspaceId}`, entry.label]),
    };
    return okOutcome(
      {
        items: workspaces.map((entry) => ({
          ...descriptor(entry.workspaceId, "workspace", entry.workspaceId, entry.label),
        })),
      },
      { view },
    );
  },
};

const workspaceShow: CommandDefinition = {
  path: ["workspace", "show"],
  summary: "Show the workspace and its top-level outline.",
  positionals: [["workspace", "Workspace label, workspace: ref, or canonical link", "optional"]],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: false,
  run: async (context: CommandContext, args: ParsedArgs): Promise<CommandResult> => {
    const token = args.optionalPositional("workspace") ?? context.workspaceChoice;
    if (token === null) {
      throw new CliError(
        "configuration-missing",
        "No workspace given. Pass a workspace target or --workspace <label|ref>.",
      );
    }
    const entry = resolveWorkspaceFromList(await context.session.workspaces.list(), token);
    const workspaceId = entry.workspaceId;
    const label = entry.label;
    const result = await context.session.application.query({
      kind: "outline",
      workspaceId,
      perspective: context.perspective,
      rootNodeId: workspaceId,
      maxDepth: 2,
      limit: context.limit,
      after: context.cursor,
    });
    if (result.status !== "ok") {
      throw new CliError("unavailable", `Workspace outline is unavailable: ${result.error.message}`);
    }
    const outline = result.value as unknown as OutlineResult;
    const [nodes, systemNodes] = await Promise.all([
      context.session.readProjection(workspaceId, context.perspective, "nodes") as Promise<
        Record<string, ProjectedNode>
      >,
      context.session.readProjection(workspaceId, context.perspective, "workspaceSystemNodes"),
    ]);
    const trashNodeId = (systemNodes as { trash?: string }).trash;
    const visibleRows = outline.rows.filter((row) => row.nodeId !== trashNodeId);
    const rows = visibleRows.map((row) => {
      const node = nodes[row.nodeId];
      const text = node === undefined ? row.nodeId : nodeLabel(node);
      return ["  ".repeat(row.depth), text, `node:${row.nodeId}`] as const;
    });
    return okOutcome(
      {
        resource: descriptor(workspaceId, "workspace", workspaceId, label),
        outline: visibleRows.map((row) => ({ nodeId: row.nodeId, depth: row.depth })),
        ...(outline.next !== null ? { next: outline.next } : {}),
      },
      {
        view: { kind: "table", columns: ["", "label", "ref"], rows },
        page: outline.next !== null ? { count: visibleRows.length, next: outline.next } : null,
      },
    );
  },
};
