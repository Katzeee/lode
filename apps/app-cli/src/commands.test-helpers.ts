import type { ParsedCli } from "./args.js";
import type { ClientLike } from "./commands/types.js";

// Method names matching the typed client, so tests can assert calls by name.
export const Methods = {
  CreateWorkspaceDoc: "createWorkspaceDoc",
  ListWorkspaceDocs: "listWorkspaceDocs",
  RemoveWorkspaceDoc: "removeWorkspaceDoc",
  CreatePlainNode: "createPlainNode",
  GetNode: "getNode",
  GetNodeChildren: "getNodeChildren",
  MoveNode: "moveNode",
  RemoveNodeOccurrence: "removeNodeOccurrence",
  HardDeleteNode: "hardDeleteNode",
  ReplaceNodeText: "replaceNodeText",
  CreateRef: "createRef",
  CloneRef: "cloneRef",
  CreateSchema: "createSchema",
  ApplySchema: "applySchema",
  RemoveSchema: "removeSchema",
  ReconcileSchema: "reconcileSchema",
  CreateFieldDef: "createFieldDef",
  SetFieldDefType: "setFieldDefType",
  SetFieldDefPresence: "setFieldDefPresence",
  AddField: "addField",
  SetFieldValues: "setFieldValues",
  RemoveField: "removeField",
  GetNodeById: "getNodeById",
} as const;

export function command(
  group: string,
  action: string,
  flags: Record<string, string[]>,
  orderedFlags?: ParsedCli["orderedFlags"],
): ParsedCli {
  const resolvedFlags =
    group === "workspace" || flags["--workspace"]
      ? flags
      : { "--workspace": ["ws_main"], ...flags };
  return {
    url: "http://localhost:8080",
    actorId: "alice",
    group,
    action,
    flags: resolvedFlags,
    orderedFlags: orderedFlags ?? toOrderedFlags(resolvedFlags),
  };
}

export type CallRecord = { method: string; params: unknown };
export type ResponseFactory = (params: unknown) => unknown;

// Builds a fake typed client. Each method records its call and returns a canned
// proto-shaped response (or the result of a factory). Overrides key on method name
// (camelCase) — see Methods. A factory is invoked with the params.
export function createFakeClient(overrides: Record<string, unknown> = {}): {
  client: ClientLike;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];

  const responses: Record<string, unknown> = {
    createWorkspaceDoc: { value: "doc_created" },
    listWorkspaceDocs: { docIds: ["doc_main"] },
    removeWorkspaceDoc: { value: true },
    createPlainNode: wireNode("node_new", "occ_new"),
    getNode: { occurrence: undefined },
    getNodeChildren: { children: [] },
    moveNode: {},
    removeNodeOccurrence: {},
    hardDeleteNode: {},
    replaceNodeText: {},
    createRef: wireNode("node_ref", "occ_ref"),
    cloneRef: wireNode("node_clone", "occ_clone"),
    createSchema: { nodeId: "node_schema", occurrenceId: "occ_schema" },
    applySchema: {
      target: { nodeId: "node_target", occurrenceId: "occ_target" },
      schema: { nodeId: "node_schema" },
      changes: [
        {
          kind: 0,
          reason: 0,
          nodeId: "node_field",
          occurrenceId: "occ_field",
        },
        {
          kind: 1,
          reason: 1,
          nodeId: "node_template",
          occurrenceId: "occ_template",
        },
      ],
    },
    removeSchema: {
      target: { nodeId: "node_target", occurrenceId: "occ_target" },
      schema: { nodeId: "node_schema" },
      changes: [],
    },
    reconcileSchema: {
      target: { nodeId: "node_target", occurrenceId: "occ_target" },
      changes: [],
    },
    createFieldDef: { nodeId: "node_field_def", occurrenceId: "occ_field_def" },
    setFieldDefType: {},
    setFieldDefPresence: {},
    addField: { nodeId: "node_field", occurrenceId: "occ_field", created: true },
    setFieldValues: {
      field: { nodeId: "node_field", occurrenceId: "occ_field" },
      changes: [
        { kind: 2, reason: 0, nodeId: "node_value", occurrenceId: "occ_value" },
        { kind: 2, reason: 2, nodeId: "node_moved", occurrenceId: "occ_moved" },
      ],
    },
    removeField: {},
    getNodeById: { occurrence: undefined },
    ...overrides,
  };

  const make = (method: string) => (params: unknown) => {
    calls.push({ method, params });
    const response = responses[method];
    if (typeof response === "function") {
      return Promise.resolve((response as ResponseFactory)(params));
    }
    return Promise.resolve(response);
  };

  const client = {
    createWorkspaceDoc: make(Methods.CreateWorkspaceDoc),
    listWorkspaceDocs: make(Methods.ListWorkspaceDocs),
    removeWorkspaceDoc: make(Methods.RemoveWorkspaceDoc),
    createPlainNode: make(Methods.CreatePlainNode),
    getNode: make(Methods.GetNode),
    getNodeChildren: make(Methods.GetNodeChildren),
    moveNode: make(Methods.MoveNode),
    removeNodeOccurrence: make(Methods.RemoveNodeOccurrence),
    hardDeleteNode: make(Methods.HardDeleteNode),
    replaceNodeText: make(Methods.ReplaceNodeText),
    createRef: make(Methods.CreateRef),
    cloneRef: make(Methods.CloneRef),
    createSchema: make(Methods.CreateSchema),
    applySchema: make(Methods.ApplySchema),
    removeSchema: make(Methods.RemoveSchema),
    reconcileSchema: make(Methods.ReconcileSchema),
    createFieldDef: make(Methods.CreateFieldDef),
    setFieldDefType: make(Methods.SetFieldDefType),
    setFieldDefPresence: make(Methods.SetFieldDefPresence),
    addField: make(Methods.AddField),
    setFieldValues: make(Methods.SetFieldValues),
    removeField: make(Methods.RemoveField),
    getNodeById: make(Methods.GetNodeById),
  } as unknown as ClientLike;

  return { client, calls };
}

export function wireNode(nodeId: string, occurrenceId: string) {
  return {
    nodeId,
    occurrenceId,
    parentOccurrenceId: undefined,
    canonicalOccurrenceId: occurrenceId,
    canonicalChildOccurrenceIds: [],
    props: {},
    entityMeta: {},
    occurrenceProps: {},
    occurrenceMeta: {},
    deltas: [],
  };
}

function toOrderedFlags(flags: Record<string, string[]>): ParsedCli["orderedFlags"] {
  return Object.entries(flags).flatMap(([name, values]) =>
    values.map((value) => ({ name, value })),
  );
}
