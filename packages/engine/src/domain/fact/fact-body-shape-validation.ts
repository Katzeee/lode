import type { FactBody } from "./types.js";
import { assertGovernanceAction } from "./governance-shape-validation.js";
import { requireFactIds } from "./identities.js";
import { assertMaintenanceAction } from "./maintenance-shape-validation.js";
import { assertKeys, assertObject, requireString } from "../../decoding/index.js";

export function assertFactBody(
  value: unknown,
  assertAuthoredAction: (action: unknown) => void,
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
  if (value.kind === "maintenance") {
    assertKeys(value, ["kind", "actorId", "action"], "Maintenance Fact");
    assertMaintenanceAction(value.action);
    return;
  }
  if (value.kind !== "edit") {
    throw new Error("Unknown Fact body kind");
  }
  assertKeys(value, ["kind", "actorId", "intent", "actions"], "Edit Fact");
  if (value.intent !== "direct" && value.intent !== "proposal") {
    throw new Error("Invalid Edit intent shape");
  }
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error("Edit Fact actions must be non-empty");
  }
  value.actions.forEach(assertAuthoredAction);
}
