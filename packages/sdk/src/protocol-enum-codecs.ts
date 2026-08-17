import {
  backlinkSourceKind,
  editIntent,
  engineErrorCode,
  engineEventKind,
  viewRowSourceKind,
} from "./protocol-enums/engine.js";
import { contributionMutationKind } from "./protocol-enums/fact.js";
import { hardDeleteBlocker } from "./protocol-enums/maintenance.js";
import {
  anchorAffinity,
  anchorFallback,
  historyOperation,
  intrinsicNodeType,
  inlineReferenceTargetStatus,
  viewType,
  templateFieldVisibility,
  viewSortDirection,
  searchDateComparisonOperator,
} from "./protocol-enums/model.js";
import {
  projectionPerspective,
  projectionSection,
  templateFieldDefinitionOwner,
  templateNodeState,
  typedFieldValueState,
} from "./protocol-enums/projection.js";
import {
  diffSpaceKind,
  placementEndpoint,
  recoveryAction,
  resolutionDecision,
  supertagRelationKind,
} from "./protocol-enums/review.js";
import type { ProtocolEnumCodec } from "./protocol-enums/enum-codec.js";

type AnyEnumCodec = ProtocolEnumCodec<number, string>;

export const protocolEnumCodecs = new Map<string, AnyEnumCodec>([
  ["lode.AnchorAffinity", anchorAffinity],
  ["lode.AnchorFallback", anchorFallback],
  ["lode.ContributionMutationKind", contributionMutationKind],
  ["lode.EditIntent", editIntent],
  ["lode.EngineErrorCode", engineErrorCode],
  ["lode.EngineEventKind", engineEventKind],
  ["lode.HardDeleteBlocker", hardDeleteBlocker],
  ["lode.HistoryOperation", historyOperation],
  ["lode.IntrinsicNodeType", intrinsicNodeType],
  ["lode.PlacementEndpoint", placementEndpoint],
  ["lode.ProjectionSection", projectionSection],
  ["lode.RecoveryAction", recoveryAction],
  ["lode.ResolutionDecision", resolutionDecision],
  ["lode.SupertagRelationKind", supertagRelationKind],
  ["lode.TemplateNodeState", templateNodeState],
  ["lode.TemplateFieldDefinitionOwner", templateFieldDefinitionOwner],
  ["lode.TypedFieldValueState", typedFieldValueState],
  ["lode.TemplateFieldVisibility", templateFieldVisibility],
  ["lode.ProjectionPerspective", projectionPerspective],
  ["lode.DiffSpaceKind", diffSpaceKind],
  ["lode.InlineReferenceTargetStatus", inlineReferenceTargetStatus],
  ["lode.BacklinkSourceKind", backlinkSourceKind],
  ["lode.ViewType", viewType],
  ["lode.ViewSortDirection", viewSortDirection],
  ["lode.SearchDateComparisonOperator", searchDateComparisonOperator],
  ["lode.ViewRowReference.SourceKind", viewRowSourceKind],
]);
