import { createContext, useContext, useRef, type ReactNode } from "react";
import type { OutlineEditPosition } from "./outline-tree-view-model.js";
import type { OutlineContent } from "./outline-content.js";

export type NodeEditorArea = Readonly<{
  element(): HTMLElement | null;
  keys(): readonly string[];
  focus(position: OutlineEditPosition, content?: OutlineContent): void;
  enter(direction: -1 | 1): void;
  end(): void;
}>;

/** A panel coordinates appearances; it never owns the Node data behind them. */
export class NodeEditorCoordinator {
  private readonly areas = new Map<string, NodeEditorArea>();
  private active: string | null = null;
  private pending: Readonly<{ owner: string; position: OutlineEditPosition; content?: OutlineContent }> | null = null;
  register(id: string, area: NodeEditorArea): () => void {
    this.areas.set(id, area);
    this.refresh();
    return () => {
      this.areas.delete(id);
      this.cancel(id);
      if (this.active === id) {
        this.active = null;
      }
    };
  }
  claim(id: string): void {
    this.pending = null;
    const previous = this.active;
    this.active = id;
    if (previous !== id && previous !== null) {
      this.areas.get(previous)?.end();
    }
  }
  isActive(id: string): boolean {
    return this.active === id;
  }
  focus(position: OutlineEditPosition, content?: OutlineContent): boolean {
    const entry = [...this.areas].find(([, area]) => area.keys().includes(position.key));
    if (!entry) {
      return false;
    }
    this.claim(entry[0]);
    entry[1].focus(position, content);
    return true;
  }
  requestFocus(owner: string, position: OutlineEditPosition, content?: OutlineContent): void {
    if (!this.focus(position, content)) {
      this.pending = { owner, position, content };
    }
  }
  cancel(owner: string): void {
    if (this.pending?.owner === owner) {
      this.pending = null;
    }
  }
  /** Regions can publish their appearances after the originating command resolves. */
  refresh(): void {
    if (this.pending !== null) {
      this.focus(this.pending.position, this.pending.content);
    }
  }
  adjacent(id: string, direction: -1 | 1): boolean {
    const ordered = [...this.areas]
      .filter(([, area]) => area.element()?.isConnected)
      .sort(([, left], [, right]) =>
        left.element()!.compareDocumentPosition(right.element()!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
    const index = ordered.findIndex(([key]) => key === id);
    if (index < 0) {
      return false;
    }
    const next = ordered[index + direction];
    if (!next) {
      return false;
    }
    const key = direction === 1 ? next?.[1].keys()[0] : next?.[1].keys().at(-1);
    if (key !== undefined) {
      return this.focus({ key, caret: 0 });
    }
    this.claim(next[0]);
    next[1].enter(direction);
    return true;
  }
}

const NodeEditorContext = createContext<NodeEditorCoordinator | null>(null);

export function NodeEditor({ children }: Readonly<{ children: ReactNode }>) {
  const parent = useContext(NodeEditorContext);
  const own = useRef<NodeEditorCoordinator | null>(null);
  own.current ??= new NodeEditorCoordinator();
  return <NodeEditorContext.Provider value={parent ?? own.current}>{children}</NodeEditorContext.Provider>;
}

export function useNodeEditorCoordinator(): NodeEditorCoordinator {
  const coordinator = useContext(NodeEditorContext);
  if (!coordinator) {
    throw new Error("Node editing regions require a NodeEditor");
  }
  return coordinator;
}
