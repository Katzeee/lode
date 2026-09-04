import { useRef, useState, type SetStateAction } from "react";
import type { OutlineEditHistory } from "../components/outline/outline-tree-edit-contract.js";
import type { OutlineEditPosition } from "../components/outline/outline-tree-view-model.js";
import type { DemoGraph } from "./outline-demo-model.js";
import { presentOutline } from "./outline-demo-presenter.js";

type Snapshot = Readonly<{ graph: DemoGraph; expandedKeys: ReadonlySet<string>; position: OutlineEditPosition | null }>;
type Checkpoint = Readonly<{ position: OutlineEditPosition | null; group: "typing" | "operation"; time: number }>;

/** Model snapshots group text input while structural operations remain atomic. */
export function useOutlineDemoHistory(initialGraph: DemoGraph, initialExpanded: ReadonlySet<string>) {
  const [graph, renderGraph] = useState(initialGraph);
  const [expandedKeys, renderExpanded] = useState(initialExpanded);
  const state = useRef({ graph, expandedKeys });
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const pending = useRef<Checkpoint | null>(null);
  const last = useRef<Checkpoint | null>(null);

  const setGraph = (update: SetStateAction<DemoGraph>) => {
    const previous = state.current.graph;
    const next = typeof update === "function" ? update(previous) : update;
    if (previous === next || JSON.stringify(previous) === JSON.stringify(next)) {
      return;
    }
    const checkpoint = pending.current ?? { position: null, group: "operation", time: Date.now() };
    const grouped =
      checkpoint.group === "typing" &&
      last.current?.group === "typing" &&
      checkpoint.position?.key === last.current.position?.key &&
      checkpoint.time - last.current.time < 750;
    if (!grouped) {
      past.current.push({ ...state.current, position: checkpoint.position });
    }
    future.current = [];
    last.current = checkpoint;
    pending.current = null;
    state.current = { ...state.current, graph: next };
    renderGraph(next);
  };
  const setExpandedKeys = (update: SetStateAction<ReadonlySet<string>>) => {
    const next = typeof update === "function" ? update(state.current.expandedKeys) : update;
    state.current = { ...state.current, expandedKeys: next };
    renderExpanded(next);
  };
  const restore = (from: Snapshot[], to: Snapshot[], position: OutlineEditPosition | null) => {
    const snapshot = from.pop();
    if (snapshot === undefined) {
      return null;
    }
    to.push({ ...state.current, position });
    state.current = { graph: snapshot.graph, expandedKeys: snapshot.expandedKeys };
    renderGraph(snapshot.graph);
    renderExpanded(snapshot.expandedKeys);
    pending.current = null;
    last.current = null;
    return {
      position:
        snapshot.position !== null && presentOutline(snapshot.graph).modelPathsByKey.has(snapshot.position.key)
          ? snapshot.position
          : null,
    };
  };
  const history: OutlineEditHistory = {
    checkpoint: (position, group) => {
      pending.current = { position, group, time: Date.now() };
    },
    undo: (position) => restore(past.current, future.current, position),
    redo: (position) => restore(future.current, past.current, position),
  };
  return { graph, setGraph, expandedKeys, setExpandedKeys, history };
}
