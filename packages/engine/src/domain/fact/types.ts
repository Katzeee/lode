import type { AuthoredAction, GraphAction, ProposableAction, TerminalAction } from "./action-catalog.js";
import type {
  ActorId,
  CausalCoordinate,
  EditIntent,
  FactActionId,
  FactFrontier,
  FactId,
  HistoryChannelId,
  HistoryOperation,
  ResolutionDecision,
  ResolutionId,
  WorkspaceId,
} from "./fact-value-types.js";
import type { GovernanceBody } from "./governance-types.js";

export type {
  ActorId,
  CausalCoordinate,
  EditIntent,
  FactActionId,
  FactFrontier,
  FactId,
  HistoryChannelId,
  HistoryOperation,
  InvocationId,
  JsonValue,
  PreviousValue,
  ProjectionPerspective,
  ReplicaId,
  ResolutionDecision,
  ResolutionId,
  SequenceAnchor,
  TextAtomId,
  WorkspaceId,
} from "./fact-value-types.js";

export type { AuthoredAction, GraphAction, ProposableAction, TerminalAction } from "./action-catalog.js";

export const FACT_ID_GENERATION = 1 as const;

type DirectGraphActionBody = Readonly<{
  kind: "action";
  actorId: ActorId;
  intent: "direct";
  actions: readonly [GraphAction, ...GraphAction[]];
}>;

type ProposalActionBody = Readonly<{
  kind: "action";
  actorId: ActorId;
  intent: "proposal";
  actions: readonly [ProposableAction, ...ProposableAction[]];
}>;

type TerminalActionBody = Readonly<{
  kind: "action";
  actorId: ActorId;
  intent: "direct";
  actions: readonly [TerminalAction, ...TerminalAction[]];
}>;

export type ActionBody = DirectGraphActionBody | ProposalActionBody | TerminalActionBody;

export type ResolutionBody = Readonly<{
  kind: "resolution";
  actorId: ActorId;
  decision: ResolutionDecision;
  proposalFactIds: readonly FactId[];
  adjudicatesResolutionIds: readonly ResolutionId[];
}>;

export type HistoryBody = Readonly<{
  kind: "history";
  channelId: HistoryChannelId;
  operation: HistoryOperation;
  targetStepId: FactId | null;
  actionFactCount: number;
}>;

export type FactBody = ActionBody | ResolutionBody | GovernanceBody | HistoryBody;

export type Fact = Readonly<{
  id: FactId;
  coordinate: CausalCoordinate;
  body: FactBody;
}>;

export type FactAction<Action extends AuthoredAction = AuthoredAction> = Readonly<{
  id: FactActionId;
  factId: FactId;
  index: number;
  coordinate: CausalCoordinate;
  actorId: ActorId;
  intent: EditIntent;
  action: Action;
}>;

export type ActionFact = Fact & Readonly<{ body: ActionBody }>;
export type ResolutionFact = Fact & Readonly<{ body: ResolutionBody }>;

export type FactSnapshot = Readonly<{
  facts: readonly Fact[];
  frontier: FactFrontier;
}>;

export type { InlineReferenceId } from "./inline-reference-types.js";
type RulesVersion = string;
type SchemaVersion = string;

type ProjectionGenerationId = string;

export type ProjectionIdentity = Readonly<{
  workspaceNodeId: WorkspaceId;
  generationId: ProjectionGenerationId;
  frontier: FactFrontier;
  rulesVersion: RulesVersion;
  schemaVersion: SchemaVersion;
}>;
