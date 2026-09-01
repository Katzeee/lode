import {
  compareCausalOrder,
  isInlineReferenceAction,
  isTextAction,
  type FactAction,
  type InlineReferenceAction,
  type TextAction,
} from "../fact/index.js";
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
    if (isTextAction(authoredAction)) {
      applyTextContent(fact.id, authoredAction, nodes);
    } else if (isInlineReferenceAction(authoredAction)) {
      applyInlineReferenceContent(fact.id, authoredAction, nodes, inlineReferenceIds);
    }
  }
}

function applyTextContent(
  factActionId: FactAction["id"],
  action: TextAction,
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  switch (action.kind) {
    case "rich-text-splice": {
      const node = nodes.get(action.nodeId);
      if (!node) {
        return;
      }
      const deleted = new Set(action.deleteAtomIds);
      node.content = node.content.filter((item) => item.kind !== "text" || !deleted.has(item.id));
      const inserted = [...action.insert].map((value, index): TextAtom => ({
        kind: "text",
        id: `${factActionId}#${index}`,
        value,
        attributes: action.attributes ?? {},
        factActionId,
      }));
      insertManyAtAnchor(node.content, inserted, action.anchor, (item) => item.id);
      return;
    }
    case "rich-text-mark": {
      const node = nodes.get(action.nodeId);
      if (!node) {
        return;
      }
      const targets = new Set(action.atomIds);
      node.content = node.content.map((item) => {
        if (item.kind !== "text" || !targets.has(item.id)) {
          return item;
        }
        const attributes = { ...item.attributes };
        if (action.value.kind === "unset") {
          delete attributes[action.key];
        } else {
          attributes[action.key] = action.value.value;
        }
        return { ...item, attributes };
      });
      return;
    }
    default:
      assertNever(action);
  }
}

function applyInlineReferenceContent(
  factActionId: FactAction["id"],
  action: InlineReferenceAction,
  nodes: ReadonlyMap<string, MutableNode>,
  inlineReferenceIds: Set<string>,
): void {
  switch (action.kind) {
    case "inline-reference-create": {
      const node = nodes.get(action.hostNodeId);
      if (!node || inlineReferenceIds.has(action.inlineReferenceId)) {
        return;
      }
      const reference: MutableInlineReference = {
        kind: "inline-reference",
        id: action.inlineReferenceId,
        targetNodeId: action.targetNodeId,
        factActionId,
      };
      insertManyAtAnchor(node.content, [reference], action.anchor, (item) => item.id);
      inlineReferenceIds.add(reference.id);
      return;
    }
    case "inline-reference-remove":
      for (const node of nodes.values()) {
        node.content = node.content.filter(
          (item) => item.kind !== "inline-reference" || item.id !== action.inlineReferenceId,
        );
      }
      inlineReferenceIds.delete(action.inlineReferenceId);
      return;
    case "inline-alias-attach":
    case "inline-alias-detach":
      return;
    default:
      assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown Content Action: ${JSON.stringify(value)}`);
}
