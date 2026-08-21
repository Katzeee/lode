import { assertKeys, assertObject, assertStringArray, requireString } from "../../decoding/index.js";

export function assertMaintenanceAction(value: unknown): void {
  assertObject(value, "Maintenance action");
  requireString(value.kind, "Maintenance action kind");
  if (value.kind === "deletion-acknowledge") {
    assertKeys(value, ["kind", "nodeId", "deletionFactIds"], "deletion acknowledgement");
    requireString(value.nodeId, "deleted Node identity");
    assertStringArray(value.deletionFactIds, "deletion Fact identities");
    return;
  }
  if (value.kind === "replica-retire") {
    assertKeys(value, ["kind", "replicaId"], "Replica retirement");
    requireString(value.replicaId, "retired Replica identity");
    return;
  }
  if (value.kind === "node-purge") {
    assertKeys(
      value,
      ["kind", "nodeId", "deletionFactIds", "acknowledgementFactIds", "retiredReplicaIds"],
      "Node purge",
    );
    requireString(value.nodeId, "purged Node identity");
    assertStringArray(value.deletionFactIds, "deletion Fact identities");
    assertStringArray(value.acknowledgementFactIds, "acknowledgement Fact identities");
    assertStringArray(value.retiredReplicaIds, "retired Replica identities");
    return;
  }
  throw new Error(`Unknown Maintenance action kind: ${value.kind}`);
}
