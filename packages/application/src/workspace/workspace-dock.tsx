import { useState, useSyncExternalStore } from "react";
import { OutlineTree, OutlineBullet, OutlineBulletDot, type OutlineItemViewModel } from "@lode/ui";
import { useWorkspaceController } from "./workspace-context.js";
import { projectWorkspaceOutline } from "./workspace-outline.js";
import { nodeLabel } from "./node-source.js";
import { workspaceExtensions } from "./workspace-extensions.js";

export function WorkspaceDock({
  workspaces,
  actorId,
  onNavigate,
}: Readonly<{
  workspaces: readonly Readonly<{ workspaceId: string; label: string }>[];
  actorId: string;
  onNavigate(workspaceId: string, nodeId: string): void;
}>) {
  return (
    <div className="flex flex-col gap-1 px-4" data-ui="workspace-dock">
      <p className="mb-2 text-caption font-semibold uppercase text-muted-foreground">Workspaces</p>
      {workspaces.map((workspace) => (
        <DockRoot
          key={workspace.workspaceId}
          workspace={workspace}
          actorId={actorId}
          onNavigate={(nodeId) => onNavigate(workspace.workspaceId, nodeId)}
        />
      ))}
    </div>
  );
}
function DockRoot({
  workspace,
  actorId,
  onNavigate,
}: Readonly<{
  workspace: Readonly<{ workspaceId: string; label: string }>;
  actorId: string;
  onNavigate(nodeId: string): void;
}>) {
  const rootKey = `workspace:${workspace.workspaceId}`;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const controller = useWorkspaceController(workspace.workspaceId, actorId, expanded.has(rootKey));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const graph = controller.viewGraph();
  const projection = graph ? projectWorkspaceOutline(graph, state.drafts, graph.rootNodeId, state.insertions) : null;
  const href = (nodeId: string) =>
    `#/workspace/${encodeURIComponent(workspace.workspaceId)}${nodeId === workspace.workspaceId ? "" : `/node/${encodeURIComponent(nodeId)}`}`;
  const navigable = (items: readonly OutlineItemViewModel<string>[]): readonly OutlineItemViewModel<string>[] =>
    items
      .filter((item) => !state.insertions.has(projection?.bindings.get(item.key)?.nodeId ?? ""))
      .map((item) => ({
        ...item,
        key: `dock:${workspace.workspaceId}:${item.key}`,
        href: href(projection?.bindings.get(item.key)?.contentNodeId ?? ""),
        activation: "navigate",
        editable: false,
        children: navigable(item.children ?? []),
      }));
  const rootNode = graph?.nodes[workspace.workspaceId];
  const label = rootNode && graph ? nodeLabel(rootNode, graph) || "Untitled" : workspace.label;
  return (
    <OutlineTree
      items={[
        {
          key: rootKey,
          accessibilityLabel: label,
          content: [{ type: "text", text: label }],
          presentation: rootKey,
          href: href(workspace.workspaceId),
          activation: "navigate",
          editable: false,
          expandable: true,
          children: navigable(projection?.items ?? []),
        },
      ]}
      expandedKeys={expanded}
      inlineExtensions={workspaceExtensions(onNavigate, false)}
      onExpandedChange={(key, open) =>
        setExpanded((previous) => {
          const next = new Set(previous);
          if (open) {
            next.add(key);
          } else {
            next.delete(key);
          }
          return next;
        })
      }
      label={`${label} navigation`}
      onPresentationAction={(_key, nodeId: string) => onNavigate(nodeId)}
      presentation={{
        resolve: (identity) =>
          identity === rootKey
            ? {
                bullet: {
                  action: workspace.workspaceId,
                  accessibilityLabel: `Open ${label}`,
                  content: (
                    <span
                      aria-hidden
                      data-ui="workspace-marker"
                      className="grid size-5 place-items-center rounded-full border border-current/30 text-caption"
                    >
                      {Array.from(label).slice(0, 2).join("").toLocaleUpperCase()}
                    </span>
                  ),
                },
              }
            : {
                bullet: {
                  action:
                    projection?.fields.get(graph?.occurrences[identity]?.nodeId ?? "")?.fieldDefinitionId ??
                    graph?.occurrences[identity]?.nodeId ??
                    "",
                  content: (
                    <OutlineBullet
                      frame={
                        graph &&
                        graph.nodeOwners[graph.occurrences[identity]?.nodeId ?? ""] !==
                          graph.occurrences[identity]?.parentNodeId
                          ? "dashed"
                          : "none"
                      }
                    >
                      <OutlineBulletDot />
                    </OutlineBullet>
                  ),
                },
              },
      }}
    />
  );
}
