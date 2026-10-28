// Purpose: Derives the supertag and field-definition roles and the content gate from a node's templates.

import type { NodeId } from "../store/node-id.ts";
import { hasName } from "../graph/content.ts";
import type { Graph } from "../graph/graph.ts";
import { template, templates } from "./templates.ts";

/** Any raw value is the supertag system node. Roles are relations; a kind never grants one. */
export function isSupertag(graph: Graph, node: NodeId): boolean {
  return templates(graph, node)?.includes(graph.system.supertag) ?? false;
}

/** Only the first raw value counts: a field definition tagged with something first is not one. */
export function isFieldDefinition(graph: Graph, node: NodeId): boolean {
  return template(graph, node) === graph.system.fieldDefinition;
}

/**
 * Whether an outline shows the node's template content: its first raw value is a named supertag.
 * Later values never open the gate, so a node whose first tag lost its role shows no template content
 * even when a later tag is valid.
 */
export function hasValidTemplate(graph: Graph, node: NodeId): boolean {
  const first = template(graph, node);
  return first !== undefined && isNamedSupertag(graph, first);
}

/** What the content gate asks of a node's first template. */
export function isNamedSupertag(graph: Graph, tag: NodeId): boolean {
  return isSupertag(graph, tag) && hasName(graph, tag);
}
