import {
  EditIntent as ProtocolEditIntent,
  EngineErrorCode as ProtocolEngineErrorCode,
  EngineEventKind as ProtocolEngineEventKind,
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
    [ProtocolEngineErrorCode.UNRECOGNIZED]: null,
  },
  "Engine error code",
);
export type EngineErrorCode = DomainEnum<typeof engineErrorCode>;

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
