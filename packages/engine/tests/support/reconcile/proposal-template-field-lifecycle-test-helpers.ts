import { SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, type GraphAction } from "../../../src/domain/fact/index.js";
import { supertagAndFieldFacts } from "./materialized-field-test-facts.js";
import { addDefinitionNode } from "./placed-node-test-helpers.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { base, end, type Facts } from "./reconcile-test-helpers.js";

export const templateFieldProposalLifecycleCases = {
  "field-definition-make-discoverable": fieldDefinitionMakeDiscoverableCase,
  "field-definition-return-to-template-field": fieldDefinitionReturnCase,
  "template-field-add": templateFieldAddCase,
  "template-field-remove": templateFieldRemoveCase,
  "template-field-restore": templateFieldRestoreCase,
  "template-field-visibility-set": templateFieldVisibilityCase,
  "template-field-static-default-set": templateFieldStaticDefaultCase,
  "optional-field-contribution-add": optionalFieldAddCase,
  "optional-field-contribution-remove": optionalFieldRemoveCase,
} as const;

function fieldDefinitionMakeDiscoverableCase(): ProposalLifecycleCase {
  const facts = withPrivateTemplateField();
  return lifecycle(facts, { kind: "field-definition-make-discoverable", fieldDefinitionId: "field" });
}

function fieldDefinitionReturnCase(): ProposalLifecycleCase {
  const facts = withPrivateTemplateField();
  const templateField = templateFieldAction(facts);
  facts.add({ kind: "field-definition-make-discoverable", fieldDefinitionId: "field" });
  return lifecycle(facts, {
    kind: "field-definition-return-to-template-field",
    fieldDefinitionId: "field",
    templateFieldId: templateField.id,
  });
}

function templateFieldAddCase(): ProposalLifecycleCase {
  return lifecycle(supertagAndFieldFacts(), templateFieldAdd());
}

function templateFieldRemoveCase(): ProposalLifecycleCase {
  const facts = withTemplateField();
  return lifecycle(facts, { kind: "template-field-remove", supertagId: "supertag", fieldDefinitionId: "field" });
}

function templateFieldRestoreCase(): ProposalLifecycleCase {
  const facts = withTemplateField();
  const templateField = templateFieldAction(facts);
  facts.add({ kind: "template-field-remove", supertagId: "supertag", fieldDefinitionId: "field" });
  return lifecycle(facts, { kind: "template-field-restore", templateFieldId: templateField.id });
}

function templateFieldVisibilityCase(): ProposalLifecycleCase {
  const facts = withTemplateField();
  return lifecycle(facts, {
    kind: "template-field-visibility-set",
    templateFieldId: templateFieldAction(facts).id,
    visibility: "pinned",
  });
}

function templateFieldStaticDefaultCase(): ProposalLifecycleCase {
  const facts = withTemplateField();
  return lifecycle(facts, {
    kind: "template-field-static-default-set",
    templateFieldId: templateFieldAction(facts).id,
    value: "default",
  });
}

function optionalFieldAddCase(): ProposalLifecycleCase {
  return lifecycle(supertagAndFieldFacts(), {
    kind: "optional-field-contribution-add",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    anchor: end,
  });
}

function optionalFieldRemoveCase(): ProposalLifecycleCase {
  const facts = supertagAndFieldFacts();
  facts.add({
    kind: "optional-field-contribution-add",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "optional-field-contribution-remove",
    supertagId: "supertag",
    fieldDefinitionId: "field",
  });
}

function withTemplateField(): Facts {
  const facts = supertagAndFieldFacts();
  facts.add(templateFieldAdd());
  return facts;
}

function withPrivateTemplateField(): Facts {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  facts.add({
    kind: "template-field-add",
    supertagId: "supertag",
    fieldDefinition: { kind: "new", fieldDefinitionId: "field" },
    anchor: end,
  });
  return facts;
}

function templateFieldAdd(): GraphAction {
  return {
    kind: "template-field-add",
    supertagId: "supertag",
    fieldDefinition: { kind: "existing", fieldDefinitionId: "field" },
    anchor: end,
  };
}

function templateFieldAction(facts: Facts) {
  const action = facts.values
    .flatMap((fact) =>
      fact.body.kind === "action" ? fact.body.actions.map((candidate, index) => ({ fact, candidate, index })) : [],
    )
    .find(({ candidate }) => candidate.kind === "template-field-add");
  if (!action) {
    throw new Error("Template Field fixture has no add action");
  }
  return { id: `${action.fact.id}/actions/${action.index}` as const };
}

function lifecycle(facts: Facts, action: GraphAction): ProposalLifecycleCase {
  return { kind: action.kind, facts, proposal: facts.add(action, "proposal") };
}
