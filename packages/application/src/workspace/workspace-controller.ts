import { nextInsertion } from "./workspace-insertions.js";
import { workspaceContentKey, workspaceTemplateInstance } from "./workspace-content-target.js";
import type { WorkspaceContentTarget } from "./workspace-content-target.js";
import { readWorkspaceView } from "./workspace-view-query.js";
import { WorkspaceDrafts, type WorkspaceDraftState } from "./workspace-drafts.js";
import { END_SEQUENCE_ANCHOR, type EditAction, type EngineApplicationContract, type SequenceAnchor } from "@lode/sdk";
import { contentToSource, type OutlineContent } from "@lode/ui";
import { splitNodeActions, removeAppearanceAction } from "./workspace-structure.js";
import { incompleteReference } from "./node-source.js";
import { nodeText, readWorkspace, type WorkspaceSnapshot } from "./workspace-model.js";

export type WorkspaceState = WorkspaceDraftState &
  Readonly<{
    graph: WorkspaceSnapshot | null;
    pending: number;
    error: string | null;
  }>;
export class WorkspaceController {
  private state: WorkspaceState = { graph: null, drafts: new Map(), insertions: new Map(), pending: 0, error: null };
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly buffer = new WorkspaceDrafts({
    graph: () => this.state.graph,
    read: () => this.read(),
    write: (actions) => this.write(actions),
    publish: (state) => this.publish(state),
  });
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopEvents: (() => void) | undefined;
  private readonly channel = crypto.randomUUID();
  constructor(
    private readonly engine: EngineApplicationContract,
    readonly workspaceId: string,
    private readonly actorId: string,
  ) {}
  getSnapshot = (): WorkspaceState => this.state;
  viewGraph = (): WorkspaceSnapshot | null => this.buffer.view();
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
    this.buffer.discard();
    clearTimeout(this.timer);
    this.publish({ error: null });
    this.reload();
  };
  stageNode(nodeId: string, content: OutlineContent): void {
    this.stageContent({ kind: "node", nodeId }, content);
  }
  stageContent(target: WorkspaceContentTarget, content: OutlineContent): void {
    this.buffer.stage(workspaceContentKey(target), content, target);
    clearTimeout(this.timer);
    if (!incompleteReference(content)) {
      this.timer = setTimeout(() => this.flush(), 350);
    }
  }
  commitNode(nodeId: string, content: OutlineContent, reason: "blur" | "operation"): void {
    this.commitContent({ kind: "node", nodeId }, content, reason);
  }
  commitContent(target: WorkspaceContentTarget, content: OutlineContent, reason: "blur" | "operation"): void {
    const nodeId = workspaceContentKey(target);
    this.buffer.stage(nodeId, content, target);
    if (reason === "blur" && this.buffer.discardEmpty(nodeId)) {
      return;
    }
    this.flush();
  }
  prepare(parentNodeId: string, content: OutlineContent = [], anchor: SequenceAnchor = END_SEQUENCE_ANCHOR) {
    const insertion = this.buffer.begin({ kind: "children", parentNodeId }, anchor, content);
    if (contentToSource(content).length > 0) {
      this.flush();
    }
    return insertion;
  }
  prepareField(
    ownerNodeId: string,
    fieldDefinitionId: string,
    content: OutlineContent = [],
    anchor: SequenceAnchor = END_SEQUENCE_ANCHOR,
  ) {
    const insertion = this.buffer.begin({ kind: "field", ownerNodeId, fieldDefinitionId }, anchor, content);
    if (contentToSource(content).length > 0) {
      this.flush();
    }
    return insertion;
  }
  viewRows = (hostNodeId: string) => readWorkspaceView(this.engine, this.workspaceId, hostNodeId);
  flush = (): void => {
    clearTimeout(this.timer);
    const snapshot = this.buffer.snapshot();
    void this.schedule(() => this.buffer.save(snapshot));
  };
  create(
    parentKey: string | null = null,
    placement: "before" | "after" | "child" = "child",
    content: OutlineContent = [],
    target?: WorkspaceContentTarget,
  ) {
    const graph = this.viewGraph();
    if (!graph) {
      return;
    }
    if (target?.kind === "template-instance" && workspaceTemplateInstance(target, graph)?.state === "linked") {
      return this.insertTemplate(target, content, placement);
    }
    const pending = [...this.state.insertions.values()].find((item) => item.occurrenceId === parentKey);
    if (parentKey !== null) {
      this.buffer.confirm(parentKey);
    }
    const location = nextInsertion(graph, parentKey, placement, pending);
    const insertion = this.buffer.begin(location.destination, location.anchor, content, location.context);
    if (pending || contentToSource(content).length > 0) {
      this.flush();
    }
    return insertion;
  }
  private insertTemplate(
    target: Extract<WorkspaceContentTarget, { kind: "template-instance" }>,
    content: OutlineContent,
    placement: "before" | "after" | "child",
    before?: OutlineContent,
  ) {
    const insertion = this.buffer.begin(
      { kind: "template", target, placement, ...(before ? { before } : {}) },
      END_SEQUENCE_ANCHOR,
      content,
    );
    this.buffer.confirm(insertion.occurrenceId);
    this.flush();
    return insertion;
  }
  split(
    key: string,
    before: OutlineContent,
    after: OutlineContent,
    placement: "after" | "child",
    target?: WorkspaceContentTarget,
  ) {
    if (target?.kind === "template-instance") {
      return this.insertTemplate(target, after, placement, before);
    }
    const identity = { nodeId: crypto.randomUUID(), occurrenceId: crypto.randomUUID() };
    void this.apply((graph) => splitNodeActions(graph, key, before, after, placement, identity));
    return identity;
  }
  deleteEmpty(key: string): void {
    const insertion = [...this.state.insertions.values()].find((item) => item.occurrenceId === key);
    if (insertion && this.buffer.discardEmpty(insertion.nodeId)) {
      return;
    }
    void this.schedule(async () => {
      await this.buffer.save();
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
      if (this.buffer.restoreDraft(direction)) {
        return;
      }
      await this.buffer.save();
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
  whenIdle = (): Promise<unknown> => this.queue;
  discardPlaceholder = (nodeId: string): boolean => this.buffer.discardEmpty(nodeId);
  apply(
    build: (graph: WorkspaceSnapshot) => readonly EditAction[],
    updates?: ReadonlyMap<string, OutlineContent>,
    materialize: readonly string[] = [],
  ): Promise<boolean> {
    for (const occurrenceId of materialize) {
      this.buffer.confirm(occurrenceId);
    }
    const snapshot = this.buffer.snapshot();
    return this.schedule(async () => {
      await this.buffer.save(snapshot);
      const graph = await this.read();
      await this.write(build(graph));
      const saved = await this.read();
      if (updates) {
        this.buffer.acceptContent(updates, saved);
      }
    });
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
