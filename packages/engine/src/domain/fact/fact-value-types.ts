export type WorkspaceId = string;
export type ReplicaId = string;
export type ActorId = string;
export type InvocationId = string;
export type FactId = `g${number}/${string}/${string}/${number}`;
export type FactActionId = `${FactId}/actions/${number}`;
export type ResolutionId = FactId;
export type HistoryChannelId = string;
export type HistoryOperation = "normal" | "undo" | "redo";

export type EditIntent = "direct" | "proposal";
export type ResolutionDecision = "accept" | "reject";
export type ProjectionPerspective = "origin" | "review";

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export type FactFrontier = Readonly<Record<ReplicaId, number>>;

type FactDot = Readonly<{
  replicaId: ReplicaId;
  sequence: number;
}>;

export type CausalCoordinate = Readonly<{
  dot: FactDot;
  observed: FactFrontier;
  lamport: number;
}>;

export type TextAtomId = `${FactActionId}#${number}`;

export type SequenceAnchor = Readonly<{
  after: string | null;
  before: string | null;
  affinity: "after" | "before";
  fallback: "start" | "end";
}>;

export type PreviousValue = Readonly<{ kind: "unset" }> | Readonly<{ kind: "set"; value: JsonValue }>;
