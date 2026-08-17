import {
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_CONFIGURATION_DEFINITION_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  FIELD_OPTIONALITY_NODE_IDS,
  type Mutation,
} from "../../../src/domain/fact/index.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { materializedFieldFacts, supertagAndFieldFacts } from "./materialized-field-test-facts.js";
import { end } from "./reconcile-test-helpers.js";
import type { Facts } from "./reconcile-test-helpers.js";

export const fieldProposalLifecycleCases = {
  "field-materialize": fieldMaterializeCase,
  "field-value-delete": fieldValueDeleteCase,
  "materialized-field-delete": materializedFieldDeleteCase,
  "field-datatype-configure": fieldDatatypeConfigureCase,
  "field-cardinality-configure": fieldCardinalityConfigureCase,
  "field-optionality-configure": fieldOptionalityConfigureCase,
  "field-initialization-expression-configure": fieldInitializationExpressionConfigureCase,
} as const;

function fieldDatatypeConfigureCase(): ProposalLifecycleCase {
  const facts = fieldDefinitionConfigurationFacts(
    "datatype-configuration",
    FIELD_CONFIGURATION_DEFINITION_NODE_IDS.datatype,
    FIELD_DATATYPE_NODE_IDS.options,
  );
  const previous = facts.add({
    kind: "field-datatype-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "datatype-configuration",
    configurationOccurrenceId: "datatype-configuration-occurrence",
    datatypeNodeId: FIELD_DATATYPE_NODE_IDS.options,
    previousDatatypeNodeId: null,
    observedValueFactIds: [],
  });
  return configurationLifecycle(facts, "datatype-configuration", "datatype-value", "datatype-value-next", {
    kind: "field-datatype-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "datatype-configuration",
    configurationOccurrenceId: "datatype-configuration-occurrence",
    datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
    previousDatatypeNodeId: FIELD_DATATYPE_NODE_IDS.options,
    observedValueFactIds: [previous.id],
  });
}

function fieldCardinalityConfigureCase(): ProposalLifecycleCase {
  const facts = fieldDefinitionConfigurationFacts(
    "cardinality-configuration",
    FIELD_CONFIGURATION_DEFINITION_NODE_IDS.cardinality,
    FIELD_CARDINALITY_NODE_IDS.list,
  );
  const previous = facts.add({
    kind: "field-cardinality-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "cardinality-configuration",
    configurationOccurrenceId: "cardinality-configuration-occurrence",
    cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.list,
    previousCardinalityNodeId: null,
    observedValueFactIds: [],
  });
  return configurationLifecycle(facts, "cardinality-configuration", "cardinality-value", "cardinality-value-next", {
    kind: "field-cardinality-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "cardinality-configuration",
    configurationOccurrenceId: "cardinality-configuration-occurrence",
    cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
    previousCardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.list,
    observedValueFactIds: [previous.id],
  });
}

function fieldOptionalityConfigureCase(): ProposalLifecycleCase {
  const facts = fieldDefinitionConfigurationFacts(
    "optionality-configuration",
    FIELD_CONFIGURATION_DEFINITION_NODE_IDS.optionality,
    FIELD_OPTIONALITY_NODE_IDS.no,
  );
  const previous = facts.add({
    kind: "field-optionality-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "optionality-configuration",
    configurationOccurrenceId: "optionality-configuration-occurrence",
    optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
    previousOptionalityNodeId: null,
    observedValueFactIds: [],
  });
  return configurationLifecycle(facts, "optionality-configuration", "optionality-value", "optionality-value-next", {
    kind: "field-optionality-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "optionality-configuration",
    configurationOccurrenceId: "optionality-configuration-occurrence",
    optionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.yes,
    previousOptionalityNodeId: FIELD_OPTIONALITY_NODE_IDS.no,
    observedValueFactIds: [previous.id],
  });
}

function fieldInitializationExpressionConfigureCase(): ProposalLifecycleCase {
  const facts = fieldDefinitionConfigurationFacts(
    "initialization-configuration",
    FIELD_CONFIGURATION_DEFINITION_NODE_IDS.initializationExpression,
    "initialization-expression",
  );
  return lifecycle(facts, {
    kind: "field-initialization-expression-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "initialization-configuration",
    configurationOccurrenceId: "initialization-configuration-occurrence",
    expression: {
      kind: "find-field-values",
      expressionNodeId: "initialization-expression",
      expressionOccurrenceId: "initialization-expression-occurrence",
      sourceFieldDefinitionId: "field",
      sourceFieldDefinitionOccurrenceId: "initialization-source-occurrence",
      contextNodeId: "initialization-above",
      contextOccurrenceId: "initialization-above-occurrence",
    },
    previousExpression: null,
    observedValueFactIds: [],
  });
}

function fieldDefinitionConfigurationFacts(
  configurationNodeId: string,
  definitionNodeId: string,
  valueNodeId: string,
): Facts {
  const facts = supertagAndFieldFacts();
  facts.addTransaction([
    { kind: "node-create", nodeId: configurationNodeId },
    {
      kind: "node-owner-set",
      nodeId: configurationNodeId,
      ownerNodeId: "field",
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId: `${configurationNodeId}-occurrence`,
      nodeId: configurationNodeId,
      parentNodeId: "field",
      anchor: end,
    },
    {
      kind: "occurrence-create",
      occurrenceId: `${configurationNodeId}-definition`,
      nodeId: definitionNodeId,
      parentNodeId: configurationNodeId,
      anchor: end,
    },
  ]);
  if (configurationNodeId === "initialization-configuration") {
    facts.addPlaced("initialization-expression", configurationNodeId, "initialization-expression-occurrence");
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "initialization-source-occurrence",
      nodeId: "field",
      parentNodeId: "initialization-expression",
      anchor: end,
    });
    facts.addPlaced("initialization-above", "initialization-expression", "initialization-above-occurrence");
  } else {
    facts.add({
      kind: "occurrence-create",
      occurrenceId: configurationNodeId.startsWith("datatype")
        ? "datatype-value"
        : configurationNodeId.startsWith("cardinality")
          ? "cardinality-value"
          : "optionality-value",
      nodeId: valueNodeId,
      parentNodeId: configurationNodeId,
      anchor: end,
    });
  }
  return facts;
}

function configurationLifecycle(
  facts: Facts,
  configurationNodeId: string,
  previousValueOccurrenceId: string,
  valueOccurrenceId: string,
  mutation: Mutation,
): ProposalLifecycleCase {
  const proposalFacts = facts.addTransaction(
    [
      {
        kind: "occurrence-delete",
        occurrenceId: previousValueOccurrenceId,
        previousParentNodeId: configurationNodeId,
        previousAnchor: end,
      },
      {
        kind: "occurrence-create",
        occurrenceId: valueOccurrenceId,
        nodeId:
          mutation.kind === "field-datatype-configure"
            ? mutation.datatypeNodeId
            : mutation.kind === "field-cardinality-configure"
              ? mutation.cardinalityNodeId
              : mutation.kind === "field-optionality-configure"
                ? mutation.optionalityNodeId
                : (() => {
                    throw new Error("Configuration lifecycle only accepts scalar Field configuration mutations");
                  })(),
        parentNodeId: configurationNodeId,
        anchor: end,
      },
      mutation,
    ],
    "proposal",
  );
  const proposal = proposalFacts.find(
    (fact) => fact.body.kind === "contribution" && fact.body.mutation.kind === mutation.kind,
  );
  if (!proposal) {
    throw new Error("Field configuration proposal transaction has no configuration Fact");
  }
  return { kind: mutation.kind, facts, proposal };
}

function fieldMaterializeCase(): ProposalLifecycleCase {
  const facts = materializedFieldFacts(false, false);
  return lifecycle(facts, {
    kind: "field-materialize",
    ownerNodeId: "node",
    fieldDefinitionId: "field",
    fieldNodeId: "field-node",
    fieldOccurrenceId: "field-occurrence",
  });
}

function fieldValueDeleteCase(): ProposalLifecycleCase {
  const facts = materializedFieldFacts(true);
  return lifecycle(facts, {
    kind: "field-value-delete",
    ownerNodeId: "node",
    fieldDefinitionId: "field",
    valueOccurrenceId: "value-occurrence",
    previousParentNodeId: "field-node",
    previousAnchor: end,
  });
}

function materializedFieldDeleteCase(): ProposalLifecycleCase {
  const facts = materializedFieldFacts(true);
  return lifecycle(facts, {
    kind: "materialized-field-delete",
    ownerNodeId: "node",
    fieldDefinitionId: "field",
    fieldNodeId: "field-node",
    fieldOccurrenceId: "field-occurrence",
    previousParentNodeId: "node",
    previousAnchor: end,
  });
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
