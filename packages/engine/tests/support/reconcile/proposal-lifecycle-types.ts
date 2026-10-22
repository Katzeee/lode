import type { FactAction, GraphAction } from "../../../src/domain/fact/index.js";
import type { Facts } from "./reconcile-test-helpers.js";

export type ProposalLifecycleCase = Readonly<{
  kind: GraphAction["kind"];
  facts: Facts;
  proposal: FactAction;
}>;
