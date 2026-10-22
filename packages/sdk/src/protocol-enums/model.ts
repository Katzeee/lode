import {
  AnchorAffinity as ProtocolAnchorAffinity,
  AnchorFallback as ProtocolAnchorFallback,
  HistoryOperation as ProtocolHistoryOperation,
  InlineReferenceTargetStatus as ProtocolInlineReferenceTargetStatus,
  IntrinsicNodeType as ProtocolIntrinsicNodeType,
  SearchDateComparisonOperator as ProtocolSearchDateComparisonOperator,
  TemplateFieldVisibility as ProtocolTemplateFieldVisibility,
  ViewSortDirection as ProtocolViewSortDirection,
  ViewType as ProtocolViewType,
} from "@lode/protocol/proto";
import { protocolEnum, type DomainEnum } from "./enum-codec.js";

export const anchorAffinity = protocolEnum(ProtocolAnchorAffinity, "Anchor affinity");
export type AnchorAffinity = DomainEnum<typeof anchorAffinity>;

export const anchorFallback = protocolEnum(ProtocolAnchorFallback, "Anchor fallback");
export type AnchorFallback = DomainEnum<typeof anchorFallback>;

export const intrinsicNodeType = protocolEnum(ProtocolIntrinsicNodeType, "Intrinsic Node Type");
export type IntrinsicNodeType = DomainEnum<typeof intrinsicNodeType>;

export const historyOperation = protocolEnum(ProtocolHistoryOperation, "History operation");
export type HistoryOperation = DomainEnum<typeof historyOperation>;

export const inlineReferenceTargetStatus = protocolEnum(
  ProtocolInlineReferenceTargetStatus,
  "Inline Reference target status",
);
export type InlineReferenceTargetStatus = DomainEnum<typeof inlineReferenceTargetStatus>;

export const viewType = protocolEnum(ProtocolViewType, "View type");
export type ViewType = DomainEnum<typeof viewType>;

export const viewSortDirection = protocolEnum(ProtocolViewSortDirection, "View sort direction");
export type ViewSortDirection = DomainEnum<typeof viewSortDirection>;

export const searchDateComparisonOperator = protocolEnum(
  ProtocolSearchDateComparisonOperator,
  "Search Date comparison operator",
);

export const templateFieldVisibility = protocolEnum(ProtocolTemplateFieldVisibility, "Template Field visibility");
export type TemplateFieldVisibility = DomainEnum<typeof templateFieldVisibility>;
