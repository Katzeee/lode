import { useState, useSyncExternalStore } from "react";
import { END_SEQUENCE_ANCHOR, type TemplateField } from "@lode/sdk";
import { Button, Checkbox, NodeEditor, Select, type OutlineEditPosition } from "@lode/ui";
import type { WorkspaceController } from "./workspace-controller.js";
import { nodeLabel } from "./node-source.js";
import { WorkspaceRegion } from "./workspace-region.js";

type Properties = Readonly<{
  controller: WorkspaceController;
  supertagId: string;
  onNavigate(nodeId: string): void;
  focusRequest?: OutlineEditPosition;
}>;
type RegionFocus = Readonly<{ scope: string; position: OutlineEditPosition }>;

export function WorkspaceSupertag({ controller, supertagId, onNavigate, focusRequest }: Properties) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const graph = controller.viewGraph();
  const [focus, setFocus] = useState<RegionFocus | null>(null);
  const [adding, setAdding] = useState(false);
  if (!graph) {
    return null;
  }
  const definition = graph.nodes[supertagId];
  if (definition?.intrinsicNodeType !== "supertag-definition") {
    return null;
  }
  const fields = graph.templateFields[supertagId] ?? [];
  const fieldsByOccurrence = new Map(fields.map((field) => [field.templateFieldOccurrenceId, field]));
  const members = new Set(graph.supertagTemplateNodes[supertagId] ?? []);
  for (const insertion of state.insertions.values()) {
    if (insertion.destination.kind === "children" && insertion.destination.parentNodeId === supertagId) {
      members.add(insertion.nodeId);
    }
  }
  const visible = (nodeId: string) => {
    const visited = new Set<string>();
    let owner: string | null | undefined = nodeId;
    while (owner && !visited.has(owner)) {
      if (owner === graph.workspaceSystemNodes.trash || owner === graph.workspaceSystemNodes.systemDefinitionCatalog) {
        return false;
      }
      visited.add(owner);
      owner = graph.nodeOwners[owner];
    }
    return true;
  };
  const existingFields = Object.values(graph.nodes)
    .filter(
      (node) =>
        node.intrinsicNodeType === "field-definition" &&
        visible(node.nodeId) &&
        graph.nodeOwners[node.nodeId] === graph.workspaceSystemNodes.schema &&
        !fields.some((field) => field.fieldDefinitionId === node.nodeId),
    )
    .map((node) => ({ value: node.nodeId, label: nodeLabel(node, graph) }))
    .filter((option) => option.label.length > 0)
    .sort((left, right) => left.label.localeCompare(right.label));
  const focusDefinition = (field: TemplateField) => {
    const scope = `template-field:${field.factActionId}:definition`;
    setFocus({ scope, position: { key: `${scope}:${JSON.stringify([field.fieldDefinitionId])}`, caret: 0 } });
  };
  const addField = async (existingId?: string) => {
    setAdding(true);
    const fieldDefinitionId = existingId ?? crypto.randomUUID();
    const previous = new Set(fields.map((field) => field.factActionId));
    const published = await controller.apply(() => [
      {
        kind: existingId === undefined ? "supertag-template-field-create" : "supertag-template-field-add-existing",
        supertagId,
        fieldDefinitionId,
        anchor: END_SEQUENCE_ANCHOR,
      },
    ]);
    if (published && existingId === undefined) {
      const field = controller
        .viewGraph()
        ?.templateFields[supertagId]?.find(
          (field) => !previous.has(field.factActionId) && field.fieldDefinitionId === fieldDefinitionId,
        );
      if (field) {
        focusDefinition(field);
      }
    }
    setAdding(false);
  };
  const addNode = () => {
    const insertion = controller.prepare(supertagId);
    const scope = `template-node:${supertagId}:${insertion.occurrenceId}`;
    setFocus({ scope, position: { key: `${scope}:${JSON.stringify([insertion.occurrenceId])}`, caret: 0 } });
  };
  const fieldRow = (field: TemplateField) => {
    const nameScope = `template-field:${field.factActionId}:definition`;
    const name = graph.nodes[field.fieldDefinitionId];
    const label = name ? nodeLabel(name, graph) || "Unnamed field" : "Unavailable field";
    return (
      <div
        key={field.factActionId}
        className="@container/template-field rounded-selection border border-transparent px-2 py-1 data-[pinned=true]:border-border"
        data-pinned={field.visibility === "pinned"}
      >
        <div className="grid min-w-0 grid-cols-1 items-start gap-x-3 gap-y-1 @outline-field/template-field:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
          <WorkspaceRegion
            controller={controller}
            source={{ kind: "node", nodeId: field.fieldDefinitionId, structural: false }}
            scope={nameScope}
            label={`Field definition ${label}`}
            onNavigate={onNavigate}
            focusRequest={focus?.scope === nameScope ? focus.position : undefined}
          />
          {field.staticDefaultConflicted ? (
            <p role="status" className="text-label text-muted-foreground">
              Default value has conflicting changes.
            </p>
          ) : (
            <WorkspaceRegion
              controller={controller}
              source={{ kind: "template-default", supertagId, templateFieldId: field.factActionId }}
              scope={`template-field:${field.factActionId}:default`}
              label={`Default value for ${label}`}
              onNavigate={onNavigate}
            />
          )}
          <label className="flex items-center gap-2 py-1 text-label text-muted-foreground">
            <Checkbox
              checked={field.visibility === "pinned"}
              indeterminate={field.visibilityConflicted}
              aria-label={`Pin ${label}`}
              onCheckedChange={(checked) => {
                void controller.apply(() => [
                  {
                    kind: "supertag-template-field-visibility-set",
                    supertagId,
                    templateFieldId: field.factActionId,
                    visibility: checked ? "pinned" : "normal",
                  },
                ]);
              }}
            />
            Pinned
          </label>
        </div>
      </div>
    );
  };
  return (
    <NodeEditor>
      <section aria-label="Supertag configuration" className="space-y-5">
        <h2 className="text-title font-semibold">Content template</h2>
        <div className="space-y-1">
          {(graph.childOccurrences[supertagId] ?? []).map((occurrenceId) => {
            const field = fieldsByOccurrence.get(occurrenceId);
            if (field) {
              return fieldRow(field);
            }
            const occurrence = graph.occurrences[occurrenceId];
            if (!occurrence || !members.has(occurrence.nodeId)) {
              return null;
            }
            const scope = `template-node:${supertagId}:${occurrenceId}`;
            return (
              <WorkspaceRegion
                key={occurrenceId}
                controller={controller}
                source={{ kind: "appearance", occurrenceId }}
                scope={scope}
                label="Template content"
                siblingPosition={(id) => ({
                  key: `template-node:${supertagId}:${id}:${JSON.stringify([id])}`,
                  caret: 0,
                })}
                onNavigate={onNavigate}
                focusRequest={
                  focus?.scope === scope
                    ? focus.position
                    : focusRequest?.key.startsWith(`${scope}:`)
                      ? focusRequest
                      : undefined
                }
              />
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={addNode}>
            New node
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={adding}
            onClick={() => {
              void addField();
            }}
          >
            New field
          </Button>
          <Select
            className="h-8 w-auto min-w-48 text-label"
            placeholder="Insert existing field"
            value=""
            options={existingFields}
            disabled={adding || existingFields.length === 0}
            onValueChange={(fieldId) => {
              if (fieldId) {
                void addField(fieldId);
              }
            }}
          />
        </div>
      </section>
    </NodeEditor>
  );
}
