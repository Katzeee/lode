import type { ViewMode, WorkspaceId } from "../domain/fact/index.js";

export type ViewQueryRequest = Readonly<{
  kind: "view";
  workspaceId: WorkspaceId;
  view: ViewMode;
  viewNodeId: string;
  after?: string | null;
  limit?: number;
}>;
