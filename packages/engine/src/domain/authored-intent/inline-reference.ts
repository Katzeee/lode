import { graphActionKindsInFamily } from "../fact/index.js";
import { locateInlineReference } from "../reconcile/index.js";
import { AuthoredIntentViolation, type AuthoredIntentFamily } from "./contract.js";

const INLINE_REFERENCE_ACTION_KINDS = graphActionKindsInFamily("inlineReference");

export const inlineReferenceAuthoredIntent = {
  key: "inline-reference",
  actionKinds: INLINE_REFERENCE_ACTION_KINDS,
  assert(action, context) {
    const { available, resulting } = context;
    const location = locateInlineReference(available.nodes, action.inlineReferenceId);
    if (action.kind === "inline-reference-create") {
      if (resulting.nodes[action.hostNodeId] === undefined || resulting.nodes[action.targetNodeId] === undefined) {
        throw new AuthoredIntentViolation("Inline Reference host and target must exist in the current Projection");
      }
      if (location !== null) {
        throw new AuthoredIntentViolation("Inline Reference identity already exists");
      }
      return;
    }
    const current =
      location ??
      (action.kind === "inline-alias-attach" ? locateInlineReference(resulting.nodes, action.inlineReferenceId) : null);
    if (current === null) {
      throw new AuthoredIntentViolation("Inline Reference is absent from the current Projection");
    }
    if (action.kind === "inline-reference-remove") {
      return;
    }
    if (resulting.nodes[action.aliasNodeId] === undefined) {
      throw new AuthoredIntentViolation("Inline Alias Node is absent from the current Projection");
    }
    if (resulting.nodeOwners[action.aliasNodeId] !== current.hostNodeId) {
      throw new AuthoredIntentViolation("Inline Alias Node must be owned by the host Node");
    }
    if (action.kind === "inline-alias-attach" && location !== null && location.reference.aliasNodeId !== null) {
      throw new AuthoredIntentViolation("Inline Reference already has an Alias");
    }
    if (action.kind === "inline-alias-detach" && current.reference.aliasNodeId !== action.aliasNodeId) {
      throw new AuthoredIntentViolation("Inline Reference Alias attachment is stale");
    }
  },
} satisfies AuthoredIntentFamily<(typeof INLINE_REFERENCE_ACTION_KINDS)[number]>;
