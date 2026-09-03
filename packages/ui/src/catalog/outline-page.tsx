import { useMemo, useRef, useState } from "react";

import { Breadcrumbs, type BreadcrumbItem } from "../components/breadcrumbs.js";
import { contentToPlainText, mergeContent } from "../components/outline-content.js";
import {
  OutlineTree,
  type OutlineContent,
  type OutlineMove,
  type OutlineRow,
  type OutlineRowLayout,
} from "../components/outline-tree.js";
import { flattenOutline } from "../components/outline-tree-model.js";
import {
  absoluteKey,
  findOriginalOccurrenceKey,
  insertGraphNode,
  projectOutline,
  replaceGraphOccurrenceNode,
  removeGraphOccurrence,
  retargetGraphOccurrence,
  resolveGraphPath,
  updateGraphNode,
  updateGraphOccurrence,
} from "./outline-demo-graph.js";
import { completionIds, createDemoCompletionProviders } from "./outline-demo-completions.js";
import {
  initialGraph,
  textContent,
  type DemoGraph,
  type DemoNode,
  type DemoOccurrence,
  type FieldDatatype,
  type NodeValue,
} from "./outline-demo-model.js";
import { DemoBullet, DemoRow } from "./outline-demo-row.js";
import { PageIntro, Specimen } from "./specimen.js";

type RowProjection = Readonly<{
  fieldDatatype?: FieldDatatype;
  fieldValue: boolean;
  layout: OutlineRowLayout;
}>;

function fieldDatatype(graph: DemoGraph, value: NodeValue): FieldDatatype | undefined {
  if (value.field?.kind === "definition") {
    return value.field.datatype;
  }
  const definition = value.field?.kind === "field" ? graph.nodes[value.field.definitionId] : undefined;
  return definition?.value.field?.kind === "definition" ? definition.value.field.datatype : undefined;
}

function projectRows(graph: DemoGraph, rows: readonly OutlineRow<NodeValue>[]): ReadonlyMap<string, RowProjection> {
  const projections = new Map<string, RowProjection>();
  const valueRootDepths = new Map<string, number>();
  const rowsByKey = new Map(rows.map((row) => [row.key, row]));
  for (const row of rows) {
    if (row.occurrence.value.field?.kind === "field") {
      projections.set(row.key, {
        fieldDatatype: fieldDatatype(graph, row.occurrence.value),
        fieldValue: false,
        layout: { column: "leading" },
      });
      continue;
    }
    const parent = row.parentKey === null ? undefined : rowsByKey.get(row.parentKey);
    if (parent?.occurrence.value.field?.kind === "field") {
      projections.set(row.key, {
        fieldValue: true,
        layout: { column: "trailing", indentDepth: 0, pairWithPrevious: row.indexInParent === 0 },
      });
      valueRootDepths.set(row.key, row.depth);
      continue;
    }
    const valueRootDepth = row.parentKey === null ? undefined : valueRootDepths.get(row.parentKey);
    if (valueRootDepth !== undefined) {
      projections.set(row.key, {
        fieldValue: false,
        layout: { column: "trailing", indentDepth: row.depth - valueRootDepth },
      });
      valueRootDepths.set(row.key, valueRootDepth);
      continue;
    }
    projections.set(row.key, {
      fieldDatatype: fieldDatatype(graph, row.occurrence.value),
      fieldValue: false,
      layout: {},
    });
  }
  return projections;
}

function siblingLocation(graph: DemoGraph, key: string): Readonly<{ index: number; parentKey: string | null }> | null {
  const segments = key.split("/");
  const occurrenceId = segments.pop();
  const parentKey = segments.length === 0 ? null : segments.join("/");
  const ids =
    parentKey === null ? graph.rootOccurrenceIds : resolveGraphPath(graph, parentKey)?.node.childOccurrenceIds;
  const index = occurrenceId === undefined ? -1 : (ids?.indexOf(occurrenceId) ?? -1);
  return index < 0 ? null : { index, parentKey };
}

function insertExistingOccurrence(
  graph: DemoGraph,
  parentKey: string | null,
  index: number,
  occurrence: DemoOccurrence,
): DemoGraph {
  const node = graph.nodes[occurrence.nodeId];
  return node === undefined ? graph : insertGraphNode(graph, parentKey, index, node, occurrence);
}

export function OutlinePage() {
  const [graph, setGraph] = useState(initialGraph);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () =>
      new Set([
        "projects",
        "projects/lode",
        "projects/lode/roadmap",
        "projects/lode/roadmap/local-first-reference",
        "field-definitions",
        "inbox",
      ]),
  );
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const nextNodeId = useRef(0);
  const projectedOccurrences = useMemo(() => projectOutline(graph, zoomKey), [graph, zoomKey]);
  const visibleRows = useMemo(
    () => flattenOutline(projectedOccurrences, expandedKeys),
    [expandedKeys, projectedOccurrences],
  );
  const rowProjections = useMemo(() => projectRows(graph, visibleRows), [graph, visibleRows]);
  const completionProviders = useMemo(
    () =>
      createDemoCompletionProviders({
        fieldValueKeys: new Set(
          [...rowProjections].filter(([, projection]) => projection.fieldValue).map(([key]) => key),
        ),
        graph,
        rows: visibleRows,
      }),
    [graph, rowProjections, visibleRows],
  );

  const breadcrumbItems: readonly BreadcrumbItem[] = [
    { label: "All nodes", onSelect: () => setZoomKey(null) },
    ...(zoomKey ?? "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment, index, segments) => {
        const path = segments.slice(0, index + 1).join("/");
        return {
          label: contentToPlainText(resolveGraphPath(graph, path)?.node.value.content ?? textContent(segment)),
          onSelect: () => setZoomKey(path),
        };
      }),
  ];

  const createNode = (content: OutlineContent): Readonly<{ node: DemoNode; occurrence: DemoOccurrence }> => {
    nextNodeId.current += 1;
    const id = `created-${String(nextNodeId.current)}`;
    return {
      node: { childOccurrenceIds: [], id, value: { content } },
      occurrence: { id, nodeId: id },
    };
  };

  const applyMove = (move: OutlineMove) => {
    const sourceKeys = move.sourceKeys
      .map((sourceKey) => absoluteKey(zoomKey, sourceKey))
      .filter((sourceKey): sourceKey is string => sourceKey !== null);
    const targetParentKey = absoluteKey(zoomKey, move.targetParentKey);
    setGraph((previous) => {
      const occurrences = sourceKeys
        .map((sourceKey) => resolveGraphPath(previous, sourceKey)?.occurrence)
        .filter((occurrence): occurrence is DemoOccurrence => occurrence !== undefined);
      if (occurrences.length !== sourceKeys.length) {
        return previous;
      }
      const withoutSources = sourceKeys.reduce(removeGraphOccurrence, previous);
      return occurrences.reduce(
        (current, occurrence, offset) =>
          insertExistingOccurrence(current, targetParentKey, move.index + offset, occurrence),
        withoutSources,
      );
    });
  };

  const updateContent = (key: string, content: OutlineContent) => {
    const sourceKey = absoluteKey(zoomKey, key);
    const resolved = sourceKey === null ? null : resolveGraphPath(graph, sourceKey);
    if (sourceKey === null || resolved === null) {
      return;
    }
    if (JSON.stringify(resolved.node.value.content) === JSON.stringify(content)) {
      return;
    }
    if (rowProjections.get(key)?.fieldValue === true && resolved.occurrence.appearance === "reference") {
      const replacement = createNode(content);
      setGraph((previous) => replaceGraphOccurrenceNode(previous, resolved.occurrence.id, replacement.node));
      return;
    }
    setGraph((previous) =>
      updateGraphNode(previous, resolved.node.id, (node) => ({
        ...node,
        value: { ...node.value, content },
      })),
    );
  };

  return (
    <>
      <PageIntro
        description="Every visible item is a Node occurrence projected from one normalized graph. Original and Reference occurrences share one node identity and therefore always unfold the same owned children. The Outline renders those projections and emits edit intents; navigation and domain mutations remain host responsibilities."
        title="Outline"
      />
      <Specimen
        className="flex-col flex-nowrap items-stretch gap-4"
        description="Expand Lode to inspect Field Values projected into a shared column, then expand the Local-first Reference to see the same target-owned child graph as its Original. Datatypes provide suggestions and validation without restricting a value Node's content."
        title="Node outline"
      >
        {zoomKey === null ? null : (
          <header className="flex flex-col gap-0.5 border-b border-border pb-3">
            <Breadcrumbs items={breadcrumbItems} />
            <h3 className="text-title-small font-semibold tracking-tight">
              {contentToPlainText(resolveGraphPath(graph, zoomKey)?.node.value.content ?? [])}
            </h3>
          </header>
        )}
        <OutlineTree
          editing={{
            completionProviders,
            contentOf: (row) => row.occurrence.value.content,
            emptyPlaceholder: "Type / for commands, > for a field, or [[ to link a node…",
            isEditable: (row) =>
              rowProjections.get(row.key)?.fieldValue === true || row.occurrence.value.editable !== false,
            onCompletion: (key, providerId, itemId, content) => {
              const sourceKey = absoluteKey(zoomKey, key);
              const resolved = sourceKey === null ? null : resolveGraphPath(graph, sourceKey);
              if (sourceKey === null || resolved === null) {
                return;
              }
              if (providerId === completionIds.value && graph.nodes[itemId] !== undefined) {
                setGraph((previous) => retargetGraphOccurrence(previous, resolved.occurrence.id, itemId, "reference"));
                return;
              }
              if (providerId === completionIds.field) {
                const definition = graph.nodes[itemId]?.value.field;
                if (definition?.kind !== "definition") {
                  return;
                }
                const created = createNode([]);
                setGraph((previous) => {
                  const withField = updateGraphNode(previous, resolved.node.id, (node) => ({
                    ...node,
                    value: {
                      ...node.value,
                      content,
                      editable: false,
                      field: { definitionId: itemId, kind: "field" },
                    },
                  }));
                  const withBehavior = updateGraphOccurrence(withField, resolved.occurrence.id, (occurrence) => ({
                    ...occurrence,
                    expandable: false,
                  }));
                  return insertGraphNode(withBehavior, sourceKey, 0, created.node, created.occurrence);
                });
                return;
              }
              setGraph((previous) =>
                updateGraphNode(previous, resolved.node.id, (node) => ({
                  ...node,
                  value: {
                    ...node.value,
                    content,
                    ...(providerId === completionIds.command && itemId === "task" ? { todo: "open" as const } : {}),
                    ...(providerId === completionIds.command && itemId === "project"
                      ? { tags: [...new Set([...(node.value.tags ?? []), "#project"])] }
                      : {}),
                  },
                })),
              );
            },
            onContentChange: updateContent,
            onContentCommit: updateContent,
            onCreateAfter: (key) => {
              const sourceKey = absoluteKey(zoomKey, key);
              if (sourceKey === null) {
                return;
              }
              const created = createNode([]);
              setGraph((previous) => {
                const location = siblingLocation(previous, sourceKey);
                return location === null
                  ? previous
                  : insertGraphNode(previous, location.parentKey, location.index + 1, created.node, created.occurrence);
              });
            },
            onCreateChild: (key) => {
              const sourceKey = absoluteKey(zoomKey, key);
              const resolved = sourceKey === null ? null : resolveGraphPath(graph, sourceKey);
              if (resolved === null || resolved.node.childOccurrenceIds.length > 0) {
                return;
              }
              const created = createNode([]);
              setGraph((previous) => insertGraphNode(previous, sourceKey, 0, created.node, created.occurrence));
            },
            onDeleteEmpty: (key) => {
              const sourceKey = absoluteKey(zoomKey, key);
              if (sourceKey !== null) {
                setGraph((previous) => removeGraphOccurrence(previous, sourceKey));
              }
            },
            onMergeUp: (key) => {
              const sourceIndex = visibleRows.findIndex((row) => row.key === key);
              const previousRow = visibleRows[sourceIndex - 1];
              const sourceKey = absoluteKey(zoomKey, key);
              if (sourceKey === null || previousRow === undefined) {
                return;
              }
              setGraph((previous) => {
                const source = resolveGraphPath(previous, sourceKey);
                if (source === null) {
                  return previous;
                }
                const merged = updateGraphNode(previous, previousRow.occurrence.nodeId, (node) => ({
                  ...node,
                  value: { ...node.value, content: mergeContent(node.value.content, source.node.value.content) },
                }));
                return removeGraphOccurrence(merged, sourceKey);
              });
            },
            onSplit: (key, before, after) => {
              const sourceKey = absoluteKey(zoomKey, key);
              if (sourceKey === null) {
                return;
              }
              const created = createNode(after);
              setGraph((previous) => {
                const source = resolveGraphPath(previous, sourceKey);
                const location = siblingLocation(previous, sourceKey);
                if (source === null || location === null) {
                  return previous;
                }
                const updated = updateGraphNode(previous, source.node.id, (node) => ({
                  ...node,
                  value: { ...node.value, content: before },
                }));
                return insertGraphNode(
                  updated,
                  location.parentKey,
                  location.index + 1,
                  created.node,
                  created.occurrence,
                );
              });
            },
          }}
          expandedKeys={expandedKeys}
          getRowLayout={(row) => rowProjections.get(row.key)?.layout ?? {}}
          label="Demo outline"
          occurrences={projectedOccurrences}
          onDeleteSelection={(keys) => {
            const sourceKeys = keys
              .map((key) => absoluteKey(zoomKey, key))
              .filter((key): key is string => key !== null);
            setGraph((previous) => sourceKeys.reduce(removeGraphOccurrence, previous));
          }}
          onExpandedChange={(key, expanded) => {
            setExpandedKeys((previous) => {
              const next = new Set(previous);
              if (expanded) {
                next.add(key);
              } else {
                next.delete(key);
              }
              return next;
            });
          }}
          onBulletClick={(row) => {
            if (row.occurrence.value.field !== undefined) {
              return;
            }
            const targetKey =
              row.occurrence.appearance === "reference"
                ? findOriginalOccurrenceKey(graph, row.occurrence.nodeId)
                : absoluteKey(zoomKey, row.key);
            if (targetKey !== null) {
              setZoomKey(targetKey);
              setExpandedKeys(new Set());
            }
          }}
          onMove={applyMove}
          renderBullet={(row, state) => (
            <DemoBullet
              fieldDatatype={rowProjections.get(row.key)?.fieldDatatype}
              fieldValue={rowProjections.get(row.key)?.fieldValue === true}
              row={row}
              selected={state.selected}
            />
          )}
          renderRow={(row) => <DemoRow row={row} />}
          showGuides
        />
      </Specimen>
    </>
  );
}
