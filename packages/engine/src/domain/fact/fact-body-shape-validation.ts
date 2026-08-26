import { actionHasAdmission } from "./action-catalog.js";
import { canonicalJson } from "./canonical.js";
import type { AuthoredAction, FactBody } from "./types.js";
import { assertGovernanceAction } from "./governance-shape-validation.js";
import { requireFactIds } from "./identities.js";
import { assertKeys, assertObject, requireString } from "../../decoding/index.js";

export function assertFactBody(
  value: unknown,
  parseAuthoredAction: (action: unknown) => AuthoredAction,
): asserts value is FactBody {
  assertObject(value, "Fact body");
  requireString(value.actorId, "Fact actor identity");
  if (value.kind === "governance") {
    assertKeys(value, ["kind", "actorId", "action"], "Governance Fact");
    assertGovernanceAction(value.action);
    return;
  }
  if (value.kind === "resolution") {
    assertKeys(value, ["kind", "actorId", "decision", "proposalFactIds", "adjudicatesResolutionIds"], "Resolution");
    if (value.decision !== "accept" && value.decision !== "reject") {
      throw new Error("Invalid Resolution decision shape");
    }
    requireFactIds(value.proposalFactIds, "Resolution targets");
    requireFactIds(value.adjudicatesResolutionIds, "adjudicated Resolution identities", false);
    return;
  }
  if (value.kind !== "action") {
    throw new Error("Unknown Fact body kind");
  }
  assertKeys(value, ["kind", "actorId", "intent", "actions"], "Action Fact");
  if (value.intent !== "direct" && value.intent !== "proposal") {
    throw new Error("Invalid Action intent shape");
  }
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error("Action Fact actions must be non-empty");
  }
  const actions = value.actions.map((action) => parseAuthoredAction(action));
  const terminalActions = actions.filter((action) => actionHasAdmission(action, "terminal"));
  if (terminalActions.length > 0) {
    if (value.intent !== "direct") {
      throw new Error("Terminal actions must be direct");
    }
    if (terminalActions.length !== actions.length) {
      throw new Error("Terminal and graph actions cannot share one Action Fact");
    }
    const identities = terminalActions.map(canonicalJson);
    if (new Set(identities).size !== identities.length) {
      throw new Error("Terminal actions in one Action Fact must be unique");
    }
  } else if (value.intent === "proposal" && actions.some((action) => !actionHasAdmission(action, "proposable"))) {
    throw new Error("Direct-only actions cannot be proposed");
  }
}
