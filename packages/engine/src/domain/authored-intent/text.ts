import { graphActionKindsInFamily, type AuthoredAction, type TextAction } from "../fact/index.js";
import { isPresentNodeOutsideTrash, textAtoms, type ScopedProjection } from "../reconcile/index.js";
import type { AuthoredIntentContext, AuthoredIntentFamily } from "./policy.js";

type RichTextSpliceAction = Extract<AuthoredAction, { kind: "rich-text-splice" }>;
type RichTextMarkAction = Extract<AuthoredAction, { kind: "rich-text-mark" }>;

const TEXT_ACTION_KINDS = graphActionKindsInFamily("text");

export const textAuthoredIntent = {
  key: "text",
  actionKinds: TEXT_ACTION_KINDS,
  validate: validateTextAuthoredIntent,
} satisfies AuthoredIntentFamily<(typeof TEXT_ACTION_KINDS)[number]>;

function validateTextAuthoredIntent(action: TextAction, context: AuthoredIntentContext): TextAction {
  const { available } = context.projections();
  switch (action.kind) {
    case "rich-text-splice":
      return validateTextSplice(action, available);
    case "rich-text-mark":
      return validateTextMark(action, available);
  }
}

function validateTextSplice(action: RichTextSpliceAction, available: ScopedProjection): RichTextSpliceAction {
  if (!isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, action.nodeId)) {
    throw new Error("Text target Node is absent from the observed projection");
  }
  const node = available.nodes[action.nodeId];
  if (!node) {
    throw new Error("Text target Node is absent from the observed projection");
  }
  const atoms = textAtoms(node);
  assertTextAnchor(
    action,
    node.content.map((item) => item.id),
  );
  for (const id of action.deleteAtomIds) {
    if (!atoms.some((atom) => atom.id === id)) {
      throw new Error(`Text Atom is absent from the observed projection: ${id}`);
    }
  }
  return action;
}

function validateTextMark(action: RichTextMarkAction, available: ScopedProjection): RichTextMarkAction {
  if (!isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, action.nodeId)) {
    throw new Error("Text mark target Node is absent from the observed projection");
  }
  const availableNode = available.nodes[action.nodeId];
  const availableAtoms = textAtoms(availableNode);
  if (!availableNode || action.atomIds.some((id) => !availableAtoms.some((atom) => atom.id === id))) {
    throw new Error("Text mark targets an Atom outside the observed projection");
  }
  return action;
}

function assertTextAnchor(action: RichTextSpliceAction, atomIds: readonly string[]): void {
  for (const endpoint of [action.anchor.after, action.anchor.before]) {
    if (endpoint !== null && !atomIds.includes(endpoint)) {
      throw new Error("Text anchor endpoint is absent from the observed projection");
    }
  }
}
