import { expect, it } from "vitest";
import type { EngineCommand } from "./contract.js";
import type { NodeRestoreDestination } from "./node-restore-destination.js";
import { decodeEngineCommand, encodeEngineCommand } from "./protocol-codec.js";
import { END_SEQUENCE_ANCHOR as anchor } from "./model.js";

it("preserves explicit and logical restoration destinations through protobuf", () => {
  const destinations: readonly NodeRestoreDestination[] = [
    { kind: "node", nodeId: "parent" },
    { kind: "field", ownerNodeId: "note", fieldDefinitionId: "assignee" },
  ];
  for (const destination of destinations) {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      actorId: "actor",
      invocationId: "restore",
      historyChannelId: "clipboard",
      intent: "direct",
      actions: [{ kind: "node-restore", nodeId: "source", occurrenceId: "source-original", destination, anchor }],
    };
    expect(decodeEngineCommand(encodeEngineCommand(command))).toEqual(command);
  }
});
