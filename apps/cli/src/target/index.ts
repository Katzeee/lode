export {
  TARGET_KINDS,
  parseSelector,
  descriptor,
  nodeLabel,
  resolveWorkspaceFromList,
  type TargetKind,
  type ParsedSelector,
  type ResourceDescriptor,
  type WorkspaceEntry,
} from "./selector.js";
export {
  resolveNodeTarget,
  resolveOccurrenceTarget,
  anchorFor,
  readNodeUniverse,
  labelOf,
  ownerLabel,
  ownerChainIncludes,
  type ResolvedNodeTarget,
  type ResolvedOccurrenceTarget,
  type ProjectedOccurrenceLike,
} from "./nodes.js";
