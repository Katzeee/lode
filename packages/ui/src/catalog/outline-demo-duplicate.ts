import { contentLength, type OutlineContent } from "../components/outline/outline-content.js";
import { insertGraphNode, resolveGraphPath, siblingLocation } from "./outline-demo-graph.js";
import { outlineDemoItemKey } from "./outline-demo-presenter.js";
import type { OutlineEditPosition } from "../components/outline/outline-tree-view-model.js";
import type { DemoGraph, DemoNode, DemoOccurrence } from "./outline-demo-model.js";

export function duplicateDemoItems(
  graph: DemoGraph,
  paths: readonly string[],
  create: (content: OutlineContent) => Readonly<{ node: DemoNode; occurrence: DemoOccurrence }>,
) {
  let next = graph;
  let position: OutlineEditPosition | null = null;
  const clone = (path: string, parent: string | null, index: number, ancestors: ReadonlySet<string>): string | null => {
    const source = resolveGraphPath(graph, path);
    if (source === null || ancestors.has(source.node.id)) {
      return null;
    }
    const created = create(source.node.value.content);
    next = insertGraphNode(
      next,
      parent,
      index,
      { ...created.node, value: source.node.value },
      { ...created.occurrence, expandable: source.occurrence.expandable },
    );
    const copiedPath = parent === null ? created.occurrence.id : `${parent}/${created.occurrence.id}`;
    source.node.childOccurrenceIds.forEach((id, childIndex) =>
      clone(`${path}/${id}`, copiedPath, childIndex, new Set(ancestors).add(source.node.id)),
    );
    return copiedPath;
  };
  for (const path of paths) {
    const location = siblingLocation(next, path);
    if (location === null) {
      continue;
    }
    const copied = clone(path, location.parentKey, location.index + 1, new Set());
    if (copied !== null) {
      position = {
        key: outlineDemoItemKey(copied),
        caret: contentLength(resolveGraphPath(next, copied)?.node.value.content ?? []),
      };
    }
  }
  return position === null ? null : { graph: next, position };
}
