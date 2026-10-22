import { END_SEQUENCE_ANCHOR as anchor, START_SEQUENCE_ANCHOR } from "../../../domain/fact/index.js";
import type { NodeEditIntent } from "../../../domain/edit/node-edit-intent.js";
import type { templateEditProgram } from "./template-edit-program.js";
import { retainNodeContentReferences } from "./node-content-retention.js";
import { nodeContentActions } from "./template-content-creation.js";
import { prepareSupertagApplicationCreation } from "./supertag-application-planning.js";

export function planNodeIntents(
  nodeId: string,
  intents: readonly NodeEditIntent[],
  program: ReturnType<typeof templateEditProgram>,
  occurrenceId?: string,
): void {
  for (const intent of intents) {
    const graph = program.current();
    if (intent.kind === "set-content") {
      const node = graph.nodes[nodeId];
      if (!node) {
        throw new Error("Edited Node is absent");
      }
      const content = retainNodeContentReferences(intent.content, nodeId, graph);
      const textIds = node.content.flatMap((item) => (item.kind === "text" ? [item.id] : []));
      if (textIds.length) {
        program.append({ kind: "rich-text-splice", nodeId, anchor, deleteAtomIds: textIds, insert: "" });
      }
      for (const item of node.content) {
        if (item.kind === "inline-reference") {
          program.append({ kind: "inline-reference-remove", inlineReferenceId: item.id });
        }
      }
      program.appendContent(
        nodeContentActions(nodeId, content, program.finalActionId, `${program.finalActionId(0)}/content`),
      );
    } else if (intent.kind === "insert-node") {
      const occurrence = occurrenceId && graph.occurrences[occurrenceId];
      if (!occurrence || occurrence.nodeId !== nodeId) {
        throw new Error("The insertion context has no current Occurrence");
      }
      program.append({
        kind: "node-create",
        nodeId: intent.nodeId,
        ownerNodeId: intent.placement === "child" ? nodeId : occurrence.parentNodeId,
        originalPlacement: {
          placementId: intent.occurrenceId,
          anchor: {
            ...(intent.placement === "child" ? START_SEQUENCE_ANCHOR : anchor),
            before: intent.placement === "before" ? occurrenceId : null,
            after: intent.placement === "after" ? occurrenceId : null,
          },
        },
      });
      program.appendContent(nodeContentActions(intent.nodeId, intent.content, program.finalActionId, intent.nodeId));
      planNodeIntents(
        intent.nodeId,
        intent.supertagIds.map((supertagId) => ({ kind: "add-supertag", supertagId })),
        program,
      );
    } else {
      const present = (graph.supertagApplications[nodeId] ?? []).some((item) => item.supertagId === intent.supertagId);
      if (intent.kind === "add-supertag" && !present) {
        program.append(
          ...prepareSupertagApplicationCreation(
            { kind: "supertag-application-create", hostNodeId: nodeId, supertagId: intent.supertagId, anchor },
            graph,
          ),
        );
      } else if (intent.kind === "remove-supertag" && present) {
        program.append({ kind: "supertag-membership-remove", hostNodeId: nodeId, supertagId: intent.supertagId });
      }
    }
  }
}
