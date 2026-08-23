import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  type TemplateAction,
} from "../../../../domain/fact/index.js";
import type { AuthoredActionBatch } from "../action-batch.js";
import { occurrenceAnchor, textAtoms, type ScopedProjection } from "../../../../domain/reconcile/index.js";
import { createNodeUnlessPresent, nodeSeed } from "./generated-lifecycle.js";
import { requireAuthoredActionBatch } from "./action-batch.js";

export function expandTemplateAction(action: TemplateAction, available: ScopedProjection): AuthoredActionBatch {
  const source = available.nodes[action.templateNodeId];
  const instanceNodeId = templateInstanceNodeId(action.ownerNodeId, action.templateNodeId);
  const instanceOccurrenceId = templateInstanceOccurrenceId(action.ownerNodeId, action.templateNodeId);
  const detachment = {
    ...action,
    instanceNodeId,
    instanceOccurrenceId,
    anchor: occurrenceAnchor(available, instanceOccurrenceId),
  };
  const seed = source
    ? nodeSeed(textAtoms(source).map((atom) => ({ value: atom.value, attributes: atom.attributes })))
    : undefined;
  return requireAuthoredActionBatch([
    ...createNodeUnlessPresent(
      instanceNodeId,
      action.ownerNodeId,
      { placementId: instanceOccurrenceId, anchor: action.anchor },
      available,
      { ...(seed ? { seed } : {}) },
    ),
    detachment,
  ]);
}
