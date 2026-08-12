import type {
  EditIntent,
  FactSnapshot,
  JsonValue,
  Mutation,
  ViewMode,
} from "../../domain/fact/index.js";
import {
  replayNodeIdentity,
  replayOccurrenceIdentity,
  valueOwnerAddress,
  type Projection,
  type ProjectionGeneration,
  type ProjectedNode,
  type TextAtom,
} from "../../domain/reconcile/index.js";

export function applyPlanningMutation(
  generation: ProjectionGeneration,
  mutation: Mutation,
  factId: string,
  intent: EditIntent,
  snapshot: FactSnapshot,
): ProjectionGeneration {
  const origin =
    intent === "direct"
      ? applyToProjection(generation.origin, mutation, factId, snapshot, "origin")
      : generation.origin;
  const review = applyToProjection(generation.review, mutation, factId, snapshot, "review");
  return { ...generation, origin, review };
}

function applyToProjection(
  projection: Projection,
  mutation: Mutation,
  factId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
): Projection {
  const nodes = Object.fromEntries(
    Object.entries(projection.nodes).map(([id, node]) => [
      id,
      {
        ...node,
        text: node.text.map((atom) => ({ ...atom, attributes: { ...atom.attributes } })),
        properties: { ...node.properties },
        metadata: { ...node.metadata },
      },
    ]),
  );
  const occurrences = Object.fromEntries(
    Object.entries(projection.occurrences).map(([id, occurrence]) => [
      id,
      {
        ...occurrence,
        properties: { ...occurrence.properties },
        metadata: { ...occurrence.metadata },
      },
    ]),
  );
  const children = Object.fromEntries(
    Object.entries(projection.children).map(([id, ids]) => [id, [...ids]]),
  );
  const canonicalOccurrences = { ...projection.canonicalOccurrences };
  const addressedValues = Object.fromEntries(
    Object.entries(projection.addressedValues).map(([address, values]) => [address, { ...values }]),
  );
  const next = {
    ...projection,
    nodes,
    occurrences,
    children,
    canonicalOccurrences,
    addressedValues,
  };
  applyMutation(next, mutation, factId, snapshot, view);
  return next;
}

function applyMutation(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
): void {
  switch (mutation.kind) {
    case "node-create":
      projection.nodes[mutation.nodeId] ??= {
        nodeId: mutation.nodeId,
        text: [],
        properties: {},
        metadata: {},
      };
      return;
    case "node-restore": {
      const restored = replayNodeIdentity(snapshot, view, mutation.nodeId);
      if (restored) {
        projection.nodes[mutation.nodeId] = {
          ...restored,
          text: restored.text.map((atom) => ({
            ...atom,
            attributes: { ...atom.attributes },
          })),
          properties: { ...restored.properties },
          metadata: { ...restored.metadata },
        };
      }
      return;
    }
    case "node-delete":
      delete projection.nodes[mutation.nodeId];
      for (const occurrence of Object.values(projection.occurrences)) {
        if (occurrence.nodeId === mutation.nodeId) {
          removeOccurrence(projection, occurrence.occurrenceId, "cascade");
        }
      }
      return;
    case "occurrence-create":
      projection.occurrences[mutation.occurrenceId] = {
        occurrenceId: mutation.occurrenceId,
        nodeId: mutation.nodeId,
        parentOccurrenceId: mutation.parentOccurrenceId,
        properties: {},
        metadata: {},
        managed: false,
      };
      insertChild(projection, mutation.occurrenceId, mutation.parentOccurrenceId, mutation.anchor);
      return;
    case "occurrence-restore": {
      const restored = replayOccurrenceIdentity(snapshot, view, mutation.occurrenceId);
      if (!restored) {
        return;
      }
      projection.occurrences[mutation.occurrenceId] = {
        ...restored,
        parentOccurrenceId: mutation.parentOccurrenceId,
      };
      insertChild(projection, mutation.occurrenceId, mutation.parentOccurrenceId, mutation.anchor);
      return;
    }
    case "occurrence-delete":
      removeOccurrence(projection, mutation.occurrenceId, mutation.childPolicy);
      return;
    case "occurrence-move":
      {
        const occurrence = projection.occurrences[mutation.occurrenceId];
        if (!occurrence) {
          return;
        }
        detachChild(projection, mutation.occurrenceId);
        projection.occurrences[mutation.occurrenceId] = {
          ...occurrence,
          parentOccurrenceId: mutation.parentOccurrenceId,
        };
      }
      insertChild(projection, mutation.occurrenceId, mutation.parentOccurrenceId, mutation.anchor);
      return;
    case "canonical-occurrence-set":
      projection.canonicalOccurrences[mutation.nodeId] = mutation.occurrenceId;
      return;
    case "text-splice": {
      const node = projection.nodes[mutation.nodeId];
      if (!node) {
        return;
      }
      const remaining = node.text.filter((atom) => !mutation.deleteAtomIds.includes(atom.id));
      const index = insertionIndex(remaining, mutation.anchor);
      const inserted = [...mutation.insert].map((value, offset): TextAtom => ({
        id: `${factId}#${offset}`,
        value,
        attributes: {},
        contributionId: factId,
      }));
      node.text = [...remaining.slice(0, index), ...inserted, ...remaining.slice(index)];
      return;
    }
    case "text-mark": {
      const node = projection.nodes[mutation.nodeId];
      if (!node) {
        return;
      }
      node.text = node.text.map((atom) =>
        mutation.atomIds.includes(atom.id)
          ? {
              ...atom,
              attributes:
                mutation.value.kind === "unset"
                  ? without(atom.attributes, mutation.key)
                  : { ...atom.attributes, [mutation.key]: mutation.value.value },
            }
          : atom,
      );
      return;
    }
    case "value-set":
    case "value-unset":
      applyValue(projection, mutation);
  }
}

type MutableProjection = Omit<
  Projection,
  "nodes" | "occurrences" | "children" | "canonicalOccurrences" | "addressedValues"
> & {
  nodes: Record<string, MutableNode>;
  occurrences: Record<string, Projection["occurrences"][string]>;
  children: Record<string, readonly string[]>;
  canonicalOccurrences: Record<string, string>;
  addressedValues: Record<string, Readonly<Record<string, JsonValue>>>;
};
type MutableNode = Omit<ProjectedNode, "text" | "properties" | "metadata"> & {
  text: TextAtom[];
  properties: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
};

function applyValue(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
): void {
  let values: Record<string, JsonValue>;
  if (mutation.owner.kind === "node") {
    const node = projection.nodes[mutation.owner.id];
    if (!node) {
      return;
    }
    values = { ...(mutation.namespace === "metadata" ? node.metadata : node.properties) };
    projection.nodes[mutation.owner.id] = {
      ...node,
      [mutation.namespace === "metadata" ? "metadata" : "properties"]: values,
    };
  } else if (mutation.owner.kind === "occurrence") {
    const occurrence = projection.occurrences[mutation.owner.id];
    if (!occurrence) {
      return;
    }
    values = {
      ...(mutation.namespace === "metadata" ? occurrence.metadata : occurrence.properties),
    };
    projection.occurrences[mutation.owner.id] = {
      ...occurrence,
      [mutation.namespace === "metadata" ? "metadata" : "properties"]: values,
    };
  } else {
    const address = valueOwnerAddress(mutation.owner, mutation.namespace);
    values = { ...projection.addressedValues[address] };
    projection.addressedValues[address] = values;
  }
  if (mutation.kind === "value-set") {
    values[mutation.key] = mutation.value;
  } else {
    delete values[mutation.key];
  }
}

function removeOccurrence(
  projection: MutableProjection,
  occurrenceId: string,
  policy: "cascade" | "rehome",
): void {
  const occurrence = projection.occurrences[occurrenceId];
  if (!occurrence) {
    return;
  }
  const nested = [...(projection.children[occurrenceId] ?? [])];
  detachChild(projection, occurrenceId);
  if (policy === "cascade") {
    for (const child of nested) {
      removeOccurrence(projection, child, "cascade");
    }
  } else {
    for (const child of nested) {
      const nestedOccurrence = projection.occurrences[child];
      if (!nestedOccurrence) {
        continue;
      }
      projection.occurrences[child] = {
        ...nestedOccurrence,
        parentOccurrenceId: occurrence.parentOccurrenceId,
      };
      insertChild(projection, child, occurrence.parentOccurrenceId, {
        after: null,
        before: null,
        affinity: "after",
        fallback: "end",
      });
    }
  }
  delete projection.children[occurrenceId];
  delete projection.occurrences[occurrenceId];
}

function detachChild(projection: MutableProjection, occurrenceId: string): void {
  for (const [parent, ids] of Object.entries(projection.children)) {
    projection.children[parent] = ids.filter((id) => id !== occurrenceId);
  }
}
function insertChild(
  projection: MutableProjection,
  occurrenceId: string,
  parent: string | null,
  anchor: Extract<Mutation, { kind: "occurrence-create" }>["anchor"],
): void {
  const key = parent ?? "$root";
  const ids = [...(projection.children[key] ?? [])].filter((id) => id !== occurrenceId);
  const index = insertionIndex(
    ids.map((id) => ({ id })),
    anchor,
  );
  ids.splice(index, 0, occurrenceId);
  projection.children[key] = ids;
}
function insertionIndex(
  values: readonly { id: string }[],
  anchor: { after: string | null; before: string | null; fallback: "start" | "end" },
): number {
  const after = anchor.after === null ? -1 : values.findIndex((value) => value.id === anchor.after);
  if (after >= 0) {
    return after + 1;
  }
  const before =
    anchor.before === null ? -1 : values.findIndex((value) => value.id === anchor.before);
  return before >= 0 ? before : anchor.fallback === "start" ? 0 : values.length;
}
function without(values: Readonly<Record<string, JsonValue>>, key: string) {
  const next = { ...values };
  delete next[key];
  return next;
}
