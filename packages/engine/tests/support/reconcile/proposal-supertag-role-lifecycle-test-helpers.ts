import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { base } from "./reconcile-test-helpers.js";

export const supertagRoleProposalLifecycleCases = {
  "supertag-role-add": (): ProposalLifecycleCase => {
    const facts = base();
    return {
      kind: "supertag-role-add",
      facts,
      proposal: facts.add({ kind: "supertag-role-add", nodeId: "node" }, "proposal"),
    };
  },
  "supertag-role-remove": (): ProposalLifecycleCase => {
    const facts = base();
    const role = facts.add({ kind: "supertag-role-add", nodeId: "node" });
    return {
      kind: "supertag-role-remove",
      facts,
      proposal: facts.add({ kind: "supertag-role-remove", nodeId: "node", roleActionId: role.id }, "proposal"),
    };
  },
  "supertag-role-restore": (): ProposalLifecycleCase => {
    const facts = base();
    const role = facts.add({ kind: "supertag-role-add", nodeId: "node" });
    facts.add({ kind: "supertag-role-remove", nodeId: "node", roleActionId: role.id });
    return {
      kind: "supertag-role-restore",
      facts,
      proposal: facts.add({ kind: "supertag-role-restore", nodeId: "node", roleActionId: role.id }, "proposal"),
    };
  },
};
