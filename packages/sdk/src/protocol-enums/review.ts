import {
  DiffSpaceKind as ProtocolDiffSpaceKind,
  PlacementEndpoint as ProtocolPlacementEndpoint,
  RecoveryAction as ProtocolRecoveryAction,
  ResolutionDecision as ProtocolResolutionDecision,
  SupertagRelationKind as ProtocolSupertagRelationKind,
} from "@lode/protocol/proto";
import { protocolEnum, type DomainEnum } from "./enum-codec.js";

export const resolutionDecision = protocolEnum(ProtocolResolutionDecision, "Resolution decision");
export type ResolutionDecision = DomainEnum<typeof resolutionDecision>;

export const supertagRelationKind = protocolEnum(ProtocolSupertagRelationKind, "Supertag relation kind");
export type SupertagRelationKind = DomainEnum<typeof supertagRelationKind>;

export const diffSpaceKind = protocolEnum(ProtocolDiffSpaceKind, "Diff space kind");
export type DiffSpaceKind = DomainEnum<typeof diffSpaceKind>;

export const recoveryAction = protocolEnum(ProtocolRecoveryAction, "Recovery action");
export type RecoveryAction = DomainEnum<typeof recoveryAction>;

export const placementEndpoint = protocolEnum(ProtocolPlacementEndpoint, "Placement endpoint");
export type PlacementEndpoint = DomainEnum<typeof placementEndpoint>;
