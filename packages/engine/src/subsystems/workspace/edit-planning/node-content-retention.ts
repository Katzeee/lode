import type { NodeContentInput } from "../../../domain/edit/node-content-input.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";
import { EditPlanningRejection } from "./planning-rejection.js";

/** Retained References carry identity; explicit new targets are never guessed from their label. */
export function retainNodeContentReferences(
  input: NodeContentInput,
  sourceNodeId: string,
  graph: InterpretedProjection,
  target: (nodeId: string) => string = (id) => id,
): NodeContentInput {
  const source = graph.nodes[sourceNodeId];
  const used = new Set<string>();
  return {
    items: input.items.map((item) => {
      if (item.kind === "text") {
        return item;
      }
      if (!item.sourceReferenceId) {
        return {
          ...item,
          ...(item.alias ? { alias: retainNodeContentReferences(item.alias, "", graph, target) } : {}),
        };
      }
      const reference = source?.content.find(
        (candidate) => candidate.kind === "inline-reference" && candidate.id === item.sourceReferenceId,
      );
      if (
        !reference ||
        reference.kind !== "inline-reference" ||
        reference.targetNodeId !== item.targetNodeId ||
        used.has(reference.id)
      ) {
        throw new EditPlanningRejection("Retained Reference does not belong to the edited source Node");
      }
      used.add(reference.id);
      return {
        ...item,
        targetNodeId: target(reference.targetNodeId),
        ...(item.alias
          ? { alias: retainNodeContentReferences(item.alias, reference.aliasNodeId ?? "", graph, target) }
          : {}),
      };
    }),
  };
}
