import type { FactBody } from "./types.js";
import { assertGovernanceAction } from "./governance-shape-validation.js";
import { assertMaintenanceAction } from "./maintenance-shape-validation.js";
import { assertKeys, assertObject, assertStringArray, requireString } from "../../shape-validation/index.js";

export function assertFactBody(value: unknown, assertMutation: (mutation: unknown) => void): asserts value is FactBody {
  assertObject(value, "Fact body");
  requireString(value.actorId, "Fact actor identity");
  if (value.kind === "governance") {
    assertKeys(value, ["kind", "actorId", "action"], "Governance Fact");
    assertGovernanceAction(value.action);
    return;
  }
  if (value.kind === "resolution") {
    assertKeys(
      value,
      ["kind", "actorId", "decision", "proposalContributionIds", "adjudicatesResolutionIds"],
      "Resolution",
    );
    if (value.decision !== "accept" && value.decision !== "reject") {
      throw new Error("Invalid Resolution decision shape");
    }
    assertStringArray(value.proposalContributionIds, "Resolution targets");
    assertStringArray(value.adjudicatesResolutionIds, "adjudicated Resolution identities");
    return;
  }
  if (value.kind === "maintenance") {
    assertKeys(value, ["kind", "actorId", "action"], "Maintenance Fact");
    assertMaintenanceAction(value.action);
    return;
  }
  if (value.kind !== "contribution") {
    throw new Error("Unknown Fact body kind");
  }
  assertKeys(value, ["kind", "actorId", "intent", "mutation"], "Contribution");
  if (value.intent !== "direct" && value.intent !== "proposal") {
    throw new Error("Invalid Contribution intent shape");
  }
  assertMutation(value.mutation);
}
