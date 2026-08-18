import {
  EditIntent as ProtocolEditIntent,
  EngineErrorCode as ProtocolEngineErrorCode,
  EngineEventKind as ProtocolEngineEventKind,
  BacklinkSourceKind as ProtocolBacklinkSourceKind,
  ViewRowReference_SourceKind as ProtocolViewRowSourceKind,
  WorkspaceRunState as ProtocolWorkspaceRunState,
} from "@lode/protocol/dto/engine";
import { defineProtocolEnum, type DomainEnum } from "./enum-codec.js";

export const editIntent = defineProtocolEnum<ProtocolEditIntent>()(
  {
    [ProtocolEditIntent.EDIT_INTENT_UNSPECIFIED]: null,
    [ProtocolEditIntent.EDIT_INTENT_DIRECT]: "direct",
    [ProtocolEditIntent.EDIT_INTENT_PROPOSAL]: "proposal",
    [ProtocolEditIntent.UNRECOGNIZED]: null,
  },
  "Edit intent",
);
export type EditIntent = DomainEnum<typeof editIntent>;

export const engineErrorCode = defineProtocolEnum<ProtocolEngineErrorCode>()(
  {
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_UNSPECIFIED]: null,
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_INVALID_INPUT]: "invalid-input",
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_STALE_SELECTION]: "stale-selection",
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_PROJECTION_UNAVAILABLE]: "projection-unavailable",
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_INVOCATION_CONFLICT]: "invocation-conflict",
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_AUTHORITY_FAULT]: "authority-fault",
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_HISTORY_UNAVAILABLE]: "history-unavailable",
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_MAINTENANCE_BLOCKED]: "maintenance-blocked",
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_WORKSPACE_NOT_FOUND]: "workspace-not-found",
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_ACTOR_LOCKED]: "actor-locked",
    [ProtocolEngineErrorCode.ENGINE_ERROR_CODE_ACTOR_NOT_MEMBER]: "actor-not-member",
    [ProtocolEngineErrorCode.UNRECOGNIZED]: null,
  },
  "Engine error code",
);
export type EngineErrorCode = DomainEnum<typeof engineErrorCode>;

export const workspaceRunState = defineProtocolEnum<ProtocolWorkspaceRunState>()(
  {
    [ProtocolWorkspaceRunState.WORKSPACE_RUN_STATE_UNSPECIFIED]: null,
    [ProtocolWorkspaceRunState.WORKSPACE_RUN_STATE_ACTIVE]: "active",
    [ProtocolWorkspaceRunState.WORKSPACE_RUN_STATE_AUTHORITY_FAULT]: "authority-fault",
    [ProtocolWorkspaceRunState.UNRECOGNIZED]: null,
  },
  "Workspace run state",
);
export type WorkspaceRunStateEnum = DomainEnum<typeof workspaceRunState>;

export const engineEventKind = defineProtocolEnum<ProtocolEngineEventKind>()(
  {
    [ProtocolEngineEventKind.ENGINE_EVENT_KIND_UNSPECIFIED]: null,
    [ProtocolEngineEventKind.ENGINE_EVENT_KIND_AUTHORITY_ADVANCED]: "authority-advanced",
    [ProtocolEngineEventKind.ENGINE_EVENT_KIND_PROJECTION_PUBLISHED]: "projection-published",
    [ProtocolEngineEventKind.ENGINE_EVENT_KIND_PROJECTION_FAILED]: "projection-failed",
    [ProtocolEngineEventKind.ENGINE_EVENT_KIND_PROJECTION_RECOVERED]: "projection-recovered",
    [ProtocolEngineEventKind.UNRECOGNIZED]: null,
  },
  "Engine event kind",
);
export type EngineEventKind = DomainEnum<typeof engineEventKind>;

export const backlinkSourceKind = defineProtocolEnum<ProtocolBacklinkSourceKind>()(
  {
    [ProtocolBacklinkSourceKind.BACKLINK_SOURCE_KIND_UNSPECIFIED]: null,
    [ProtocolBacklinkSourceKind.BACKLINK_SOURCE_KIND_BLOCK]: "block",
    [ProtocolBacklinkSourceKind.BACKLINK_SOURCE_KIND_INLINE]: "inline",
    [ProtocolBacklinkSourceKind.UNRECOGNIZED]: null,
  },
  "Backlink source kind",
);
export type BacklinkSourceKind = DomainEnum<typeof backlinkSourceKind>;

export const viewRowSourceKind = defineProtocolEnum<ProtocolViewRowSourceKind>()(
  {
    [ProtocolViewRowSourceKind.SOURCE_KIND_UNSPECIFIED]: null,
    [ProtocolViewRowSourceKind.SOURCE_KIND_OCCURRENCE]: "occurrence",
    [ProtocolViewRowSourceKind.SOURCE_KIND_SEARCH_RESULT]: "search-result",
    [ProtocolViewRowSourceKind.UNRECOGNIZED]: null,
  },
  "View row source kind",
);
export type ViewRowSourceKind = DomainEnum<typeof viewRowSourceKind>;
