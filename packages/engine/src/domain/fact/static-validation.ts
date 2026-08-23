import { factId } from "./fact.js";
import type { Fact, WorkspaceId } from "./types.js";

export function validateStaticFact(workspaceId: WorkspaceId, fact: Fact): void {
  if (fact.id !== factId(workspaceId, fact.coordinate.dot.replicaId, fact.coordinate.dot.sequence)) {
    throw new Error(`Fact workspace mismatch: ${fact.id}`);
  }
  if (fact.body.actorId.length === 0) {
    throw new Error(`Fact actor is empty: ${fact.id}`);
  }
}
