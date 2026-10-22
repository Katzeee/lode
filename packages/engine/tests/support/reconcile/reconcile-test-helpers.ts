import {
  END_SEQUENCE_ANCHOR,
  factActionsFromFacts,
  factActions,
  graphActionBody,
  makeFact,
  owningFactIds,
  type Fact,
  type FactAction,
  type FactActionId,
  type FactBody,
  type FactSnapshot,
  type GraphAction,
  type SequenceAnchor,
  workspaceGenesisActions,
  workspaceTrashNodeId,
} from "../../../src/domain/fact/index.js";
import { frontierOf } from "../../../src/domain/fact/frontier.js";
import { withFieldDefinitionEndpoints, withInitialNodeRelations } from "./placed-node-test-helpers.js";
import { fixtureConsequences, fixturePrerequisites } from "./reconcile-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS } from "../../../src/domain/reconcile/index.js";
import { supertagApplicationActions, supertagRemovalActions } from "./supertag-application-test-helpers.js";

export const REPLICA = "101";
export const versions = CURRENT_PROJECTION_VERSIONS;
export const end = END_SEQUENCE_ANCHOR;

export class Facts {
  readonly values: Fact[] = [];

  constructor(trashNodeId = workspaceTrashNodeId("workspace")) {
    const defaultTrashNodeId = workspaceTrashNodeId("workspace");
    this.addTransaction(
      workspaceGenesisActions("workspace").map((authoredAction): GraphAction => {
        if (authoredAction.kind === "node-create" && authoredAction.nodeId === defaultTrashNodeId) {
          return { ...authoredAction, nodeId: trashNodeId };
        }
        return authoredAction;
      }),
    );
  }

  add(authoredAction: GraphAction, intent: "direct" | "proposal" = "direct"): FactAction {
    const prerequisites = fixturePrerequisites(authoredAction);
    const fact = this.addTransaction(
      [...prerequisites, authoredAction, ...fixtureConsequences(authoredAction)],
      intent,
    )[prerequisites.length];
    if (!fact) {
      throw new Error("Fixture transaction did not contain its requested action");
    }
    return fact;
  }

  applySupertag(
    hostNodeId: string,
    supertagId: string,
    intent: "direct" | "proposal" = "direct",
    anchor: SequenceAnchor = end,
  ): FactAction {
    const applicationActions = supertagApplicationActions(hostNodeId, supertagId, anchor);
    const facts = this.addTransaction(applicationActions, intent);
    const application = facts.find((fact) => fact.action.kind === "supertag-application-add");
    if (!application) {
      throw new Error("Fixture Supertag Application transaction has no application Fact");
    }
    return application;
  }

  removeSupertag(hostNodeId: string, supertagId: string, intent: "direct" | "proposal" = "direct"): FactAction {
    const application = [...factActionsFromFacts(this.values)]
      .reverse()
      .find(
        (fact) =>
          fact.action.kind === "supertag-application-add" &&
          fact.action.hostNodeId === hostNodeId &&
          fact.action.supertagId === supertagId,
      );
    if (!application || application.action.kind !== "supertag-application-add") {
      throw new Error("Fixture Supertag Application is absent");
    }
    const facts = this.addTransaction(supertagRemovalActions(hostNodeId, supertagId), intent);
    const removal = facts.find((fact) => fact.action.kind === "supertag-membership-remove");
    if (!removal) {
      throw new Error("Fixture Supertag removal transaction has no removal Fact");
    }
    return removal;
  }

  addTransaction(actions: readonly GraphAction[], intent: "direct" | "proposal" = "direct"): readonly FactAction[] {
    const preparedActions = withFieldDefinitionEndpoints(withInitialNodeRelations(actions));
    const [first, ...rest] = preparedActions;
    if (!first) {
      return [];
    }
    return factActions(this.body(graphActionBody("actor", intent, [first, ...rest])));
  }

  addPlaced(
    nodeId: string,
    parentNodeId = "workspace",
    occurrenceId = `${nodeId}-original`,
    intent: "direct" | "proposal" = "direct",
  ): readonly FactAction[] {
    return this.addTransaction(
      withInitialNodeRelations([
        { kind: "node-create", nodeId, ownerNodeId: parentNodeId, originalPlacement: null },
        { kind: "placement-create", placementId: occurrenceId, nodeId, parentNodeId, anchor: end },
      ]),
      intent,
    );
  }

  resolve(targets: readonly FactActionId[], decision: "accept" | "reject"): Fact {
    return this.body({
      kind: "resolution",
      adjudicatesResolutionIds: [],
      actorId: "reviewer",
      decision,
      proposalFactIds: owningFactIds(this.values, targets),
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
    const facts: Fact[] = [];
    for (const body of bodies) {
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
      facts.push(fact);
    }
    return facts;
  }
}

export function base(intent: "direct" | "proposal" = "direct"): Facts {
  const facts = new Facts();
  facts.addTransaction(
    withInitialNodeRelations([
      { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
      {
        kind: "placement-create",
        placementId: "occurrence",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
    ]),
    intent,
  );
  return facts;
}
