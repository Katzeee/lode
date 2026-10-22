import { Icon, OutlineBullet, OutlineBulletDot, Tooltip, contentToSource } from "@lode/ui";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import type { WorkspaceState } from "./workspace-controller.js";
import type { WorkspaceAppearance } from "./workspace-outline.js";
import { workspaceNodeInTrash } from "./workspace-node-location.js";

export function workspacePresentation(
  graph: WorkspaceSnapshot,
  state: WorkspaceState,
  bindings: ReadonlyMap<string, WorkspaceAppearance>,
) {
  const fields = new Map(
    Object.values(graph.materializedFields)
      .flat()
      .map((field) => [field.fieldNodeId, field]),
  );
  return {
    resolve: (key: string) => {
      const item = bindings.get(key);
      const nodeId = item?.nodeId ?? "",
        field = fields.get(nodeId);
      const pending = state.insertions.get(nodeId);
      const placeholder =
        !!pending && !pending.confirmed && contentToSource(state.drafts.get(nodeId)?.content ?? []).length === 0;
      return {
        bullet: {
          action: placeholder ? undefined : (item?.contentNodeId ?? nodeId),
          content:
            field || graph.nodes[nodeId]?.intrinsicNodeType === "field-definition" ? (
              <Icon name="list-tree" className="size-3.5" />
            ) : (
              <OutlineBullet frame={item?.reference ? "dashed" : "none"}>
                <OutlineBulletDot quiet={placeholder} />
              </OutlineBullet>
            ),
        },
        prefix:
          item?.reference && workspaceNodeInTrash(graph, nodeId) ? (
            <Tooltip content="The referenced node is in the trash">
              <span
                aria-label="The referenced node is in the trash"
                className="inline-flex align-middle text-muted-foreground"
              >
                <Icon name="trash" className="size-3" />
              </span>
            </Tooltip>
          ) : undefined,
        childrenLayout: field ? ("beside" as const) : ("indented" as const),
      };
    },
  };
}
