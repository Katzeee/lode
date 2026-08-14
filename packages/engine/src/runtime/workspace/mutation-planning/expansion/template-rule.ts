import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  type TemplateMutation,
} from "../../../../domain/fact/index.js";
import type { MutationWrite } from "../../../../domain/edit/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { createNodeUnlessPresent, nodeSeed } from "./generated-lifecycle.js";
import { atomicExpansion } from "./mutation-write.js";

export function expandTemplateMutation(
  mutation: TemplateMutation,
  available: ScopedProjection,
): MutationWrite {
  const source = available.nodes[mutation.templateNodeId];
  const instanceNodeId = templateInstanceNodeId(mutation.ownerNodeId, mutation.templateNodeId);
  const instanceOccurrenceId = templateInstanceOccurrenceId(
    mutation.ownerNodeId,
    mutation.templateNodeId,
  );
  const detachment = { ...mutation, instanceNodeId, instanceOccurrenceId };
  const seed = source
    ? nodeSeed(
        source.properties,
        source.metadata,
        {},
        source.text.map((atom) => ({ value: atom.value, attributes: atom.attributes })),
      )
    : undefined;
  return atomicExpansion([
    ...createNodeUnlessPresent(instanceNodeId, available, seed),
    detachment,
    {
      kind: "occurrence-create",
      occurrenceId: instanceOccurrenceId,
      nodeId: instanceNodeId,
      parentNodeId: mutation.ownerNodeId,
      anchor: mutation.anchor,
    },
  ]);
}
