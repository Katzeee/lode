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
  fieldInitializationSource,
  fieldDatatype,
  fieldCardinality,
  fieldVisibility,
  historyOperation,
  nodeType,
  inlineReferenceTargetStatus,
  viewType,
} from "./protocol-enums/model.js";
import { projectionPerspective, projectionSection, templateNodeState } from "./protocol-enums/projection.js";
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
  ["lode.FieldInitializationSource", fieldInitializationSource],
  ["lode.FieldDatatype", fieldDatatype],
  ["lode.FieldCardinality", fieldCardinality],
  ["lode.FieldVisibility", fieldVisibility],
  ["lode.HardDeleteBlocker", hardDeleteBlocker],
  ["lode.HistoryOperation", historyOperation],
  ["lode.NodeType", nodeType],
  ["lode.PlacementEndpoint", placementEndpoint],
  ["lode.ProjectionSection", projectionSection],
  ["lode.RecoveryAction", recoveryAction],
  ["lode.ResolutionDecision", resolutionDecision],
  ["lode.SupertagRelationKind", supertagRelationKind],
  ["lode.TemplateNodeState", templateNodeState],
  ["lode.ProjectionPerspective", projectionPerspective],
  ["lode.DiffSpaceKind", diffSpaceKind],
  ["lode.InlineReferenceTargetStatus", inlineReferenceTargetStatus],
  ["lode.BacklinkSourceKind", backlinkSourceKind],
  ["lode.ViewType", viewType],
  ["lode.ViewRowReference.SourceKind", viewRowSourceKind],
]);
