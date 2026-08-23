import {
  factActionsOfKind,
  factObserves,
  stableStringCompare,
  templateInstanceOccurrenceId,
  type FactAction,
} from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { supertagExtensionGraph } from "./supertag-extension-graph.js";
import type { TemplateNodeInstance, TemplateNodeSource } from "./projection-types.js";
import { listFor } from "./sequence.js";
import { templateMemberOccurrenceId } from "./projection-identity.js";

export type TemplateStructureProjection = Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  childOccurrences: Map<string, string[]>;
  instances: readonly TemplateNodeInstance[];
}>;

export function projectTemplateStructure(
  active: readonly FactAction[],
  allActions: readonly FactAction[],
  supertagApplications: Readonly<Record<string, readonly string[]>>,
  supertagTemplateNodes: Readonly<Record<string, readonly string[]>>,
  supertagExtensions: Readonly<Record<string, readonly string[]>>,
  nodes: Map<string, MutableNode>,
  authoredOccurrences: ReadonlyMap<string, MutableOccurrence>,
  authoredChildren: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
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
          const templateOccurrenceId = activeTemplateOccurrenceId(active, supertagId, templateNodeId);
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
  for (const identity of identities) {
    const [ownerNodeId, templateNodeId] = parseIdentity(identity);
    const current = currentSources.get(identity) ?? [];
    const detachFacts = detaches.get(identity) ?? [];
    if (!(ownerNodeId in nodeOwners) || (!nodes.has(templateNodeId) && detachFacts.length === 0)) {
      continue;
    }
    const detached = detachFacts.length > 0;
    const detachment = detached ? detachmentAction(detachFacts) : null;
    const occurrenceId = detachment?.instanceOccurrenceId ?? templateInstanceOccurrenceId(ownerNodeId, templateNodeId);
    const nodeId = detachment?.instanceNodeId ?? templateNodeId;
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
      state: detached ? "detached" : "linked",
      sources: current.length > 0 ? current : sourcesAtDetachments(detachFacts, allActions),
      detachmentActionIds: detachFacts.map((fact) => fact.id).sort(stableStringCompare),
    });
  }
  return { occurrences, childOccurrences, instances };
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

function activeTemplateOccurrenceId(
  active: readonly FactAction[],
  supertagId: string,
  templateNodeId: string,
): string | null {
  const removals = factActionsOfKind(active, "template-member-remove");
  let result: string | null = null;
  for (const fact of active) {
    const authoredAction = fact.action;
    if (
      authoredAction.kind !== "template-member-add" ||
      authoredAction.supertagId !== supertagId ||
      authoredAction.templateNodeId !== templateNodeId
    ) {
      continue;
    }
    const removed = removals.some((candidate) => {
      const removal = candidate.action;
      return (
        removal.supertagId === authoredAction.supertagId &&
        removal.templateNodeId === authoredAction.templateNodeId &&
        factObserves(candidate, fact)
      );
    });
    if (!removed) {
      result = templateMemberOccurrenceId(fact.id);
    }
  }
  return result;
}

export function authoredStructureWithoutProjectedTemplates(
  instances: readonly TemplateNodeInstance[],
  effectiveOccurrences: ReadonlyMap<string, MutableOccurrence>,
  effectiveChildren: ReadonlyMap<string, readonly string[]>,
): Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  childOccurrences: Map<string, string[]>;
}> {
  const occurrences = new Map([...effectiveOccurrences].map(([id, occurrence]) => [id, { ...occurrence }]));
  const childOccurrences = new Map(
    [...effectiveChildren].map(([parentNodeId, occurrenceIds]) => [parentNodeId, [...occurrenceIds]]),
  );
  const occurrenceIds = new Set<string>();
  for (const instance of instances) {
    const occurrence = occurrences.get(instance.instanceOccurrenceId);
    const stillProjected = instance.instanceNodeId === null && occurrence?.nodeId === instance.templateNodeId;
    if (stillProjected) {
      occurrenceIds.add(instance.instanceOccurrenceId);
      occurrences.delete(instance.instanceOccurrenceId);
    }
  }
  for (const [parent, childIds] of childOccurrences) {
    childOccurrences.set(
      parent,
      childIds.filter((occurrenceId) => !occurrenceIds.has(occurrenceId)),
    );
  }
  return { occurrences, childOccurrences };
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

function sourcesAtDetachments(
  detachments: readonly FactAction[],
  allActions: readonly FactAction[],
): readonly TemplateNodeSource[] {
  const sources = new Map<string, TemplateNodeSource>();
  for (const detachment of detachments) {
    const authoredAction = detachment.action;
    if (authoredAction.kind !== "template-node-detach") {
      continue;
    }
    const observed = allActions.filter(
      (candidate) => candidate.id === detachment.id || factObserves(detachment, candidate),
    );
    const applications = observed.filter((candidate) => {
      const application = candidate.action;
      if (application.kind !== "supertag-application-add" || application.hostNodeId !== authoredAction.ownerNodeId) {
        return false;
      }
      return !observed.some((removal) => {
        const removed = removal.action;
        return (
          removed.kind === "supertag-membership-remove" &&
          removed.hostNodeId === application.hostNodeId &&
          removed.supertagId === application.supertagId &&
          factObserves(removal, candidate)
        );
      });
    });
    const templateMembers = observed.filter((candidate) => {
      const member = candidate.action;
      if (member.kind !== "template-member-add" || member.templateNodeId !== authoredAction.templateNodeId) {
        return false;
      }
      return !observed.some((removal) => {
        const removed = removal.action;
        return (
          removed.kind === "template-member-remove" &&
          removed.supertagId === member.supertagId &&
          removed.templateNodeId === member.templateNodeId &&
          factObserves(removal, candidate)
        );
      });
    });
    const extensionAdds = observed.filter((candidate) => {
      const extension = candidate.action;
      if (extension.kind !== "supertag-extension-add") {
        return false;
      }
      return !observed.some((removal) => {
        const removed = removal.action;
        return (
          removed.kind === "supertag-extension-remove" &&
          removed.supertagId === extension.supertagId &&
          removed.baseSupertagId === extension.baseSupertagId &&
          factObserves(removal, candidate)
        );
      });
    });
    const extensions: Record<string, string[]> = {};
    for (const extension of extensionAdds) {
      const action = extension.action;
      if (action.kind !== "supertag-extension-add") {
        continue;
      }
      const bases = extensions[action.supertagId] ?? [];
      if (!bases.includes(action.baseSupertagId)) {
        bases.push(action.baseSupertagId);
      }
      extensions[action.supertagId] = bases;
    }
    const extensionGraph = supertagExtensionGraph(extensions);
    for (const applicationFact of applications) {
      const application = applicationFact.action;
      if (application.kind !== "supertag-application-add") {
        continue;
      }
      const lineage = new Set(extensionGraph.lineage(application.supertagId));
      for (const memberFact of templateMembers) {
        const member = memberFact.action;
        if (member.kind !== "template-member-add" || !lineage.has(member.supertagId)) {
          continue;
        }
        const occurrenceId = templateMemberOccurrenceId(memberFact.id);
        sources.set(`${application.supertagId}/${occurrenceId}`, {
          supertagId: member.supertagId,
          appliedSupertagId: application.supertagId,
          templateOccurrenceId: occurrenceId,
        });
      }
    }
  }
  return [...sources.values()].sort((left, right) =>
    stableStringCompare(left.templateOccurrenceId, right.templateOccurrenceId),
  );
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
