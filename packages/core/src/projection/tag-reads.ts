// Purpose: Reads tags and template sources at any address; a projected node's tag reads go through its projected metanode.

import type { NodeId } from "../store/node-id.ts";
import { isEmpty } from "../graph/emptiness.ts";
import type { Graph } from "../graph/graph.ts";
import { foldApplications } from "../tags/fold.ts";
import { isNamedSupertag } from "../tags/roles.ts";
import { templateSources, type SourceOrder } from "../tags/sources.ts";
import { template, templates } from "../tags/templates.ts";
import { addressKey, isProjected, sameAddress, storedNode, type NodeAddress } from "./address.ts";
import { childrenOf, definitionAt, isMetanodeAt, kindAt, metanodeCandidatesAt, type Line } from "./readers.ts";

/**
 * The address's templates. A real node reads its own fold. A projected node reads through its
 * projected metanodes: a metanode's template is the metanode template, otherwise the applications every
 * valid candidate lists, folded as stored candidates are, with values already projected where the
 * boundary says.
 */
export function templatesAt(graph: Graph, address: NodeAddress): NodeAddress[] | undefined {
  if (!isProjected(address)) {
    return templates(graph, address);
  }
  if (isMetanodeAt(graph, address)) {
    return [graph.system.metaTemplate];
  }
  const applications = metanodeCandidatesAt(graph, address).flatMap((metanode) =>
    childrenOf(graph, metanode)
      .map((line) => line.node)
      // Nominal, not structural: an application with no value is still the fold's seed.
      .filter((child) => kindAt(graph, child) === "tuple" && definitionAt(graph, child) === graph.system.tags),
  );
  const values = foldApplications<Line>(
    applications.map((application) => childrenOf(graph, application)),
    {
      same: (a, b) => sameAddress(a.node, b.node),
      isReference: (line) => line.link === "reference",
      isEmpty: (line) => isEmpty(graph, storedNode(line.node)),
    },
  ).map((group) => group[0]!.node);
  return values.length > 0 ? values : undefined;
}

/** The first template is read from the stored source unmapped, as the reference system reads it on a projection. */
export function templateAt(graph: Graph, address: NodeAddress): NodeId | undefined {
  return template(graph, storedNode(address));
}

export function isSupertagAt(graph: Graph, address: NodeAddress): boolean {
  return templatesAt(graph, address)?.includes(graph.system.supertag) ?? false;
}

export function hasValidTemplateAt(graph: Graph, address: NodeAddress): boolean {
  const first = templateAt(graph, address);
  return first !== undefined && isNamedSupertag(graph, first);
}

/** Template sources as addresses: a tag the projection shows as a projection is walked as one. */
export function templateSourcesAt(graph: Graph, address: NodeAddress, order: SourceOrder): NodeAddress[] {
  return templateSources(address, order, {
    templatesOf: (node) => templatesAt(graph, node),
    key: addressKey,
    isSupertagMarker: (node) => node === graph.system.supertag,
  });
}
