import { canonicalDigest } from "./canonical.js";
import { normalizeFrontier } from "./frontier.js";
import {
  FACT_SCHEMA_VERSION,
  FORMAT_GENERATION,
  type Fact,
  type FactBody,
  type FactFrontier,
  type FactTransactionPosition,
  type WorkspaceId,
  type ReplicaId,
} from "./types.js";

export function makeFact(input: {
  workspaceId: WorkspaceId;
  replicaId: ReplicaId;
  sequence: number;
  observed: FactFrontier;
  lamport: number;
  transaction?: FactTransactionPosition;
  body: FactBody;
}): Fact {
  const id = factId(input.workspaceId, input.replicaId, input.sequence);
  const transaction =
    input.transaction ??
    ({
      transactionId: factTransactionId(input.workspaceId, input.replicaId, input.sequence),
      index: 0,
      size: 1,
    } as const);
  const unsigned = {
    formatGeneration: FORMAT_GENERATION,
    schemaVersion: FACT_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    id,
    transaction,
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

export function factTransactionId(
  workspaceId: WorkspaceId,
  replicaId: ReplicaId,
  firstSequence: number,
): string {
  return `t${FORMAT_GENERATION}/${workspaceId}/${replicaId}/${firstSequence}`;
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
