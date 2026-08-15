import { editMutationKind } from "./protocol-enums/edit.js";
import { editIntent, engineErrorCode, engineEventKind } from "./protocol-enums/engine.js";
import { contributionMutationKind } from "./protocol-enums/fact.js";
import { hardDeleteBlocker } from "./protocol-enums/maintenance.js";
import {
  anchorAffinity,
  anchorFallback,
  fieldInitializationSource,
  fieldVisibility,
  historyOperation,
  nodeType,
  valueNamespace,
} from "./protocol-enums/model.js";
import {
  nodeState,
  projectionSection,
  templateNodeState,
  viewFieldState,
  viewLayout,
  viewMode,
} from "./protocol-enums/projection.js";
import {
  diffSpaceKind,
  placementEndpoint,
  recoveryAction,
  resolutionDecision,
  schemaRelationKind,
} from "./protocol-enums/review.js";
import type { ProtocolEnumCodec } from "./protocol-enums/enum-codec.js";

type AnyEnumCodec = ProtocolEnumCodec<number, string>;

export const protocolEnumCodecs = new Map<string, AnyEnumCodec>([
  ["lode.AnchorAffinity", anchorAffinity],
  ["lode.AnchorFallback", anchorFallback],
  ["lode.ContributionMutationKind", contributionMutationKind],
  ["lode.EditIntent", editIntent],
  ["lode.EditMutationKind", editMutationKind],
  ["lode.EngineErrorCode", engineErrorCode],
  ["lode.EngineEventKind", engineEventKind],
  ["lode.FieldInitializationSource", fieldInitializationSource],
  ["lode.FieldVisibility", fieldVisibility],
  ["lode.HardDeleteBlocker", hardDeleteBlocker],
  ["lode.HistoryOperation", historyOperation],
  ["lode.NodeState", nodeState],
  ["lode.NodeType", nodeType],
  ["lode.PlacementEndpoint", placementEndpoint],
  ["lode.ProjectionSection", projectionSection],
  ["lode.RecoveryAction", recoveryAction],
  ["lode.ResolutionDecision", resolutionDecision],
  ["lode.SchemaRelationKind", schemaRelationKind],
  ["lode.TemplateNodeState", templateNodeState],
  ["lode.ValueNamespace", valueNamespace],
  ["lode.ViewFieldState", viewFieldState],
  ["lode.ViewLayout", viewLayout],
  ["lode.ViewMode", viewMode],
  ["lode.DiffSpaceKind", diffSpaceKind],
]);
