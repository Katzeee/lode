import { canonicalDigest } from "./canonical.js";
import { normalizeFrontier } from "./frontier.js";
import {
  FACT_ID_GENERATION,
  type Fact,
  type FactBody,
  type FactFrontier,
  type WorkspaceId,
  type ReplicaId,
} from "./types.js";

export function makeFact(input: {
  workspaceId: WorkspaceId;
  replicaId: ReplicaId;
  sequence: number;
  observed: FactFrontier;
  lamport: number;
  body: FactBody;
}): Fact {
  const id = factId(input.workspaceId, input.replicaId, input.sequence);
  return {
    id,
    coordinate: {
      dot: { replicaId: input.replicaId, sequence: input.sequence },
      observed: normalizeFrontier(input.observed),
      lamport: input.lamport,
    },
    body: input.body,
  } as const;
}

export function factId(workspaceId: WorkspaceId, replicaId: ReplicaId, sequence: number): Fact["id"] {
  return `g${FACT_ID_GENERATION}/${workspaceId}/${replicaId}/${sequence}`;
}

export function requestDigest(request: unknown): string {
  return canonicalDigest(request);
}

export function isReplicaId(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(value);
}
