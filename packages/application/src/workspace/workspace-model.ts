import {
  END_SEQUENCE_ANCHOR,
  type EngineApplicationContract,
  type NodeGraph,
  type ProjectedNode,
  type ProjectionPage,
  type ProjectionPageSection,
  type ProjectionSections,
  type TextAtom,
  type EditAction,
} from "@lode/sdk";

export type WorkspaceSnapshot = NodeGraph &
  Readonly<{ rootNodeId: string; generationId: string; systemNodeIds: readonly string[] }>;
export async function readWorkspace(
  engine: EngineApplicationContract,
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let generation: string | undefined;
    let changed = false;
    let rootNodeId = workspaceId;
    const read = async <Section extends ProjectionPageSection>(
      section: Section,
    ): Promise<ProjectionSections[Section]> => {
      const value: Record<string, unknown> = {};
      let after: string | undefined;
      do {
        const result = await engine.query({
          kind: "projection",
          workspaceId,
          perspective: "origin",
          section,
          after,
          limit: 100,
        });
        if (result.status !== "ok") {
          throw new Error(result.error.message);
        }
        const page = result.value as ProjectionPage<Section>;
        const identity = page.identity;
        rootNodeId = identity.workspaceNodeId;
        if (generation !== undefined && generation !== identity.generationId) {
          changed = true;
        }
        generation ??= identity.generationId;
        Object.assign(value, (page as unknown as Record<string, unknown>)[section]);
        after = page.next ?? undefined;
      } while (after !== undefined);
      return value as ProjectionSections[Section];
    };
    const nodes = await read("nodes");
    const occurrences = await read("occurrences");
    const childOccurrences = await read("childOccurrences");
    const nodeOwners = await read("nodeOwners");
    const systemNodes = await read("workspaceSystemNodes");
    if (!changed && generation !== undefined) {
      return {
        nodes,
        occurrences,
        childOccurrences,
        nodeOwners,
        metanodes: {},
        rootNodeId,
        generationId: generation,
        systemNodeIds: Object.values(systemNodes).filter((id): id is string => id !== undefined),
      };
    }
  }
  throw new Error("The workspace changed while loading. Please retry.");
}
export function nodeText(node: ProjectedNode): string {
  return node.content.map((atom) => (atom.kind === "text" ? atom.value : `@{${atom.targetNodeId}}`)).join("");
}
export function canEditNode(node: ProjectedNode): boolean {
  return (
    node.intrinsicNodeType === null &&
    node.content.every((atom) => atom.kind === "text" && Object.keys(atom.attributes).length === 0)
  );
}
export function replaceText(node: ProjectedNode, text: string): readonly EditAction[] {
  if (!canEditNode(node)) {
    throw new Error("This content needs a structured editor");
  }
  const atoms = node.content.filter((atom): atom is TextAtom => atom.kind === "text");
  const next = Array.from(text);
  let start = 0;
  while (start < atoms.length && start < next.length && atoms[start]?.value === next[start]) {
    start += 1;
  }
  let end = atoms.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && atoms[end - 1]?.value === next[nextEnd - 1]) {
    end -= 1;
    nextEnd -= 1;
  }
  if (start === end && start === nextEnd) {
    return [];
  }
  return [
    {
      kind: "rich-text-splice",
      nodeId: node.nodeId,
      deleteAtomIds: atoms.slice(start, end).map((atom) => atom.id),
      anchor: { ...END_SEQUENCE_ANCHOR, after: atoms[start - 1]?.id ?? null, before: atoms[end]?.id ?? null },
      insert: next.slice(start, nextEnd).join(""),
    },
  ];
}
