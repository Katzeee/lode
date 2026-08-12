import type { JsonValue, ProjectionIdentity, TextAtomId, ViewMode } from "../fact/index.js";

export type TextAtom = Readonly<{
  id: TextAtomId;
  value: string;
  attributes: Readonly<Record<string, JsonValue>>;
  contributionId: string;
}>;

export type ProjectedNode = Readonly<{
  nodeId: string;
  text: readonly TextAtom[];
  properties: Readonly<Record<string, JsonValue>>;
  metadata: Readonly<Record<string, JsonValue>>;
}>;

export type ProjectedOccurrence = Readonly<{
  occurrenceId: string;
  nodeId: string;
  parentOccurrenceId: string | null;
  properties: Readonly<Record<string, JsonValue>>;
  metadata: Readonly<Record<string, JsonValue>>;
  managed: boolean;
}>;

export type ManagedChild = Readonly<{
  parentNodeId: string;
  schemaId: string;
  fieldId: string;
  nodeId: string;
  occurrenceId: string;
}>;

export type Projection = Readonly<{
  view: ViewMode;
  identity: ProjectionIdentity;
  nodes: Readonly<Record<string, ProjectedNode>>;
  occurrences: Readonly<Record<string, ProjectedOccurrence>>;
  children: Readonly<Record<string, readonly string[]>>;
  canonicalOccurrences: Readonly<Record<string, string>>;
  addressedValues: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  managedChildren: readonly ManagedChild[];
}>;

export type ProjectionGeneration = Readonly<{
  identity: ProjectionIdentity;
  origin: Projection;
  review: Projection;
  ownerCaches: Readonly<{
    origin: ProjectionOwnerCache;
    review: ProjectionOwnerCache;
  }>;
}>;

export type ProjectionOwnerCache = Readonly<{
  activeContributionIds: readonly string[];
  supportPasses: number;
}>;

export type ProjectionVersions = Readonly<{
  rulesVersion: string;
  schemaVersion: string;
}>;

export const CURRENT_PROJECTION_VERSIONS: ProjectionVersions = {
  rulesVersion: "proposal-rules-1",
  schemaVersion: "proposal-schema-1",
};

export function assertSupportedProjectionVersions(versions: ProjectionVersions): void {
  if (
    versions.rulesVersion !== CURRENT_PROJECTION_VERSIONS.rulesVersion ||
    versions.schemaVersion !== CURRENT_PROJECTION_VERSIONS.schemaVersion
  ) {
    throw new Error(
      `Unsupported projection versions: ${versions.rulesVersion}/${versions.schemaVersion}`,
    );
  }
}
