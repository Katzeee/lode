import type { ReplicaSynchronizationResult } from "@lode/sdk/host";
import type { WorkspaceReplica } from "../workspace/index.js";

export type SynchronizationCapability = Readonly<{
  synchronize(workspaceId: string, endpoint: string): Promise<ReplicaSynchronizationResult>;
  exchange(workspaceId: string, replica: WorkspaceReplica, endpoint: string): Promise<ReplicaSynchronizationResult>;
}>;
