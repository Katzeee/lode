import {
  Alert,
  Button,
  OutlineBulletDot,
  OutlineTree,
  PageScaffold,
  Spinner,
  type OutlineContent,
  type OutlineItemViewModel,
  type OutlineTreeEditing,
} from "@lode/ui";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ApplicationHost } from "../session/contract.js";
import { canEditNode, nodeText } from "./workspace-model.js";
import { WorkspaceController } from "./workspace-controller.js";

type Props = Readonly<{
  host: ApplicationHost;
  workspace: Readonly<{ workspaceId: string; label: string }>;
  actorId: string;
}>;
const presentation = { resolve: () => ({ bullet: { content: <OutlineBulletDot /> } }) };
const source = (content: OutlineContent) =>
  content.map((part) => (part.type === "text" ? part.text : part.source)).join("");
export function WorkspacePage({ host, workspace, actorId }: Props) {
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
  const appearances = new Map<string, string>();
  const occurrenceId = (key: string) => appearances.get(key) ?? "";
  const editing: OutlineTreeEditing = {
    onContentChange: (key, content) => controller.stage(occurrenceId(key), source(content)),
    onContentCommit: (key, content) => {
      controller.stage(occurrenceId(key), source(content));
      controller.flush();
    },
    onCreateBefore: (key) => controller.create(occurrenceId(key), "before"),
    onCreateAfter: (key) => controller.create(occurrenceId(key), "after"),
    onCreateChild: (key) => {
      setExpanded((keys) => new Set(keys).add(key));
      controller.create(occurrenceId(key), "child");
    },
    onDeleteEmpty: (key) => controller.deleteEmpty(occurrenceId(key)),
    onSplit: (key, before, after, placement) => {
      if (placement === "child") {
        setExpanded((keys) => new Set(keys).add(key));
      }
      controller.split(occurrenceId(key), source(before), source(after), placement);
    },
    history: {
      checkpoint: () => {},
      undo: () => {
        controller.history("undo");
        return null;
      },
      redo: () => {
        controller.history("redo");
        return null;
      },
    },
  };
  const graph = state.graph;
  const build = (
    parent: string,
    ancestors: ReadonlySet<string>,
    path: readonly string[] = [],
  ): readonly OutlineItemViewModel<null>[] =>
    (graph?.childOccurrences[parent] ?? []).flatMap((key) => {
      const occurrence = graph?.occurrences[key];
      const node = occurrence ? graph?.nodes[occurrence.nodeId] : undefined;
      if (!node || ancestors.has(node.nodeId) || graph?.systemNodeIds.includes(node.nodeId)) {
        return [];
      }
      const appearance = JSON.stringify([...path, key]);
      appearances.set(appearance, key);
      const text = state.drafts.get(node.nodeId)?.text ?? nodeText(node);
      return [
        {
          key: appearance,
          presentation: null,
          content: [{ type: "text", text }],
          accessibilityLabel: text || "Empty node",
          editable: canEditNode(node),
          readonlyReason: "Structured content",
          children: build(node.nodeId, new Set(ancestors).add(node.nodeId), [...path, key]),
        },
      ];
    });
  return (
    <PageScaffold
      title={workspace.label}
      actions={
        <Button disabled={graph === null} onClick={() => controller.create()}>
          Add node
        </Button>
      }
    >
      <p className="mb-4 text-caption text-muted-foreground" role="status">
        {state.pending > 0 ? "Saving…" : state.drafts.size > 0 ? "Unsaved changes" : "Saved locally"}
      </p>
      {state.error === null ? null : (
        <Alert tone="destructive">
          {state.error}
          <Button variant="ghost" onClick={controller.retry}>
            Retry
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
          key={editorRevision}
          items={build(graph.rootNodeId, new Set([graph.rootNodeId]))}
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
          editing={editing}
        />
      )}
    </PageScaffold>
  );
}
