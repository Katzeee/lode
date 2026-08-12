import { stableStringCompare } from "../../domain/fact/index.js";
import type { Projection } from "../../domain/reconcile/index.js";

export type ProjectionIndexEntry = Readonly<{
  section:
    | "occurrenceIdsByNode"
    | "managedChildrenByParentNode"
    | "managedChildrenBySchema"
    | "managedChildrenByField"
    | "managedChildrenByNode"
    | "managedChildrenByOccurrence";
  identity: string;
  value: readonly string[];
}>;

export function projectionIndexEntries(projection: Projection): readonly ProjectionIndexEntry[] {
  const indexes = new Map<
    string,
    {
      section: ProjectionIndexEntry["section"];
      identity: string;
      values: string[];
    }
  >();
  const add = (section: ProjectionIndexEntry["section"], identity: string, value: string) => {
    const key = JSON.stringify([section, identity]);
    const index = indexes.get(key) ?? { section, identity, values: [] };
    index.values.push(value);
    indexes.set(key, index);
  };
  for (const occurrence of Object.values(projection.occurrences)) {
    add("occurrenceIdsByNode", occurrence.nodeId, occurrence.occurrenceId);
  }
  projection.managedChildren.forEach((child, index) => {
    const identity = String(index);
    add("managedChildrenByParentNode", child.parentNodeId, identity);
    add("managedChildrenBySchema", child.schemaId, identity);
    add("managedChildrenByField", child.fieldId, identity);
    add("managedChildrenByNode", child.nodeId, identity);
    add("managedChildrenByOccurrence", child.occurrenceId, identity);
  });
  return [...indexes.values()].map((index) => ({
    section: index.section,
    identity: index.identity,
    value: index.values.sort(stableStringCompare),
  }));
}
