import type { ContributionFact } from "../fact/index.js";
import type { MutableNode } from "./projection-state.js";
import type { TextAtom } from "./projection-types.js";
import { activeNodeTypes } from "./node-type-declarations.js";

export function createNodes(active: readonly ContributionFact[]): Map<string, MutableNode> {
  const created = new Map<string, MutableNode>();

  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "node-create") {
      addNode(created, mutation.nodeId, {
        content: seededTextAtoms(fact, mutation.seed?.text ?? []),
      });
    }
  }
  for (const [nodeId, nodeType] of activeNodeTypes(active)) {
    const node = created.get(nodeId);
    if (node) {
      node.nodeType = nodeType;
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
        content: [...node.content],
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
    nodeType: null,
    content: content.content ?? [],
  });
}

function seededTextAtoms(
  fact: ContributionFact,
  seeds: NonNullable<Extract<ContributionFact["body"]["mutation"], { kind: "node-create" }>["seed"]>["text"],
): TextAtom[] {
  return seeds.map((atom, index) => ({
    kind: "text",
    id: `${fact.id}#${index}`,
    value: atom.value,
    attributes: { ...atom.attributes },
    contributionId: fact.id,
  }));
}
