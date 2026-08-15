import type { ContributionFact } from "../fact/index.js";
import type { MutableNode } from "./projection-state.js";
import type { TextAtom } from "./projection-types.js";

export function createNodes(active: readonly ContributionFact[]): Map<string, MutableNode> {
  const created = new Map<string, MutableNode>();
  const deletionFactIds = new Map<string, string[]>();
  const restoredDeletionIds = new Set<string>();

  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "node-create") {
      addNode(created, mutation.nodeId, {
        text: seededTextAtoms(fact, mutation.seed?.text ?? []),
        properties: { ...(mutation.seed?.properties ?? {}) },
        metadata: { ...(mutation.seed?.metadata ?? {}) },
      });
    } else if (mutation.kind === "node-delete") {
      const deletions = deletionFactIds.get(mutation.nodeId) ?? [];
      deletions.push(fact.id);
      deletionFactIds.set(mutation.nodeId, deletions);
    } else if (mutation.kind === "node-restore") {
      restoredDeletionIds.add(mutation.deletionFactId);
    }
  }

  for (const [nodeId, deletionIds] of deletionFactIds) {
    if (deletionIds.some((id) => !restoredDeletionIds.has(id))) {
      created.delete(nodeId);
    }
  }
  return created;
}

export function cloneNodes(nodes: ReadonlyMap<string, MutableNode>): Map<string, MutableNode> {
  return new Map(
    [...nodes].map(([nodeId, node]) => [
      nodeId,
      {
        ...node,
        text: [...node.text],
        properties: { ...node.properties },
        metadata: { ...node.metadata },
      },
    ]),
  );
}

function addNode(
  created: Map<string, MutableNode>,
  nodeId: string,
  content: Partial<Omit<MutableNode, "nodeId">> = {},
): void {
  if (created.has(nodeId)) {
    return;
  }
  created.set(nodeId, {
    nodeId,
    text: content.text ?? [],
    properties: content.properties ?? {},
    metadata: content.metadata ?? {},
  });
}

function seededTextAtoms(
  fact: ContributionFact,
  seeds: NonNullable<Extract<ContributionFact["body"]["mutation"], { kind: "node-create" }>["seed"]>["text"],
): TextAtom[] {
  return seeds.map((atom, index) => ({
    id: `${fact.id}#${index}`,
    value: atom.value,
    attributes: { ...atom.attributes },
    contributionId: fact.id,
  }));
}
