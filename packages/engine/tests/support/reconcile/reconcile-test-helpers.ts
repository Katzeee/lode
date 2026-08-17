import {
  frontierOf,
  makeFact,
  type Fact,
  type FactBody,
  type FactSnapshot,
  type Mutation,
  type SequenceAnchor,
  factTransactionId,
  workspaceGenesisMutations,
  workspaceTrashNodeId,
  workspaceTrashOccurrenceId,
} from "../../../src/domain/fact/index.js";
import { withFieldDefinitionEndpoints, withInitialOwnerRelations } from "./placed-node-test-helpers.js";
import { fixtureConsequences, fixturePrerequisites } from "./reconcile-test-mutations.js";
import { CURRENT_PROJECTION_VERSIONS, occurrenceAnchor } from "../../../src/domain/reconcile/index.js";
import { projectSnapshot } from "./projection.js";
import {
  supertagApplicationIdentity,
  supertagApplicationMutations,
  supertagRemovalMutations,
} from "./supertag-application-test-helpers.js";

export const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
export const versions = CURRENT_PROJECTION_VERSIONS;
export const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

export class Facts {
  readonly values: Fact[] = [];

  constructor(trashNodeId = workspaceTrashNodeId("workspace")) {
    const defaultTrashNodeId = workspaceTrashNodeId("workspace");
    this.addTransaction(
      workspaceGenesisMutations("workspace").map((mutation): Mutation => {
        if (mutation.kind === "node-create" && mutation.nodeId === defaultTrashNodeId) {
          return { ...mutation, nodeId: trashNodeId };
        }
        if (
          mutation.kind === "occurrence-create" &&
          mutation.occurrenceId === workspaceTrashOccurrenceId("workspace")
        ) {
          return { ...mutation, nodeId: trashNodeId };
        }
        if (mutation.kind === "node-owner-set" && mutation.nodeId === defaultTrashNodeId) {
          return { ...mutation, nodeId: trashNodeId };
        }
        return mutation;
      }),
    );
  }

  add(mutation: Mutation, intent: "direct" | "proposal" = "direct"): Fact {
    if (mutation.kind === "node-delete") {
      return this.deleteNode(mutation.nodeId, intent);
    }
    if (mutation.kind === "node-restore") {
      return this.restoreNode(mutation, intent);
    }
    const prerequisites = fixturePrerequisites(mutation);
    const fact = this.addTransaction([...prerequisites, mutation, ...fixtureConsequences(mutation)], intent)[
      prerequisites.length
    ];
    if (!fact) {
      throw new Error("Fixture transaction did not contain its requested mutation");
    }
    return fact;
  }

  private deleteNode(nodeId: string, intent: "direct" | "proposal"): Fact {
    const projection = projectSnapshot(
      "workspace",
      this.snapshot(),
      intent === "proposal" ? "review" : "origin",
      versions,
    );
    const ownerNodeId = projection.nodeOwners[nodeId];
    const trashNodeId = projection.workspaceSystemNodes.trash;
    const occurrence = Object.values(projection.occurrences).find(
      (candidate) => candidate.nodeId === nodeId && candidate.parentNodeId === ownerNodeId,
    );
    if (!ownerNodeId || !trashNodeId || !occurrence) {
      throw new Error("Fixture Node deletion has no owning structure");
    }
    const facts = this.addTransaction(
      [
        { kind: "node-delete", nodeId },
        { kind: "node-owner-set", nodeId, ownerNodeId: trashNodeId, previousOwnerNodeId: ownerNodeId },
        {
          kind: "occurrence-move",
          occurrenceId: occurrence.occurrenceId,
          parentNodeId: trashNodeId,
          anchor: end,
          previousParentNodeId: occurrence.parentNodeId,
          previousAnchor: occurrenceAnchor(projection, occurrence.occurrenceId),
        },
      ],
      intent,
    );
    const deletion = facts[0];
    if (!deletion) {
      throw new Error("Fixture Node deletion transaction is empty");
    }
    return deletion;
  }

  private restoreNode(mutation: Extract<Mutation, { kind: "node-restore" }>, intent: "direct" | "proposal"): Fact {
    const deletion = this.values.find((fact) => fact.id === mutation.deletionFactId);
    const transactionId = deletion?.transaction.transactionId;
    const members = this.values.filter((fact) => fact.transaction.transactionId === transactionId);
    const ownerChange = members.find(
      (fact) => fact.body.kind === "contribution" && fact.body.mutation.kind === "node-owner-set",
    );
    const placementChange = members.find(
      (fact) => fact.body.kind === "contribution" && fact.body.mutation.kind === "occurrence-move",
    );
    if (
      ownerChange?.body.kind !== "contribution" ||
      ownerChange.body.mutation.kind !== "node-owner-set" ||
      !ownerChange.body.mutation.previousOwnerNodeId ||
      placementChange?.body.kind !== "contribution" ||
      placementChange.body.mutation.kind !== "occurrence-move" ||
      !placementChange.body.mutation.previousParentNodeId ||
      !placementChange.body.mutation.previousAnchor
    ) {
      throw new Error("Fixture Node restore has no explicit destination context");
    }
    const facts = this.addTransaction(
      [
        mutation,
        {
          kind: "node-owner-set",
          nodeId: mutation.nodeId,
          ownerNodeId: ownerChange.body.mutation.previousOwnerNodeId,
          previousOwnerNodeId: ownerChange.body.mutation.ownerNodeId,
        },
        {
          kind: "occurrence-move",
          occurrenceId: placementChange.body.mutation.occurrenceId,
          parentNodeId: placementChange.body.mutation.previousParentNodeId,
          anchor: placementChange.body.mutation.previousAnchor,
          previousParentNodeId: placementChange.body.mutation.parentNodeId,
          previousAnchor: placementChange.body.mutation.anchor,
        },
      ],
      intent,
    );
    const restore = facts[0];
    if (!restore) {
      throw new Error("Fixture Node restore transaction is empty");
    }
    return restore;
  }

  applySupertag(
    hostNodeId: string,
    supertagId: string,
    intent: "direct" | "proposal" = "direct",
    anchor: SequenceAnchor = end,
  ): Fact {
    const ordinal =
      this.values.filter(
        (fact) =>
          fact.body.kind === "contribution" &&
          fact.body.mutation.kind === "supertag-apply" &&
          fact.body.mutation.hostNodeId === hostNodeId &&
          fact.body.mutation.supertagId === supertagId,
      ).length + 1;
    const identity = supertagApplicationIdentity(hostNodeId, supertagId, ordinal);
    const metanodeExists = this.values.some(
      (fact) =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "metanode-attach" &&
        fact.body.mutation.hostNodeId === hostNodeId,
    );
    const mutations = supertagApplicationMutations(identity, anchor, !metanodeExists);
    const facts = this.addTransaction(mutations, intent);
    const application = facts.find(
      (fact) => fact.body.kind === "contribution" && fact.body.mutation.kind === "supertag-apply",
    );
    if (!application) {
      throw new Error("Fixture Supertag Application transaction has no application Fact");
    }
    return application;
  }

  removeSupertag(hostNodeId: string, supertagId: string, intent: "direct" | "proposal" = "direct"): Fact {
    const application = [...this.values]
      .reverse()
      .find(
        (fact) =>
          fact.body.kind === "contribution" &&
          fact.body.mutation.kind === "supertag-apply" &&
          fact.body.mutation.hostNodeId === hostNodeId &&
          fact.body.mutation.supertagId === supertagId,
      );
    if (
      !application ||
      application.body.kind !== "contribution" ||
      application.body.mutation.kind !== "supertag-apply"
    ) {
      throw new Error("Fixture Supertag Application is absent");
    }
    const mutation = application.body.mutation;
    const identity = {
      hostNodeId,
      supertagId,
      metanodeId: `${hostNodeId}-metanode`,
      applicationNodeId: mutation.applicationNodeId,
      applicationOccurrenceId: mutation.applicationOccurrenceId,
      relationDefinitionOccurrenceId: mutation.relationDefinitionOccurrenceId,
      definitionOccurrenceId: mutation.definitionOccurrenceId,
    };
    const facts = this.addTransaction(supertagRemovalMutations(identity), intent);
    const removal = facts.find(
      (fact) => fact.body.kind === "contribution" && fact.body.mutation.kind === "supertag-remove",
    );
    if (!removal) {
      throw new Error("Fixture Supertag removal transaction has no removal Fact");
    }
    return removal;
  }

  addTransaction(mutations: readonly Mutation[], intent: "direct" | "proposal" = "direct"): readonly Fact[] {
    return this.bodies(
      withFieldDefinitionEndpoints(withInitialOwnerRelations(mutations)).map((mutation) => ({
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
      withInitialOwnerRelations([
        { kind: "node-create", nodeId },
        { kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor: end },
      ]),
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
    withInitialOwnerRelations([
      { kind: "node-create", nodeId: "node" },
      {
        kind: "occurrence-create",
        occurrenceId: "occurrence",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
    ]),
    intent,
  );
  return facts;
}
