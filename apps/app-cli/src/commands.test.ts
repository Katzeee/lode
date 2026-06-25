import { describe, expect, it } from "vitest";
import { executeCommand } from "./commands.js";
import { command, createFakeClient, Methods, wireNode } from "./commands.test-helpers.js";

describe("executeCommand", () => {
  it("maps schema apply flags to typed client params", async () => {
    const { client, calls } = createFakeClient({
      getNodeById: (params: unknown) => {
        const nodeId = (params as { nodeId: string }).nodeId;
        if (nodeId === "node_schema") {
          return {
            occurrence: {
              ...wireNode("node_schema", "occ_schema"),
              deltas: [{ insert: "Task" }],
            },
          };
        }
        return { occurrence: undefined };
      },
    });
    const summary = await executeCommand(
      client,
      command("schema", "apply", {
        "--doc": ["doc_main"],
        "--target-occ": ["occ_target"],
        "--schema-node": ["node_schema"],
      }),
    );

    expect(calls).toContainEqual({
      method: Methods.ApplySchema,
      params: {
        workspaceId: "ws_main",
        docId: "doc_main",
        targetOccurrenceId: "occ_target",
        schemaNodeId: "node_schema",
      },
    });
    expect(summary).toBe(
      [
        "schema apply target=occ_target schema=Task(node_schema) changes=2",
        "fieldSlot created",
        "  node=node_field",
        "  occ=occ_field",
        "templateRef reused",
        "  node=node_template",
        "  occ=occ_template",
      ].join("\n"),
    );
  });

  it("creates a node with parsed index and initial text (null parent omitted)", async () => {
    const { client, calls } = createFakeClient();

    await executeCommand(
      client,
      command("node", "create", {
        "--doc": ["doc_main"],
        "--parent-occ": ["null"],
        "--index": ["2"],
        "--text": ["hello"],
      }),
    );

    expect(calls).toContainEqual({
      method: Methods.CreatePlainNode,
      params: {
        workspaceId: "ws_main",
        docId: "doc_main",
        index: 2,
      },
    });
    expect(calls).toContainEqual({
      method: Methods.ReplaceNodeText,
      params: {
        workspaceId: "ws_main",
        docId: "doc_main",
        occurrenceId: "occ_new",
        deltas: [{ insert: "hello" }],
      },
    });
  });

  it("prints readable node details and child rows", async () => {
    const { client } = createFakeClient({
      getNode: {
        occurrence: {
          ...wireNode("node_task", "occ_task"),
          canonicalChildOccurrenceIds: ["occ_child"],
          deltas: [{ insert: "Task title" }],
          entityMeta: { schemaIds: ["node_schema"] },
          occurrenceMeta: { managedKind: "fieldSlot" },
        },
      },
      getNodeChildren: {
        children: [
          {
            ...wireNode("node_child", "occ_child"),
            parentOccurrenceId: "occ_task",
            deltas: [{ insert: "Child text" }],
            entityMeta: { fieldDefId: "node_field_def" },
          },
        ],
      },
      getNodeById: (params: unknown) => {
        const nodeId = (params as { nodeId: string }).nodeId;
        if (nodeId === "node_schema") {
          return {
            occurrence: {
              ...wireNode("node_schema", "occ_schema"),
              deltas: [{ insert: "Task" }],
            },
          };
        }
        if (nodeId === "node_field_def") {
          return {
            occurrence: {
              ...wireNode("node_field_def", "occ_field_def"),
              deltas: [{ insert: "Due" }],
            },
          };
        }
        return { occurrence: undefined };
      },
    });

    const nodeSummary = await executeCommand(
      client,
      command("node", "get", {
        "--doc": ["doc_main"],
        "--occ": ["occ_task"],
      }),
    );
    const childrenSummary = await executeCommand(
      client,
      command("node", "children", {
        "--doc": ["doc_main"],
        "--occ": ["occ_task"],
      }),
    );

    expect(nodeSummary).toBe(
      [
        "node",
        "occ_task  Task title",
        "  node=node_task parent=null canonical=occ_task canonicalChildren=1",
        "  entityMeta.schemaIds=Task(node_schema)",
        "  occurrenceMeta.managedKind=fieldSlot",
      ].join("\n"),
    );
    expect(childrenSummary).toBe(
      [
        "children parent=occ_task count=1",
        "occ_child  Child text",
        "  node=node_child parent=occ_task canonical=occ_child canonicalChildren=0",
        "  entityMeta.fieldDefId=Due(node_field_def)",
      ].join("\n"),
    );
  });

  it("preserves ordered field value flags as proto FieldValueInput", async () => {
    const { client, calls } = createFakeClient();

    const summary = await executeCommand(
      client,
      command(
        "field",
        "set-values",
        {
          "--doc": ["doc_main"],
          "--field-occ": ["occ_field"],
          "--text": ["a", "c"],
          "--ref-node": ["node_b"],
          "--move-occ": ["occ_move"],
        },
        [
          { name: "--doc", value: "doc_main" },
          { name: "--field-occ", value: "occ_field" },
          { name: "--text", value: "a" },
          { name: "--ref-node", value: "node_b" },
          { name: "--text", value: "c" },
          { name: "--move-occ", value: "occ_move" },
        ],
      ),
    );

    const setValuesCall = calls.find((c) => c.method === Methods.SetFieldValues) as
      | { method: string; params: { values: { value: { case: string } }[] } }
      | undefined;
    expect(setValuesCall?.params).toMatchObject({
      workspaceId: "ws_main",
      docId: "doc_main",
      fieldOccurrenceId: "occ_field",
    });
    const cases = setValuesCall?.params.values.map((v) => v.value.case);
    expect(cases).toEqual(["text", "ref", "text", "move"]);
    expect(summary).toBe(
      [
        "field set-values field=occ_field values=4 changes=2",
        "fieldValue created",
        "  node=node_value",
        "  occ=occ_value",
        "fieldValue moved",
        "  node=node_moved",
        "  occ=occ_moved",
      ].join("\n"),
    );
  });

  it("prints field add output as an operation block", async () => {
    const { client } = createFakeClient({
      getNodeById: (params: unknown) => {
        const nodeId = (params as { nodeId: string }).nodeId;
        if (nodeId === "node_field_def") {
          return {
            occurrence: {
              ...wireNode("node_field_def", "occ_field_def"),
              deltas: [{ insert: "Due" }],
            },
          };
        }
        return { occurrence: undefined };
      },
    });

    const summary = await executeCommand(
      client,
      command("field", "add", {
        "--doc": ["doc_main"],
        "--target-occ": ["occ_target"],
        "--field-def-node": ["node_field_def"],
      }),
    );

    expect(summary).toBe(
      [
        "field add status=created",
        "occ_field  field",
        "  node=node_field target=occ_target fieldDef=Due(node_field_def)",
      ].join("\n"),
    );
  });

  it("parses field definition type and presence flags into proto enums", async () => {
    const { client, calls } = createFakeClient();

    await executeCommand(
      client,
      command("field-def", "create", {
        "--doc": ["doc_main"],
        "--parent-occ": ["occ_defs"],
        "--name": ["Due"],
        "--field-type": ["date"],
        "--presence": ["optional"],
      }),
    );
    await executeCommand(
      client,
      command("field-def", "set-type", {
        "--doc": ["doc_main"],
        "--field-def-node": ["node_field_def"],
        "--field-type": ["checkbox"],
      }),
    );

    expect(calls).toContainEqual({
      method: Methods.CreateFieldDef,
      params: {
        workspaceId: "ws_main",
        docId: "doc_main",
        parentOccurrenceId: "occ_defs",
        name: "Due",
        fieldType: 3,
        presence: 1,
      },
    });
    expect(calls).toContainEqual({
      method: Methods.SetFieldDefType,
      params: {
        workspaceId: "ws_main",
        docId: "doc_main",
        fieldDefNodeId: "node_field_def",
        fieldType: 4,
      },
    });
  });

  it("rejects unknown commands and invalid flags", async () => {
    const { client } = createFakeClient();

    await expect(executeCommand(client, command("schema", "unknown", {}))).rejects.toThrow(
      /Unknown command/,
    );
    await expect(
      executeCommand(client, command("schema", "apply", { "--doc": ["doc_main"] })),
    ).rejects.toThrow(/--target-occ/);
    await expect(
      executeCommand(client, command("schema", "apply", { "--doc": ["doc_main"], "--bad": ["x"] })),
    ).rejects.toThrow(/Unknown flag/);
  });
});
