import { actionHasAdmission } from "./action-catalog.js";
import { canonicalJson } from "./canonical.js";
import type { AuthoredAction, FactBody } from "./types.js";
import { assertGovernanceAction } from "./governance-shape-validation.js";
import { requireFactActionId, requireFactId, requireFactIds } from "./identities.js";
import { assertKeys, assertObject, requireString, safeInteger } from "../../decoding/index.js";

export function assertFactBody(
  value: unknown,
  parseAuthoredAction: (action: unknown) => AuthoredAction,
): asserts value is FactBody {
  assertObject(value, "Fact body");
  if (value.kind === "history") {
    assertKeys(
      value,
      ["kind", "channelId", "operation", "targetStepId", "actionFactCount", "restorations"],
      "History Fact",
    );
    requireString(value.channelId, "History channel identity");
    if (value.operation !== "normal" && value.operation !== "undo" && value.operation !== "redo") {
      throw new Error("Invalid History operation shape");
    }
    if (value.targetStepId !== null) {
      requireFactId(value.targetStepId, "History target Step identity");
    }
    if (
      (value.operation === "normal" && value.targetStepId !== null) ||
      (value.operation !== "normal" && value.targetStepId === null)
    ) {
      throw new Error("History target Step does not match its operation");
    }
    safeInteger(value.actionFactCount, 1, "History Action Fact count");
    if (!Array.isArray(value.restorations) || (value.operation === "normal" && value.restorations.length > 0)) {
      throw new Error("History restorations require a compensation operation");
    }
    const outputs = new Set<string>();
    for (const restoration of value.restorations) {
      assertObject(restoration, "History restoration");
      assertKeys(restoration, ["factIndex", "actionIndex", "sources"], "History restoration");
      safeInteger(restoration.factIndex, 0, "History restoration Fact index");
      safeInteger(restoration.actionIndex, 0, "History restoration Action index");
      if ((restoration.factIndex as number) >= (value.actionFactCount as number)) {
        throw new Error("History restoration Fact index is outside its batch");
      }
      const key = `${Number(restoration.factIndex)}/${Number(restoration.actionIndex)}`;
      if (outputs.has(key) || !Array.isArray(restoration.sources) || restoration.sources.length === 0) {
        throw new Error("History restoration outputs must be unique and have sources");
      }
      outputs.add(key);
      for (const source of restoration.sources) {
        assertObject(source, "History content source");
        assertKeys(source, ["id", "factActionId"], "History content source");
        requireString(source.id, "History content identity");
        requireFactActionId(source.factActionId, "History content producer");
      }
    }
    return;
  }
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
