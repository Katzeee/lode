import { useSyncExternalStore } from "react";
import type { OutlineEditPosition } from "@lode/ui";
import type { WorkspaceController } from "./workspace-controller.js";
import { WorkspaceRegion } from "./workspace-region.js";
import { WorkspaceTable } from "./workspace-table.js";

export function WorkspaceCollection({
  controller,
  nodeId,
  scope,
  onNavigate,
  focusRequest,
  selectionToolbar,
  parentEditor,
}: Readonly<{
  controller: WorkspaceController;
  nodeId: string;
  scope: string;
  onNavigate(nodeId: string): void;
  focusRequest?: OutlineEditPosition;
  selectionToolbar?: boolean;
  parentEditor?: Readonly<{ key: string; nodeId: string }>;
}>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const renderCollection = (nodeId: string, scope: string) => (
    <WorkspaceCollection controller={controller} nodeId={nodeId} scope={scope} onNavigate={onNavigate} />
  );
  return state.graph?.sharedDefaultViewDefinitions[nodeId]?.[0]?.viewType === "table" ? (
    <WorkspaceTable
      controller={controller}
      nodeId={nodeId}
      scope={scope}
      onNavigate={onNavigate}
      focusRequest={focusRequest}
      renderCollection={renderCollection}
      parentEditor={parentEditor}
    />
  ) : (
    <WorkspaceRegion
      controller={controller}
      source={{ kind: "children", nodeId }}
      scope={scope}
      label="Workspace nodes"
      onNavigate={onNavigate}
      focusRequest={focusRequest}
      renderCollection={renderCollection}
      selectionToolbar={selectionToolbar}
      parentEditor={parentEditor}
    />
  );
}
