import { END_SEQUENCE_ANCHOR as end, type GraphAction, type SequenceAnchor } from "../../../src/domain/fact/index.js";

export function supertagApplicationActions(
  hostNodeId: string,
  supertagId: string,
  anchor: SequenceAnchor = end,
): readonly GraphAction[] {
  return [{ kind: "supertag-application-add", hostNodeId, supertagId, anchor }];
}

export function supertagRemovalActions(hostNodeId: string, supertagId: string): readonly GraphAction[] {
  return [{ kind: "supertag-membership-remove", hostNodeId, supertagId }];
}
