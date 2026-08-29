import {
  canonicalDigest,
  type FactActionId,
  type FactSnapshot,
  type FieldDefinitionConfigurationValue,
  type ProjectionIdentity,
} from "../fact/index.js";
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

export function fieldConfigurationProjectionIdentity(
  fieldDefinitionId: string,
  configuration: FieldDefinitionConfigurationValue,
): FieldConfigurationProjectionIdentity {
  const relationRoot = `field-configuration:v1:${encodeURIComponent(fieldDefinitionId)}:${configuration.kind}`;
  const candidateRoot = `${relationRoot}/candidate/${canonicalDigest(configuration)}`;
  return {
    configurationNodeId: `${relationRoot}/node`,
    configurationOccurrenceId: `${relationRoot}/occurrence`,
    definitionOccurrenceId: `${relationRoot}/definition-occurrence`,
    valueOccurrenceId: `${candidateRoot}/value-occurrence`,
    optionsSupertagOccurrenceId: `${candidateRoot}/options-supertag-occurrence`,
    expressionNodeId: `${candidateRoot}/expression/node`,
    expressionOccurrenceId: `${candidateRoot}/expression/occurrence`,
    sourceFieldDefinitionOccurrenceId: `${candidateRoot}/expression/source-field-definition-occurrence`,
    contextNodeId: `${candidateRoot}/expression/context/node`,
    contextOccurrenceId: `${candidateRoot}/expression/context/occurrence`,
  };
}
