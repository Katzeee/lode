import type { EngineApplicationContract, ViewRowsResult } from "@lode/sdk";

export async function readWorkspaceView(
  engine: EngineApplicationContract,
  workspaceId: string,
  hostNodeId: string,
): Promise<ViewRowsResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let first: ViewRowsResult | undefined;
    const rows: ViewRowsResult["rows"][number][] = [];
    let after: string | undefined;
    let changed = false;
    do {
      const result = await engine.query({
        kind: "view-rows",
        workspaceId,
        perspective: "origin",
        hostNodeId,
        after,
        limit: 100,
      });
      if (result.status !== "ok") {
        throw new Error(result.error.message);
      }
      first ??= result.value;
      changed ||= first.generationId !== result.value.generationId;
      rows.push(...result.value.rows);
      after = result.value.next ?? undefined;
    } while (after && !changed);
    if (first && !changed) {
      return { ...first, rows, next: null };
    }
  }
  throw new Error("The collection changed while loading. Please retry.");
}
