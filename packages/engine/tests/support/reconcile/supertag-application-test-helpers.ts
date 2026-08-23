import type { AuthoredAction, SequenceAnchor } from "../../../src/domain/fact/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function supertagApplicationActions(
  hostNodeId: string,
  supertagId: string,
  anchor: SequenceAnchor = end,
): readonly AuthoredAction[] {
  return [{ kind: "supertag-application-add", hostNodeId, supertagId, anchor }];
}

export function supertagRemovalActions(hostNodeId: string, supertagId: string): readonly AuthoredAction[] {
  return [{ kind: "supertag-membership-remove", hostNodeId, supertagId }];
}
