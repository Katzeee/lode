import {
  frontierOf,
  makeFact,
  type Fact,
  type FactBody,
  type FactSnapshot,
  type Mutation,
} from "../fact/index.js";

export const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
export const versions = {
  rulesVersion: "proposal-rules-1",
  schemaVersion: "lode-schema-12",
} as const;
export const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

export class Facts {
  readonly values: Fact[] = [];

  add(mutation: Mutation, intent: "direct" | "proposal" = "direct"): Fact {
    return this.body({ kind: "contribution", actorId: "actor", intent, mutation });
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
    const sequence = this.values.length + 1;
    const fact = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence,
      observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
      lamport: sequence,
      body,
    });
    this.values.push(fact);
    return fact;
  }
}

export function base(intent: "direct" | "proposal" = "direct"): Facts {
  const facts = new Facts();
  facts.add({ kind: "node-create", nodeId: "node" }, intent);
  facts.add(
    {
      kind: "occurrence-create",
      occurrenceId: "occurrence",
      nodeId: "node",
      parentOccurrenceId: null,
      parentPolicy: "cascade",
      anchor: end,
    },
    intent,
  );
  return facts;
}

export function fullSurface(intent: "direct" | "proposal"): Facts {
  const facts = base(intent);
  facts.add({ kind: "node-create", nodeId: "schema" }, intent);
  facts.add({ kind: "node-create", nodeId: "field" }, intent);
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
      owner: { kind: "node", id: "node" },
      namespace: "property",
      key: "color",
      value: "blue",
      previous: { kind: "unset" },
    },
    intent,
  );
  facts.add(
    { kind: "schema-field-add", schemaId: "schema", fieldDefinitionId: "field", anchor: end },
    intent,
  );
  facts.add({ kind: "schema-apply", nodeId: "node", schemaId: "schema", anchor: end }, intent);
  facts.add(
    {
      kind: "value-set",
      owner: { kind: "field", id: "field" },
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
      parentOccurrenceId: null,
      parentPolicy: "cascade",
      anchor: end,
    },
    intent,
  );
  facts.add(
    {
      kind: "occurrence-move",
      occurrenceId: "reference",
      parentOccurrenceId: "occurrence",
      anchor: end,
      previousParentOccurrenceId: null,
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
      kind: "canonical-occurrence-set",
      nodeId: "node",
      occurrenceId: "reference",
      previousOccurrenceId: "occurrence",
    },
    intent,
  );
}
