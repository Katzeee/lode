import { stableStringCompare, templateInstanceOccurrenceId, type FactAction } from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { supertagExtensionGraph } from "./supertag-extension-graph.js";
import type { TemplateNodeInstance, TemplateNodeSource } from "./projection-types.js";
import { listFor } from "./sequence.js";

export type TemplateStructureProjection = Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  childOccurrences: Map<string, string[]>;
  instances: readonly TemplateNodeInstance[];
}>;

export function projectTemplateStructure(
  active: readonly FactAction[],
  supertagApplications: Readonly<Record<string, readonly string[]>>,
  supertagTemplateNodes: Readonly<Record<string, readonly string[]>>,
  supertagExtensions: Readonly<Record<string, readonly string[]>>,
  nodes: Map<string, MutableNode>,
  authoredOccurrences: ReadonlyMap<string, MutableOccurrence>,
  authoredChildren: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  activeNodeIds: ReadonlySet<string>,
): TemplateStructureProjection {
  const occurrences = new Map([...authoredOccurrences].map(([id, occurrence]) => [id, { ...occurrence }]));
  const childOccurrences = new Map(
    [...authoredChildren].map(([parentNodeId, occurrenceIds]) => [parentNodeId, [...occurrenceIds]]),
  );
  const extensionGraph = supertagExtensionGraph(supertagExtensions);
  const currentSources = new Map<string, TemplateNodeSource[]>();
  for (const [ownerNodeId, appliedSupertagIds] of Object.entries(supertagApplications)) {
    for (const appliedSupertagId of appliedSupertagIds) {
      for (const supertagId of extensionGraph.lineage(appliedSupertagId)) {
        for (const templateNodeId of supertagTemplateNodes[supertagId] ?? []) {
          const templateOccurrenceId =
            (authoredChildren.get(supertagId) ?? []).find(
              (id) => authoredOccurrences.get(id)?.nodeId === templateNodeId,
            ) ?? null;
          if (templateOccurrenceId === null) {
            continue;
          }
          appendSource(currentSources, ownerNodeId, templateNodeId, {
            supertagId,
            appliedSupertagId,
            templateOccurrenceId,
          });
        }
      }
    }
  }
  const detaches = detachments(active);
  const identities = new Set([...currentSources.keys(), ...detaches.keys()]);
  const instances: TemplateNodeInstance[] = [];
  const sourceSlots = new Map<string, string[]>();
  for (const identity of identities) {
    const [ownerNodeId, templateNodeId] = parseIdentity(identity);
    const current = currentSources.get(identity) ?? [];
    const detachFacts = detaches.get(identity) ?? [];
    if (!(ownerNodeId in nodeOwners) || (!nodes.has(templateNodeId) && detachFacts.length === 0)) {
      continue;
    }
    const liveDetachments = activeDetachments(detachFacts, activeNodeIds, authoredOccurrences, ownerNodeId);
    const detached = liveDetachments.length > 0;
    if (!detached && current.length === 0) {
      continue;
    }
    const detachment = detached ? detachmentAction(liveDetachments) : null;
    const sourceOccurrenceId = templateInstanceOccurrenceId(ownerNodeId, templateNodeId);
    const occupied = authoredOccurrences.get(sourceOccurrenceId);
    const occurrenceId =
      detachment?.instanceOccurrenceId ??
      (occupied && occupied.nodeId !== templateNodeId ? `${sourceOccurrenceId}/source` : sourceOccurrenceId);
    const nodeId = detachment?.instanceNodeId ?? templateNodeId;
    if (current.length > 0) {
      appendUnique(listFor(sourceSlots, ownerNodeId), occurrenceId);
    }
    if (detached) {
      const occurrence = occurrences.get(occurrenceId);
      if (occurrence) {
        occurrence.derived = false;
      }
    } else {
      occurrences.set(occurrenceId, {
        occurrenceId,
        nodeId,
        parentNodeId: ownerNodeId,
        derived: true,
      });
      appendUnique(listFor(childOccurrences, ownerNodeId), occurrenceId);
    }
    instances.push({
      ownerNodeId,
      templateNodeId,
      instanceNodeId: detached ? nodeId : null,
      instanceOccurrenceId: occurrenceId,
      state: detached
        ? "detached"
        : current.some((source) => nodeOwners[templateNodeId] === source.supertagId)
          ? "linked"
          : "reference",
      sources:
        current.length > 0
          ? current
          : detachFacts.flatMap((fact) => (fact.action.kind === "template-node-detach" ? fact.action.sources : [])),
      detachmentActionIds: detachFacts.map((fact) => fact.id).sort(stableStringCompare),
      copies: detachment?.copies ?? [],
      referenceCopies: detachment?.referenceCopies ?? [],
    });
  }
  applySourceOrder(childOccurrences, sourceSlots);
  return { occurrences, childOccurrences, instances };
}

function applySourceOrder(children: Map<string, string[]>, sourceSlots: ReadonlyMap<string, readonly string[]>) {
  // Active template sources keep their effective positions even when a local copy occupies them.
  // Removing the application reveals the underlying authored sequence unchanged.
  for (const [ownerNodeId, slots] of sourceSlots) {
    const occupied = new Set(slots);
    children.set(ownerNodeId, [...slots, ...listFor(children, ownerNodeId).filter((id) => !occupied.has(id))]);
  }
}

function activeDetachments(
  facts: readonly FactAction[],
  activeNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  ownerNodeId: string,
) {
  return facts.filter(
    (fact) =>
      fact.action.kind === "template-node-detach" &&
      activeNodeIds.has(fact.action.instanceNodeId) &&
      occurrences.get(fact.action.instanceOccurrenceId)?.parentNodeId === ownerNodeId,
  );
}

function detachmentAction(
  facts: readonly FactAction[],
): Extract<FactAction["action"], { kind: "template-node-detach" }> {
  for (const fact of facts) {
    if (fact.action.kind === "template-node-detach") {
      return fact.action;
    }
  }
  throw new Error("Detached Template content has no detachment Fact");
}

function detachments(active: readonly FactAction[]): ReadonlyMap<string, readonly FactAction[]> {
  const result = new Map<string, FactAction[]>();
  for (const fact of active) {
    const authoredAction = fact.action;
    if (authoredAction.kind !== "template-node-detach") {
      continue;
    }
    const key = `${encodeURIComponent(authoredAction.ownerNodeId)}/${encodeURIComponent(authoredAction.templateNodeId)}`;
    const values = result.get(key) ?? [];
    values.push(fact);
    result.set(key, values);
  }
  return result;
}

function appendSource(
  sources: Map<string, TemplateNodeSource[]>,
  ownerNodeId: string,
  templateNodeId: string,
  source: TemplateNodeSource,
): void {
  const key = `${encodeURIComponent(ownerNodeId)}/${encodeURIComponent(templateNodeId)}`;
  const values = sources.get(key) ?? [];
  if (
    !values.some(
      (candidate) =>
        candidate.appliedSupertagId === source.appliedSupertagId &&
        candidate.templateOccurrenceId === source.templateOccurrenceId,
    )
  ) {
    values.push(source);
  }
  sources.set(key, values);
}

function parseIdentity(value: string): readonly [string, string] {
  const [ownerNodeId, templateNodeId] = value.split("/");
  if (!ownerNodeId || !templateNodeId) {
    throw new Error(`Invalid Template Node instance identity: ${value}`);
  }
  return [decodeURIComponent(ownerNodeId), decodeURIComponent(templateNodeId)];
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}
