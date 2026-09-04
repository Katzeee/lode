import {
  contentLength,
  mergeContent,
  sliceContent,
  type OutlineContent,
} from "../components/outline/outline-content.js";
import type { OutlineClipboardItem, OutlinePaste } from "../components/outline/outline-tree-edit-contract.js";
import type { OutlineEditPosition } from "../components/outline/outline-tree-view-model.js";
import {
  findOriginalOccurrenceKey,
  insertGraphNode,
  removeGraphOccurrence,
  resolveGraphPath,
  siblingLocation,
  updateGraphContent,
} from "./outline-demo-graph.js";
import { demoInlineToken, demoNodeLabel } from "./outline-demo-inline.js";
import { outlineDemoItemKey } from "./outline-demo-presenter.js";
import type { DemoGraph, DemoNode, DemoOccurrence } from "./outline-demo-model.js";

export function copyDemoItems(
  graph: DemoGraph,
  paths: readonly string[],
  scope: string,
): readonly OutlineClipboardItem[] {
  const visit = (path: string, ancestors: ReadonlySet<string>): OutlineClipboardItem[] => {
    const resolved = resolveGraphPath(graph, path);
    if (resolved === null || ancestors.has(resolved.node.id)) {
      return [];
    }
    const node = resolved.node;
    return [
      {
        content: node.value.content,
        data: { scope, nodeId: node.id },
        children: node.childOccurrenceIds.flatMap((id) => visit(`${path}/${id}`, new Set(ancestors).add(node.id))),
      },
    ];
  };
  return paths.flatMap((path) => visit(path, new Set()));
}

export function pasteDemoItems(
  graph: DemoGraph,
  path: string | null,
  paste: OutlinePaste,
  scope: string,
  create: (content: OutlineContent) => Readonly<{ node: DemoNode; occurrence: DemoOccurrence }>,
  rootParent: string | null = null,
): Readonly<{ graph: DemoGraph; position: OutlineEditPosition }> | null {
  const target = path === null ? null : resolveGraphPath(graph, path);
  const location = path === null ? { parentKey: rootParent, index: -1 } : siblingLocation(graph, path);
  if ((path !== null && target === null) || location === null || target?.node.value.editable === false) {
    return null;
  }
  const copiedNode = (item: OutlineClipboardItem): DemoNode | undefined => {
    const data = item.data;
    return typeof data === "object" &&
      data !== null &&
      "scope" in data &&
      data.scope === scope &&
      "nodeId" in data &&
      typeof data.nodeId === "string"
      ? graph.nodes[data.nodeId]
      : undefined;
  };
  const only = paste.items.length === 1 ? paste.items[0] : undefined;
  const referenced = only === undefined ? undefined : copiedNode(only);
  if (referenced !== undefined && target !== null && path !== null && contentLength(target.node.value.content) > 0) {
    const token = demoInlineToken("reference", referenced.id, demoNodeLabel(referenced.value.content));
    const content = mergeContent(
      sliceContent(target.node.value.content, 0, paste.selection.from),
      [token],
      sliceContent(target.node.value.content, paste.selection.to, contentLength(target.node.value.content)),
    );
    return {
      graph: updateGraphContent(graph, path, content),
      position: { key: outlineDemoItemKey(path), caret: paste.selection.from + token.source.length },
    };
  }
  const parentPath = paste.placement === "child" && !paste.replaceEmpty ? path : location.parentKey;
  const firstIndex =
    paste.placement === "child" && !paste.replaceEmpty ? 0 : location.index + (paste.replaceEmpty ? 0 : 1);
  const ancestorIds = new Set<string>();
  const segments = parentPath?.split("/") ?? [];
  for (let index = 1; index <= segments.length; index += 1) {
    const ancestor = resolveGraphPath(graph, segments.slice(0, index).join("/"));
    if (ancestor !== null) {
      ancestorIds.add(ancestor.node.id);
    }
  }
  let next = graph;
  let position: OutlineEditPosition | null = null;
  let inserted = 0;
  const materialize = (item: OutlineClipboardItem, parent: string | null, index: number): string => {
    const created = create(item.content);
    next = insertGraphNode(next, parent, index, created.node, created.occurrence);
    const createdPath = parent === null ? created.occurrence.id : `${parent}/${created.occurrence.id}`;
    item.children.forEach((child, childIndex) => materialize(child, createdPath, childIndex));
    return createdPath;
  };
  for (const item of paste.items) {
    const node = copiedNode(item);
    if (node !== undefined && ancestorIds.has(node.id)) {
      continue;
    }
    if (paste.replaceEmpty && next === graph && path !== null) {
      next = removeGraphOccurrence(next, path);
    }
    let pastedPath: string;
    if (node === undefined) {
      pastedPath = materialize(item, parentPath, firstIndex + inserted);
      inserted += 1;
    } else {
      const siblings =
        parentPath === null
          ? next.rootOccurrenceIds
          : (resolveGraphPath(next, parentPath)?.node.childOccurrenceIds ?? []);
      const existing = siblings.find((id) => next.occurrences[id]?.nodeId === node.id);
      if (existing !== undefined) {
        pastedPath = parentPath === null ? existing : `${parentPath}/${existing}`;
      } else {
        const created = create(node.value.content);
        const occurrence: DemoOccurrence = {
          id: created.occurrence.id,
          nodeId: node.id,
          appearance: findOriginalOccurrenceKey(next, node.id) === null ? "original" : "reference",
        };
        next = insertGraphNode(next, parentPath, firstIndex + inserted, node, occurrence);
        pastedPath = parentPath === null ? occurrence.id : `${parentPath}/${occurrence.id}`;
        inserted += 1;
      }
    }
    position = { key: outlineDemoItemKey(pastedPath), caret: contentLength(node?.value.content ?? item.content) };
  }
  return position === null ? null : { graph: next, position };
}
