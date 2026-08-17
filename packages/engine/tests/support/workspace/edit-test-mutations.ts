import type { EditMutation } from "../../../src/domain/edit/index.js";
import { detachedSupertagValueNodeId, detachedSupertagValueOccurrenceId } from "../../../src/domain/fact/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function createSupertagApplication(hostNodeId: string, supertagId: string, identity = "1"): EditMutation {
  const applicationNodeId = `${hostNodeId}-supertag-application-${supertagId}-${identity}`;
  return {
    kind: "supertag-application-create",
    hostNodeId,
    supertagId,
    metanodeId: `${hostNodeId}-metanode`,
    applicationNodeId,
    applicationOccurrenceId: `${applicationNodeId}-occurrence`,
    relationDefinitionOccurrenceId: `${applicationNodeId}-relation-definition-occurrence`,
    definitionOccurrenceId: `${applicationNodeId}-definition-occurrence`,
    anchor: end,
  };
}

export function removeSupertagApplication(hostNodeId: string, supertagId: string, identity = "1"): EditMutation {
  const applicationNodeId = `${hostNodeId}-supertag-application-${supertagId}-${identity}`;
  return {
    kind: "supertag-remove",
    hostNodeId,
    supertagId,
    applicationNodeId,
    applicationOccurrenceId: `${applicationNodeId}-occurrence`,
    relationDefinitionOccurrenceId: `${applicationNodeId}-relation-definition-occurrence`,
    definitionOccurrenceId: `${applicationNodeId}-definition-occurrence`,
    detachedValueNodeId: detachedSupertagValueNodeId(applicationNodeId),
    detachedValueOccurrenceId: detachedSupertagValueOccurrenceId(applicationNodeId),
  };
}
