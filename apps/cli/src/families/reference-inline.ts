import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import type { CommandContext } from "../invocation/index.js";
import { descriptor, labelOf, readNodeUniverse, resolveOccurrenceTarget } from "../target/index.js";
import type { ResourceDescriptor } from "../target/index.js";
import { executeWrite, writeResult, workspaceIdOf } from "../intent/index.js";

const referenceRemove: CommandDefinition = {
  path: ["reference", "remove"],
  summary: "Remove one reference placement.",
  positionals: [["reference", "Occurrence or inline reference target"]],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const token = args.positional("reference");
    const inline = await findInlineReference(context, token);
    if (inline !== null) {
      const { result, data } = await executeWrite(context, "reference.remove", [
        { kind: "inline-reference-remove", inlineReferenceId: inline.inlineReferenceId },
      ]);
      return writeResult(data, result, {
        extra: { target: inline.descriptor },
        view: writeView("Removed inline reference", inline.descriptor),
      });
    }
    const workspaceId = workspaceIdOf(context);
    const placement = await resolveOccurrenceTarget(context.session, workspaceId, context.perspective, token, {
      nodeKinds: ["node", "supertag", "field", "search"],
    });
    const { owners } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    if (placement.parentNodeId === (owners[placement.nodeId] ?? null)) {
      throw new CliError("invalid-value", `${token} is the Original placement; use node trash or node move instead.`);
    }
    const { result, data } = await executeWrite(context, "reference.remove", [
      { kind: "occurrence-delete", occurrenceId: placement.occurrenceId },
    ]);
    return writeResult(data, result, {
      extra: {
        target: descriptor(workspaceId, "occurrence", placement.occurrenceId, placement.nodeLabel),
      },
      view: writeView(
        "Removed reference",
        descriptor(workspaceId, "occurrence", placement.occurrenceId, placement.nodeLabel),
      ),
    });
  },
};

async function findInlineReference(
  context: CommandContext,
  token: string,
): Promise<Readonly<{ inlineReferenceId: string; descriptor: ResourceDescriptor }> | null> {
  if (!token.startsWith("reference:")) {
    return null;
  }
  const inlineReferenceId = token.slice("reference:".length);
  const { nodes } = await readNodeUniverse(context.session, workspaceIdOf(context), context.perspective);
  for (const node of Object.values(nodes)) {
    const found = node.content.find(
      (item): item is Extract<(typeof node)["content"][number], { kind: "inline-reference" }> =>
        item.kind === "inline-reference" && item.id === inlineReferenceId,
    );
    if (found !== undefined) {
      const label = labelOf(nodes, found.targetNodeId);
      return {
        inlineReferenceId,
        descriptor: descriptor(workspaceIdOf(context), "reference", inlineReferenceId, label),
      };
    }
  }
  throw new CliError("target-not-found", `No inline reference matches ${token}.`);
}

export function registerReferenceInlineCommands(catalog: CommandCatalog): void {
  catalog.register(referenceRemove);
}
