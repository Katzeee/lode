import { useMemo, useRef, useState } from "react";

import { Breadcrumbs, type BreadcrumbItem } from "../components/breadcrumbs.js";
import { demoNodeLabel } from "./outline-demo-inline.js";
import {
  OutlineTree,
  type OutlineContent,
  type OutlineMerge,
  type OutlineMove,
} from "../components/outline/outline-tree.js";
import {
  findOriginalOccurrenceKey,
  insertGraphNode,
  replaceGraphOccurrenceNode,
  removeGraphOccurrence,
  retargetGraphOccurrence,
  resolveGraphPath,
  updateGraphNode,
  updateGraphOccurrence,
} from "./outline-demo-graph.js";
import { presentOutline } from "./outline-demo-presenter.js";
import { demoOutlinePresentationRegistry, type DemoOutlinePresentationAction } from "./outline-demo-presentation.js";
import { completionIds, createDemoCompletionProviders } from "./outline-demo-completions.js";
import { initialGraph, textContent, type DemoGraph, type DemoNode, type DemoOccurrence } from "./outline-demo-model.js";
import { demoInlineExtensions } from "./outline-demo-inline-presentation.js";
import { demoOutlineCommands } from "./outline-demo-commands.js";
import { PageIntro, Specimen } from "./specimen.js";

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
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => {
    const expandedModelPaths = new Set([
      "projects",
      "projects/lode",
      "projects/lode/roadmap",
      "projects/lode/roadmap/local-first-reference",
      "field-definitions",
      "inbox",
    ]);
    return new Set(
      [...presentOutline(initialGraph).modelPathsByKey]
        .filter(([, path]) => expandedModelPaths.has(path))
        .map(([key]) => key),
    );
  });
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const nextNodeId = useRef(0);
  const presentedOutline = useMemo(() => presentOutline(graph, zoomKey), [graph, zoomKey]);
  const completionProviders = useMemo(
    () =>
      createDemoCompletionProviders({
        commands: demoOutlineCommands,
        fieldDefinitionIdsByKey: presentedOutline.fieldDefinitionIdsByKey,
        graph,
      }),
    [graph, presentedOutline.fieldDefinitionIdsByKey],
  );

  const modelPath = (key: string): string | null => presentedOutline.modelPathsByKey.get(key) ?? null;

  const breadcrumbItems: readonly BreadcrumbItem[] = [
    { label: "All nodes", onSelect: () => setZoomKey(null) },
    ...(zoomKey ?? "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment, index, segments) => {
        const path = segments.slice(0, index + 1).join("/");
        return {
          label: demoNodeLabel(resolveGraphPath(graph, path)?.node.value.content ?? textContent(segment)),
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
      .map((sourceKey) => modelPath(sourceKey))
      .filter((sourceKey): sourceKey is string => sourceKey !== null);
    const targetParentKey = move.targetParentKey === null ? zoomKey : modelPath(move.targetParentKey);
    if (sourceKeys.length !== move.sourceKeys.length || (move.targetParentKey !== null && targetParentKey === null)) {
      return;
    }
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
    const sourceKey = modelPath(key);
    const resolved = sourceKey === null ? null : resolveGraphPath(graph, sourceKey);
    if (sourceKey === null || resolved === null) {
      return;
    }
    if (JSON.stringify(resolved.node.value.content) === JSON.stringify(content)) {
      return;
    }
    if (presentedOutline.fieldDefinitionIdsByKey.has(key) && resolved.occurrence.appearance === "reference") {
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

  const handlePresentationAction = (key: string, action: DemoOutlinePresentationAction) => {
    const sourcePath = modelPath(key);
    if (sourcePath === null || action.type === "configure-field") {
      return;
    }
    if (action.type === "set-checked") {
      setGraph((previous) => {
        const resolved = resolveGraphPath(previous, sourcePath);
        return resolved === null
          ? previous
          : updateGraphNode(previous, resolved.node.id, (node) => ({
              ...node,
              value: { ...node.value, todo: action.checked ? "done" : "open" },
            }));
      });
      return;
    }
    const resolved = resolveGraphPath(graph, sourcePath);
    if (resolved === null || resolved.node.value.field !== undefined) {
      return;
    }
    const targetKey =
      resolved.occurrence.appearance === "reference" ? findOriginalOccurrenceKey(graph, resolved.node.id) : sourcePath;
    if (targetKey !== null) {
      setZoomKey(targetKey);
      setExpandedKeys(new Set());
    }
  };

  return (
    <>
      <PageIntro
        description="This page owns a normalized demo Model and presents it through the Outline component's ViewModel. Original and Reference occurrences share one Node identity in that Model, while the component receives only presentation data and opaque keys, renders the complete view, and emits semantic edit intents back to the page."
        title="Outline"
      />
      <Specimen
        className="flex-col flex-nowrap items-stretch gap-4"
        description="Click text to edit its source, including formatting, references and Supertags. Use / for commands, @ to reference a node, # to apply a Supertag, and > to choose a field. Field values share a column and remain editable as ordinary nodes."
        title="Node outline"
      >
        {zoomKey === null ? null : (
          <header className="flex flex-col gap-0.5 border-b border-border pb-3">
            <Breadcrumbs items={breadcrumbItems} />
            <h3 className="text-title-small font-semibold tracking-tight">
              {demoNodeLabel(resolveGraphPath(graph, zoomKey)?.node.value.content ?? [])}
            </h3>
          </header>
        )}
        <OutlineTree
          inlineExtensions={demoInlineExtensions}
          editing={{
            completionProviders,
            emptyPlaceholder: "Type / for commands, @ to reference, # for a Supertag, or > for a field…",
            onCompletion: (key, providerId, itemId, content) => {
              const sourceKey = modelPath(key);
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
                  value:
                    providerId === completionIds.command
                      ? (demoOutlineCommands
                          .find((command) => command.id === itemId)
                          ?.apply?.({ ...node.value, content }) ?? { ...node.value, content })
                      : { ...node.value, content },
                })),
              );
            },
            onContentChange: updateContent,
            onContentCommit: updateContent,
            onCreateAfter: (key) => {
              const sourceKey = modelPath(key);
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
              const sourceKey = modelPath(key);
              const resolved = sourceKey === null ? null : resolveGraphPath(graph, sourceKey);
              if (resolved === null || resolved.node.childOccurrenceIds.length > 0) {
                return;
              }
              const created = createNode([]);
              setGraph((previous) => insertGraphNode(previous, sourceKey, 0, created.node, created.occurrence));
            },
            onDeleteEmpty: (key) => {
              const sourceKey = modelPath(key);
              if (sourceKey !== null) {
                setGraph((previous) => removeGraphOccurrence(previous, sourceKey));
              }
            },
            onMerge: ({ content, sourceKey, targetKey }: OutlineMerge) => {
              const sourcePath = modelPath(sourceKey);
              const targetPath = modelPath(targetKey);
              if (sourcePath === null || targetPath === null) {
                return;
              }
              setGraph((previous) => {
                const target = resolveGraphPath(previous, targetPath);
                if (target === null) {
                  return previous;
                }
                const merged = updateGraphNode(previous, target.node.id, (node) => ({
                  ...node,
                  value: { ...node.value, content },
                }));
                return removeGraphOccurrence(merged, sourcePath);
              });
            },
            onSplit: (key, before, after) => {
              const sourceKey = modelPath(key);
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
          items={presentedOutline.items}
          label="Demo outline"
          onDeleteSelection={(keys) => {
            const sourceKeys = keys.map((key) => modelPath(key)).filter((key): key is string => key !== null);
            if (sourceKeys.length !== keys.length) {
              return;
            }
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
          onMove={applyMove}
          onPresentationAction={handlePresentationAction}
          presentation={demoOutlinePresentationRegistry}
          showGuides
        />
      </Specimen>
    </>
  );
}
