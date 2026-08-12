export const FORMAT_GENERATION = 1 as const;
export const FACT_SCHEMA_VERSION = 1 as const;

export type WorkspaceId = string;
export type ReplicaId = string;
export type ActorId = string;
export type InvocationId = string;
export type ContributionId = string;
export type ResolutionId = string;
export type FactId = string;
export type HistoryChannelId = string;

export type EditIntent = "direct" | "proposal";
export type ResolutionDecision = "accept" | "reject";
export type ViewMode = "origin" | "review";

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export type FactFrontier = Readonly<Record<ReplicaId, number>>;

export type FactDot = Readonly<{
  replicaId: ReplicaId;
  sequence: number;
}>;

export type CausalCoordinate = Readonly<{
  dot: FactDot;
  observed: FactFrontier;
  lamport: number;
}>;

export type TextAtomId = `${string}#${number}`;

export type SequenceAnchor = Readonly<{
  after: string | null;
  before: string | null;
  affinity: "after" | "before";
  fallback: "start" | "end";
}>;

export type ValueOwner = Readonly<{
  kind: "node" | "occurrence" | "schema" | "field";
  id: string;
}>;

export type PreviousValue =
  Readonly<{ kind: "unset" }> | Readonly<{ kind: "set"; value: JsonValue }>;

export type Mutation =
  | Readonly<{ kind: "node-create"; nodeId: string }>
  | Readonly<{ kind: "node-delete"; nodeId: string }>
  | Readonly<{ kind: "node-restore"; nodeId: string; deletionFactId: FactId }>
  | Readonly<{
      kind: "occurrence-create";
      occurrenceId: string;
      nodeId: string;
      parentOccurrenceId: string | null;
      parentPolicy: "cascade" | "rehome";
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "occurrence-delete";
      occurrenceId: string;
      childPolicy: "cascade" | "rehome";
      previousParentOccurrenceId?: string | null;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "occurrence-restore";
      occurrenceId: string;
      deletionFactId: FactId;
      parentOccurrenceId: string | null;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "occurrence-move";
      occurrenceId: string;
      parentOccurrenceId: string | null;
      anchor: SequenceAnchor;
      previousParentOccurrenceId?: string | null;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "canonical-occurrence-set";
      nodeId: string;
      occurrenceId: string;
      previousOccurrenceId?: string | null;
    }>
  | Readonly<{
      kind: "text-splice";
      nodeId: string;
      deleteAtomIds: readonly TextAtomId[];
      deletedAtoms?: readonly Readonly<{
        id: TextAtomId;
        value: string;
        attributes: Readonly<Record<string, JsonValue>>;
      }>[];
      anchor: SequenceAnchor;
      insert: string;
      attributes?: Readonly<Record<string, JsonValue>>;
    }>
  | Readonly<{
      kind: "text-mark";
      nodeId: string;
      atomIds: readonly TextAtomId[];
      key: string;
      value: PreviousValue;
      previous?: PreviousValue;
    }>
  | Readonly<{
      kind: "value-set";
      owner: ValueOwner;
      namespace: "property" | "metadata" | "schema";
      key: string;
      value: JsonValue;
      previous?: PreviousValue;
    }>
  | Readonly<{
      kind: "value-unset";
      owner: ValueOwner;
      namespace: "property" | "metadata" | "schema";
      key: string;
      previous?: PreviousValue;
    }>;

export type ContributionBody = Readonly<{
  kind: "contribution";
  actorId: ActorId;
  intent: EditIntent;
  mutation: Mutation;
}>;

export type ResolutionBody = Readonly<{
  kind: "resolution";
  actorId: ActorId;
  decision: ResolutionDecision;
  proposalContributionIds: readonly ContributionId[];
}>;

export type FactBody = ContributionBody | ResolutionBody;

export type Fact = Readonly<{
  formatGeneration: typeof FORMAT_GENERATION;
  schemaVersion: typeof FACT_SCHEMA_VERSION;
  workspaceId: WorkspaceId;
  id: FactId;
  coordinate: CausalCoordinate;
  body: FactBody;
  contentDigest: string;
}>;

export type ContributionFact = Fact & Readonly<{ body: ContributionBody }>;
export type ResolutionFact = Fact & Readonly<{ body: ResolutionBody }>;

export type FactSnapshot = Readonly<{
  facts: readonly Fact[];
  frontier: FactFrontier;
}>;

export type Admission = Readonly<{
  kind: "ready" | "pending" | "fault";
  snapshot: FactSnapshot;
  pendingFactIds: readonly FactId[];
  fault: string | null;
}>;

export type HistoryOperation = "normal" | "undo" | "redo";

export type ReceiptLineage = Readonly<{
  channelId: HistoryChannelId;
  ordinal: number;
  parentStepId: InvocationId | null;
  operation: HistoryOperation;
  targetStepId: InvocationId | null;
}>;

export type AuthorityReceipt = Readonly<{
  workspaceId: WorkspaceId;
  replicaId: ReplicaId;
  invocationId: InvocationId;
  requestDigest: string;
  factIds: readonly FactId[];
  committedFrontier: FactFrontier;
  lineage: ReceiptLineage | null;
}>;

export type AuthorityRecord =
  | Readonly<{ recordKind: "fact"; fact: Fact }>
  | Readonly<{ recordKind: "receipt"; receipt: AuthorityReceipt }>
  | Readonly<{
      recordKind: "quarantine";
      reason: string;
      updateDigest: string;
    }>;

export type RulesVersion = string;
export type SchemaVersion = string;

export type ProjectionGenerationId = string;

export type ProjectionIdentity = Readonly<{
  generationId: ProjectionGenerationId;
  frontier: FactFrontier;
  rulesVersion: RulesVersion;
  schemaVersion: SchemaVersion;
}>;

export type AuthorityFault = Readonly<{
  message: string;
  conflictingFactId?: FactId;
}>;
