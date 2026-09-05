import { diffArrays } from "diff";
import { END_SEQUENCE_ANCHOR, type EditAction, type NodeContentItem, type ProjectedNode } from "@lode/sdk";
import type { OutlineContent } from "@lode/ui";
import { nodeSource, resolveSource, sourceEntries, type SourceEntry } from "./node-source.js";
import type { WorkspaceSnapshot } from "./workspace-model.js";

export function editNodeSource(
  node: ProjectedNode,
  content: OutlineContent,
  graph: WorkspaceSnapshot,
  baseline?: OutlineContent,
): readonly EditAction[] {
  const { entries, supertagIds } = sourceEntries(resolveSource(content, node, graph, baseline));
  const old = node.content.map((item): SourceEntry =>
    item.kind === "text"
      ? item
      : {
          kind: "reference",
          data: {
            kind: "reference",
            referenceId: item.id,
            targetNodeId: item.targetNodeId,
            aliasNodeId: item.aliasNodeId,
          },
        },
  );
  const expanded = old.flatMap((entry): SourceEntry[] =>
    entry.kind === "text" ? Array.from(entry.value).map((value) => ({ ...entry, value })) : [entry],
  );
  const tags = new Set((graph.supertagApplications[node.nodeId] ?? []).map((tag) => tag.supertagId));
  if (
    expanded.length === entries.length &&
    expanded.every((entry, index) => sameEntry(entry, entries[index]!)) &&
    tags.size === supertagIds.size &&
    [...tags].every((id) => supertagIds.has(id))
  ) {
    return [];
  }
  const changes = diffArrays(old, [...entries], {
    comparator: (a, b) =>
      a.kind === "text" && b.kind === "text"
        ? a.value === b.value
        : a.kind === "reference" &&
          b.kind === "reference" &&
          a.data.referenceId !== undefined &&
          a.data.referenceId === b.data.referenceId,
  });
  const aligned: { entry: SourceEntry; existing?: NodeContentItem }[] = [];
  let offset = 0;
  const removed: NodeContentItem[] = [];
  const deletions: EditAction[] = [];
  for (const change of changes) {
    if (change.removed) {
      const items = node.content.slice(offset, offset + change.value.length);
      const atomIds = items.filter((item) => item.kind === "text").map((item) => item.id);
      if (atomIds.length) {
        deletions.push({
          kind: "rich-text-splice",
          nodeId: node.nodeId,
          deleteAtomIds: atomIds,
          insert: "",
          anchor: {
            ...END_SEQUENCE_ANCHOR,
            after: node.content[offset - 1]?.id ?? null,
            before: node.content[offset + change.value.length]?.id ?? null,
            fallback: offset === 0 ? "start" : "end",
          },
        });
      }
      removed.push(...items);
      offset += change.value.length;
    } else if (change.added) {
      change.value.forEach((entry) => aligned.push({ entry }));
    } else {
      change.value.forEach((entry) => {
        aligned.push({ entry, existing: node.content[offset] });
        offset += 1;
      });
    }
  }
  const actions: EditAction[] = [...deletions];
  for (const item of removed) {
    if (item.kind === "inline-reference") {
      actions.push({ kind: "inline-reference-remove", inlineReferenceId: item.id });
    }
  }
  for (let index = 0; index < aligned.length; index += 1) {
    const current = aligned[index]!;
    if (current.existing) {
      if (current.existing.kind === "text" && current.entry.kind === "text") {
        for (const key of ["bold", "italic", "code"]) {
          if ((current.existing.attributes[key] === true) !== (current.entry.attributes[key] === true)) {
            actions.push({
              kind: "rich-text-mark",
              nodeId: node.nodeId,
              atomIds: [current.existing.id],
              key,
              value: current.entry.attributes[key] === true ? { kind: "set", value: true } : { kind: "unset" },
            });
          }
        }
      }
      continue;
    }
    const right = aligned.slice(index + 1).find((item) => item.existing)?.existing;
    const anchor = { ...END_SEQUENCE_ANCHOR, before: right ? right.id : null, affinity: "before" as const };
    if (current.entry.kind === "reference") {
      const referenceId = crypto.randomUUID();
      actions.push({
        kind: "inline-reference-create",
        inlineReferenceId: referenceId,
        hostNodeId: node.nodeId,
        targetNodeId: current.entry.data.targetNodeId,
        anchor,
      });
      if (current.entry.data.aliasNodeId) {
        const alias = graph.nodes[current.entry.data.aliasNodeId];
        if (alias) {
          const aliasNodeId = crypto.randomUUID();
          actions.push({
            kind: "inline-reference-alias-create",
            inlineReferenceId: referenceId,
            hostNodeId: node.nodeId,
            aliasNodeId,
          });
          actions.push(
            ...editNodeSource(
              { nodeId: aliasNodeId, content: [], intrinsicNodeType: null },
              nodeSource(alias, graph),
              graph,
            ),
          );
        }
      }
    } else {
      let insert = current.entry.value;
      const attributes = current.entry.attributes;
      while (aligned[index + 1]?.existing === undefined && aligned[index + 1]?.entry.kind === "text") {
        const next = aligned[index + 1]!.entry;
        if (next.kind !== "text" || JSON.stringify(next.attributes) !== JSON.stringify(attributes)) {
          break;
        }
        insert += next.value;
        index += 1;
      }
      actions.push({ kind: "rich-text-splice", nodeId: node.nodeId, deleteAtomIds: [], anchor, insert, attributes });
    }
  }
  const existingTags = new Set((graph.supertagApplications[node.nodeId] ?? []).map((tag) => tag.supertagId));
  for (const id of supertagIds) {
    if (!existingTags.has(id)) {
      actions.push({
        kind: "supertag-application-create",
        hostNodeId: node.nodeId,
        supertagId: id,
        anchor: END_SEQUENCE_ANCHOR,
      });
    }
  }
  for (const id of existingTags) {
    if (!supertagIds.has(id)) {
      actions.push({ kind: "supertag-remove", hostNodeId: node.nodeId, supertagId: id });
    }
  }
  return actions;
}

function sameEntry(a: SourceEntry, b: SourceEntry): boolean {
  if (a.kind === "text" && b.kind === "text") {
    return (
      a.value === b.value &&
      ["bold", "italic", "code"].every((key) => (a.attributes[key] === true) === (b.attributes[key] === true))
    );
  }
  return (
    a.kind === "reference" &&
    b.kind === "reference" &&
    a.data.referenceId === b.data.referenceId &&
    a.data.targetNodeId === b.data.targetNodeId &&
    (a.data.aliasNodeId ?? null) === (b.data.aliasNodeId ?? null)
  );
}
