import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Button, NodeTable, OutlineEmptyChild, Spinner, type OutlineEditPosition } from "@lode/ui";
import type { ViewRowsResult } from "@lode/sdk";
import type { WorkspaceController } from "./workspace-controller.js";
import { WorkspaceRegion } from "./workspace-region.js";
import { nodeLabel } from "./node-source.js";

export function WorkspaceTable({
  controller,
  nodeId,
  scope,
  onNavigate,
  focusRequest,
  renderCollection,
  parentEditor,
}: Readonly<{
  controller: WorkspaceController;
  nodeId: string;
  scope: string;
  onNavigate(nodeId: string): void;
  focusRequest?: OutlineEditPosition;
  renderCollection(nodeId: string, scope: string): ReactNode;
  parentEditor?: Readonly<{ key: string; nodeId: string }>;
}>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [query, setQuery] = useState<Readonly<{ host: string; value: ViewRowsResult }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localFocus, setLocalFocus] = useState<OutlineEditPosition>();
  const focus = localFocus ?? focusRequest;
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void controller.viewRows(nodeId).then(
      (value) => {
        if (active) {
          setQuery({ host: nodeId, value });
          setError(null);
        }
      },
      (error: unknown) => {
        if (active) {
          setError(error instanceof Error ? error.message : String(error));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [controller, nodeId, state.graph?.generationId, revision]);
  const graph = controller.viewGraph();
  const view = query?.host === nodeId ? query.value : undefined;
  if (error) {
    return (
      <Alert tone="destructive">
        {error}
        <Button onClick={() => setRevision((value) => value + 1)}>Retry</Button>
      </Alert>
    );
  }
  if (!graph || !view) {
    return <Spinner label="Loading table" />;
  }
  if (!view.available || view.optionsConflicted) {
    return <Alert tone="destructive">The view has conflicting settings. Resolve them before editing this table.</Alert>;
  }
  const columns = [
    { key: "name", heading: "Name" },
    ...view.options.columns.map((column) => ({
      key: column.columnNodeId,
      heading: graph.nodes[column.fieldDefinitionId]
        ? nodeLabel(graph.nodes[column.fieldDefinitionId]!, graph)
        : "Unavailable field",
    })),
  ];
  const rows = [
    ...view.rows.map((row) => ({
      rowKey: `${row.sourceKind}:${row.sourceIdentity}`,
      sourceIdentity: row.sourceIdentity,
      nodeId: row.targetNodeId,
      occurrenceId: row.sourceKind === "occurrence" ? row.sourceIdentity : null,
    })),
    ...[...state.insertions.values()]
      .filter(
        (item) =>
          item.destination.kind === "children" &&
          item.destination.parentNodeId === nodeId &&
          !view.rows.some((row) => row.sourceIdentity === item.occurrenceId),
      )
      .map((item) => ({
        rowKey: `occurrence:${item.occurrenceId}`,
        sourceIdentity: item.occurrenceId,
        nodeId: item.nodeId,
        occurrenceId: item.occurrenceId,
      })),
  ];
  return (
    <NodeTable
      label="Node table"
      columns={columns}
      rows={rows.map((row, index) => ({
        key: row.rowKey,
        cells: new Map([
          [
            "name",
            <WorkspaceRegion
              key="name"
              controller={controller}
              parentEditor={index === 0 && row.occurrenceId ? parentEditor : undefined}
              renderCollection={renderCollection}
              siblingPosition={(occurrenceId) => ({
                key: `${scope}:row:occurrence:${occurrenceId}:${JSON.stringify([occurrenceId])}`,
                caret: 0,
              })}
              source={
                row.occurrenceId
                  ? { kind: "appearance", occurrenceId: row.occurrenceId }
                  : { kind: "search-result", nodeId: row.nodeId, sourceIdentity: row.sourceIdentity }
              }
              scope={`${scope}:row:${row.rowKey}`}
              label={`Name: ${graph.nodes[row.nodeId] ? nodeLabel(graph.nodes[row.nodeId]!, graph) : "Empty node"}`}
              onNavigate={onNavigate}
              focusRequest={
                focus?.key === JSON.stringify([row.occurrenceId])
                  ? { ...focus, key: `${scope}:row:${row.rowKey}:${focus.key}` }
                  : undefined
              }
            />,
          ],
          ...view.options.columns.map(
            (column) =>
              [
                column.columnNodeId,
                <WorkspaceRegion
                  key={column.columnNodeId}
                  controller={controller}
                  renderCollection={renderCollection}
                  source={{
                    kind: "field-values",
                    ownerNodeId: row.nodeId,
                    fieldDefinitionId: column.fieldDefinitionId,
                  }}
                  scope={`${scope}:row:${row.rowKey}:field:${column.fieldDefinitionId}`}
                  label={`Field values: ${graph.nodes[column.fieldDefinitionId] ? nodeLabel(graph.nodes[column.fieldDefinitionId]!, graph) : "Unavailable field"}`}
                  onNavigate={onNavigate}
                />,
              ] as const,
          ),
        ]),
      }))}
      footer={
        graph.nodes[nodeId]?.intrinsicNodeType === "search" ? undefined : (
          <OutlineEmptyChild
            parentKey={null}
            parentLabel="Node table"
            onActivate={() => {
              const insertion = controller.prepare(nodeId);
              setLocalFocus({ key: JSON.stringify([insertion.occurrenceId]), caret: 0 });
            }}
          />
        )
      }
    />
  );
}
