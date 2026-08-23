import { canonicalDigest, type FactActionId, type FactSnapshot, type ProjectionIdentity } from "../fact/index.js";
import type { ProjectionVersions } from "./projection-types.js";

export function projectionIdentity(
  workspaceId: string,
  snapshot: FactSnapshot,
  versions: ProjectionVersions,
): ProjectionIdentity {
  return {
    workspaceNodeId: workspaceId,
    generationId: canonicalDigest({
      workspaceId,
      frontier: snapshot.frontier,
      rulesVersion: versions.rulesVersion,
      schemaVersion: versions.schemaVersion,
    }),
    frontier: snapshot.frontier,
    rulesVersion: versions.rulesVersion,
    schemaVersion: versions.schemaVersion,
  };
}

export function templateMemberOccurrenceId(actionId: FactActionId): string {
  return `${actionId}/projection/template-member-occurrence`;
}

export function metanodeNodeId(hostNodeId: string): string {
  return `metanode:v1:${encodeURIComponent(hostNodeId)}`;
}

export function metanodeHostNodeId(nodeId: string): string | null {
  const prefix = "metanode:v1:";
  if (!nodeId.startsWith(prefix)) {
    return null;
  }
  try {
    const hostNodeId = decodeURIComponent(nodeId.slice(prefix.length));
    return hostNodeId.length > 0 ? hostNodeId : null;
  } catch {
    return null;
  }
}

export type FieldConfigurationProjectionIdentity = Readonly<{
  configurationNodeId: string;
  configurationOccurrenceId: string;
  definitionOccurrenceId: string;
  valueOccurrenceId: string;
  optionsSupertagOccurrenceId: string;
  expressionNodeId: string;
  expressionOccurrenceId: string;
  sourceFieldDefinitionOccurrenceId: string;
  contextNodeId: string;
  contextOccurrenceId: string;
}>;

export function fieldConfigurationProjectionIdentity(actionId: FactActionId): FieldConfigurationProjectionIdentity {
  const root = `${actionId}/projection/field-configuration`;
  return {
    configurationNodeId: `${root}/node`,
    configurationOccurrenceId: `${root}/occurrence`,
    definitionOccurrenceId: `${root}/definition-occurrence`,
    valueOccurrenceId: `${root}/value-occurrence`,
    optionsSupertagOccurrenceId: `${root}/options-supertag-occurrence`,
    expressionNodeId: `${root}/expression/node`,
    expressionOccurrenceId: `${root}/expression/occurrence`,
    sourceFieldDefinitionOccurrenceId: `${root}/expression/source-field-definition-occurrence`,
    contextNodeId: `${root}/expression/context/node`,
    contextOccurrenceId: `${root}/expression/context/occurrence`,
  };
}
