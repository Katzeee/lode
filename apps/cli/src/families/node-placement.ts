import {
  END_SEQUENCE_ANCHOR,
  type ProjectedNode,
  type SequenceAnchor,
  type TextAtomId,
  type TrashEvidenceResult,
} from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { fileOption, stringOption, writeCommand, type CommandContext } from "../command/index.js";
import { anchorFor, readNodeUniverse, resolveOccurrence, resolveTarget, resource } from "../target/index.js";
import { runWrite, workspaceIdOf } from "../intent/index.js";

const TEXT_FILE = fileOption("--text-file", "Read the node text from a UTF-8 file (- for stdin)");
const UNDER = stringOption("--under", "Parent node target");
const BEFORE = stringOption("--before", "Place before this occurrence");
const AFTER = stringOption("--after", "Place after this occurrence");
const nodeEdit = writeCommand({
  path: ["node", "edit"],
  summary: "Replace a node's text, keeping inline references in place.",
  positionals: [["node", "Node target"]],
  options: [
    stringOption("--text", "New node text", { conflicts: ["--text-file"] }),
    { ...TEXT_FILE, conflicts: ["--text"] },
  ],
  run: runWrite("node.edit", async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const text = args.option("--text") ?? args.option("--text-file");
    if (text === undefined) {
      throw new CliError("usage", "node edit requires --text or --text-file.");
    }
    const target = await resolveTarget(context, args.positional("node"), ["node"]);
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
    const edited = resource(context, "node", target.nodeId, text);
    return {
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: target.nodeId,
          deleteAtomIds,
          anchor: insertAnchor,
          insert: text,
        },
      ],
      extra: { target: edited },
      view: writeView("Updated", edited),
    };
  }),
});

const nodeMove = writeCommand({
  path: ["node", "move"],
  summary: "Move one placement of a node under a new parent.",
  positionals: [["target", "Node or occurrence target"]],
  options: [
    { ...UNDER },
    stringOption("--from", "Current parent node, to disambiguate placements"),
    { ...BEFORE, conflicts: ["--after"] },
    { ...AFTER },
  ],
  run: runWrite("node.move", async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const under = args.option("--under");
    if (under === undefined) {
      throw new CliError("usage", "node move requires --under.");
    }
    const parent = await resolveTarget(context, under, ["node"]);
    const from = args.option("--from");
    const fromParentIds = from === undefined ? undefined : [(await resolveTarget(context, from, ["node"])).nodeId];
    const placement = await resolveOccurrence(context, args.positional("target"), {
      nodeKinds: ["node"],
      fromParentIds,
    });
    const anchor = await anchorFor(
      context.session,
      workspaceId,
      context.perspective,
      parent.nodeId,
      args.option("--before"),
      args.option("--after"),
    );
    const moved = resource(context, "node", placement.nodeId, placement.nodeLabel);
    return {
      actions: [{ kind: "occurrence-move", occurrenceId: placement.occurrenceId, parentNodeId: parent.nodeId, anchor }],
      extra: { target: moved, to: resource(context, "node", parent.nodeId, parent.label) },
      view: writeView("Moved", moved, parent.label),
    };
  }),
});

const nodeTrash = writeCommand({
  path: ["node", "trash"],
  summary: "Move a node to Trash (recoverable).",
  positionals: [["node", "Node target"]],
  run: runWrite("node.trash", async (context, args) => {
    const target = await resolveTarget(context, args.positional("node"), ["node"]);
    return {
      actions: [{ kind: "node-delete", nodeId: target.nodeId }],
      extra: { target: target.descriptor },
      view: writeView("Trashed", target.descriptor),
    };
  }),
});

const nodeRestore = writeCommand({
  path: ["node", "restore"],
  summary: "Restore a trashed node to its previous placement.",
  positionals: [["node", "Node target"]],
  run: runWrite("node.restore", async (context, args) => {
    const target = await resolveTarget(context, args.positional("node"), ["node"]);
    const evidence = await readTrashEvidence(context, target.nodeId);
    if (!evidence.available) {
      throw new CliError(
        "unsupported",
        `Node ${target.descriptor.ref} has no restorable Trash Evidence. It may not be in Trash, or its deletion is entangled with later work.`,
      );
    }
    return {
      actions: [
        {
          kind: "node-restore",
          nodeId: target.nodeId,
          occurrenceId: evidence.occurrenceId,
          parentNodeId: evidence.parentNodeId,
          anchor: evidence.anchor ?? END_SEQUENCE_ANCHOR,
        },
      ],
      extra: { target: target.descriptor },
      view: writeView("Restored", target.descriptor),
    };
  }),
});

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
  return result.value;
}

/**
 * The replacement text takes the position of the first deleted text atom so
 * inline references keep their relative place; with no text atoms it appends.
 */
function replacementAnchor(node: ProjectedNode): SequenceAnchor {
  const firstTextIndex = node.content.findIndex((item) => item.kind === "text");
  if (firstTextIndex === -1) {
    return END_SEQUENCE_ANCHOR;
  }
  const previous = node.content[firstTextIndex - 1];
  if (previous !== undefined) {
    return { after: previous.id, before: null, affinity: "after", fallback: "end" };
  }
  const following = node.content.slice(firstTextIndex).find((item) => item.kind !== "text");
  if (following !== undefined) {
    return { after: null, before: following.id, affinity: "before", fallback: "start" };
  }
  return END_SEQUENCE_ANCHOR;
}

export function registerNodePlacementCommands(catalog: CommandCatalog): void {
  catalog.register(nodeEdit);
  catalog.register(nodeMove);
  catalog.register(nodeTrash);
  catalog.register(nodeRestore);
}
