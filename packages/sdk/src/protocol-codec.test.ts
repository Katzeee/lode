import { describe, expect, it } from "vitest";
import {
  file_lode_daemon,
  file_lode_edit,
  file_lode_engine,
  file_lode_fact,
  file_lode_history,
  file_lode_maintenance,
  file_lode_model,
  file_lode_projection,
  file_lode_replica_sync,
  file_lode_review,
} from "@lode/protocol/proto";

import {
  decodeEngineCommand,
  decodeEngineEvent,
  decodeEngineQueryResult,
  decodeWriteResult,
  encodeEngineCommand,
  encodeEngineEvent,
  encodeEngineQueryResult,
  encodeWriteResult,
} from "./protocol-codec.js";
import type { EngineCommand, EngineEvent, EngineQueryResult, WriteResult } from "./contract.js";
import { protocolEnumCodecs } from "./protocol-enum-codecs.js";

describe("generated protobuf SDK codec", () => {
  it("has an ergonomic adapter for every protocol-owned enum", () => {
    expect(() =>
      assertProtocolEnumAdapters([
        file_lode_daemon,
        file_lode_edit,
        file_lode_engine,
        file_lode_fact,
        file_lode_history,
        file_lode_maintenance,
        file_lode_model,
        file_lode_projection,
        file_lode_replica_sync,
        file_lode_review,
      ]),
    ).not.toThrow();
  });

  it("round-trips commands without a JSON payload contract", () => {
    const command: EngineCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "invocation",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "node-create",
          nodeId: "node",
          occurrenceId: "node-occurrence",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    };

    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);
  });

  it("round-trips typed results and events", () => {
    const write: WriteResult = {
      status: "rejected",
      error: { code: "invalid-input", message: "invalid", currentGenerationId: null },
    };
    expect(decodeWriteResult(encodeWriteResult(write))).toEqual(write);

    const query = { kind: "invocation", workspaceId: "workspace", invocationId: "invocation" } as const;
    const result: EngineQueryResult<typeof query> = { status: "ok", value: { status: "absent" } };
    expect(decodeEngineQueryResult(encodeEngineQueryResult(query, result), query)).toEqual(result);

    const event: EngineEvent = {
      kind: "projection-published",
      workspaceId: "workspace",
      frontier: { replica: 3 },
      generationId: "generation",
    };
    expect(decodeEngineEvent(encodeEngineEvent(event))).toEqual(event);
  });

  it("round-trips prepared History compensation evidence independently from edit mutations", () => {
    const query = { kind: "history", workspaceId: "workspace", channelId: "desktop" } as const;
    const selection = {
      token: "token",
      channelId: "desktop",
      operation: "undo",
      targetInvocationId: "target",
      headInvocationId: "target",
      headOrdinal: 1,
      frontier: { replica: 2 },
      evidence: {
        targetInvocationId: "target",
        targetFactIds: ["replica:1"],
        compensations: [
          {
            kind: "text-splice",
            nodeId: "node",
            deleteAtomIds: ["replica:1#0"],
            deletedAtoms: [{ id: "replica:1#0", value: "old", attributes: { bold: true } }],
            anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            insert: "new",
            attributes: {},
          },
        ],
      },
    } as const;
    const result: EngineQueryResult<typeof query> = {
      status: "ok",
      value: { channelId: "desktop", undo: selection, redo: null },
    };

    expect(decodeEngineQueryResult(encodeEngineQueryResult(query, result), query)).toEqual(result);
  });

  it("rejects fields outside the generated mutation schema", () => {
    const command = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "invocation",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [{ kind: "node-delete", nodeId: "node", future: true }],
    } as const;

    expect(() => encodeEngineCommand(command as never)).toThrow("Unknown input field: future");
  });
});

type ProtocolEnum = Readonly<{ typeName: string }>;
type ProtocolMessage = Readonly<{
  nestedEnums: readonly ProtocolEnum[];
  nestedMessages: readonly ProtocolMessage[];
}>;
type ProtocolFile = Readonly<{
  enums: readonly ProtocolEnum[];
  messages: readonly ProtocolMessage[];
}>;

function assertProtocolEnumAdapters(files: readonly ProtocolFile[]): void {
  const missing = new Set<string>();
  const inspectMessage = (message: ProtocolMessage): void => {
    for (const nested of message.nestedEnums) {
      if (!protocolEnumCodecs.has(nested.typeName)) {
        missing.add(nested.typeName);
      }
    }
    message.nestedMessages.forEach(inspectMessage);
  };
  for (const file of files) {
    for (const protocolEnum of file.enums) {
      if (protocolEnum.typeName.startsWith("lode.") && !protocolEnumCodecs.has(protocolEnum.typeName)) {
        missing.add(protocolEnum.typeName);
      }
    }
    file.messages.forEach(inspectMessage);
  }
  if (missing.size > 0) {
    throw new Error(`SDK has no enum adapter for ${[...missing].sort().join(", ")}`);
  }
}
