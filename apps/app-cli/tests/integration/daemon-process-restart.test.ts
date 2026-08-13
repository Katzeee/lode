import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  array,
  cliRequest,
  type DaemonProcess,
  record,
  startDaemonProcess,
} from "./daemon-process-test-helpers.js";

const accessToken = "real-child-process-access-token";
const workspaceId = "restart-idempotency";
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const temporaryDirectories: string[] = [];
let daemon: DaemonProcess | null = null;

afterEach(async () => {
  await daemon?.stop();
  daemon = null;
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

describe("real daemon child-process restart", () => {
  it("deduplicates Schema Application initializer Resolution and History compensation after lost acknowledgements", async () => {
    const processRoot = await temporaryDirectory();
    daemon = await startDaemonProcess(processRoot, accessToken);
    await mutate(daemon.address, "setup", "setup", [
      nodeAt("task", workspaceId, "task-occurrence"),
      nodeAt("schema", workspaceId, "schema-occurrence"),
      nodeAt("field", workspaceId, "field-occurrence"),
      {
        kind: "schema-field-add",
        schemaId: "schema",
        fieldDefinitionId: "field",
        fieldNodeId: "schema-field-template-field",
        fieldOccurrenceId: "schema-field-template-field-occurrence",
        anchor: end,
      },
      {
        kind: "schema-field-configure",
        schemaId: "schema",
        fieldDefinitionId: "field",
        fieldNodeId: "schema-field-template-field",
        config: {
          visibility: "normal",
          staticDefault: [{ kind: "text", value: "Default" }],
          initializer: null,
        },
      },
    ]);

    const apply = mutateCommand("apply-once", "schema", "direct", [
      { kind: "schema-apply", nodeId: "task", schemaId: "schema", anchor: end },
    ]);
    await loseAcknowledgement(daemon.address, apply);
    daemon = await restart(processRoot, daemon);
    await expectRetryMatchesDurableOutcome(daemon.address, "apply-once", apply);
    expect((await projectionSection(daemon.address, "schemaApplications")).task).toEqual([
      "schema",
    ]);
    const fields = array(
      (await projectionSection(daemon.address, "materializedFields")).task,
      "Task Fields",
    );
    expect(fields).toHaveLength(1);
    const valueOccurrenceIds = array(
      record(fields[0], "Task Field").valueOccurrenceIds,
      "Field values",
    );
    expect(valueOccurrenceIds).toHaveLength(1);
    const valueOccurrenceId = valueOccurrenceIds[0];
    const occurrence = record(
      (await projectionSection(daemon.address, "occurrences"))[String(valueOccurrenceId)],
      "Initialized value Occurrence",
    );
    const valueNode = record(
      (await projectionSection(daemon.address, "nodes"))[String(occurrence.nodeId)],
      "Initialized value Node",
    );
    expect(
      array(valueNode.text, "Initialized text")
        .map((atom) => record(atom, "Atom").value)
        .join(""),
    ).toBe("Default");

    await mutate(
      daemon.address,
      "proposal-once",
      "review",
      [
        {
          kind: "value-set",
          target: { kind: "node", id: "task" },
          namespace: "property",
          key: "reviewed",
          value: true,
        },
      ],
      "proposal",
    );
    const review = await query(daemon.address, { kind: "review", workspaceId });
    const hunk = record(array(review.hunks, "Review Hunks")[0], "Review Hunk");
    const resolution = {
      kind: "resolve-review",
      workspaceId,
      invocationId: "resolve-once",
      actorId: "reviewer",
      decision: "accept",
      selection: hunk.selection,
    };
    await loseAcknowledgement(daemon.address, resolution);
    daemon = await restart(processRoot, daemon);
    await expectRetryMatchesDurableOutcome(daemon.address, "resolve-once", resolution);
    expect(record((await projectionSection(daemon.address, "nodes")).task, "Task")).toMatchObject({
      properties: { reviewed: true },
    });
    expect(
      array((await query(daemon.address, { kind: "review", workspaceId })).hunks, "Hunks"),
    ).toEqual([]);

    await mutate(daemon.address, "history-edit", "history", [
      {
        kind: "value-set",
        target: { kind: "node", id: "task" },
        namespace: "property",
        key: "temporary",
        value: "remove me",
      },
    ]);
    const history = await query(daemon.address, {
      kind: "history",
      workspaceId,
      channelId: "history",
    });
    const undo = {
      kind: "undo",
      workspaceId,
      invocationId: "undo-once",
      actorId: "history-user",
      selection: history.undo,
    };
    await loseAcknowledgement(daemon.address, undo);
    daemon = await restart(processRoot, daemon);
    await expectRetryMatchesDurableOutcome(daemon.address, "undo-once", undo);
    const task = record((await projectionSection(daemon.address, "nodes")).task, "Task");
    expect(record(task.properties, "Task properties").temporary).toBeUndefined();
  });
});

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string) {
  return { kind: "node-create", nodeId, parentNodeId, occurrenceId, anchor: end };
}

async function mutate(
  endpoint: string,
  invocationId: string,
  channelId: string,
  mutations: readonly unknown[],
  intent: "direct" | "proposal" = "direct",
): Promise<void> {
  expect(
    await execute(endpoint, mutateCommand(invocationId, channelId, intent, mutations)),
  ).toMatchObject({
    status: "published",
  });
}

function mutateCommand(
  invocationId: string,
  channelId: string,
  intent: "direct" | "proposal",
  mutations: readonly unknown[],
) {
  return {
    kind: "mutate",
    workspaceId,
    invocationId,
    actorId: "restart-user",
    intent,
    historyChannelId: channelId,
    mutations,
  };
}

async function loseAcknowledgement(endpoint: string, command: unknown): Promise<void> {
  const durable = await execute(endpoint, command);
  expect(durable.status).toBe("published");
  await expect(Promise.reject(new Error("simulated acknowledgement loss"))).rejects.toThrow(
    "simulated acknowledgement loss",
  );
}

async function expectRetryMatchesDurableOutcome(
  endpoint: string,
  invocationId: string,
  command: unknown,
): Promise<void> {
  const outcome = await query(endpoint, { kind: "invocation", workspaceId, invocationId });
  const retry = await execute(endpoint, command);
  expect(retry).toEqual(outcome);
  const receipt = record(retry.receipt, "Authority receipt");
  expect(receipt.invocationId).toBe(invocationId);
  expect(array(receipt.factIds, "Receipt Fact identities")).not.toHaveLength(0);
}

async function restart(processRoot: string, current: DaemonProcess): Promise<DaemonProcess> {
  await current.stop();
  return startDaemonProcess(processRoot, accessToken);
}

async function projectionSection(
  endpoint: string,
  section: string,
): Promise<Record<string, unknown>> {
  const value = await query(endpoint, {
    kind: "projection",
    workspaceId,
    view: "origin",
    section,
  });
  return record(value[section], `${section} Projection`);
}

async function execute(endpoint: string, command: unknown): Promise<Record<string, unknown>> {
  return cliRequest("execute", endpoint, accessToken, command);
}

async function query(endpoint: string, request: unknown): Promise<Record<string, unknown>> {
  const response = await cliRequest("query", endpoint, accessToken, request);
  expect(response.status).toBe("ok");
  return record(response.value, "Query value");
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lode-real-daemon-process-"));
  temporaryDirectories.push(directory);
  return directory;
}
