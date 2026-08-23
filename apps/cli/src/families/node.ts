import type { EditAction, OutlineResult } from "@lode/sdk";

import { CliError, okOutcome, writeView, type CommandResult, type HumanView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import {
  anchorFor,
  descriptor,
  labelOf,
  nodeLabel,
  ownerChainIncludes,
  ownerLabel,
  readNodeUniverse,
  resolveNodeTarget,
} from "../target/index.js";
import { executeWrite, identity, writeResult, workspaceIdOf } from "../intent/index.js";
import { registerNodePlacementCommands } from "./node-placement.js";

/**
 * Node family: ordinary node lifecycle with explicit placement. Create/Edit
 * read the projection first, targets resolve by kind and scope, and restore
 * re-reads Trash Evidence before writing — no partial writes.
 */

export function registerNodeCommands(catalog: CommandCatalog): void {
  catalog.register(nodeCreate);
  catalog.register(nodeShow);
  catalog.register(nodeOutline);
  registerNodePlacementCommands(catalog);
}

const TEXT_FILE = {
  name: "--text-file",
  description: "Read the node text from a UTF-8 file (- for stdin)",
  value: { kind: "file" as const },
};
const UNDER = { name: "--under", description: "Parent node target", value: { kind: "string" as const } };
const BEFORE = { name: "--before", description: "Place before this occurrence", value: { kind: "string" as const } };
const AFTER = { name: "--after", description: "Place after this occurrence", value: { kind: "string" as const } };

const nodeCreate: CommandDefinition = {
  path: ["node", "create"],
  summary: "Create a node with the given text.",
  positionals: [["text", "Node text (omit when using --text-file)", "optional"]],
  options: [{ ...TEXT_FILE }, { ...UNDER }, { ...BEFORE, conflicts: ["--after"] }, { ...AFTER }],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const positional = args.optionalPositional("text");
    const fromFile = args.option("--text-file");
    if (positional !== undefined && fromFile !== undefined) {
      throw new CliError("usage", "node create takes <text> or --text-file, not both.");
    }
    const text = positional ?? fromFile;
    if (text === undefined) {
      throw new CliError("usage", "node create requires <text> or --text-file.");
    }
    const parent = args.option("--under");
    const parentNodeId =
      parent === undefined
        ? workspaceId
        : (await resolveNodeTarget(context.session, workspaceId, context.perspective, parent, ["node"])).nodeId;
    const anchor = await anchorFor(
      context.session,
      workspaceId,
      context.perspective,
      parentNodeId,
      args.option("--before"),
      args.option("--after"),
    );
    const nodeId = identity(context.requestId, "node");
    const actions: readonly EditAction[] = [
      {
        kind: "node-create",
        nodeId,
        occurrenceId: `${nodeId}-original`,
        parentNodeId,
        anchor,
        seed: { text: [{ value: text, attributes: {} }] },
      },
    ];
    const { result, data } = await executeWrite(context, "node.create", actions);
    const resource = descriptor(workspaceId, "node", nodeId, text);
    return writeResult(data, result, {
      extra: { target: resource },
      view: writeView("Created", resource),
    });
  },
};

const nodeShow: CommandDefinition = {
  path: ["node", "show"],
  summary: "Show one node: label, content, owner, and children.",
  positionals: [["node", "Node target"]],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args): Promise<CommandResult> => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
    ]);
    const { nodes, owners } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    const node = nodes[target.nodeId];
    if (node === undefined) {
      throw new CliError("target-not-found", `Node ${target.nodeId} is not in this projection.`);
    }
    const systemNodes = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "workspaceSystemNodes",
    )) as {
      trash?: string;
    };
    const owner = owners[target.nodeId] ?? null;
    const childOccurrences = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "occurrences",
    )) as Record<string, { occurrenceId: string; nodeId: string; parentNodeId: string }>;
    const children = Object.values(childOccurrences).filter((occurrence) => occurrence.parentNodeId === target.nodeId);
    const inTrash = owner !== null && ownerChainIncludes(owners, owner, systemNodes.trash);
    const view: HumanView = {
      kind: "text",
      lines: [
        `${nodeLabel(node)}${inTrash ? " (in Trash)" : ""}`,
        `Ref: ${target.descriptor.ref}`,
        `Link: ${target.descriptor.link}`,
        `Owner: ${owner === null ? "—" : ownerLabel(nodes, owner)}`,
        ...(children.length === 0
          ? ["No children."]
          : ["Children:", ...children.map((child) => `  ${labelOf(nodes, child.nodeId)}  (node:${child.nodeId})`)]),
      ],
    };
    return okOutcome(
      {
        resource: target.descriptor,
        content: node.content.map((item) =>
          item.kind === "text"
            ? { kind: "text", value: item.value }
            : { kind: "inline-reference", target: item.targetNodeId },
        ),
        ownerNodeId: owner,
        location: inTrash ? "trash" : "active",
        children: children.map((child) => descriptor(workspaceId, "node", child.nodeId, labelOf(nodes, child.nodeId))),
      },
      { view },
    );
  },
};

const nodeOutline: CommandDefinition = {
  path: ["node", "outline"],
  summary: "Read a bounded outline below one node.",
  positionals: [["node", "Root node target"]],
  options: [],
  kind: "read",
  paginated: true,
  needsWorkspace: true,
  run: async (context, args): Promise<CommandResult> => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
      "search",
    ]);
    const result = await context.session.application.query({
      kind: "outline",
      workspaceId,
      perspective: context.perspective,
      rootNodeId: target.nodeId,
      maxDepth: 20,
      limit: context.limit,
      after: context.cursor,
    });
    if (result.status !== "ok") {
      throw new CliError("unavailable", `Outline is unavailable: ${result.error.message}`);
    }
    const outline = result.value as unknown as OutlineResult;
    const { nodes } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    return okOutcome(
      {
        resource: target.descriptor,
        rows: outline.rows.map((row) => ({ nodeId: row.nodeId, depth: row.depth, occurrenceId: row.occurrenceId })),
      },
      {
        view: {
          kind: "table",
          columns: ["depth", "label", "ref"],
          rows: outline.rows.map((row) => ["  ".repeat(row.depth), labelOf(nodes, row.nodeId), `node:${row.nodeId}`]),
        },
        page: { count: outline.rows.length, next: outline.next },
      },
    );
  },
};
