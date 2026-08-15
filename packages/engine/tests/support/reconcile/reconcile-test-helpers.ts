import {
  frontierOf,
  makeFact,
  type Fact,
  type FactBody,
  type FactSnapshot,
  type Mutation,
  factTransactionId,
} from "../../../src/domain/fact/index.js";
import { addPlacedNode } from "./placed-node-test-helpers.js";
import { fixtureConsequences, fixturePrerequisites } from "./reconcile-test-mutations.js";

export const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
export const versions = {
  rulesVersion: "proposal-rules-5",
  schemaVersion: "lode-schema-19",
} as const;
export const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

export class Facts {
  readonly values: Fact[] = [];

  constructor() {
    this.body({
      kind: "contribution",
      actorId: "actor",
      intent: "direct",
      mutation: { kind: "node-create", nodeId: "workspace" },
    });
  }

  add(mutation: Mutation, intent: "direct" | "proposal" = "direct"): Fact {
    const prerequisites = fixturePrerequisites(mutation);
    const fact = this.addTransaction([...prerequisites, mutation, ...fixtureConsequences(mutation)], intent)[
      prerequisites.length
    ];
    if (!fact) {
      throw new Error("Fixture transaction did not contain its requested mutation");
    }
    return fact;
  }

  addTransaction(mutations: readonly Mutation[], intent: "direct" | "proposal" = "direct"): readonly Fact[] {
    return this.bodies(
      mutations.map((mutation) => ({
        kind: "contribution" as const,
        actorId: "actor",
        intent,
        mutation,
      })),
    );
  }

  addPlaced(
    nodeId: string,
    parentNodeId = "workspace",
    occurrenceId = `${nodeId}-original`,
    intent: "direct" | "proposal" = "direct",
  ): readonly Fact[] {
    return this.addTransaction(
      [
        { kind: "node-create", nodeId },
        { kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor: end },
      ],
      intent,
    );
  }

  resolve(targets: readonly string[], decision: "accept" | "reject"): Fact {
    return this.body({
      kind: "resolution",
      adjudicatesResolutionIds: [],
      actorId: "reviewer",
      decision,
      proposalContributionIds: targets,
    });
  }

  snapshot(): FactSnapshot {
    return { facts: [...this.values], frontier: frontierOf(this.values) };
  }

  private body(body: FactBody): Fact {
    const fact = this.bodies([body])[0];
    if (!fact) {
      throw new Error("Fixture Fact body was not created");
    }
    return fact;
  }

  private bodies(bodies: readonly FactBody[]): readonly Fact[] {
    const firstSequence = this.values.length + 1;
    const transactionId = factTransactionId("workspace", REPLICA, firstSequence);
    const facts = bodies.map((body, index) => {
      const sequence = firstSequence + index;
      return makeFact({
        workspaceId: "workspace",
        replicaId: REPLICA,
        sequence,
        observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
        lamport: sequence,
        transaction: { transactionId, index, size: bodies.length },
        body,
      });
    });
    this.values.push(...facts);
    return facts;
  }
}

export function base(intent: "direct" | "proposal" = "direct"): Facts {
  const facts = new Facts();
  facts.addTransaction(
    [
      { kind: "node-create", nodeId: "node" },
      {
        kind: "occurrence-create",
        occurrenceId: "occurrence",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
    ],
    intent,
  );
  return facts;
}

export function fullSurface(intent: "direct" | "proposal"): Facts {
  const facts = base(intent);
  addPlacedNode(facts, "reference-parent", intent);
  addPlacedNode(facts, "moved-parent", intent);
  addPlacedNode(facts, "schema", intent);
  addPlacedNode(facts, "field", intent);
  facts.add({ kind: "node-type-declare", nodeId: "schema", nodeType: "schema" }, intent);
  facts.add({ kind: "node-type-declare", nodeId: "field", nodeType: "field-definition" }, intent);
  const splice = facts.add(
    {
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "AB",
    },
    intent,
  );
  facts.add(
    {
      kind: "text-mark",
      nodeId: "node",
      atomIds: [`${splice.id}#0`],
      key: "bold",
      value: { kind: "set", value: true },
      previous: { kind: "unset" },
    },
    intent,
  );
  facts.add(
    {
      kind: "value-set",
      target: { kind: "node", id: "node" },
      namespace: "property",
      key: "color",
      value: "blue",
      previous: { kind: "unset" },
    },
    intent,
  );
  facts.add(
    {
      kind: "schema-field-add",
      schemaId: "schema",
      fieldDefinitionId: "field",
      fieldNodeId: "schema-field-template-field",
      fieldOccurrenceId: "schema-field-template-field-occurrence",
      anchor: end,
    },
    intent,
  );
  facts.add({ kind: "schema-apply", nodeId: "node", schemaId: "schema", anchor: end }, intent);
  facts.add(
    {
      kind: "value-set",
      target: { kind: "node", id: "field" },
      namespace: "metadata",
      key: "label",
      value: "Field",
      previous: { kind: "unset" },
    },
    intent,
  );
  facts.add(
    {
      kind: "occurrence-create",
      occurrenceId: "reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    },
    intent,
  );
  facts.add(
    {
      kind: "occurrence-move",
      occurrenceId: "reference",
      parentNodeId: "moved-parent",
      anchor: end,
      previousParentNodeId: "reference-parent",
      previousAnchor: end,
    },
    intent,
  );
  addCanonical(facts, intent);
  return facts;
}

function addCanonical(facts: Facts, intent: "direct" | "proposal"): void {
  facts.add(
    {
      kind: "node-owner-set",
      nodeId: "node",
      ownerNodeId: "moved-parent",
      previousOwnerNodeId: "workspace",
    },
    intent,
  );
}
