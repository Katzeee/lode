import type { FactAction, AuthoredAction } from "../../../src/domain/fact/index.js";
import type { Facts } from "./reconcile-test-helpers.js";

export type ProposalLifecycleCase = Readonly<{
  kind: AuthoredAction["kind"];
  facts: Facts;
  proposal: FactAction;
}>;
