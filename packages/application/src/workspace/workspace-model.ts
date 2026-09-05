import {
  type EngineApplicationContract,
  type NodeGraph,
  type SupertagProjection,
  type WorkspaceSystemNodeProjection,
  type FieldProjection,
  type ProjectedNode,
  type ProjectionPage,
  type ProjectionPageSection,
  type ProjectionSections,
} from "@lode/sdk";

export type WorkspaceSnapshot = Pick<NodeGraph, "nodes" | "occurrences" | "childOccurrences" | "nodeOwners"> &
  WorkspaceSystemNodeProjection &
  Pick<SupertagProjection, "supertagApplications" | "templateNodeInstances"> &
  Pick<FieldProjection, "materializedFields"> &
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
      const value = Object.create(null) as Record<string, unknown>;
      const array: unknown[] = [];
      let arraySection = false;
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
        const payload = (page as unknown as Record<string, unknown>)[section];
        if (Array.isArray(payload)) {
          arraySection = true;
          array.push(...(payload as unknown[]));
        } else {
          Object.assign(value, payload);
        }
        after = page.next ?? undefined;
      } while (after !== undefined);
      return (arraySection ? array : value) as ProjectionSections[Section];
    };
    const nodes = await read("nodes");
    const occurrences = await read("occurrences");
    const childOccurrences = await read("childOccurrences");
    const nodeOwners = await read("nodeOwners");
    const systemNodes = await read("workspaceSystemNodes");
    const supertagApplications = await read("supertagApplications");
    const materializedFields = await read("materializedFields");
    const templateNodeInstances = await read("templateNodeInstances");
    if (!changed && generation !== undefined) {
      return {
        nodes,
        workspaceSystemNodes: systemNodes,
        supertagApplications,
        materializedFields,
        templateNodeInstances,
        occurrences,
        childOccurrences,
        nodeOwners,
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
