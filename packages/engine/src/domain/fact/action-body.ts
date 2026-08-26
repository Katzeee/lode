import type { ActionBody, ActorId, EditIntent, GraphAction, ProposableAction, TerminalAction } from "./types.js";
import { actionHasAdmission } from "./action-catalog.js";
import { canonicalJson } from "./canonical.js";

type NonEmpty<Value> = readonly [Value, ...Value[]];

export function graphActionBody(actorId: ActorId, intent: EditIntent, actions: NonEmpty<GraphAction>): ActionBody {
  if (intent === "proposal") {
    if (actions.some((action) => !actionHasAdmission(action, "proposable"))) {
      throw new Error("Direct-only actions cannot be proposed");
    }
    return { kind: "action", actorId, intent, actions: actions as NonEmpty<ProposableAction> };
  }
  return { kind: "action", actorId, intent, actions };
}

export function terminalActionBody(actorId: ActorId, actions: NonEmpty<TerminalAction>): ActionBody {
  const identities = actions.map(canonicalJson);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Terminal actions in one Action Fact must be unique");
  }
  return { kind: "action", actorId, intent: "direct", actions };
}
