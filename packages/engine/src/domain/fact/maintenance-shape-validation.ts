import { assertKeys, assertObject, requireString } from "../../decoding/index.js";

export function assertMaintenanceAction(value: unknown): void {
  assertObject(value, "Maintenance action");
  requireString(value.kind, "Maintenance action kind");
  if (value.kind === "deletion-acknowledge") {
    assertKeys(value, ["kind", "nodeId"], "deletion acknowledgement");
    requireString(value.nodeId, "deleted Node identity");
    return;
  }
  if (value.kind === "replica-retire") {
    assertKeys(value, ["kind", "replicaId"], "Replica retirement");
    requireString(value.replicaId, "retired Replica identity");
    return;
  }
  if (value.kind === "node-purge") {
    assertKeys(value, ["kind", "nodeId"], "Node purge");
    requireString(value.nodeId, "purged Node identity");
    return;
  }
  throw new Error(`Unknown Maintenance action kind: ${value.kind}`);
}
