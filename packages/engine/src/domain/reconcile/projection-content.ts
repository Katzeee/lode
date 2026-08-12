import { stableStringCompare, type ContributionFact, type JsonValue } from "../fact/index.js";
import type { ManagedChild, TextAtom } from "./projection-types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import {
  managedNodeId,
  managedOccurrenceId,
  mutationTargets,
  parseManagedIdentity,
} from "./managed-identity.js";
import { insertManyAtAnchor, listFor, removePlacement } from "./sequence.js";
import { valueOwnerAddress } from "./value-address.js";

export function applyText(
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "text-splice") {
      const node = nodes.get(mutation.nodeId);
      if (!node) {
        continue;
      }
      const deleted = new Set(mutation.deleteAtomIds);
      node.text = node.text.filter((atom) => !deleted.has(atom.id));
      const inserted = [...mutation.insert].map((value, index): TextAtom => ({
        id: `${fact.id}#${index}`,
        value,
        attributes: mutation.attributes ?? {},
        contributionId: fact.id,
      }));
      insertManyAtAnchor(node.text, inserted, mutation.anchor, (atom) => atom.id);
    } else if (mutation.kind === "text-mark") {
      const node = nodes.get(mutation.nodeId);
      if (!node) {
        continue;
      }
      const targets = new Set(mutation.atomIds);
      node.text = node.text.map((atom) => {
        if (!targets.has(atom.id)) {
          return atom;
        }
        const attributes = { ...atom.attributes };
        if (mutation.value.kind === "unset") {
          delete attributes[mutation.key];
        } else {
          attributes[mutation.key] = mutation.value.value;
        }
        return { ...atom, attributes };
      });
    }
  }
}
export function applyValues(
  active: readonly ContributionFact[],
  initial: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {},
): Readonly<Record<string, Readonly<Record<string, JsonValue>>>> {
  const standalone = new Map(
    Object.entries(initial).map(([address, values]) => [address, { ...values }]),
  );
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "value-set" && mutation.kind !== "value-unset") {
      continue;
    }
    const address = valueOwnerAddress(mutation.owner, mutation.namespace);
    const namespace = standalone.get(address) ?? {};
    standalone.set(address, namespace);
    if (mutation.kind === "value-set") {
      namespace[mutation.key] = mutation.value;
    } else {
      delete namespace[mutation.key];
    }
  }
  return Object.fromEntries(
    [...standalone].sort(([left], [right]) => stableStringCompare(left, right)),
  );
}
export function deriveManagedChildren(
  nodes: Map<string, MutableNode>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  canonicalOccurrences: Readonly<Record<string, string>>,
  addressedValues: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
  active: readonly ContributionFact[],
): ManagedChild[] {
  const managed: ManagedChild[] = [];
  for (const node of [...nodes.values()]) {
    const schemaId =
      addressedValues[valueOwnerAddress({ kind: "node", id: node.nodeId }, "property")]?.schemaId;
    if (typeof schemaId !== "string") {
      continue;
    }
    const fields = managedFieldCandidates(node.nodeId, schemaId, addressedValues, active);
    for (const [field, isActive] of fields) {
      materializeManagedChild(
        node.nodeId,
        schemaId,
        field,
        isActive,
        nodes,
        occurrences,
        children,
        canonicalOccurrences,
        managed,
      );
    }
  }
  for (const fact of active) {
    for (const target of mutationTargets(fact.body.mutation)) {
      const identity = parseManagedIdentity(target);
      if (identity && nodes.has(identity.parentNodeId) && !nodes.has(identity.nodeId)) {
        materializeManagedChild(
          identity.parentNodeId,
          identity.schemaId,
          identity.fieldId,
          false,
          nodes,
          occurrences,
          children,
          canonicalOccurrences,
          managed,
        );
      }
    }
  }
  return managed;
}
function materializeManagedChild(
  parentNodeId: string,
  schemaId: string,
  fieldId: string,
  active: boolean,
  nodes: Map<string, MutableNode>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  canonicalOccurrences: Readonly<Record<string, string>>,
  managed: ManagedChild[],
): void {
  const nodeId = managedNodeId(parentNodeId, schemaId, fieldId);
  const occurrenceId = managedOccurrenceId(parentNodeId, schemaId, fieldId);
  const existingNode = nodes.get(nodeId);
  if (!existingNode) {
    nodes.set(nodeId, {
      nodeId,
      text: [],
      properties: { fieldId, schemaId },
      metadata: active ? { managed: true } : { inactiveField: true },
    });
  } else {
    existingNode.properties.fieldId = fieldId;
    existingNode.properties.schemaId = schemaId;
    delete existingNode.metadata.managed;
    delete existingNode.metadata.inactiveField;
    existingNode.metadata[active ? "managed" : "inactiveField"] = true;
  }
  const canonicalId = canonicalOccurrences[parentNodeId];
  const canonical = canonicalId ? occurrences.get(canonicalId) : undefined;
  const existingOccurrence = occurrences.get(occurrenceId);
  if (canonical && !existingOccurrence) {
    occurrences.set(occurrenceId, {
      occurrenceId,
      nodeId,
      parentOccurrenceId: canonical.occurrenceId,
      properties: {},
      metadata: active ? { managed: true } : { inactiveField: true },
      managed: active,
    });
    listFor(children, canonical.occurrenceId).push(occurrenceId);
  } else if (canonical && existingOccurrence) {
    if (existingOccurrence.parentOccurrenceId !== canonical.occurrenceId) {
      removePlacement(children, occurrenceId);
      existingOccurrence.parentOccurrenceId = canonical.occurrenceId;
      listFor(children, canonical.occurrenceId).push(occurrenceId);
    }
    delete existingOccurrence.metadata.managed;
    delete existingOccurrence.metadata.inactiveField;
    existingOccurrence.metadata[active ? "managed" : "inactiveField"] = true;
    existingOccurrence.managed = active;
  }
  if (active) {
    managed.push({ parentNodeId, schemaId, fieldId, nodeId, occurrenceId });
  }
}
function managedFieldCandidates(
  parentNodeId: string,
  schemaId: string,
  addressedValues: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
  active: readonly ContributionFact[],
): ReadonlyMap<string, boolean> {
  const fields = new Map<string, Readonly<{ active: boolean; order: number }>>();
  for (const [fieldId, definition] of Object.entries(
    addressedValues[valueOwnerAddress({ kind: "schema", id: schemaId }, "schema")] ?? {},
  )) {
    if (typeof definition === "number") {
      fields.set(fieldId, { active: true, order: definition });
    }
  }
  for (const fact of active) {
    for (const target of mutationTargets(fact.body.mutation)) {
      const identity = parseManagedIdentity(target);
      if (
        identity?.parentNodeId === parentNodeId &&
        identity.schemaId === schemaId &&
        !fields.has(identity.fieldId)
      ) {
        fields.set(identity.fieldId, { active: false, order: Number.MAX_SAFE_INTEGER });
      }
    }
  }
  return new Map(
    [...fields]
      .sort(
        ([leftId, left], [rightId, right]) =>
          left.order - right.order || stableStringCompare(leftId, rightId),
      )
      .map(([fieldId, field]) => [fieldId, field.active]),
  );
}
