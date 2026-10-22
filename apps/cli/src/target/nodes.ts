import {
  END_SEQUENCE_ANCHOR,
  type ProjectedNode,
  type ProjectedOccurrence,
  type ProjectionPerspective,
  type SequenceAnchor,
} from "@lode/sdk";

import { CliError, type TargetCandidate } from "../outcome/index.js";
import type { DesktopSession } from "../session/index.js";
import {
  descriptor,
  NODE_KIND_INTRINSICS,
  nodeLabel,
  parseSelector,
  type ResourceDescriptor,
  type TargetKind,
} from "./selector.js";

type ResolvedNodeTarget = Readonly<{
  nodeId: string;
  label: string;
  kind: TargetKind;
  descriptor: ResourceDescriptor;
}>;

/** Node kinds a given node can satisfy for a command, or none. */
function kindOfNode(node: ProjectedNode, kinds: readonly TargetKind[]): TargetKind | undefined {
  for (const [kind, intrinsics] of Object.entries(NODE_KIND_INTRINSICS) as readonly (readonly [
    keyof typeof NODE_KIND_INTRINSICS,
    readonly (string | null)[],
  ])[]) {
    if (kinds.includes(kind) && intrinsics.includes(node.intrinsicNodeType ?? null)) {
      return kind;
    }
  }
  return undefined;
}

/**
 * Resolves one node-backed target. `kinds` restricts the target kinds this
 * command accepts; `scope.under` narrows label matches to one owner chain
 * before uniqueness is decided.
 */
export async function resolveNodeTarget(
  session: DesktopSession,
  workspaceId: string,
  perspective: ProjectionPerspective,
  token: string,
  kinds: readonly TargetKind[],
  scope: Readonly<{ underParentIds?: readonly string[] }> = {},
): Promise<ResolvedNodeTarget> {
  const selector = parseSelector(token);
  if (selector.form !== "label" && !kinds.includes(selector.kind)) {
    throw new CliError("usage", `This command accepts ${kinds.join("/")} targets, not ${selector.kind}`);
  }
  const { nodes, owners } = await readNodeUniverse(session, workspaceId, perspective);

  if (selector.form === "label") {
    const matches = Object.values(nodes).filter(
      (node) =>
        kindOfNode(node, kinds) !== undefined &&
        nodeLabel(node).normalize("NFC") === selector.label &&
        inScope(node, owners, scope),
    );
    if (matches.length === 0) {
      throw new CliError("target-not-found", `No ${kinds.join("/")} target is named exactly “${selector.label}”.`);
    }
    if (matches.length > 1) {
      throw ambiguousTarget(
        matches.map((node) => candidate(workspaceId, kindOfNode(node, kinds)!, node, nodes, owners)),
      );
    }
    const node = matches.at(0);
    if (node === undefined) {
      throw new CliError("internal", "Matched node disappeared during target resolution.");
    }
    const kind = kindOfNode(node, kinds)!;
    return {
      nodeId: node.nodeId,
      label: nodeLabel(node),
      kind,
      descriptor: descriptor(workspaceId, kind, node.nodeId, nodeLabel(node)),
    };
  }

  if (selector.form === "link" && selector.workspaceId !== workspaceId) {
    throw new CliError(
      "target-not-found",
      `Target ${token} belongs to workspace ${selector.workspaceId}, not the selected workspace.`,
    );
  }
  const node = nodes[selector.identity];
  if (node === undefined) {
    throw new CliError("target-not-found", `No ${kinds.join("/")} target matches ${token}.`);
  }
  return {
    nodeId: selector.identity,
    label: nodeLabel(node),
    kind: selector.kind,
    descriptor: descriptor(workspaceId, selector.kind, selector.identity, nodeLabel(node)),
  };
}

function inScope(
  node: ProjectedNode,
  owners: Readonly<Record<string, string | null>>,
  scope: Readonly<{ underParentIds?: readonly string[] }>,
): boolean {
  if (scope.underParentIds === undefined) {
    return true;
  }
  let cursor: string | null | undefined = owners[node.nodeId];
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined && !seen.has(cursor)) {
    if (scope.underParentIds.includes(cursor)) {
      return true;
    }
    seen.add(cursor);
    cursor = owners[cursor];
  }
  return false;
}

function candidate(
  workspaceId: string,
  kind: TargetKind,
  node: ProjectedNode,
  nodes: Readonly<Record<string, ProjectedNode>>,
  owners: Readonly<Record<string, string | null>>,
): TargetCandidate {
  const parent = owners[node.nodeId] ?? null;
  const parentNode = parent === null ? undefined : nodes[parent];
  const parents = parentNode === undefined ? [] : [nodeLabel(parentNode)];
  return {
    ref: `${kind}:${node.nodeId}`,
    link: descriptor(workspaceId, kind, node.nodeId, nodeLabel(node)).link,
    label: nodeLabel(node),
    parents,
  };
}

function ambiguousTarget(candidates: readonly TargetCandidate[]): CliError {
  const listing = candidates
    .map(
      (entry) =>
        `  ${entry.ref} (${entry.label}${entry.parents.length > 0 ? ` under ${entry.parents.join(" / ")}` : ""})`,
    )
    .join("\n");
  return new CliError("ambiguous-target", `Target matches ${candidates.length} candidates:\n${listing}`, {
    candidates,
  });
}

export async function readNodeUniverse(
  session: DesktopSession,
  workspaceId: string,
  perspective: ProjectionPerspective,
): Promise<
  Readonly<{ nodes: Readonly<Record<string, ProjectedNode>>; owners: Readonly<Record<string, string | null>> }>
> {
  const [nodes, owners] = await Promise.all([
    session.readProjection(workspaceId, perspective, "nodes"),
    session.readProjection(workspaceId, perspective, "nodeOwners"),
  ]);
  return { nodes: nodes, owners: owners };
}

type ResolvedOccurrenceTarget = Readonly<{
  occurrenceId: string;
  nodeId: string;
  parentNodeId: string;
  nodeLabel: string;
  descriptor: ResourceDescriptor;
}>;

/**
 * Resolves one Occurrence target. `occurrence:` refs address the placement
 * directly; bare labels match by owning node label, so a node with several
 * placements is ambiguous until `--from` (parent) narrows it.
 */
export async function resolveOccurrenceTarget(
  session: DesktopSession,
  workspaceId: string,
  perspective: ProjectionPerspective,
  token: string,
  options: Readonly<{ nodeKinds: readonly TargetKind[]; fromParentIds?: readonly string[] }> = { nodeKinds: ["node"] },
): Promise<ResolvedOccurrenceTarget> {
  const { nodes, owners } = await readNodeUniverse(session, workspaceId, perspective);
  const occurrences = await session.readProjection(workspaceId, perspective, "occurrences");
  const selector = parseSelector(token);
  const inFrom = (occurrence: ProjectedOccurrence): boolean =>
    options.fromParentIds === undefined || options.fromParentIds.includes(occurrence.parentNodeId);
  const toTarget = (occurrence: ProjectedOccurrence): ResolvedOccurrenceTarget => {
    const node = nodes[occurrence.nodeId];
    const label = node === undefined ? occurrence.nodeId : nodeLabel(node);
    return {
      occurrenceId: occurrence.occurrenceId,
      nodeId: occurrence.nodeId,
      parentNodeId: occurrence.parentNodeId,
      nodeLabel: label,
      descriptor: descriptor(workspaceId, "occurrence", occurrence.occurrenceId, label),
    };
  };
  const occurrenceCandidates = (occurrences: readonly ProjectedOccurrence[]): CliError =>
    ambiguousTarget(
      occurrences.map((occurrence) => {
        const parent = nodes[occurrence.parentNodeId];
        return {
          ref: `occurrence:${occurrence.occurrenceId}`,
          link: descriptor(workspaceId, "occurrence", occurrence.occurrenceId, occurrence.nodeId).link,
          label: toTarget(occurrence).nodeLabel,
          parents: [parent === undefined ? occurrence.parentNodeId : nodeLabel(parent)],
        };
      }),
    );

  if (selector.form === "label") {
    const matching = Object.values(occurrences).filter((occurrence) => {
      const node = nodes[occurrence.nodeId];
      return (
        node !== undefined &&
        kindOfNode(node, options.nodeKinds) !== undefined &&
        nodeLabel(node).normalize("NFC") === selector.label &&
        inFrom(occurrence)
      );
    });
    if (matching.length === 0) {
      throw new CliError("target-not-found", `No occurrence of a node named exactly “${selector.label}”.`);
    }
    if (matching.length > 1) {
      throw occurrenceCandidates(matching);
    }
    const unique = matching.at(0);
    if (unique === undefined) {
      throw new CliError("target-not-found", `No occurrence of a node named exactly “${selector.label}”.`);
    }
    return toTarget(unique);
  }
  if (selector.form === "link" && selector.workspaceId !== workspaceId) {
    throw new CliError(
      "target-not-found",
      `Target ${token} belongs to workspace ${selector.workspaceId}, not the selected workspace.`,
    );
  }
  if (selector.kind === "occurrence" || selector.kind === "reference") {
    const occurrence = occurrences[selector.identity];
    if (occurrence === undefined || !inFrom(occurrence)) {
      throw new CliError("target-not-found", `No occurrence matches ${token}.`);
    }
    if (selector.kind === "reference" && occurrence.parentNodeId === (owners[occurrence.nodeId] ?? null)) {
      throw new CliError("invalid-value", `${token} is the Original placement, not a Reference.`);
    }
    return toTarget(occurrence);
  }
  if (selector.kind === "node") {
    const placements = Object.values(occurrences).filter((occurrence) => occurrence.nodeId === selector.identity);
    const scoped = placements.filter(inFrom);
    if (scoped.length === 0) {
      throw new CliError("target-not-found", `Node ${token} has no matching placement.`);
    }
    if (scoped.length > 1) {
      throw occurrenceCandidates(scoped);
    }
    const unique = scoped.at(0);
    if (unique === undefined) {
      throw new CliError("target-not-found", `Node ${token} has no matching placement.`);
    }
    return toTarget(unique);
  }
  throw new CliError("usage", `This command accepts occurrence targets, not ${selector.kind}.`);
}

/**
 * Compiles `--before`/`--after` anchor occurrences (children of one parent)
 * into a SequenceAnchor; omitted anchors append at the end.
 */
export async function anchorFor(
  session: DesktopSession,
  workspaceId: string,
  perspective: ProjectionPerspective,
  parentNodeId: string,
  before: string | undefined,
  after: string | undefined,
): Promise<SequenceAnchor> {
  if (before === undefined && after === undefined) {
    return END_SEQUENCE_ANCHOR;
  }
  const token = before ?? after;
  const anchor = await resolveOccurrenceTarget(session, workspaceId, perspective, token ?? "", {
    nodeKinds: ["node", "supertag", "field", "search"],
  });
  if (anchor.parentNodeId !== parentNodeId) {
    throw new CliError("invalid-value", `Anchor ${token} is not a child of the target parent.`);
  }
  return before !== undefined
    ? { after: null, before: anchor.occurrenceId, affinity: "before", fallback: "start" }
    : { after: anchor.occurrenceId, before: null, affinity: "after", fallback: "end" };
}

export function labelOf(nodes: Readonly<Record<string, ProjectedNode>>, nodeId: string): string {
  const node = nodes[nodeId];
  return node === undefined ? nodeId : nodeLabel(node);
}

export function ownerLabel(nodes: Readonly<Record<string, ProjectedNode>>, ownerNodeId: string): string {
  const owner = nodes[ownerNodeId];
  return owner === undefined ? ownerNodeId : `${nodeLabel(owner)} (node:${ownerNodeId})`;
}

export function ownerChainIncludes(
  owners: Readonly<Record<string, string | null>>,
  start: string,
  ancestor: string | undefined,
): boolean {
  if (ancestor === undefined) {
    return false;
  }
  let cursor: string | null | undefined = start;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined && !seen.has(cursor)) {
    if (cursor === ancestor) {
      return true;
    }
    seen.add(cursor);
    cursor = owners[cursor];
  }
  return false;
}
