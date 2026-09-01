import {
  BacklinkSourceKind as ProtocolBacklinkSourceKind,
  EditIntent as ProtocolEditIntent,
  EngineErrorCode as ProtocolEngineErrorCode,
  EngineEventKind as ProtocolEngineEventKind,
  ViewRowReference_SourceKind as ProtocolViewRowSourceKind,
} from "@lode/protocol/proto";
import { protocolEnum, type DomainEnum } from "./enum-codec.js";

export const editIntent = protocolEnum(ProtocolEditIntent, "Edit intent");
export type EditIntent = DomainEnum<typeof editIntent>;

export const engineErrorCode = protocolEnum(ProtocolEngineErrorCode, "Engine error code");
export type EngineErrorCode = DomainEnum<typeof engineErrorCode>;

export const engineEventKind = protocolEnum(ProtocolEngineEventKind, "Engine event kind");
export type EngineEventKind = DomainEnum<typeof engineEventKind>;

export const backlinkSourceKind = protocolEnum(ProtocolBacklinkSourceKind, "Backlink source kind");
export type BacklinkSourceKind = DomainEnum<typeof backlinkSourceKind>;

export const viewRowSourceKind = protocolEnum(ProtocolViewRowSourceKind, "View row source kind");
export type ViewRowSourceKind = DomainEnum<typeof viewRowSourceKind>;
