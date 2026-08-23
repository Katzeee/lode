import type { EditAction } from "../../../src/domain/edit/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function createSupertagApplication(hostNodeId: string, supertagId: string): EditAction {
  return {
    kind: "supertag-application-create",
    hostNodeId,
    supertagId,
    anchor: end,
  };
}

export function removeSupertagApplication(hostNodeId: string, supertagId: string): EditAction {
  return {
    kind: "supertag-remove",
    hostNodeId,
    supertagId,
  };
}
