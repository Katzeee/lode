import { END_SEQUENCE_ANCHOR, type EditAction, type EngineApplicationContract, type ProjectedNode } from "@lode/sdk";
import { nodeText, readWorkspace, replaceText, type WorkspaceSnapshot } from "./workspace-model.js";

type Draft = Readonly<{ base: ProjectedNode; text: string }>;
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
    this.schedule(async () => {
      await this.read();
    });
  };
  retry = (): void => {
    this.publish({ error: null });
    this.flush();
  };
  discardDrafts = (): void => {
    clearTimeout(this.timer);
    this.publish({ drafts: new Map(), error: null });
    this.reload();
  };
  stage(key: string, text: string): void {
    const node = this.node(key);
    if (!node) {
      return;
    }
    const drafts = new Map(this.state.drafts);
    drafts.set(node.nodeId, { base: drafts.get(node.nodeId)?.base ?? node, text });
    this.publish({ drafts });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 350);
  }
  flush = (): void => {
    clearTimeout(this.timer);
    this.schedule(() => this.saveDrafts());
  };
  create(parentKey: string | null = null, placement: "before" | "after" | "child" = "child", text = ""): void {
    this.schedule(async () => {
      await this.saveDrafts();
      const graph = await this.read();
      const occurrence = parentKey === null ? undefined : graph.occurrences[parentKey];
      if (parentKey !== null && !occurrence) {
        throw new Error("The insertion location is no longer available");
      }
      const parentNodeId = occurrence
        ? placement === "child"
          ? occurrence.nodeId
          : occurrence.parentNodeId
        : graph.rootNodeId;
      await this.write([
        {
          kind: "node-create",
          nodeId: crypto.randomUUID(),
          occurrenceId: crypto.randomUUID(),
          parentNodeId,
          anchor: {
            ...END_SEQUENCE_ANCHOR,
            before: placement === "before" ? parentKey : null,
            after: placement === "after" ? parentKey : null,
          },
          seed: { text: [{ value: text, attributes: {} }] },
        },
      ]);
      await this.read();
    });
  }
  split(key: string, before: string, after: string, placement: "after" | "child"): void {
    this.stage(key, before);
    this.flush();
    this.create(key, placement, after);
  }
  deleteEmpty(key: string): void {
    this.schedule(async () => {
      await this.saveDrafts();
      const graph = await this.read();
      const occurrence = graph.occurrences[key];
      const node = occurrence && graph.nodes[occurrence.nodeId];
      if (!node || nodeText(node) !== "" || (graph.childOccurrences[node.nodeId]?.length ?? 0) !== 0) {
        return;
      }
      await this.write([{ kind: "occurrence-delete", occurrenceId: key }]);
      await this.read();
    });
  }
  history(direction: "undo" | "redo"): void {
    this.schedule(async () => {
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
  private node(key: string): ProjectedNode | undefined {
    const graph = this.state.graph;
    const occurrence = graph?.occurrences[key];
    return occurrence ? graph?.nodes[occurrence.nodeId] : undefined;
  }
  private async saveDrafts(): Promise<void> {
    for (const nodeId of this.state.drafts.keys()) {
      const draft = this.state.drafts.get(nodeId);
      if (!draft) {
        continue;
      }
      const latest = await this.read();
      const node = latest.nodes[nodeId];
      if (!node || nodeText(node) !== nodeText(draft.base)) {
        throw new Error("This node changed in another client. Your draft is retained; resolve it before saving.");
      }
      await this.write(replaceText(node, draft.text));
      const saved = await this.read();
      const drafts = new Map(this.state.drafts);
      const current = drafts.get(nodeId);
      if (current?.text === draft.text) {
        drafts.delete(nodeId);
      } else if (current && saved.nodes[nodeId]) {
        drafts.set(nodeId, { base: saved.nodes[nodeId], text: current.text });
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
  private schedule(operation: () => Promise<void>): void {
    this.publish({ pending: this.state.pending + 1 });
    this.queue = this.queue
      .then(operation)
      .catch(this.fail)
      .finally(() => this.publish({ pending: this.state.pending - 1 }));
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
