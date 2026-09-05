import { type EditAction, type EngineApplicationContract, type ProjectedNode } from "@lode/sdk";
import type { OutlineContent } from "@lode/ui";
import { createNodeActions, insertionParent, removeAppearanceAction } from "./workspace-structure.js";
import { editNodeSource } from "./node-edit.js";
import { contentIdentity, nodeSource, incompleteReference, sameSource } from "./node-source.js";
import { nodeText, readWorkspace, type WorkspaceSnapshot } from "./workspace-model.js";

type Draft = Readonly<{ base: ProjectedNode; content: OutlineContent; baseline: OutlineContent; applications: string }>;
export type WorkspaceState = Readonly<{
  graph: WorkspaceSnapshot | null;
  drafts: ReadonlyMap<string, Draft>;
  pending: number;
  error: string | null;
}>;
export class WorkspaceController {
  private state: WorkspaceState = { graph: null, drafts: new Map(), pending: 0, error: null };
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private draftRedo: ReadonlyMap<string, Draft> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopEvents: (() => void) | undefined;
  private readonly channel = crypto.randomUUID();
  constructor(
    private readonly engine: EngineApplicationContract,
    readonly workspaceId: string,
    private readonly actorId: string,
  ) {}
  getSnapshot = (): WorkspaceState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  start(): () => void {
    this.stopEvents = this.engine.subscribe((event) => {
      if (event.workspaceId === this.workspaceId) {
        this.reload();
      }
    }, this.fail);
    this.reload();
    return () => {
      this.stopEvents?.();
      this.stopEvents = undefined;
      this.flush();
    };
  }
  reload = (): void => {
    void this.schedule(async () => {
      await this.read();
    });
  };
  retry = (): void => {
    this.publish({ error: null });
    if (this.state.drafts.size > 0) {
      this.flush();
    } else {
      this.reload();
    }
  };
  discardDrafts = (): void => {
    this.draftRedo = null;
    clearTimeout(this.timer);
    this.publish({ drafts: new Map(), error: null });
    this.reload();
  };
  stageNode(nodeId: string, content: OutlineContent): void {
    this.draftRedo = null;
    const node = this.state.graph?.nodes[nodeId];
    if (!node) {
      return;
    }
    const drafts = new Map(this.state.drafts);
    drafts.set(node.nodeId, {
      base: drafts.get(node.nodeId)?.base ?? node,
      baseline: drafts.get(node.nodeId)?.baseline ?? nodeSource(node, this.state.graph!),
      applications:
        drafts.get(node.nodeId)?.applications ??
        JSON.stringify(this.state.graph!.supertagApplications[node.nodeId] ?? []),
      content,
    });
    this.publish({ drafts });
    clearTimeout(this.timer);
    if (!incompleteReference(content)) {
      this.timer = setTimeout(() => this.flush(), 350);
    }
  }
  flush = (): void => {
    clearTimeout(this.timer);
    void this.schedule(() => this.saveDrafts());
  };
  create(
    parentKey: string | null = null,
    placement: "before" | "after" | "child" = "child",
    content: OutlineContent = [],
  ): void {
    void this.apply((graph) => {
      const { parentNodeId, anchor } = insertionParent(graph, parentKey, placement);
      return createNodeActions(graph, parentNodeId, content, anchor);
    });
  }
  split(key: string, before: OutlineContent, after: OutlineContent, placement: "after" | "child"): void {
    void this.apply((graph) => {
      const occurrence = graph.occurrences[key];
      const node = occurrence && graph.nodes[occurrence.nodeId];
      if (!node) {
        throw new Error("The split node is no longer available");
      }
      const { parentNodeId, anchor } = insertionParent(graph, key, placement);
      return [...editNodeSource(node, before, graph), ...createNodeActions(graph, parentNodeId, after, anchor)];
    });
  }
  deleteEmpty(key: string): void {
    void this.schedule(async () => {
      await this.saveDrafts();
      const graph = await this.read();
      const occurrence = graph.occurrences[key];
      const node = occurrence && graph.nodes[occurrence.nodeId];
      if (!node || nodeText(node) !== "" || (graph.childOccurrences[node.nodeId]?.length ?? 0) !== 0) {
        return;
      }
      await this.write([removeAppearanceAction(graph, key)]);
      await this.read();
    });
  }
  history(direction: "undo" | "redo"): Promise<boolean> {
    return this.schedule(async () => {
      const incomplete = [...this.state.drafts].filter(([, draft]) => incompleteReference(draft.content));
      if (direction === "undo" && incomplete.length > 0) {
        this.draftRedo = new Map(incomplete);
        this.publish({ drafts: new Map([...this.state.drafts].filter(([id]) => !this.draftRedo!.has(id))) });
        return;
      }
      if (direction === "redo" && this.draftRedo !== null) {
        this.publish({ drafts: new Map([...this.state.drafts, ...this.draftRedo]) });
        this.draftRedo = null;
        return;
      }
      this.draftRedo = null;
      await this.saveDrafts();
      const history = await this.engine.query({
        kind: "history",
        workspaceId: this.workspaceId,
        channelId: this.channel,
      });
      if (history.status !== "ok") {
        throw new Error(history.error.message);
      }
      const selection = history.value[direction];
      if (selection === null) {
        return;
      }
      const result = await this.engine.execute({
        kind: direction,
        workspaceId: this.workspaceId,
        actorId: this.actorId,
        invocationId: crypto.randomUUID(),
        selection,
      });
      if (result.status === "rejected") {
        throw new Error(result.error.message);
      }
      if (result.status !== "published") {
        throw new Error("History change is not yet confirmed. Reload to check its outcome.");
      }
      await this.read();
    });
  }
  whenIdle(): Promise<unknown> {
    return this.queue;
  }
  apply(build: (graph: WorkspaceSnapshot) => readonly EditAction[]): Promise<boolean> {
    return this.schedule(async () => {
      await this.saveDrafts();
      const graph = await this.read();
      await this.write(build(graph));
      await this.read();
    });
  }
  private async saveDrafts(): Promise<void> {
    for (const nodeId of this.state.drafts.keys()) {
      const draft = this.state.drafts.get(nodeId);
      if (!draft || incompleteReference(draft.content)) {
        continue;
      }
      const latest = await this.read();
      const node = latest.nodes[nodeId];
      if (
        !node ||
        contentIdentity(node) !== contentIdentity(draft.base) ||
        JSON.stringify(latest.supertagApplications[nodeId] ?? []) !== draft.applications
      ) {
        throw new Error("This node changed in another client. Your draft is retained; resolve it before saving.");
      }
      await this.write(editNodeSource(node, draft.content, latest, draft.baseline));
      const saved = await this.read();
      const drafts = new Map(this.state.drafts);
      const current = drafts.get(nodeId);
      if (current && sameSource(current.content, draft.content)) {
        drafts.delete(nodeId);
      } else if (current && saved.nodes[nodeId]) {
        drafts.set(nodeId, {
          base: saved.nodes[nodeId],
          baseline: nodeSource(saved.nodes[nodeId], saved),
          applications: JSON.stringify(saved.supertagApplications[nodeId] ?? []),
          content: current.content,
        });
      }
      this.publish({ drafts });
    }
  }
  private async write(actions: readonly EditAction[]): Promise<void> {
    if (actions.length === 0) {
      return;
    }
    const invocationId = crypto.randomUUID();
    let result = await this.engine.execute({
      kind: "edit",
      workspaceId: this.workspaceId,
      actorId: this.actorId,
      invocationId,
      historyChannelId: this.channel,
      intent: "direct",
      actions,
    });
    if (result.status === "outcome-unknown") {
      const outcome = await this.engine.query({ kind: "invocation", workspaceId: this.workspaceId, invocationId });
      if (outcome.status === "ok" && outcome.value.status !== "absent") {
        result = outcome.value;
      }
    }
    if (result.status === "rejected") {
      throw new Error(result.error.message);
    }
    if (result.status !== "published") {
      throw new Error("Save is not yet confirmed. Your draft is retained; reload before retrying.");
    }
  }
  private async read(): Promise<WorkspaceSnapshot> {
    const graph = await readWorkspace(this.engine, this.workspaceId);
    this.publish({ graph });
    return graph;
  }
  private schedule(operation: () => Promise<void>): Promise<boolean> {
    this.publish({ pending: this.state.pending + 1 });
    const pending = this.queue
      .then(operation)
      .then(() => true)
      .catch((error: unknown) => {
        this.fail(error);
        return false;
      })
      .finally(() => this.publish({ pending: this.state.pending - 1 }));
    this.queue = pending;
    return pending;
  }
  private fail = (error: unknown): void => {
    this.publish({ error: error instanceof Error ? error.message : String(error) });
  };
  private publish(update: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
