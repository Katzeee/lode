import type { EditAction } from "../../../domain/edit/index.js";
import type { FactActionId, GraphAction } from "../../../domain/fact/index.js";
import { requireAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import {
  occurrenceAnchor,
  templateMaterializationIdentity,
  type InterpretedProjection,
} from "../../../domain/reconcile/index.js";
import { templateSourceGraph } from "../../../domain/authored-intent/index.js";
import { templateEditProgram } from "./template-edit-program.js";
import { createTemplateGraph } from "./template-graph-creation.js";
import { planNodeIntents } from "./node-intent-planning.js";
import { EditPlanningRejection } from "./planning-rejection.js";
import { retainNodeContentReferences } from "./node-content-retention.js";

export function planTemplateNodeEdit(
  edit: Extract<EditAction, { kind: "template-node-edit" }>,
  available: InterpretedProjection,
  finalActionId: (index: number) => FactActionId,
  preview: (actions: readonly GraphAction[]) => InterpretedProjection,
): AuthoredActionBatch {
  const instance = available.templateNodeInstances.find(
    (item) => item.ownerNodeId === edit.ownerNodeId && item.templateNodeId === edit.templateNodeId,
  );
  if (!instance || instance.state === "reference") {
    throw new EditPlanningRejection("Template editing context is absent or is a shared Reference");
  }
  const program = templateEditProgram(available, finalActionId, preview);
  const samePath = (path: readonly string[]) =>
    path.length === edit.sourcePath.length && path.every((id, index) => id === edit.sourcePath[index]);
  if (instance.state === "detached") {
    const target = instance.copies.find((copy) => samePath(copy.sourcePath));
    if (!target) {
      throw new EditPlanningRejection("The source path does not identify a materialized Node");
    }
    const intents = edit.intents.map((intent) =>
      intent.kind === "insert-node"
        ? { ...intent, content: retainNodeContentReferences(intent.content, target.instanceNodeId, available) }
        : intent,
    );
    planNodeIntents(target.instanceNodeId, intents, program, target.instanceOccurrenceId);
    return requireAuthoredActionBatch(program.actions);
  }
  const identity = templateMaterializationIdentity(edit.ownerNodeId, edit.templateNodeId, available);
  const source = templateSourceGraph(edit.ownerNodeId, edit.templateNodeId, identity, available);
  const target = source.nodes.find((copy) => samePath(copy.sourcePath));
  if (!target) {
    throw new EditPlanningRejection("The source path does not identify owned template content");
  }
  const tags = new Set((available.supertagApplications[target.sourceNodeId] ?? []).map((item) => item.supertagId));
  for (const intent of edit.intents) {
    if (intent.kind === "add-supertag") {
      tags.add(intent.supertagId);
    }
    if (intent.kind === "remove-supertag") {
      tags.delete(intent.supertagId);
    }
  }
  const content = edit.intents.filter((intent) => intent.kind === "set-content").at(-1)?.content;
  const anchor = occurrenceAnchor(available, instance.instanceOccurrenceId);
  const referenceCopies = createTemplateGraph(source, available, program, anchor, target.instanceNodeId, content, tags);
  planNodeIntents(
    target.instanceNodeId,
    [...tags].map((supertagId) => ({ kind: "add-supertag", supertagId })),
    program,
  );
  program.append({
    kind: "template-node-detach",
    ownerNodeId: edit.ownerNodeId,
    templateNodeId: edit.templateNodeId,
    ...identity,
    anchor,
    sources: instance.sources,
    referenceCopies,
    copies: source.nodes.map(({ sourceNodeId, sourcePath, instanceNodeId, instanceOccurrenceId }) => ({
      sourceNodeId,
      sourcePath,
      instanceNodeId,
      instanceOccurrenceId,
    })),
  });
  // Resolve retained split content against the source before either half changes.
  const insertions = edit.intents.flatMap((intent) =>
    intent.kind === "insert-node"
      ? [
          {
            ...intent,
            // A first sibling insertion belongs to the ordinary sequence beneath the effective source slot.
            placement:
              edit.sourcePath.length === 0 && intent.placement === "after" ? ("before" as const) : intent.placement,
            content: retainNodeContentReferences(
              intent.content,
              target.sourceNodeId,
              available,
              (id) => source.copied.get(id)?.instanceNodeId ?? id,
            ),
          },
        ]
      : [],
  );
  planNodeIntents(target.instanceNodeId, insertions, program, target.instanceOccurrenceId);
  return requireAuthoredActionBatch(program.actions);
}
