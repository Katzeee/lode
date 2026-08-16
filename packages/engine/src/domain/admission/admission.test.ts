import { describe, expect, it } from "vitest";

import { factTransactionId, makeFact, workspaceTrashOccurrenceId } from "../fact/index.js";
import { Facts, REPLICA, end } from "../../../tests/support/reconcile/reconcile-test-helpers.js";
import { admitAuthorityRecords } from "./index.js";

describe("domain admission", () => {
  it("admits Node creation only with its Original Occurrence in one transaction", () => {
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
      fault: "Node creation transaction requires exactly one Original Occurrence",
    });

    facts.addPlaced("node");
    expect(admit(facts.values).kind).toBe("ready");
  });

  it("admits a Metanode through its typed host attachment instead of an Outline Occurrence", () => {
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

    facts.add({ kind: "node-delete", nodeId: "host-configuration" });
    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Metanode cannot be deleted independently of its host",
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
    facts.add({ kind: "supertag-apply", nodeId: "target", supertagId: "ordinary", anchor: end });

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Supertag type is absent from the observed projection",
    });
  });

  it("rejects a Field type declaration without a Field Definition binding", () => {
    const facts = new Facts();
    facts.addPlaced("unbound-field");
    facts.add({ kind: "node-type-declare", nodeId: "unbound-field", nodeType: "field" });

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Field Node has no Field Definition binding: unbound-field",
    });
  });

  it("rejects a later edit that leaves an active Field Node without its binding", () => {
    const facts = new Facts();
    facts.addPlaced("supertag");
    facts.addPlaced("field-definition");
    facts.add({ kind: "node-type-declare", nodeId: "supertag", nodeType: "supertag-definition" });
    facts.add({
      kind: "node-type-declare",
      nodeId: "field-definition",
      nodeType: "field-definition",
    });
    facts.add({
      kind: "supertag-field-add",
      supertagId: "supertag",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "field-node",
      fieldOccurrenceId: "field-occurrence",
      anchor: end,
    });
    expect(admit(facts.values).kind).toBe("ready");

    facts.addTransaction([
      {
        kind: "supertag-field-remove",
        supertagId: "supertag",
        fieldDefinitionId: "field-definition",
        fieldNodeId: "field-node",
        fieldOccurrenceId: "field-occurrence",
        previousAnchor: { after: null, before: null, affinity: "before", fallback: "start" },
      },
    ]);

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Field Node has no Field Definition binding: field-node",
    });
  });

  it("rejects a committed state where deleting an Original leaves its Node active", () => {
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

    expect(admit(facts.values)).toMatchObject({
      kind: "fault",
      fault: "Node Graph Node has no Owner: node",
    });
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
