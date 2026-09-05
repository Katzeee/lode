import {
  Alert,
  Button,
  OutlineBullet,
  OutlineBulletDot,
  Breadcrumbs,
  Icon,
  OutlineTree,
  PageScaffold,
  Spinner,
  type OutlineTreeEditing,
} from "@lode/ui";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ApplicationHost } from "../session/contract.js";
import { nodeLabel } from "./node-source.js";
import { projectWorkspaceOutline, type WorkspaceAppearance } from "./workspace-outline.js";
import { workspaceOutlineActions } from "./workspace-outline-actions.js";
import { workspaceExtensions } from "./workspace-extensions.js";
import { workspaceCompletions } from "./workspace-completions.js";
import { WorkspaceController } from "./workspace-controller.js";

type Props = Readonly<{
  host: ApplicationHost;
  workspace: Readonly<{ workspaceId: string; label: string }>;
  actorId: string;
  rootNodeId?: string;
  onNavigate(nodeId: string): void;
}>;

export function WorkspacePage({ host, workspace, actorId, rootNodeId, onNavigate }: Props) {
  const controller = useMemo(
    () => new WorkspaceController(host.engine, workspace.workspaceId, actorId),
    [host, workspace.workspaceId, actorId],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [editorRevision, setEditorRevision] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const stop = controller.start();
    const stopState = host.onStateChanged(controller.reload);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = controller.getSnapshot();
      if (current.drafts.size > 0 || current.pending > 0) {
        event.preventDefault();
      }
    };
    window.addEventListener("focus", controller.reload);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      stopState();
      stop();
      window.removeEventListener("focus", controller.reload);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [controller]);
  const graph = state.graph;
  const root = rootNodeId ?? graph?.rootNodeId;
  const projection = graph ? projectWorkspaceOutline(graph, state.drafts, root ?? graph.rootNodeId) : null;
  const appearances = projection?.bindings ?? new Map<string, WorkspaceAppearance>();
  const occurrenceId = (key: string) => appearances.get(key)?.occurrenceId ?? "";
  const contentNodeId = (key: string) => appearances.get(key)?.contentNodeId ?? "";
  const completion = state.graph
    ? workspaceCompletions({ graph: state.graph, controller, occurrenceId, contentNodeId })
    : { providers: [], commands: [] };
  const structure = state.graph
    ? workspaceOutlineActions(state.graph, controller, appearances, rootNodeId ?? state.graph.rootNodeId)
    : undefined;
  const editing: OutlineTreeEditing = {
    onCopy: structure?.copy,
    onPaste: structure?.paste,
    onCreateRoot: structure?.createRoot,
    completionProviders: completion.providers,
    onCompletion: (key, _provider, _item, content) => {
      controller.stageNode(contentNodeId(key), content);
      controller.flush();
    },
    onContentChange: (key, content) => controller.stageNode(contentNodeId(key), content),
    onContentCommit: (key, content) => {
      controller.stageNode(contentNodeId(key), content);
      controller.flush();
    },
    onCreateBefore: (key) => controller.create(occurrenceId(key), "before"),
    onCreateAfter: (key) => controller.create(occurrenceId(key), "after"),
    onCreateChild: (key) => {
      setExpanded((keys) => new Set(keys).add(key));
      controller.create(occurrenceId(key), "child");
    },
    onClearAppearance: structure?.clear,
    onMerge: (merge) => structure?.merge(merge),
    onDeleteEmpty: (key) => controller.deleteEmpty(occurrenceId(key)),
    onSplit: (key, before, after, placement) => {
      if (placement === "child") {
        setExpanded((keys) => new Set(keys).add(key));
      }
      controller.split(occurrenceId(key), before, after, placement);
    },
    history: {
      checkpoint: () => {},
      undo: (position) => structure?.history("undo", position) ?? null,
      redo: (position) => structure?.history("redo", position) ?? null,
    },
  };
  const fields = projection?.fields;
  const appearanceCounts = new Map<string, number>();
  for (const occurrence of Object.values(graph?.occurrences ?? {})) {
    appearanceCounts.set(occurrence.nodeId, (appearanceCounts.get(occurrence.nodeId) ?? 0) + 1);
  }
  const presentation = {
    resolve: (occurrenceId: string) => {
      const occurrence = graph?.occurrences[occurrenceId];
      const nodeId = occurrence?.nodeId ?? "";
      const reference = occurrence !== undefined && graph?.nodeOwners[nodeId] !== occurrence.parentNodeId;
      const referenced = (appearanceCounts.get(nodeId) ?? 0) > 1;
      return {
        bullet: {
          action: fields?.get(nodeId)?.fieldDefinitionId ?? nodeId,
          content: fields?.has(nodeId) ? (
            <Icon name="list-tree" className="size-3.5" />
          ) : (
            <OutlineBullet frame={reference ? "dashed" : "none"} halo={!reference && referenced ? "muted" : "none"}>
              <OutlineBulletDot />
            </OutlineBullet>
          ),
        },
        childrenLayout: fields?.has(nodeId) ? ("beside" as const) : ("indented" as const),
      };
    },
  };
  return (
    <PageScaffold
      layout="document"
      title={rootNodeId && graph?.nodes[rootNodeId] ? nodeLabel(graph.nodes[rootNodeId], graph) : workspace.label}
    >
      {rootNodeId ? (
        <Breadcrumbs
          items={[
            { label: workspace.label, onSelect: () => onNavigate(workspace.workspaceId) },
            { label: graph?.nodes[rootNodeId] ? nodeLabel(graph.nodes[rootNodeId], graph) : "Node" },
          ]}
        />
      ) : null}
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
      {graph === null ? (
        <Spinner label="Loading workspace" />
      ) : (
        <OutlineTree
          selectionToolbar
          key={editorRevision}
          items={projection?.items ?? []}
          label="Workspace nodes"
          expandedKeys={expanded}
          onExpandedChange={(key, value) =>
            setExpanded((keys) => {
              const next = new Set(keys);
              if (value) {
                next.add(key);
              } else {
                next.delete(key);
              }
              return next;
            })
          }
          presentation={presentation}
          onPresentationAction={(_key, nodeId) => onNavigate(nodeId)}
          inlineExtensions={workspaceExtensions(onNavigate)}
          commands={completion.commands}
          onMove={structure?.move}
          onDeleteSelection={structure?.remove}
          editing={editing}
        />
      )}
    </PageScaffold>
  );
}
