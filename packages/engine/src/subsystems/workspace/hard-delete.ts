import type { HardDeletePreview } from "@lode/sdk";
import { evaluateHardDelete, type HardDeleteAssessment } from "../../domain/maintenance/index.js";
import type { FactSnapshot } from "../../domain/fact/index.js";
import type { ScopedProjection } from "../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "./projection/index.js";
import type { FactAuthorityPort } from "./authority/authority-contract.js";

const HISTORY_IMPACT_LIMIT = 50;

type HardDeleteAssessmentAuthority = Pick<FactAuthorityPort, "replicaId">;

type HardDeletePreviewAuthority = HardDeleteAssessmentAuthority & Pick<FactAuthorityPort, "historyImpacts">;

export function assessWorkspaceHardDelete(
  workspaceId: string,
  nodeId: string,
  snapshot: FactSnapshot,
  facts: HardDeleteAssessmentAuthority,
  projection: Pick<ScopedProjection, "nodeOwners">,
): HardDeleteAssessment {
  return evaluateHardDelete({
    workspaceId,
    nodeId,
    snapshot,
    localReplicaId: facts.replicaId,
    ownedDescendantNodeIds: ownedDescendants(projection.nodeOwners, nodeId),
  });
}

export async function hardDeletePreview(
  workspaceId: string,
  nodeId: string,
  snapshot: FactSnapshot,
  facts: HardDeletePreviewAuthority,
  projections: ProjectionSnapshotReader,
  generationId: string,
): Promise<HardDeletePreview> {
  const assessment = evaluateHardDelete({
    workspaceId,
    nodeId,
    snapshot,
    localReplicaId: facts.replicaId,
    ownedDescendantNodeIds: await readOwnedDescendants(projections, generationId, nodeId),
  });
  const allHistoryImpacts = facts.historyImpacts(nodeId);
  const visibleHistoryImpacts = allHistoryImpacts.slice(0, HISTORY_IMPACT_LIMIT);
  return {
    generationId,
    ...assessment,
    historyImpact: {
      affectedInvocationIds: visibleHistoryImpacts.map((impact) => impact.invocationId),
      affectedChannelIds: [...new Set(visibleHistoryImpacts.map((impact) => impact.channelId))],
      totalAffectedInvocations: allHistoryImpacts.length,
      truncated: allHistoryImpacts.length > HISTORY_IMPACT_LIMIT,
    },
  };
}

function ownedDescendants(nodeOwners: Readonly<Record<string, string | null>>, rootNodeId: string): string[] {
  const childrenByOwner = new Map<string, string[]>();
  for (const [nodeId, ownerNodeId] of Object.entries(nodeOwners)) {
    if (ownerNodeId === null) {
      continue;
    }
    const childOccurrences = childrenByOwner.get(ownerNodeId) ?? [];
    childOccurrences.push(nodeId);
    childrenByOwner.set(ownerNodeId, childOccurrences);
  }
  const descendants: string[] = [];
  const pending = [rootNodeId];
  while (pending.length > 0) {
    const ownerNodeId = pending.shift();
    if (!ownerNodeId) {
      continue;
    }
    const childOccurrences = childrenByOwner.get(ownerNodeId) ?? [];
    descendants.push(...childOccurrences);
    pending.push(...childOccurrences);
  }
  return descendants;
}

async function readOwnedDescendants(
  projections: ProjectionSnapshotReader,
  generationId: string,
  rootNodeId: string,
): Promise<readonly string[]> {
  const descendants: string[] = [];
  let pending = [rootNodeId];
  while (pending.length > 0) {
    const batch = pending.slice(0, 256);
    pending = pending.slice(batch.length);
    const childOccurrences = (await projections.read(generationId, "origin", "nodeIdsByOwner", batch)).entries.flatMap(
      (entry) => entry.value,
    );
    descendants.push(...childOccurrences);
    pending.push(...childOccurrences);
  }
  return descendants;
}
