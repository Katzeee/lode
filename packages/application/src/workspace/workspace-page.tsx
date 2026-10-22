import { Alert, Button, PageScaffold, Spinner, type OutlineEditPosition, type OutlineTreeEditing } from "@lode/ui";
import { useState, useSyncExternalStore } from "react";
import { useWorkspaceController } from "./workspace-context.js";
import { WorkspaceDocument } from "./workspace-document.js";
import { WorkspaceCollection } from "./workspace-collection.js";
import { WorkspaceSupertag } from "./workspace-supertag.js";
import { WorkspaceViewOptions } from "./workspace-view-options.js";
import { workspaceCompletions } from "./workspace-completions.js";

type Props = Readonly<{
  workspace: Readonly<{ workspaceId: string; label: string }>;
  actorId: string;
  rootNodeId?: string;
  onNavigate(nodeId: string): void;
}>;

export function WorkspacePage({ workspace, actorId, rootNodeId, onNavigate }: Props) {
  const controller = useWorkspaceController(workspace.workspaceId, actorId);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [editorRevision, setEditorRevision] = useState(0);
  const [bodyFocus, setBodyFocus] = useState<Readonly<{ root: string; position: OutlineEditPosition }> | null>(null);
  const graph = controller.viewGraph();
  const root = rootNodeId ?? graph?.rootNodeId;
  if (!graph || !root) {
    return (
      <PageScaffold title="Loading workspace">
        <Spinner label="Loading workspace" />
      </PageScaffold>
    );
  }
  const completion = workspaceCompletions({ graph, controller, contentNodeId: () => root });
  const editing: OutlineTreeEditing = {
    completionProviders: completion.providers,
    onContentChange: (_key, content) => controller.stageNode(root, content),
    onContentCommit: (_key, content, reason) => controller.commitNode(root, content, reason),
    onCompletion: (_key, _provider, _item, content) => {
      controller.stageNode(root, content);
      controller.flush();
    },
  };
  const focus = bodyFocus?.root === root ? bodyFocus.position : undefined;
  return (
    <WorkspaceDocument
      graph={graph}
      rootNodeId={root}
      controller={controller}
      editing={editing}
      commands={completion.commands}
      onNavigate={onNavigate}
      onBodyFocus={(position) => setBodyFocus({ root, position })}
    >
      <p className="sr-only" role="status">
        {state.pending > 0 ? "Saving…" : state.drafts.size > 0 ? "Unsaved changes" : "Saved locally"}
      </p>
      {state.error === null ? null : (
        <Alert tone="destructive">
          {state.error}
          <Button variant="ghost" onClick={controller.retry}>
            {state.drafts.size > 0 ? "Retry save" : "Reload"}
          </Button>
          {state.drafts.size === 0 ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                controller.discardDrafts();
                setEditorRevision((value) => value + 1);
              }}
            >
              Use saved version
            </Button>
          )}
        </Alert>
      )}
      <WorkspaceViewOptions graph={graph} nodeId={root} controller={controller} />
      {graph.nodes[root]?.intrinsicNodeType === "supertag-definition" ? (
        <WorkspaceSupertag
          key={`${root}:${editorRevision}`}
          controller={controller}
          supertagId={root}
          onNavigate={onNavigate}
          focusRequest={focus}
        />
      ) : (
        <WorkspaceCollection
          key={`${root}:${editorRevision}`}
          controller={controller}
          nodeId={root}
          scope=""
          onNavigate={onNavigate}
          focusRequest={focus}
          selectionToolbar
          parentEditor={{ key: `title:${root}`, nodeId: root }}
        />
      )}
    </WorkspaceDocument>
  );
}
