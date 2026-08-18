import type { BacklinksResult, EditMutation, ProjectedNode } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { anchorFor, descriptor, labelOf, readNodeUniverse, resolveNodeTarget } from "../target/index.js";
import { executeWrite, identity, writeResult, workspaceIdOf } from "../intent/index.js";
import { registerReferenceInlineCommands } from "./reference-inline.js";

/**
 * Reference family: block references are Occurrences, inline references are
 * identity-bearing content items. `--at` is a display offset over grapheme
 * clusters and existing inline references, compiled to a stable content
 * anchor before any write.
 */

export function registerReferenceCommands(catalog: CommandCatalog): void {
  catalog.register(referenceAdd);
  catalog.register(referenceAddInline);
  registerReferenceInlineCommands(catalog);
  catalog.register(referenceOriginal);
  catalog.register(referenceBacklinks);
}

const UNDER = { name: "--under", description: "Parent node target", value: { kind: "string" as const } };
const ON = { name: "--on", description: "Host node for the inline reference", value: { kind: "string" as const } };
const BEFORE = { name: "--before", description: "Place before this occurrence", value: { kind: "string" as const } };
const AFTER = { name: "--after", description: "Place after this occurrence", value: { kind: "string" as const } };

const referenceAdd: CommandDefinition = {
  path: ["reference", "add"],
  summary: "Place an existing node as a block reference under a parent.",
  positionals: [["node", "Referenced node target"]],
  options: [{ ...UNDER, required: true }, { ...BEFORE, conflicts: ["--after"] }, { ...AFTER }],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
      "supertag",
      "field",
      "search",
    ]);
    const parent = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--under"),
      ["node"],
    );
    const anchor = await anchorFor(
      context.session,
      workspaceId,
      context.perspective,
      parent.nodeId,
      args.option("--before"),
      args.option("--after"),
    );
    const occurrenceId = identity(context.requestId, "reference-occurrence");
    const mutations: readonly EditMutation[] = [
      {
        kind: "occurrence-create",
        occurrenceId,
        nodeId: target.nodeId,
        parentNodeId: parent.nodeId,
        anchor,
      },
    ];
    const { result, data } = await executeWrite(context, "reference.add", mutations);
    const occurrence = descriptor(workspaceId, "occurrence", occurrenceId, target.label);
    return writeResult(data, result, {
      extra: {
        target: target.descriptor,
        to: parent.descriptor,
        occurrence,
      },
      view: writeView("Referenced", target.descriptor, `under ${parent.label} (${occurrence.ref})`),
    });
  },
};

const referenceAddInline: CommandDefinition = {
  path: ["reference", "add-inline"],
  summary: "Insert an inline reference into a host node's content.",
  positionals: [["node", "Referenced node target"]],
  options: [
    { ...ON, required: true },
    {
      name: "--at",
      description: "Display position: start, end, or a zero-based offset over grapheme clusters and inline references",
      value: { kind: "string" as const },
    },
    { name: "--alias", description: "Host-owned alias text", value: { kind: "string" as const } },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
      "supertag",
      "field",
      "search",
    ]);
    const host = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--on"),
      ["node"],
    );
    const { nodes } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    const hostNode = nodes[host.nodeId];
    if (hostNode === undefined) {
      throw new CliError("target-not-found", `Node ${host.nodeId} is not in this projection.`);
    }
    const inlineReferenceId = identity(context.requestId, "inline-reference");
    const mutations: EditMutation[] = [
      {
        kind: "inline-reference-create",
        inlineReferenceId,
        hostNodeId: host.nodeId,
        targetNodeId: target.nodeId,
        anchor: contentAnchor(hostNode, args.option("--at")),
      },
    ];
    const alias = args.option("--alias");
    if (alias !== undefined) {
      mutations.push({
        kind: "inline-reference-alias-create",
        inlineReferenceId,
        hostNodeId: host.nodeId,
        aliasNodeId: `${inlineReferenceId}-alias`,
        seed: { text: [{ value: alias, attributes: {} }] },
      });
    }
    const { result, data } = await executeWrite(context, "reference.add-inline", mutations);
    const reference = descriptor(workspaceId, "reference", inlineReferenceId, target.label);
    return writeResult(data, result, {
      extra: { target: target.descriptor, on: host.descriptor, reference },
      view: writeView("Referenced inline", target.descriptor, `in ${host.label} (${reference.ref})`),
    });
  },
};

const referenceOriginal: CommandDefinition = {
  path: ["reference", "original"],
  summary: "Show where a node's Original placement lives.",
  positionals: [["node", "Node target"]],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
      "supertag",
      "field",
      "search",
    ]);
    const { nodes, owners } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    const owner = owners[target.nodeId] ?? null;
    const occurrences = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "occurrences",
    )) as Record<string, { occurrenceId: string; nodeId: string; parentNodeId: string }>;
    const original = Object.values(occurrences).find(
      (occurrence) => occurrence.nodeId === target.nodeId && occurrence.parentNodeId === owner,
    );
    if (owner === null || original === undefined) {
      throw new CliError("unsupported", `Node ${target.descriptor.ref} has no Original placement in this projection.`);
    }
    const parentResource = descriptor(workspaceId, "node", owner, labelOf(nodes, owner));
    return okOutcome(
      {
        target: target.descriptor,
        owner: parentResource,
        occurrence: descriptor(workspaceId, "occurrence", original.occurrenceId, target.label),
      },
      {
        view: {
          kind: "text",
          lines: [
            `Original of ${target.label} lives under ${parentResource.label}`,
            `Occurrence: occurrence:${original.occurrenceId}`,
            `Owner: ${parentResource.ref}`,
          ],
        },
      },
    );
  },
};

const referenceBacklinks: CommandDefinition = {
  path: ["reference", "backlinks"],
  summary: "List block and inline references pointing at a node.",
  positionals: [["node", "Referenced node target"]],
  options: [],
  kind: "read",
  paginated: true,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, args.positional("node"), [
      "node",
      "supertag",
      "field",
      "search",
    ]);
    const result = await context.session.application.query({
      kind: "backlinks",
      workspaceId,
      perspective: context.perspective,
      targetNodeId: target.nodeId,
      limit: context.limit,
      after: context.cursor,
    });
    if (result.status !== "ok") {
      throw new CliError("unavailable", `Backlinks are unavailable: ${result.error.message}`);
    }
    const backlinks = result.value as unknown as BacklinksResult;
    const { nodes } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    return okOutcome(
      {
        target: target.descriptor,
        items: backlinks.backlinks.map((backlink) => ({
          sourceKind: backlink.sourceKind,
          sourceIdentity: backlink.sourceIdentity,
          hostNodeId: backlink.hostNodeId,
          hostLabel: labelOf(nodes, backlink.hostNodeId),
          targetStatus: backlink.targetStatus,
        })),
      },
      {
        view: {
          kind: "table",
          columns: ["source", "ref", "host"],
          rows: backlinks.backlinks.map((backlink) => [
            backlink.sourceKind,
            backlink.sourceKind === "inline"
              ? `reference:${backlink.sourceIdentity}`
              : `occurrence:${backlink.sourceIdentity}`,
            labelOf(nodes, backlink.hostNodeId),
          ]),
        },
        page: { count: backlinks.backlinks.length, next: backlinks.next },
      },
    );
  },
};

/**
 * `--at` positions count Unicode grapheme clusters in text atoms and each
 * existing inline reference as one position. The offset compiles to a stable
 * content anchor; out-of-range offsets fail before any write.
 */
type ContentItem = ProjectedNode["content"][number];

function contentAnchor(
  host: Readonly<{ content: readonly ContentItem[] }>,
  at: string | undefined,
): Readonly<{ after: string | null; before: string | null; affinity: "after" | "before"; fallback: "start" | "end" }> {
  if (at === undefined || at === "end") {
    return { after: null, before: null, affinity: "after", fallback: "end" };
  }
  if (at === "start") {
    return { after: null, before: null, affinity: "after", fallback: "start" };
  }
  const offset = Number.parseInt(at, 10);
  if (!Number.isSafeInteger(offset) || offset < 0 || String(offset) !== at) {
    throw new CliError("invalid-value", `--at must be start, end, or a non-negative integer, not “${at}”.`);
  }
  let position = 0;
  let previousItemId: string | null = null;
  for (const item of host.content) {
    const length = item.kind === "text" ? graphemeCount(item.value) : 1;
    if (position + length > offset) {
      if (item.kind === "text") {
        return previousItemId === null
          ? { after: null, before: null, affinity: "after", fallback: "start" }
          : { after: previousItemId, before: null, affinity: "after", fallback: "start" };
      }
      return previousItemId === null
        ? { after: null, before: item.id, affinity: "before", fallback: "start" }
        : { after: previousItemId, before: null, affinity: "after", fallback: "start" };
    }
    position += length;
    previousItemId = item.id;
  }
  if (offset > position) {
    throw new CliError("invalid-value", `--at ${offset} is beyond the end of the content (${position} positions).`);
  }
  return { after: null, before: null, affinity: "after", fallback: "end" };
}

function graphemeCount(value: string): number {
  return [...value].length;
}
