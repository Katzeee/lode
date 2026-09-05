import type { SetStateAction } from "react";
import type { OutlineCommandContext, OutlineHostCommand } from "../components/outline/outline-commands.js";
import { resolveGraphPath, updateGraphContent, updateGraphNode } from "./outline-demo-graph.js";
import type { DemoGraph } from "./outline-demo-model.js";

export const taskCommandIds = {
  toggle: "task.toggle",
  create: "task.create",
  complete: "task.complete",
  reopen: "task.reopen",
} as const;
type TaskOperation = keyof typeof taskCommandIds;

export function applyDemoTaskCommand(
  graph: DemoGraph,
  context: OutlineCommandContext,
  operation: TaskOperation,
  modelPath: (key: string) => string | null,
): DemoGraph {
  const ids = new Set(
    context.keys.flatMap((key) => {
      const path = modelPath(key);
      const node = path === null ? undefined : resolveGraphPath(graph, path)?.node;
      return node === undefined || node.value.editable === false ? [] : [node.id];
    }),
  );
  if (ids.size === 0) {
    return graph;
  }
  const path = context.position === null ? null : modelPath(context.position.key);
  let next =
    context.source === "completion" && path !== null && context.content !== null
      ? updateGraphContent(graph, path, context.content)
      : graph;
  for (const id of ids) {
    next = updateGraphNode(next, id, (node) => ({
      ...node,
      value: {
        ...node.value,
        todo:
          operation === "complete" ? "done" : operation === "toggle" && node.value.todo === "open" ? "done" : "open",
      },
    }));
  }
  return next;
}

export function createDemoTaskCommands(
  graph: DemoGraph,
  setGraph: (update: SetStateAction<DemoGraph>) => void,
  modelPath: (key: string) => string | null,
): readonly OutlineHostCommand[] {
  return (["toggle", "create", "complete", "reopen"] as const).map((operation) => ({
    id: taskCommandIds[operation],
    label:
      operation === "toggle"
        ? "Toggle task"
        : operation === "create"
          ? "Make task"
          : operation === "complete"
            ? "Complete"
            : "Reopen",
    inSelectionToolbar: operation === "toggle",
    keyBindings: operation === "toggle" ? [{ key: "Enter", mod: true }] : [],
    canExecute: (context) =>
      context.keys.some((key) => {
        const path = modelPath(key);
        const node = path === null ? undefined : resolveGraphPath(graph, path)?.node;
        return node !== undefined && node.value.editable !== false;
      }),
    execute: (context) => setGraph((previous) => applyDemoTaskCommand(previous, context, operation, modelPath)),
  }));
}
