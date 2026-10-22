import { templateInstanceNodeId, templateInstanceOccurrenceId } from "../fact/index.js";

/** Separate materializations never overwrite a prior copy retained in Trash. */
export function templateMaterializationIdentity(
  ownerNodeId: string,
  templateNodeId: string,
  graph: Readonly<{
    nodes: Readonly<Record<string, unknown>>;
    occurrences: Readonly<Record<string, Readonly<{ nodeId: string; derived: boolean }>>>;
  }>,
): Readonly<{ instanceNodeId: string; instanceOccurrenceId: string }> {
  const nodeRoot = templateInstanceNodeId(ownerNodeId, templateNodeId);
  const occurrenceRoot = templateInstanceOccurrenceId(ownerNodeId, templateNodeId);
  let incarnation = 0;
  while (true) {
    const suffix = incarnation === 0 ? "" : `/materialization/${incarnation}`;
    const instanceNodeId = `${nodeRoot}${suffix}`;
    const instanceOccurrenceId = `${occurrenceRoot}${suffix}`;
    const occurrence = graph.occurrences[instanceOccurrenceId];
    // The first source projection is replaced atomically by its first real copy.
    if (
      !(instanceNodeId in graph.nodes) &&
      (occurrence === undefined || (incarnation === 0 && occurrence.nodeId === templateNodeId && occurrence.derived))
    ) {
      return { instanceNodeId, instanceOccurrenceId };
    }
    incarnation += 1;
  }
}
