import {
  AnchorAffinity as ProtocolAnchorAffinity,
  AnchorFallback as ProtocolAnchorFallback,
  FieldInitializationSource as ProtocolFieldInitializationSource,
  FieldVisibility as ProtocolFieldVisibility,
  HistoryOperation as ProtocolHistoryOperation,
  NodeType as ProtocolNodeType,
  ValueNamespace as ProtocolValueNamespace,
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

export const nodeType = defineProtocolEnum<ProtocolNodeType>()(
  {
    [ProtocolNodeType.NODE_TYPE_UNSPECIFIED]: null,
    [ProtocolNodeType.NODE_TYPE_SCHEMA]: "schema",
    [ProtocolNodeType.NODE_TYPE_FIELD_DEFINITION]: "field-definition",
    [ProtocolNodeType.NODE_TYPE_FIELD]: "field",
    [ProtocolNodeType.NODE_TYPE_SEARCH]: "search",
    [ProtocolNodeType.NODE_TYPE_COMMAND]: "command",
    [ProtocolNodeType.NODE_TYPE_WORKSPACE]: "workspace",
    [ProtocolNodeType.NODE_TYPE_CALENDAR]: "calendar",
    [ProtocolNodeType.NODE_TYPE_VIEW]: "view",
    [ProtocolNodeType.UNRECOGNIZED]: null,
  },
  "Node type",
);
export type NodeType = DomainEnum<typeof nodeType>;

export const fieldVisibility = defineProtocolEnum<ProtocolFieldVisibility>()(
  {
    [ProtocolFieldVisibility.FIELD_VISIBILITY_UNSPECIFIED]: null,
    [ProtocolFieldVisibility.FIELD_VISIBILITY_PINNED]: "pinned",
    [ProtocolFieldVisibility.FIELD_VISIBILITY_NORMAL]: "normal",
    [ProtocolFieldVisibility.FIELD_VISIBILITY_OPTIONAL]: "optional",
    [ProtocolFieldVisibility.UNRECOGNIZED]: null,
  },
  "Field visibility",
);
export type FieldVisibility = DomainEnum<typeof fieldVisibility>;

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

export const valueNamespace = defineProtocolEnum<ProtocolValueNamespace>()(
  {
    [ProtocolValueNamespace.VALUE_NAMESPACE_UNSPECIFIED]: null,
    [ProtocolValueNamespace.VALUE_NAMESPACE_PROPERTY]: "property",
    [ProtocolValueNamespace.VALUE_NAMESPACE_METADATA]: "metadata",
    [ProtocolValueNamespace.VALUE_NAMESPACE_SCHEMA]: "schema",
    [ProtocolValueNamespace.UNRECOGNIZED]: null,
  },
  "Value namespace",
);
export type ValueNamespace = DomainEnum<typeof valueNamespace>;

export const fieldInitializationSource = defineProtocolEnum<ProtocolFieldInitializationSource>()(
  {
    [ProtocolFieldInitializationSource.FIELD_INITIALIZATION_SOURCE_UNSPECIFIED]: null,
    [ProtocolFieldInitializationSource.FIELD_INITIALIZATION_SOURCE_STATIC_DEFAULT]: "static-default",
    [ProtocolFieldInitializationSource.FIELD_INITIALIZATION_SOURCE_AUTO_INITIALIZE]: "auto-initialize",
    [ProtocolFieldInitializationSource.UNRECOGNIZED]: null,
  },
  "Field initialization source",
);
export type FieldInitializationSource = DomainEnum<typeof fieldInitializationSource>;
