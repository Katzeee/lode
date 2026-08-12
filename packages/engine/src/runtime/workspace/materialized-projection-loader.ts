import type { JsonValue } from "../../domain/fact/index.js";
import type {
  ManagedChild,
  ProjectedNode,
  ProjectedOccurrence,
  Projection,
} from "../../domain/reconcile/index.js";
import type { ProjectionHeader, ShardDescriptor } from "./materialized-generation-format.js";

export async function loadMaterializedProjection(
  header: ProjectionHeader,
  descriptors: readonly ShardDescriptor[],
  load: (descriptor: ShardDescriptor) => Promise<unknown>,
): Promise<Projection> {
  const nodes: Record<string, ProjectedNode> = {};
  const occurrences: Record<string, ProjectedOccurrence> = {};
  const children: Record<string, readonly string[]> = {};
  const canonicalOccurrences: Record<string, string> = {};
  const addressedValues: Record<string, Readonly<Record<string, JsonValue>>> = {};
  const managedChildren: ManagedChild[] = [];
  for (const descriptor of descriptors) {
    const value = await load(descriptor);
    switch (descriptor.section) {
      case "nodes":
        nodes[descriptor.identity] = value as ProjectedNode;
        break;
      case "occurrences":
        occurrences[descriptor.identity] = value as ProjectedOccurrence;
        break;
      case "children":
        children[descriptor.identity] = value as readonly string[];
        break;
      case "canonicalOccurrences":
        canonicalOccurrences[descriptor.identity] = value as string;
        break;
      case "addressedValues":
        addressedValues[descriptor.identity] = value as Readonly<Record<string, JsonValue>>;
        break;
      case "managedChildren":
        managedChildren[Number(descriptor.identity)] = value as ManagedChild;
        break;
      case "occurrenceIdsByNode":
      case "managedChildrenByParentNode":
      case "managedChildrenBySchema":
      case "managedChildrenByField":
      case "managedChildrenByNode":
      case "managedChildrenByOccurrence":
        break;
    }
  }
  return {
    view: header.view,
    identity: header.identity,
    nodes,
    occurrences,
    children,
    canonicalOccurrences,
    addressedValues,
    managedChildren,
  };
}
