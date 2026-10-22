import { END_SEQUENCE_ANCHOR } from "@lode/sdk";
import { DropdownMenu } from "@lode/ui";
import type { WorkspaceController } from "./workspace-controller.js";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import { nodeLabel } from "./node-source.js";

export function WorkspaceViewOptions({
  graph,
  nodeId,
  controller,
}: Readonly<{ graph: WorkspaceSnapshot; nodeId: string; controller: WorkspaceController }>) {
  const definitions = graph.sharedDefaultViewDefinitions[nodeId] ?? [],
    view = definitions[0];
  const type = graph.nodes[nodeId]?.intrinsicNodeType;
  if (type !== null && type !== "workspace" && type !== "search") {
    return null;
  }
  const setMode = (viewType: "outline" | "table") => {
    void controller.apply((current) => {
      const view = current.sharedDefaultViewDefinitions[nodeId]?.[0];
      return view
        ? [{ kind: "view-mode-set", hostNodeId: nodeId, viewId: view.viewId, viewType }]
        : [{ kind: "shared-default-view-create", hostNodeId: nodeId, viewType, anchor: END_SEQUENCE_ANCHOR }];
    });
  };
  const candidates = Object.values(graph.nodes).filter(
    (node) =>
      node.intrinsicNodeType === "field-definition" &&
      !view?.options.columns.some((column) => column.fieldDefinitionId === node.nodeId),
  );
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <DropdownMenu
        label={`Shared view · ${view?.viewType === "table" ? "Table" : "Outline"}`}
        items={[
          { label: "Outline", disabled: definitions.length > 1, onSelect: () => setMode("outline") },
          { label: "Table", disabled: definitions.length > 1, onSelect: () => setMode("table") },
        ]}
      />
      {view?.viewType === "table" ? (
        <DropdownMenu
          label="Columns"
          items={[
            ...candidates.map((node) => ({
              label: `Show ${nodeLabel(node, graph) || "Untitled field"}`,
              onSelect: () => {
                void controller.apply(() => [
                  {
                    kind: "view-column-add",
                    hostNodeId: nodeId,
                    viewId: view.viewId,
                    fieldDefinitionId: node.nodeId,
                    anchor: END_SEQUENCE_ANCHOR,
                  },
                ]);
              },
            })),
            ...view.options.columns.map((column) => ({
              label: `Hide ${graph.nodes[column.fieldDefinitionId] ? nodeLabel(graph.nodes[column.fieldDefinitionId]!, graph) : "Unavailable field"}`,
              onSelect: () => {
                void controller.apply(() => [
                  {
                    kind: "view-column-remove",
                    hostNodeId: nodeId,
                    viewId: view.viewId,
                    fieldDefinitionId: column.fieldDefinitionId,
                  },
                ]);
              },
            })),
          ]}
        />
      ) : null}
    </div>
  );
}
