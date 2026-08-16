import type { ContributionFact } from "../fact/index.js";
import { compareFacts } from "../fact/index.js";
import type { TextAtom } from "./projection-types.js";
import type { MutableInlineReference, MutableNode } from "./projection-state.js";
import { insertManyAtAnchor } from "./sequence.js";

export function applyContent(active: readonly ContributionFact[], nodes: ReadonlyMap<string, MutableNode>): void {
  const inlineReferenceIds = new Set<string>();
  for (const node of nodes.values()) {
    node.content.forEach((item) => {
      if (item.kind === "inline-reference") {
        inlineReferenceIds.add(item.id);
      }
    });
  }
  for (const fact of [...active].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "text-splice") {
      const node = nodes.get(mutation.nodeId);
      if (!node) {
        continue;
      }
      const deleted = new Set(mutation.deleteAtomIds);
      node.content = node.content.filter((item) => item.kind !== "text" || !deleted.has(item.id));
      const inserted = [...mutation.insert].map((value, index): TextAtom => ({
        kind: "text",
        id: `${fact.id}#${index}`,
        value,
        attributes: mutation.attributes ?? {},
        contributionId: fact.id,
      }));
      insertManyAtAnchor(node.content, inserted, mutation.anchor, (item) => item.id);
    } else if (mutation.kind === "text-mark") {
      const node = nodes.get(mutation.nodeId);
      if (!node) {
        continue;
      }
      const targets = new Set(mutation.atomIds);
      node.content = node.content.map((item) => {
        if (item.kind !== "text" || !targets.has(item.id)) {
          return item;
        }
        const attributes = { ...item.attributes };
        if (mutation.value.kind === "unset") {
          delete attributes[mutation.key];
        } else {
          attributes[mutation.key] = mutation.value.value;
        }
        return { ...item, attributes };
      });
    } else if (mutation.kind === "inline-reference-create") {
      const node = nodes.get(mutation.hostNodeId);
      if (!node || inlineReferenceIds.has(mutation.inlineReferenceId)) {
        continue;
      }
      const reference: MutableInlineReference = {
        kind: "inline-reference",
        id: mutation.inlineReferenceId,
        targetNodeId: mutation.targetNodeId,
        contributionId: fact.id,
      };
      insertManyAtAnchor(node.content, [reference], mutation.anchor, (item) => item.id);
      inlineReferenceIds.add(reference.id);
    } else if (mutation.kind === "inline-reference-delete") {
      for (const node of nodes.values()) {
        node.content = node.content.filter(
          (item) => item.kind !== "inline-reference" || item.id !== mutation.inlineReferenceId,
        );
      }
      inlineReferenceIds.delete(mutation.inlineReferenceId);
    }
  }
}
