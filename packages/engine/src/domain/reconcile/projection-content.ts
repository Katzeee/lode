import type { FactAction } from "../fact/index.js";
import { compareCausalOrder } from "../fact/index.js";
import type { TextAtom } from "./projection-types.js";
import type { MutableInlineReference, MutableNode } from "./projection-state.js";
import { insertManyAtAnchor } from "./sequence.js";

export function applyContent(active: readonly FactAction[], nodes: ReadonlyMap<string, MutableNode>): void {
  const inlineReferenceIds = new Set<string>();
  for (const node of nodes.values()) {
    node.content.forEach((item) => {
      if (item.kind === "inline-reference") {
        inlineReferenceIds.add(item.id);
      }
    });
  }
  for (const fact of [...active].sort(compareCausalOrder)) {
    const authoredAction = fact.action;
    if (authoredAction.kind === "rich-text-splice") {
      const node = nodes.get(authoredAction.nodeId);
      if (!node) {
        continue;
      }
      const deleted = new Set(authoredAction.deleteAtomIds);
      node.content = node.content.filter((item) => item.kind !== "text" || !deleted.has(item.id));
      const inserted = [...authoredAction.insert].map((value, index): TextAtom => ({
        kind: "text",
        id: `${fact.id}#${index}`,
        value,
        attributes: authoredAction.attributes ?? {},
        factActionId: fact.id,
      }));
      insertManyAtAnchor(node.content, inserted, authoredAction.anchor, (item) => item.id);
    } else if (authoredAction.kind === "rich-text-mark") {
      const node = nodes.get(authoredAction.nodeId);
      if (!node) {
        continue;
      }
      const targets = new Set(authoredAction.atomIds);
      node.content = node.content.map((item) => {
        if (item.kind !== "text" || !targets.has(item.id)) {
          return item;
        }
        const attributes = { ...item.attributes };
        if (authoredAction.value.kind === "unset") {
          delete attributes[authoredAction.key];
        } else {
          attributes[authoredAction.key] = authoredAction.value.value;
        }
        return { ...item, attributes };
      });
    } else if (authoredAction.kind === "inline-reference-create") {
      const node = nodes.get(authoredAction.hostNodeId);
      if (!node || inlineReferenceIds.has(authoredAction.inlineReferenceId)) {
        continue;
      }
      const reference: MutableInlineReference = {
        kind: "inline-reference",
        id: authoredAction.inlineReferenceId,
        targetNodeId: authoredAction.targetNodeId,
        factActionId: fact.id,
      };
      insertManyAtAnchor(node.content, [reference], authoredAction.anchor, (item) => item.id);
      inlineReferenceIds.add(reference.id);
    } else if (authoredAction.kind === "inline-reference-remove") {
      for (const node of nodes.values()) {
        node.content = node.content.filter(
          (item) => item.kind !== "inline-reference" || item.id !== authoredAction.inlineReferenceId,
        );
      }
      inlineReferenceIds.delete(authoredAction.inlineReferenceId);
    }
  }
}
