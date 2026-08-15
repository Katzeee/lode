import type { HardDeletePreview } from "@lode/sdk";
import { evaluateHardDelete, type HardDeleteAssessment } from "../../domain/maintenance/index.js";
import type { FactSnapshot } from "../../domain/fact/index.js";
import type { FactAuthority } from "../authority/fact-authority.js";

const HISTORY_IMPACT_LIMIT = 50;

type HardDeleteAssessmentAuthority = Pick<FactAuthority, "replicaId" | "uncertainInvocations">;

type HardDeletePreviewAuthority = HardDeleteAssessmentAuthority & Pick<FactAuthority, "historyImpacts">;

export function assessWorkspaceHardDelete(
  workspaceId: string,
  nodeId: string,
  snapshot: FactSnapshot,
  facts: HardDeleteAssessmentAuthority,
): HardDeleteAssessment {
  return evaluateHardDelete({
    workspaceId,
    nodeId,
    snapshot,
    localReplicaId: facts.replicaId,
    outcomeUnknownInvocationIds: facts.uncertainInvocations(),
  });
}

export function hardDeletePreview(
  workspaceId: string,
  nodeId: string,
  snapshot: FactSnapshot,
  facts: HardDeletePreviewAuthority,
  generationId: string,
): HardDeletePreview {
  const assessment = assessWorkspaceHardDelete(workspaceId, nodeId, snapshot, facts);
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
