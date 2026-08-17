import {
  AnchorAffinity as ProtocolAnchorAffinity,
  AnchorFallback as ProtocolAnchorFallback,
  HistoryOperation as ProtocolHistoryOperation,
  IntrinsicNodeType as ProtocolIntrinsicNodeType,
  InlineReferenceTargetStatus as ProtocolInlineReferenceTargetStatus,
  ViewType as ProtocolViewType,
  TemplateFieldVisibility as ProtocolTemplateFieldVisibility,
  ViewSortDirection as ProtocolViewSortDirection,
  SearchDateComparisonOperator as ProtocolSearchDateComparisonOperator,
} from "@lode/protocol/dto/model";
import { defineProtocolEnum, type DomainEnum } from "./enum-codec.js";

export const anchorAffinity = defineProtocolEnum<ProtocolAnchorAffinity>()(
  {
    [ProtocolAnchorAffinity.ANCHOR_AFFINITY_UNSPECIFIED]: null,
    [ProtocolAnchorAffinity.ANCHOR_AFFINITY_AFTER]: "after",
    [ProtocolAnchorAffinity.ANCHOR_AFFINITY_BEFORE]: "before",
    [ProtocolAnchorAffinity.UNRECOGNIZED]: null,
  },
  "Anchor affinity",
);
export type AnchorAffinity = DomainEnum<typeof anchorAffinity>;

export const anchorFallback = defineProtocolEnum<ProtocolAnchorFallback>()(
  {
    [ProtocolAnchorFallback.ANCHOR_FALLBACK_UNSPECIFIED]: null,
    [ProtocolAnchorFallback.ANCHOR_FALLBACK_START]: "start",
    [ProtocolAnchorFallback.ANCHOR_FALLBACK_END]: "end",
    [ProtocolAnchorFallback.UNRECOGNIZED]: null,
  },
  "Anchor fallback",
);
export type AnchorFallback = DomainEnum<typeof anchorFallback>;

export const intrinsicNodeType = defineProtocolEnum<ProtocolIntrinsicNodeType>()(
  {
    [ProtocolIntrinsicNodeType.INTRINSIC_NODE_TYPE_UNSPECIFIED]: null,
    [ProtocolIntrinsicNodeType.INTRINSIC_NODE_TYPE_SUPERTAG_DEFINITION]: "supertag-definition",
    [ProtocolIntrinsicNodeType.INTRINSIC_NODE_TYPE_FIELD_DEFINITION]: "field-definition",
    [ProtocolIntrinsicNodeType.INTRINSIC_NODE_TYPE_FIELD]: "field",
    [ProtocolIntrinsicNodeType.INTRINSIC_NODE_TYPE_SEARCH]: "search",
    [ProtocolIntrinsicNodeType.INTRINSIC_NODE_TYPE_COMMAND]: "command",
    [ProtocolIntrinsicNodeType.INTRINSIC_NODE_TYPE_WORKSPACE]: "workspace",
    [ProtocolIntrinsicNodeType.INTRINSIC_NODE_TYPE_CALENDAR]: "calendar",
    [ProtocolIntrinsicNodeType.UNRECOGNIZED]: null,
  },
  "Intrinsic Node Type",
);
export type IntrinsicNodeType = DomainEnum<typeof intrinsicNodeType>;

export const historyOperation = defineProtocolEnum<ProtocolHistoryOperation>()(
  {
    [ProtocolHistoryOperation.HISTORY_OPERATION_UNSPECIFIED]: null,
    [ProtocolHistoryOperation.HISTORY_OPERATION_NORMAL]: "normal",
    [ProtocolHistoryOperation.HISTORY_OPERATION_UNDO]: "undo",
    [ProtocolHistoryOperation.HISTORY_OPERATION_REDO]: "redo",
    [ProtocolHistoryOperation.UNRECOGNIZED]: null,
  },
  "History operation",
);
export type HistoryOperation = DomainEnum<typeof historyOperation>;

export const inlineReferenceTargetStatus = defineProtocolEnum<ProtocolInlineReferenceTargetStatus>()(
  {
    [ProtocolInlineReferenceTargetStatus.INLINE_REFERENCE_TARGET_STATUS_UNSPECIFIED]: null,
    [ProtocolInlineReferenceTargetStatus.INLINE_REFERENCE_TARGET_STATUS_ACTIVE]: "active",
    [ProtocolInlineReferenceTargetStatus.INLINE_REFERENCE_TARGET_STATUS_TRASH]: "trash",
    [ProtocolInlineReferenceTargetStatus.INLINE_REFERENCE_TARGET_STATUS_UNAVAILABLE]: "unavailable",
    [ProtocolInlineReferenceTargetStatus.UNRECOGNIZED]: null,
  },
  "Inline Reference target status",
);
export type InlineReferenceTargetStatus = DomainEnum<typeof inlineReferenceTargetStatus>;

export const viewType = defineProtocolEnum<ProtocolViewType>()(
  {
    [ProtocolViewType.VIEW_TYPE_UNSPECIFIED]: null,
    [ProtocolViewType.VIEW_TYPE_OUTLINE]: "outline",
    [ProtocolViewType.VIEW_TYPE_TABLE]: "table",
    [ProtocolViewType.UNRECOGNIZED]: null,
  },
  "View type",
);
export type ViewType = DomainEnum<typeof viewType>;

export const viewSortDirection = defineProtocolEnum<ProtocolViewSortDirection>()(
  {
    [ProtocolViewSortDirection.VIEW_SORT_DIRECTION_UNSPECIFIED]: null,
    [ProtocolViewSortDirection.VIEW_SORT_DIRECTION_ASCENDING]: "ascending",
    [ProtocolViewSortDirection.VIEW_SORT_DIRECTION_DESCENDING]: "descending",
    [ProtocolViewSortDirection.UNRECOGNIZED]: null,
  },
  "View sort direction",
);
export type ViewSortDirection = DomainEnum<typeof viewSortDirection>;

export const searchDateComparisonOperator = defineProtocolEnum<ProtocolSearchDateComparisonOperator>()(
  {
    [ProtocolSearchDateComparisonOperator.SEARCH_DATE_COMPARISON_OPERATOR_UNSPECIFIED]: null,
    [ProtocolSearchDateComparisonOperator.SEARCH_DATE_COMPARISON_OPERATOR_LT]: "lt",
    [ProtocolSearchDateComparisonOperator.SEARCH_DATE_COMPARISON_OPERATOR_GT]: "gt",
    [ProtocolSearchDateComparisonOperator.UNRECOGNIZED]: null,
  },
  "Search Date comparison operator",
);

export const templateFieldVisibility = defineProtocolEnum<ProtocolTemplateFieldVisibility>()(
  {
    [ProtocolTemplateFieldVisibility.TEMPLATE_FIELD_VISIBILITY_UNSPECIFIED]: null,
    [ProtocolTemplateFieldVisibility.TEMPLATE_FIELD_VISIBILITY_NORMAL]: "normal",
    [ProtocolTemplateFieldVisibility.TEMPLATE_FIELD_VISIBILITY_PINNED]: "pinned",
    [ProtocolTemplateFieldVisibility.UNRECOGNIZED]: null,
  },
  "Template Field visibility",
);
export type TemplateFieldVisibility = DomainEnum<typeof templateFieldVisibility>;
