import { describe, expect, it } from "vitest";

import {
  factTransactionId,
  makeFact,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  NODE_VIEWS_DEFINITION_NODE_ID,
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  VIEW_SORT_ASCENDING_NODE_ID,
  VIEW_SORT_FIELD_DEFINITION_NODE_ID,
  VIEW_SORT_NODE_NAME_NODE_ID,
  VIEW_SORT_ORDER_DEFINITION_NODE_ID,
  workspaceTrashOccurrenceId,
} from "../fact/index.js";
import { Facts, REPLICA, end } from "../../../tests/support/reconcile/reconcile-test-helpers.js";
import { admitAuthorityRecords } from "./index.js";

describe("domain admission", () => {
  it("requires an explicit initial Owner independently of ordered placement", () => {
    const facts = new Facts();
    const sequence = facts.values.length + 1;
    const invalid = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence,
      observed: { [REPLICA]: sequence - 1 },
      lamport: sequence,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "node" },
      },
    });

    expect(admit(facts.values).kind).toBe("ready");
    expect(admit([...facts.values, invalid])).toMatchObject({
      kind: "fault",
      fault: "Node creation transaction requires exactly one initial Owner relation",
    });

    facts.addPlaced("node");
    expect(admit(facts.values).kind).toBe("ready");
  });

  it("admits a Metanode through an explicit Owner and its typed host attachment", () => {
    const facts = new Facts();
    facts.addPlaced("host");
    facts.addTransaction([
      { kind: "node-create", nodeId: "host-configuration" },
      {
        kind: "metanode-attach",
        hostNodeId: "host",
        metanodeId: "host-configuration",
      },
    ]);

    expect(admit(facts.values)).toMatchObject({ kind: "ready" });

    facts.addTransaction([{ kind: "node-delete", nodeId: "host-configuration" }]);
    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Structural role requires a typed mutation: Node host-configuration",
    });
  });

  it("rejects a typed Metanode attachment that also places the Metanode in the outline", () => {
    const facts = new Facts();
    facts.addPlaced("host");
    facts.addTransaction([
      { kind: "node-create", nodeId: "host-configuration" },
      {
        kind: "metanode-attach",
        hostNodeId: "host",
        metanodeId: "host-configuration",
      },
      {
        kind: "occurrence-create",
        occurrenceId: "host-configuration-occurrence",
        nodeId: "host-configuration",
        parentNodeId: "host",
        anchor: end,
      },
    ]);

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Metanode structure is invalid: host-configuration",
    });
  });

  it("validates semantic evidence against the observed projection", () => {
    const facts = new Facts();
    facts.addPlaced("node");
    const inserted = facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "A",
    });
    facts.add({
      kind: "text-mark",
      nodeId: "node",
      atomIds: [`${inserted.id}#999`],
      key: "bold",
      value: { kind: "set", value: true },
      previous: { kind: "unset" },
    });

    expect(admit(facts.values).kind).toBe("fault");
  });

  it("rejects Definition relations whose target is only an ordinary Node", () => {
    const facts = new Facts();
    facts.addPlaced("ordinary");
    facts.addPlaced("target");
    facts.applySupertag("target", "ordinary");

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Supertag type is absent from the observed projection",
    });
  });

  it("rejects a Field type declaration without a Field Definition binding", () => {
    const facts = new Facts();
    facts.addPlaced("unbound-field");
    facts.add({ kind: "intrinsic-node-type-declare", nodeId: "unbound-field", intrinsicNodeType: "field" });

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Field Node has no Field Definition binding: unbound-field",
    });
  });

  it("rejects a generic edit that breaks a typed Supertag Application tuple", () => {
    const facts = new Facts();
    facts.addPlaced("host");
    facts.addPlaced("supertag");
    facts.add({ kind: "intrinsic-node-type-declare", nodeId: "supertag", intrinsicNodeType: "supertag-definition" });
    const application = facts.applySupertag("host", "supertag");
    expect(admit(facts.values).kind).toBe("ready");
    if (application.body.kind !== "contribution" || application.body.mutation.kind !== "supertag-apply") {
      throw new Error("Expected Supertag Application Fact");
    }
    facts.add({
      kind: "occurrence-delete",
      occurrenceId: application.body.mutation.definitionOccurrenceId,
      previousParentNodeId: application.body.mutation.applicationNodeId,
      previousAnchor: {
        after: application.body.mutation.relationDefinitionOccurrenceId,
        before: null,
        affinity: "after",
        fallback: "end",
      },
    });

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: `Structural role requires a typed mutation: Occurrence ${application.body.mutation.definitionOccurrenceId}`,
    });
  });

  it("does not let a View mode mutation authorize generic writes to its Definition Node", () => {
    const facts = new Facts();
    facts.addPlaced("host");
    facts.addTransaction([
      { kind: "node-create", nodeId: "host-metanode" },
      { kind: "metanode-attach", hostNodeId: "host", metanodeId: "host-metanode" },
      { kind: "node-create", nodeId: "view-attachment" },
      { kind: "node-create", nodeId: "view-definition" },
      {
        kind: "occurrence-create",
        occurrenceId: "view-attachment-occurrence",
        nodeId: "view-attachment",
        parentNodeId: "host-metanode",
        anchor: end,
      },
      {
        kind: "occurrence-create",
        occurrenceId: "view-relation-definition-occurrence",
        nodeId: NODE_VIEWS_DEFINITION_NODE_ID,
        parentNodeId: "view-attachment",
        anchor: end,
      },
      {
        kind: "occurrence-create",
        occurrenceId: "view-definition-occurrence",
        nodeId: "view-definition",
        parentNodeId: "view-attachment",
        anchor: {
          after: "view-relation-definition-occurrence",
          before: null,
          affinity: "after",
          fallback: "end",
        },
      },
      {
        kind: "shared-default-view-definition-attach",
        hostNodeId: "host",
        attachmentNodeId: "view-attachment",
        attachmentOccurrenceId: "view-attachment-occurrence",
        relationDefinitionOccurrenceId: "view-relation-definition-occurrence",
        viewDefinitionNodeId: "view-definition",
        viewDefinitionOccurrenceId: "view-definition-occurrence",
      },
      {
        kind: "shared-default-view-definition-mode-set",
        viewDefinitionNodeId: "view-definition",
        viewType: "outline",
        previousViewType: null,
        observedModeFactIds: [],
      },
    ]);
    expect(admit(facts.values).kind).toBe("ready");
    const initialMode = [...facts.values]
      .reverse()
      .find(
        (fact) =>
          fact.body.kind === "contribution" && fact.body.mutation.kind === "shared-default-view-definition-mode-set",
      );
    if (!initialMode) {
      throw new Error("Expected initial View mode Fact");
    }

    facts.addTransaction([
      {
        kind: "shared-default-view-definition-mode-set",
        viewDefinitionNodeId: "view-definition",
        viewType: "table",
        previousViewType: "outline",
        observedModeFactIds: [initialMode.id],
      },
      { kind: "intrinsic-node-type-declare", nodeId: "view-definition", intrinsicNodeType: "supertag-definition" },
    ]);

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Structural role requires a typed mutation: Intrinsic Node Type view-definition",
    });
  });

  it("does not let a View Sort mutation authorize generic writes to its Definition Node", () => {
    const facts = new Facts();
    facts.addPlaced("host");
    facts.addTransaction([
      { kind: "node-create", nodeId: "host-metanode" },
      { kind: "metanode-attach", hostNodeId: "host", metanodeId: "host-metanode" },
      { kind: "node-create", nodeId: "view-attachment" },
      { kind: "node-create", nodeId: "view-definition" },
      {
        kind: "occurrence-create",
        occurrenceId: "view-attachment-occurrence",
        nodeId: "view-attachment",
        parentNodeId: "host-metanode",
        anchor: end,
      },
      {
        kind: "occurrence-create",
        occurrenceId: "view-relation-definition-occurrence",
        nodeId: NODE_VIEWS_DEFINITION_NODE_ID,
        parentNodeId: "view-attachment",
        anchor: end,
      },
      {
        kind: "occurrence-create",
        occurrenceId: "view-definition-occurrence",
        nodeId: "view-definition",
        parentNodeId: "view-attachment",
        anchor: {
          after: "view-relation-definition-occurrence",
          before: null,
          affinity: "after",
          fallback: "end",
        },
      },
      {
        kind: "shared-default-view-definition-attach",
        hostNodeId: "host",
        attachmentNodeId: "view-attachment",
        attachmentOccurrenceId: "view-attachment-occurrence",
        relationDefinitionOccurrenceId: "view-relation-definition-occurrence",
        viewDefinitionNodeId: "view-definition",
        viewDefinitionOccurrenceId: "view-definition-occurrence",
      },
      {
        kind: "shared-default-view-definition-mode-set",
        viewDefinitionNodeId: "view-definition",
        viewType: "outline",
        previousViewType: null,
        observedModeFactIds: [],
      },
    ]);
    const attached = admit(facts.values);
    expect(attached, JSON.stringify(attached)).toMatchObject({ kind: "ready" });

    facts.addTransaction([
      { kind: "node-create", nodeId: "sort-order" },
      { kind: "intrinsic-node-type-declare", nodeId: "sort-order", intrinsicNodeType: "field" },
      {
        kind: "occurrence-create",
        occurrenceId: "sort-order-occurrence",
        nodeId: "sort-order",
        parentNodeId: "view-definition",
        anchor: end,
      },
      {
        kind: "field-materialize",
        ownerNodeId: "view-definition",
        fieldDefinitionId: VIEW_SORT_ORDER_DEFINITION_NODE_ID,
        fieldNodeId: "sort-order",
        fieldOccurrenceId: "sort-order-occurrence",
      },
      { kind: "node-create", nodeId: "sort-field" },
      { kind: "intrinsic-node-type-declare", nodeId: "sort-field", intrinsicNodeType: "field" },
      {
        kind: "occurrence-create",
        occurrenceId: "sort-field-occurrence",
        nodeId: "sort-field",
        parentNodeId: "sort-order",
        anchor: end,
      },
      {
        kind: "field-materialize",
        ownerNodeId: "sort-order",
        fieldDefinitionId: VIEW_SORT_FIELD_DEFINITION_NODE_ID,
        fieldNodeId: "sort-field",
        fieldOccurrenceId: "sort-field-occurrence",
      },
      {
        kind: "occurrence-create",
        occurrenceId: "sort-node-name-occurrence",
        nodeId: VIEW_SORT_NODE_NAME_NODE_ID,
        parentNodeId: "sort-field",
        anchor: end,
      },
      {
        kind: "occurrence-create",
        occurrenceId: "sort-ascending-occurrence",
        nodeId: VIEW_SORT_ASCENDING_NODE_ID,
        parentNodeId: "sort-field",
        anchor: end,
      },
      {
        kind: "shared-default-view-definition-sort-by-name-set",
        hostNodeId: "host",
        viewDefinitionNodeId: "view-definition",
        sortOrderFieldNodeId: "sort-order",
        sortOrderFieldOccurrenceId: "sort-order-occurrence",
        sortFieldNodeId: "sort-field",
        sortFieldOccurrenceId: "sort-field-occurrence",
        nodeNameOccurrenceId: "sort-node-name-occurrence",
        ascendingOccurrenceId: "sort-ascending-occurrence",
        enabled: true,
        previousEnabled: false,
      },
      { kind: "intrinsic-node-type-declare", nodeId: "view-definition", intrinsicNodeType: "supertag-definition" },
    ]);

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Structural role requires a typed mutation: Intrinsic Node Type view-definition",
    });
  });

  it("rejects an explicit ordinary placement of the System Definition Catalog", () => {
    const facts = new Facts();
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "explicit-system-catalog-occurrence",
      nodeId: SYSTEM_DEFINITION_CATALOG_NODE_ID,
      parentNodeId: "workspace",
      anchor: end,
    });

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: `Structural role requires a typed mutation: Node ${SYSTEM_DEFINITION_CATALOG_NODE_ID}`,
    });
  });

  it("rejects a typed Supertag Application whose tuple is incomplete", () => {
    const facts = new Facts();
    facts.addPlaced("host");
    facts.addPlaced("supertag");
    facts.add({ kind: "intrinsic-node-type-declare", nodeId: "supertag", intrinsicNodeType: "supertag-definition" });
    facts.addTransaction([
      { kind: "node-create", nodeId: "host-metanode" },
      { kind: "node-create", nodeId: "application" },
      { kind: "metanode-attach", hostNodeId: "host", metanodeId: "host-metanode" },
      {
        kind: "occurrence-create",
        occurrenceId: "application-occurrence",
        nodeId: "application",
        parentNodeId: "host-metanode",
        anchor: end,
      },
      {
        kind: "occurrence-create",
        occurrenceId: "relation-definition-occurrence",
        nodeId: NODE_SUPERTAGS_DEFINITION_NODE_ID,
        parentNodeId: "application",
        anchor: end,
      },
      {
        kind: "supertag-apply",
        hostNodeId: "host",
        supertagId: "supertag",
        applicationNodeId: "application",
        applicationOccurrenceId: "application-occurrence",
        relationDefinitionOccurrenceId: "relation-definition-occurrence",
        definitionOccurrenceId: "missing-definition-occurrence",
        anchor: end,
      },
    ]);

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Supertag Application relation structure is absent from the observed projection",
    });
  });

  it("keeps Owner authority when its matching ordered edge is deleted", () => {
    const facts = new Facts();
    facts.addPlaced("node");
    facts.add({
      kind: "occurrence-delete",
      occurrenceId: "node-original",
      previousParentNodeId: "workspace",
      previousAnchor: {
        after: workspaceTrashOccurrenceId("workspace"),
        before: null,
        affinity: "after",
        fallback: "end",
      },
    });

    expect(admit(facts.values)).toMatchObject({ kind: "ready" });
  });

  it("rejects a committed state that removes the Workspace Trash role relation", () => {
    const facts = new Facts();
    facts.add({
      kind: "occurrence-delete",
      occurrenceId: workspaceTrashOccurrenceId("workspace"),
      previousParentNodeId: "workspace",
      previousAnchor: { after: null, before: null, affinity: "before", fallback: "start" },
    });

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Workspace Trash role cannot be moved or deleted",
    });
  });

  it("requires one actor and intent across a multi-Fact domain transaction", () => {
    const facts = new Facts();
    const firstSequence = facts.values.length + 1;
    const transactionId = factTransactionId("workspace", REPLICA, firstSequence);
    const node = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: firstSequence,
      observed: { [REPLICA]: firstSequence - 1 },
      lamport: firstSequence,
      transaction: { transactionId, index: 0, size: 2 },
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "node" },
      },
    });
    const occurrence = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: firstSequence + 1,
      observed: { [REPLICA]: firstSequence },
      lamport: firstSequence + 1,
      transaction: { transactionId, index: 1, size: 2 },
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "proposal",
        mutation: {
          kind: "occurrence-create",
          occurrenceId: "node-original",
          nodeId: "node",
          parentNodeId: "workspace",
          anchor: end,
        },
      },
    });

    expect(admit([...facts.values, node, occurrence])).toMatchObject({
      kind: "fault",
      fault: "A multi-Fact domain transaction requires one actor and one intent",
    });
  });
});

function admit(facts: Facts["values"]) {
  return admitAuthorityRecords(
    "workspace",
    facts.map((fact) => ({ recordKind: "fact" as const, fact })),
  );
}
