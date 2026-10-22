import { projectInsertions, insertionActions, type Insertion } from "./workspace-insertions.js";
import {
  workspaceContentNode,
  writeWorkspaceContent,
  type WorkspaceContentTarget,
} from "./workspace-content-target.js";
import type { EditAction, ProjectedNode, SequenceAnchor } from "@lode/sdk";
import { contentToSource, type OutlineContent } from "@lode/ui";
import { contentIdentity, incompleteReference, nodeSource, sameSource, resolveSource } from "./node-source.js";
import { rebaseTemplateSource } from "./workspace-template-content.js";
import type { WorkspaceSnapshot } from "./workspace-model.js";

type Draft = Readonly<{
  target: WorkspaceContentTarget;
  base: ProjectedNode;
  content: OutlineContent;
  baseline: OutlineContent;
  applications: string;
}>;
export type WorkspaceDraftState = Readonly<{
  drafts: ReadonlyMap<string, Draft>;
  insertions: ReadonlyMap<string, Insertion>;
}>;
type Host = Readonly<{
  graph(): WorkspaceSnapshot | null;
  read(): Promise<WorkspaceSnapshot>;
  write(actions: readonly EditAction[]): Promise<void>;
  publish(state: WorkspaceDraftState): void;
}>;

/** Editing can allocate an appearance before it publishes any Node facts. */
export class WorkspaceDrafts {
  private state: WorkspaceDraftState = { drafts: new Map(), insertions: new Map() };
  private redo: ReadonlyMap<string, Draft> | null = null;
  constructor(private readonly host: Host) {}
  view(): WorkspaceSnapshot | null {
    const graph = this.host.graph();
    if (!graph || this.state.insertions.size === 0) {
      return graph;
    }
    return projectInsertions(graph, this.state.insertions);
  }
  begin(
    destination: Insertion["destination"],
    anchor: SequenceAnchor,
    content: OutlineContent = [],
    context?: Insertion["context"],
  ) {
    if (
      destination.kind === "template" &&
      (destination.placement === "child" || destination.target.sourcePath.length > 0)
    ) {
      context = {
        ...destination.target,
        sourcePath:
          destination.placement === "child"
            ? destination.target.sourcePath
            : destination.target.sourcePath.slice(0, -1),
      };
    }
    const insertion = {
      nodeId: crypto.randomUUID(),
      occurrenceId: crypto.randomUUID(),
      destination,
      anchor,
      confirmed: false,
      ...(context ? { context } : {}),
    };
    this.update({ insertions: new Map(this.state.insertions).set(insertion.nodeId, insertion) });
    if (contentToSource(content).length > 0) {
      this.stage(insertion.nodeId, content);
    }
    return insertion;
  }
  confirm(occurrenceId?: string | null) {
    this.update({
      insertions: new Map(
        [...this.state.insertions].map(([id, item]) => [
          id,
          !occurrenceId || item.occurrenceId === occurrenceId ? { ...item, confirmed: true } : item,
        ]),
      ),
    });
  }
  discardEmpty(nodeId: string): boolean {
    const insertion = this.state.insertions.get(nodeId);
    if (!insertion || insertion.confirmed || contentToSource(this.state.drafts.get(nodeId)?.content ?? []).length > 0) {
      return false;
    }
    const insertions = new Map(this.state.insertions),
      drafts = new Map(this.state.drafts);
    insertions.delete(nodeId);
    drafts.delete(nodeId);
    this.update({ insertions, drafts });
    return true;
  }
  discard() {
    this.redo = null;
    this.update({ drafts: new Map(), insertions: new Map() });
  }
  stage(nodeId: string, content: OutlineContent, target: WorkspaceContentTarget = { kind: "node", nodeId }) {
    this.redo = null;
    const graph = this.view(),
      node = graph && workspaceContentNode(target, graph);
    if (!graph || !node) {
      return;
    }
    content = rebaseTemplateSource(content, node, graph);
    if (!this.state.drafts.has(nodeId) && sameSource(content, nodeSource(node, graph))) {
      return;
    }
    const insertion = this.state.insertions.get(nodeId);
    if (insertion && !insertion.confirmed && contentToSource(content).length === 0) {
      const drafts = new Map(this.state.drafts);
      drafts.delete(nodeId);
      this.update({ drafts });
      return;
    }
    const previous = this.state.drafts.get(nodeId);
    this.update({
      drafts: new Map(this.state.drafts).set(nodeId, {
        target,
        base: previous?.base ?? node,
        baseline: previous?.baseline ?? nodeSource(node, graph),
        applications: previous?.applications ?? JSON.stringify(graph.supertagApplications[node.nodeId] ?? []),
        content,
      }),
    });
  }
  restoreDraft(direction: "undo" | "redo"): boolean {
    const incomplete = [...this.state.drafts].filter(([, draft]) => incompleteReference(draft.content));
    if (direction === "undo" && incomplete.length > 0) {
      this.redo = new Map(incomplete);
      this.update({ drafts: new Map([...this.state.drafts].filter(([id]) => !this.redo!.has(id))) });
      return true;
    }
    if (direction === "redo" && this.redo !== null) {
      this.update({ drafts: new Map([...this.state.drafts, ...this.redo]) });
      this.redo = null;
      return true;
    }
    this.redo = null;
    return false;
  }
  snapshot(): WorkspaceDraftState {
    return this.state;
  }
  acceptContent(updates: ReadonlyMap<string, OutlineContent>, graph: WorkspaceSnapshot): void {
    for (const [nodeId, content] of updates) {
      const node = graph.nodes[nodeId];
      if (node && sameSource(nodeSource(node, graph), content)) {
        const keys = [...this.state.drafts]
          .filter(([, draft]) => workspaceContentNode(draft.target, graph)?.nodeId === nodeId)
          .map(([key]) => key);
        for (const key of keys) {
          this.saved(key, content, graph);
        }
      }
    }
  }
  async save(snapshot = this.state): Promise<void> {
    for (const [nodeId, insertion] of snapshot.insertions) {
      if (!this.state.insertions.has(nodeId)) {
        continue;
      }
      const content = snapshot.drafts.get(nodeId)?.content ?? [];
      if ((!insertion.confirmed && contentToSource(content).length === 0) || incompleteReference(content)) {
        continue;
      }
      const graph = await this.host.read();
      await this.host.write(insertionActions(insertion, content, graph));
      const saved = await this.host.read();
      if (insertion.destination.kind === "template") {
        for (const [key, draft] of this.state.drafts) {
          if (draft.target.kind !== "template-instance") {
            continue;
          }
          const destination = insertion.destination;
          if (
            draft.target.ownerNodeId === destination.target.ownerNodeId &&
            draft.target.templateNodeId === destination.target.templateNodeId &&
            workspaceContentNode(draft.target, saved)?.nodeId !== draft.base.nodeId
          ) {
            this.saved(key, nodeSource(workspaceContentNode(draft.target, saved)!, saved), saved);
          }
        }
      }
      const insertions = new Map(this.state.insertions);
      insertions.delete(nodeId);
      this.update({ insertions });
      this.saved(nodeId, content, saved);
    }
    for (const [nodeId, captured] of snapshot.drafts) {
      if (this.state.insertions.has(nodeId)) {
        continue;
      }
      const draft = this.state.drafts.get(nodeId);
      if (!draft || incompleteReference(captured.content)) {
        continue;
      }
      const graph = await this.host.read(),
        node = workspaceContentNode(captured.target, graph);
      if (
        !node ||
        contentIdentity(node) !== contentIdentity(draft.base) ||
        JSON.stringify(node ? (graph.supertagApplications[node.nodeId] ?? []) : []) !== draft.applications
      ) {
        throw new Error("This node changed in another client. Your draft is retained; resolve it before saving.");
      }
      await this.host.write(writeWorkspaceContent(captured.target, node, captured.content, graph, draft.baseline));
      this.saved(nodeId, captured.content, await this.host.read());
    }
  }
  private saved(nodeId: string, content: OutlineContent, graph: WorkspaceSnapshot) {
    const drafts = new Map(this.state.drafts),
      current = drafts.get(nodeId);
    const node = current && workspaceContentNode(current.target, graph);
    if (current && sameSource(current.content, content)) {
      drafts.delete(nodeId);
    } else if (current && node) {
      drafts.set(nodeId, {
        target: current.target,
        base: node,
        baseline: nodeSource(node, graph),
        applications: JSON.stringify(graph.supertagApplications[node.nodeId] ?? []),
        content:
          current.target.kind === "template-instance" && current.base.nodeId !== node.nodeId
            ? rebaseTemplateSource(resolveSource(current.content, current.base, graph, current.baseline), node, graph)
            : current.content,
      });
    }
    this.update({ drafts });
  }
  private update(update: Partial<WorkspaceDraftState>) {
    this.state = { ...this.state, ...update };
    this.host.publish(this.state);
  }
}
