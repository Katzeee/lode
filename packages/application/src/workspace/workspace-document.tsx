import type { ReactNode } from "react";
import { START_SEQUENCE_ANCHOR } from "@lode/sdk";
import {
  Breadcrumbs,
  NodeHeading,
  NodeEditor,
  PageScaffold,
  type OutlineEditPosition,
  type OutlineHostCommand,
  type OutlineTreeEditing,
} from "@lode/ui";
import type { WorkspaceController } from "./workspace-controller.js";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import { nodeLabel, nodeSource } from "./node-source.js";
import { workspaceExtensions } from "./workspace-extensions.js";
import { nodeUsesSourceText } from "./workspace-field-policy.js";
import { workspaceNodeInTrash } from "./workspace-node-location.js";

export function WorkspaceDocument({
  graph,
  rootNodeId,
  controller,
  editing,
  commands,
  children,
  onNavigate,
  onBodyFocus,
}: Readonly<{
  graph: WorkspaceSnapshot;
  rootNodeId: string;
  controller: WorkspaceController;
  editing: OutlineTreeEditing;
  commands: readonly OutlineHostCommand[];
  children: ReactNode;
  onNavigate(nodeId: string): void;
  onBodyFocus(position: OutlineEditPosition): void;
}>) {
  const node = graph.nodes[rootNodeId];
  const key = `title:${rootNodeId}`;
  const ancestors: string[] = [];
  const visited = new Set([rootNodeId]);
  let parent = graph.nodeOwners[rootNodeId];
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    ancestors.unshift(parent);
    parent = graph.nodeOwners[parent];
  }
  if (ancestors[0] !== graph.rootNodeId && rootNodeId !== graph.rootNodeId) {
    ancestors.unshift(graph.rootNodeId);
  }
  const path = rootNodeId === graph.rootNodeId ? [rootNodeId] : ancestors;
  const firstChild = (create: boolean) => {
    const existing = graph.childOccurrences[rootNodeId]?.find(
      (id) => !graph.systemNodeIds.includes(graph.occurrences[id]?.nodeId ?? ""),
    );
    const occurrenceId =
      !create && existing ? existing : controller.prepare(rootNodeId, [], START_SEQUENCE_ANCHOR).occurrenceId;
    onBodyFocus({
      key:
        node?.intrinsicNodeType === "supertag-definition"
          ? `template-node:${rootNodeId}:${occurrenceId}:${JSON.stringify([occurrenceId])}`
          : JSON.stringify([occurrenceId]),
      caret: 0,
    });
  };
  const history = async (direction: "undo" | "redo", position: OutlineEditPosition | null) => {
    if (!(await controller.history(direction))) {
      return null;
    }
    return { position: { key, caret: position?.caret ?? 0, selectionEnd: position?.selectionEnd, editing: true } };
  };
  return (
    <NodeEditor>
      <PageScaffold
        layout="document"
        navigation={
          <Breadcrumbs
            items={path.map((id) => ({
              label: graph.nodes[id] ? nodeLabel(graph.nodes[id], graph) || "Untitled" : "Unavailable node",
              current: id === rootNodeId,
              onSelect: () => onNavigate(id),
            }))}
          />
        }
        title={
          node ? (
            <NodeHeading
              key={rootNodeId}
              target={{
                key,
                editable: nodeUsesSourceText(graph, rootNodeId) && !workspaceNodeInTrash(graph, rootNodeId),
                accessibilityLabel: nodeLabel(node, graph) || "Untitled",
                content: controller.getSnapshot().drafts.get(rootNodeId)?.content ?? nodeSource(node, graph),
              }}
              editing={{
                ...editing,
                focusRequest: undefined,
                history: {
                  checkpoint: () => {},
                  undo: (position) => history("undo", position),
                  redo: (position) => history("redo", position),
                },
              }}
              commands={commands}
              inlineExtensions={workspaceExtensions(onNavigate)}
              onEnter={() => firstChild(true)}
              onEmptyBody={() => firstChild(false)}
            />
          ) : (
            "Unavailable node"
          )
        }
      >
        {children}
      </PageScaffold>
    </NodeEditor>
  );
}
