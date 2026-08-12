import { canonicalDigest } from "./canonical.js";
import { normalizeFrontier } from "./frontier.js";
import {
  FACT_SCHEMA_VERSION,
  FORMAT_GENERATION,
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
  const unsigned = {
    formatGeneration: FORMAT_GENERATION,
    schemaVersion: FACT_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    id,
    coordinate: {
      dot: { replicaId: input.replicaId, sequence: input.sequence },
      observed: normalizeFrontier(input.observed),
      lamport: input.lamport,
    },
    body: input.body,
  } as const;
  return { ...unsigned, contentDigest: canonicalDigest(unsigned) };
}

export function factId(workspaceId: WorkspaceId, replicaId: ReplicaId, sequence: number): string {
  return `g${FORMAT_GENERATION}/${workspaceId}/${replicaId}/${sequence}`;
}

export function requestDigest(request: unknown): string {
  return canonicalDigest(request);
}

export function isReplicaId(value: string): boolean {
  return /^[a-z2-7]{26}$/.test(value);
}

export function unsignedFact(fact: Fact): Omit<Fact, "contentDigest"> {
  const { contentDigest: _digest, ...unsigned } = fact;
  return unsigned;
}
