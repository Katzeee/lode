import type { ProjectedNode, TextAtomId, TrashEvidenceResult } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import type { CommandContext } from "../invocation/index.js";
import {
  anchorFor,
  descriptor,
  readNodeUniverse,
  resolveNodeTarget,
  resolveOccurrenceTarget,
} from "../target/index.js";
import { executeWrite, writeResult, workspaceIdOf } from "../intent/index.js";

const TEXT_FILE = {
  name: "--text-file",
  description: "Read the node text from a UTF-8 file (- for stdin)",
  value: { kind: "file" as const },
};
const UNDER = { name: "--under", description: "Parent node target", value: { kind: "string" as const } };
const BEFORE = { name: "--before", description: "Place before this occurrence", value: { kind: "string" as const } };
const AFTER = { name: "--after", description: "Place after this occurrence", value: { kind: "string" as const } };
const nodeEdit: CommandDefinition = {
  path: ["node", "edit"],
  summary: "Replace a node's text, keeping inline references in place.",
  positionals: [["node", "Node target"]],
  options: [
    { name: "--text", description: "New node text", value: { kind: "string" as const }, conflicts: ["--text-file"] },
    { ...TEXT_FILE, conflicts: ["--text"] },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const text = args.option("--text") ?? args.option("--text-file");
    if (text === undefined) {
      throw new CliError("usage", "node edit requires --text or --text-file.");
    }
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
    ]);
    const { nodes } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    const node = nodes[target.nodeId];
    if (node === undefined) {
      throw new CliError("target-not-found", `Node ${target.nodeId} is not in this projection.`);
    }
    const textAtoms = node.content.filter((item) => item.kind === "text");
    const deleteAtomIds = textAtoms
      .map((item) => (item.kind === "text" ? item.id : ""))
      .filter((id) => id.length > 0) as readonly TextAtomId[];
    const insertAnchor = replacementAnchor(node);
    const { result, data } = await executeWrite(context, "node.edit", [
      {
        kind: "rich-text-splice",
        nodeId: target.nodeId,
        deleteAtomIds,
        anchor: insertAnchor,
        insert: text,
      },
    ]);
    const resource = descriptor(workspaceId, "node", target.nodeId, text);
    return writeResult(data, result, {
      extra: { target: resource },
      view: writeView("Updated", resource),
    });
  },
};

const nodeMove: CommandDefinition = {
  path: ["node", "move"],
  summary: "Move one placement of a node under a new parent.",
  positionals: [["target", "Node or occurrence target"]],
  options: [
    { ...UNDER },
    {
      name: "--from",
      description: "Current parent node, to disambiguate placements",
      value: { kind: "string" as const },
    },
    { ...BEFORE, conflicts: ["--after"] },
    { ...AFTER },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const under = args.option("--under");
    if (under === undefined) {
      throw new CliError("usage", "node move requires --under.");
    }
    const parent = await resolveNodeTarget(context.session, workspaceId, context.perspective, under, ["node"]);
    const from = args.option("--from");
    const fromParentIds =
      from === undefined
        ? undefined
        : [(await resolveNodeTarget(context.session, workspaceId, context.perspective, from, ["node"])).nodeId];
    const placement = await resolveOccurrenceTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("target"),
      { nodeKinds: ["node"], fromParentIds },
    );
    const anchor = await anchorFor(
      context.session,
      workspaceId,
      context.perspective,
      parent.nodeId,
      args.option("--before"),
      args.option("--after"),
    );
    const { result, data } = await executeWrite(context, "node.move", [
      { kind: "occurrence-move", occurrenceId: placement.occurrenceId, parentNodeId: parent.nodeId, anchor },
    ]);
    const resource = descriptor(workspaceId, "node", placement.nodeId, placement.nodeLabel);
    return writeResult(data, result, {
      extra: { target: resource, to: descriptor(workspaceId, "node", parent.nodeId, parent.label) },
      view: writeView("Moved", resource, parent.label),
    });
  },
};

const nodeTrash: CommandDefinition = {
  path: ["node", "trash"],
  summary: "Move a node to Trash (recoverable).",
  positionals: [["node", "Node target"]],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
    ]);
    const { result, data } = await executeWrite(context, "node.trash", [
      { kind: "node-delete", nodeId: target.nodeId },
    ]);
    return writeResult(data, result, {
      extra: { target: target.descriptor },
      view: writeView("Trashed", target.descriptor),
    });
  },
};

const nodeRestore: CommandDefinition = {
  path: ["node", "restore"],
  summary: "Restore a trashed node to its previous placement.",
  positionals: [["node", "Node target"]],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
    ]);
    const evidence = await readTrashEvidence(context, target.nodeId);
    if (!evidence.available) {
      throw new CliError(
        "unsupported",
        `Node ${target.descriptor.ref} has no restorable Trash Evidence. It may not be in Trash, or its deletion is entangled with later work.`,
      );
    }
    const { result, data } = await executeWrite(context, "node.restore", [
      {
        kind: "node-restore",
        nodeId: target.nodeId,
        occurrenceId: evidence.occurrenceId,
        parentNodeId: evidence.parentNodeId,
        anchor: evidence.anchor ?? { after: null, before: null, affinity: "after", fallback: "end" },
      },
    ]);
    return writeResult(data, result, {
      extra: { target: target.descriptor },
      view: writeView("Restored", target.descriptor),
    });
  },
};

async function readTrashEvidence(context: CommandContext, nodeId: string): Promise<TrashEvidenceResult> {
  const result = await context.session.application.query({
    kind: "trash-evidence",
    workspaceId: workspaceIdOf(context),
    perspective: context.perspective,
    nodeId,
  });
  if (result.status !== "ok") {
    throw new CliError("unavailable", `Trash Evidence is unavailable: ${result.error.message}`);
  }
  return result.value as unknown as TrashEvidenceResult;
}

/**
 * The replacement text takes the position of the first deleted text atom so
 * inline references keep their relative place; with no text atoms it appends.
 */
function replacementAnchor(node: ProjectedNode): Readonly<{
  after: string | null;
  before: string | null;
  affinity: "after" | "before";
  fallback: "start" | "end";
}> {
  const firstTextIndex = node.content.findIndex((item) => item.kind === "text");
  if (firstTextIndex === -1) {
    return { after: null, before: null, affinity: "after", fallback: "end" };
  }
  const previous = node.content[firstTextIndex - 1];
  if (previous !== undefined) {
    return { after: previous.id, before: null, affinity: "after", fallback: "end" };
  }
  const following = node.content.slice(firstTextIndex).find((item) => item.kind !== "text");
  if (following !== undefined) {
    return { after: null, before: following.id, affinity: "before", fallback: "start" };
  }
  return { after: null, before: null, affinity: "after", fallback: "end" };
}

export function registerNodePlacementCommands(catalog: CommandCatalog): void {
  catalog.register(nodeEdit);
  catalog.register(nodeMove);
  catalog.register(nodeTrash);
  catalog.register(nodeRestore);
}
