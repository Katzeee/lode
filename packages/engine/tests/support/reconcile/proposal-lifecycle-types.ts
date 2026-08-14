import type { Fact, Mutation } from "../../../src/domain/fact/index.js";
import type { Facts } from "./reconcile-test-helpers.js";

export type ProposalLifecycleCase = Readonly<{
  kind: Mutation["kind"];
  facts: Facts;
  proposal: Fact;
}>;
