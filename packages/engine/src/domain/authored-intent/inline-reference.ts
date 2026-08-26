import { graphActionKindsInFamily } from "../fact/index.js";
import { locateInlineReference } from "../reconcile/index.js";
import type { AuthoredIntentFamily } from "./policy.js";

const INLINE_REFERENCE_ACTION_KINDS = graphActionKindsInFamily("inlineReference");

export const inlineReferenceAuthoredIntent = {
  key: "inline-reference",
  actionKinds: INLINE_REFERENCE_ACTION_KINDS,
  validate(action, context) {
    const { available, resulting } = context.projections();
    const location = locateInlineReference(available.nodes, action.inlineReferenceId);
    if (action.kind === "inline-reference-create") {
      if (available.nodes[action.hostNodeId] === undefined || available.nodes[action.targetNodeId] === undefined) {
        throw new Error("Inline Reference host and target must exist in the current Projection");
      }
      if (location !== null) {
        throw new Error("Inline Reference identity already exists");
      }
      return action;
    }
    if (location === null) {
      throw new Error("Inline Reference is absent from the current Projection");
    }
    if (action.kind === "inline-reference-remove") {
      return action;
    }
    if (resulting.nodes[action.aliasNodeId] === undefined) {
      throw new Error("Inline Alias Node is absent from the current Projection");
    }
    if (resulting.nodeOwners[action.aliasNodeId] !== location.hostNodeId) {
      throw new Error("Inline Alias Node must be owned by the host Node");
    }
    if (action.kind === "inline-alias-attach" && location.reference.aliasNodeId !== null) {
      throw new Error("Inline Reference already has an Alias");
    }
    if (action.kind === "inline-alias-detach" && location.reference.aliasNodeId !== action.aliasNodeId) {
      throw new Error("Inline Reference Alias attachment is stale");
    }
    return action;
  },
} satisfies AuthoredIntentFamily<(typeof INLINE_REFERENCE_ACTION_KINDS)[number]>;
