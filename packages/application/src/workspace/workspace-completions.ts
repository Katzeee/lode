import { END_SEQUENCE_ANCHOR, type EditAction } from "@lode/sdk";
import type { OutlineCompletionProvider, OutlineHostCommand } from "@lode/ui";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import { nodeLabel, referenceToken } from "./node-source.js";
import type { WorkspaceController } from "./workspace-controller.js";

type Options = Readonly<{
  graph: WorkspaceSnapshot;
  controller: WorkspaceController;
  occurrenceId(key: string): string;
  contentNodeId(key: string): string;
}>;
export function workspaceCompletions({
  graph,
  controller,
  occurrenceId,
  contentNodeId,
}: Options): Readonly<{ providers: readonly OutlineCompletionProvider[]; commands: readonly OutlineHostCommand[] }> {
  const commands: OutlineHostCommand[] = [];
  const command = (
    id: string,
    label: string,
    build: (ownerNodeId: string, current: WorkspaceSnapshot) => readonly EditAction[],
  ) => {
    commands.push({
      id,
      label,
      execute: (context) => {
        const key = context.keys[0];
        const occurrence = key && graph.occurrences[occurrenceId(key)];
        if (!occurrence) {
          return;
        }
        if (context.content) {
          controller.stageNode(contentNodeId(key), context.content);
        }
        void controller.apply((current) => build(contentNodeId(key), current));
      },
    });
    return id;
  };
  const candidates = Object.values(graph.nodes).filter((node) => {
    if (
      node.nodeId === graph.rootNodeId ||
      graph.systemNodeIds.includes(node.nodeId) ||
      !nodeLabel(node, graph).trim()
    ) {
      return false;
    }
    let owner: string | null | undefined = node.nodeId;
    const visited = new Set<string>();
    while (owner && !visited.has(owner)) {
      if (owner === graph.workspaceSystemNodes.trash || owner === graph.workspaceSystemNodes.systemDefinitionCatalog) {
        return false;
      }
      visited.add(owner);
      owner = graph.nodeOwners[owner];
    }
    return true;
  });
  const providers: OutlineCompletionProvider[] = (["@", "#", ">"] as const).map((trigger) => {
    const id = trigger === "@" ? "reference" : trigger === "#" ? "supertag" : "field";
    const eligible = candidates.filter(
      (node) =>
        trigger === "@" || node.intrinsicNodeType === (trigger === "#" ? "supertag-definition" : "field-definition"),
    );
    const items = eligible.map((node) => {
      const label = nodeLabel(node, graph);
      return trigger === ">"
        ? {
            id: node.nodeId,
            label,
            replacement: [],
            commandId: command(`field:${node.nodeId}`, label, (ownerNodeId) => [
              { kind: "field-materialize", ownerNodeId, fieldDefinitionId: node.nodeId },
            ]),
          }
        : {
            id: node.nodeId,
            label,
            replacement: [
              referenceToken({ kind: id === "reference" ? "reference" : "supertag", targetNodeId: node.nodeId }, label),
            ],
          };
    });
    return {
      id,
      exitOnSelect: trigger === ">",
      ariaLabel: id === "reference" ? "Link a node" : id === "supertag" ? "Apply a supertag" : "Add a field",
      heading: id === "reference" ? "Link a node" : id === "supertag" ? "Apply a supertag" : "Add a field",
      emptyLabel: "No matches",
      match: (context) => {
        if (context.selection.from !== context.selection.to) {
          return null;
        }
        const match = new RegExp(`(?:^|\\s)${trigger}([^\\s@#>{}]*)$`, "u").exec(context.textBeforeCaret);
        if (!match) {
          return null;
        }
        return { from: context.selection.from - match[1]!.length - 1, to: context.selection.from, query: match[1]! };
      },
      items: (_key, query) =>
        items.filter((item) => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 30),
    };
  });
  const definitions = [
    { id: "new-supertag", label: "Create supertag", type: "supertag-definition" as const },
    { id: "new-field", label: "Create field definition", type: "field-definition" as const },
  ];
  for (const definition of definitions) {
    command(definition.id, definition.label, (ownerNodeId, current) => {
      const node = current.nodes[ownerNodeId];
      const label = node ? nodeLabel(node, current).trim() : "";
      if (!label) {
        throw new Error("Give the node a name before creating a definition");
      }
      const nodeId = crypto.randomUUID();
      return [
        {
          kind: "node-create",
          nodeId,
          occurrenceId: crypto.randomUUID(),
          parentNodeId: graph.workspaceSystemNodes.schema ?? graph.rootNodeId,
          anchor: END_SEQUENCE_ANCHOR,
          intrinsicNodeType: definition.type,
          seed: { text: [{ value: label, attributes: {} }] },
        },
        ...(definition.type === "supertag-definition"
          ? [
              {
                kind: "supertag-application-create" as const,
                hostNodeId: ownerNodeId,
                supertagId: nodeId,
                anchor: END_SEQUENCE_ANCHOR,
              },
            ]
          : [{ kind: "field-materialize" as const, ownerNodeId, fieldDefinitionId: nodeId }]),
      ];
    });
  }
  providers.push({
    id: "command",
    exitOnSelect: true,
    ariaLabel: "Commands",
    heading: "Commands",
    emptyLabel: "No matching commands",
    match: (context) => {
      const match = /(?:^|\s)\/([^\s/]*)$/u.exec(context.textBeforeCaret);
      return match && context.selection.from === context.selection.to
        ? { from: context.selection.from - match[1]!.length - 1, to: context.selection.from, query: match[1]! }
        : null;
    },
    items: (_key, query) =>
      definitions
        .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
        .map((item) => ({ id: item.id, label: item.label, commandId: item.id, replacement: [] })),
  });
  return { providers, commands };
}
