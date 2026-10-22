import { useState, useSyncExternalStore, type ReactNode } from "react";
import { OutlineTree, type OutlineContent, type OutlineEditPosition, type OutlineTreeEditing } from "@lode/ui";
import type { WorkspaceController } from "./workspace-controller.js";
import {
  projectWorkspaceRegion,
  workspaceRegionPath,
  type WorkspaceCollectionSource,
} from "./workspace-region-projection.js";
import { workspaceOutlineActions } from "./workspace-outline-actions.js";
import { workspaceExtensions } from "./workspace-extensions.js";
import { workspaceCompletions } from "./workspace-completions.js";
import { workspacePresentation } from "./workspace-presentation.js";
import type { WorkspaceContentTarget } from "./workspace-content-target.js";
import { fieldUsesSourceText } from "./workspace-field-policy.js";
import { nodeUsesSourceText } from "./workspace-field-policy.js";
import { nodeSource } from "./node-source.js";

export function WorkspaceRegion({
  controller,
  source,
  scope,
  label,
  onNavigate,
  focusRequest,
  siblingPosition,
  renderCollection,
  selectionToolbar,
  parentEditor,
}: Readonly<{
  controller: WorkspaceController;
  source: WorkspaceCollectionSource;
  scope: string;
  label: string;
  onNavigate(nodeId: string): void;
  focusRequest?: OutlineEditPosition;
  siblingPosition?(occurrenceId: string): OutlineEditPosition;
  renderCollection?(nodeId: string, scope: string): ReactNode;
  selectionToolbar?: boolean;
  parentEditor?: Readonly<{ key: string; nodeId: string }>;
}>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [expandedIds, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const graph = controller.viewGraph();
  if (!graph) {
    return null;
  }
  const region = projectWorkspaceRegion(graph, state, source, scope);
  const parent =
    parentEditor && graph.nodes[parentEditor.nodeId] && nodeUsesSourceText(graph, parentEditor.nodeId)
      ? {
          key: parentEditor.key,
          content:
            state.drafts.get(parentEditor.nodeId)?.content ?? nodeSource(graph.nodes[parentEditor.nodeId]!, graph),
        }
      : undefined;
  if (parent && parentEditor) {
    region.bindings.set(parent.key, {
      kind: "root",
      path: [],
      key: parent.key,
      nodeId: parentEditor.nodeId,
      contentNodeId: parentEditor.nodeId,
      editable: true,
      reference: false,
    });
  }
  const keyForPath = (path: readonly string[]) => (scope ? `${scope}:${JSON.stringify(path)}` : JSON.stringify(path));
  const binding = (key: string) => region.bindings.get(key);
  const contentId = (key: string) => binding(key)?.contentNodeId ?? "";
  const occurrenceId = (key: string) => binding(key)?.occurrenceId ?? workspaceRegionPath(key, scope).at(-1) ?? "";
  const expansionId = (key: string) =>
    binding(key)?.contentTarget?.kind === "template-instance" || (binding(key) && !binding(key)?.occurrenceId)
      ? key
      : occurrenceId(key);
  const target = (key: string): WorkspaceContentTarget => {
    const current = binding(key);
    if (current?.contentTarget) {
      return current.contentTarget;
    }
    return current?.kind === "template-default"
      ? {
          kind: "template-default",
          nodeId: current.contentNodeId,
          supertagId: current.supertagId,
          templateFieldId: current.templateFieldId,
        }
      : { kind: "node", nodeId: contentId(key) };
  };
  const structure = workspaceOutlineActions(graph, controller, region.bindings, region.rootNodeId, keyForPath);
  const completion = workspaceCompletions({
    graph,
    controller,
    contentNodeId: contentId,
    contentTarget: target,
    editable: (key) => binding(key)?.editable !== false,
  });
  const scalar = source.kind === "template-default" || (source.kind === "node" && source.structural === false);
  const defaults = source.kind === "template-default";
  const expand = (key: string) => setExpanded((current) => new Set(current).add(expansionId(key)));
  const create = (content: OutlineContent) => {
    const insertion =
      source.kind === "field-values"
        ? controller.prepareField(source.ownerNodeId, source.fieldDefinitionId, content)
        : controller.prepare(region.rootNodeId, content);
    return { key: keyForPath([insertion.occurrenceId]), caret: 0 };
  };
  const position = (key: string, occurrence: string, placement: "before" | "after" | "child") => {
    const current = binding(key);
    if (placement !== "child" && current?.path.length === 1 && siblingPosition) {
      return siblingPosition(occurrence);
    }
    if (
      placement === "child" &&
      current &&
      graph.sharedDefaultViewDefinitions[current.nodeId]?.[0]?.viewType === "table" &&
      renderCollection
    ) {
      return {
        key: `${scope}:children:${current.nodeId}:row:occurrence:${occurrence}:${JSON.stringify([occurrence])}`,
        caret: 0,
      };
    }
    return {
      key: keyForPath([
        ...(placement === "child"
          ? (current?.editingPath ?? current?.path ?? [])
          : ((current?.editingPath ?? current?.path)?.slice(0, -1) ?? [])),
        occurrence,
      ]),
      caret: 0,
    };
  };
  const insert = (key: string, placement: "before" | "after" | "child") => {
    if (placement === "child") {
      expand(key);
    }
    const current = binding(key);
    const inserted =
      current && !current.occurrenceId && placement === "child"
        ? controller.prepare(current.nodeId)
        : controller.create(occurrenceId(key), placement, [], target(key));
    return inserted ? position(key, inserted.occurrenceId, placement) : undefined;
  };
  const editable: OutlineTreeEditing = {
    parent,
    focusRequest,
    onContentChange: (key, content) => controller.stageContent(target(key), content),
    onContentCommit: (key, content, reason) => {
      if (binding(key)?.kind === "template-default") {
        controller.stageContent(target(key), content);
        controller.flush();
      } else {
        controller.commitContent(target(key), content, reason);
      }
    },
    onCompletion: (key, _provider, _item, content) => {
      controller.stageContent(target(key), content);
      controller.flush();
    },
    onCreateBefore: scalar ? undefined : (key) => insert(key, "before"),
    onCreateAfter: scalar ? undefined : (key) => insert(key, "after"),
    onCreateChild: scalar ? undefined : (key) => insert(key, "child"),
    onDeleteEmpty: scalar ? undefined : (key) => controller.deleteEmpty(occurrenceId(key)),
    onMerge: scalar ? undefined : structure.merge,
    onSplit: scalar
      ? undefined
      : (key, before, after, placement) => {
          if (placement === "child") {
            expand(key);
          }
          const inserted = controller.split(occurrenceId(key), before, after, placement, target(key));
          return position(key, inserted.occurrenceId, placement);
        },
    onCreateRoot:
      source.kind === "children" ||
      (source.kind === "field-values" && fieldUsesSourceText(graph, source.fieldDefinitionId))
        ? create
        : undefined,
    onCopy: defaults ? undefined : structure.copy,
    onPaste: scalar ? undefined : structure.paste,
    onClearAppearance: scalar ? undefined : structure.clear,
    completionProviders: defaults ? [] : completion.providers,
    history: {
      checkpoint: () => {},
      undo: (position) => structure.history("undo", position),
      redo: (position) => structure.history("redo", position),
    },
  };
  const childrenViews = renderCollection
    ? new Map(
        [...region.bindings]
          .filter(([, item]) => graph.sharedDefaultViewDefinitions[item.nodeId]?.[0]?.viewType === "table")
          .map(([key, item]) => [key, renderCollection(item.nodeId, `${scope}:children:${item.nodeId}`)]),
      )
    : undefined;
  return (
    <OutlineTree
      items={region.items}
      label={label}
      childrenViews={childrenViews}
      selectionToolbar={selectionToolbar}
      expandedKeys={
        new Set([...region.bindings].filter(([key]) => expandedIds.has(expansionId(key))).map(([key]) => key))
      }
      onExpandedChange={(key, open) =>
        setExpanded((previous) => {
          const next = new Set(previous);
          if (open) {
            next.add(expansionId(key));
          } else {
            next.delete(expansionId(key));
          }
          return next;
        })
      }
      editing={editable}
      commands={defaults ? [] : completion.commands}
      inlineExtensions={defaults ? [] : workspaceExtensions(onNavigate)}
      onMove={
        scalar
          ? undefined
          : (move) =>
              (source.kind === "node" || source.kind === "search-result") &&
              move.kind === "absolute" &&
              move.targetParentKey === null
                ? null
                : structure.move(move)
      }
      onDeleteSelection={scalar ? undefined : structure.remove}
      presentation={workspacePresentation(graph, state, region.bindings)}
      onPresentationAction={(_key, nodeId) => {
        if (nodeId) {
          onNavigate(nodeId);
        }
      }}
    />
  );
}
