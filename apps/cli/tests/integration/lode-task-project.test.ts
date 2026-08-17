import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startDaemon, type Daemon } from "@lode/daemon";
import { createEngine } from "@lode/engine/host";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli.js";

const accessToken = "task-project-access-token";
const workspaceId = "task-project";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Task and Project through task-oriented CLI commands", () => {
  it("builds, searches, presents, reviews, restores, restarts, and syncs the daily modeling loop", async () => {
    const leftRoot = await temporaryDirectory("left");
    const rightRoot = await temporaryDirectory("right");
    let left = await daemon(leftRoot);
    let right: Daemon | null = null;
    try {
      expect(array(value(await domain(left.address, "help")).commands, "domain command help").length).toBeGreaterThan(
        0,
      );
      await domain(left.address, "workspace-show");
      await domain(left.address, "node-create", "projects", workspaceId, "--text", "Projects");
      await domain(left.address, "supertag-create", "project", workspaceId, "--text", "Project");
      await domain(left.address, "supertag-create", "task", workspaceId, "--text", "Task");
      await domain(left.address, "supertag-create", "urgent", workspaceId, "--text", "Urgent");
      await domain(left.address, "supertag-extend", "urgent", "task");
      for (const field of ["due", "project-field", "estimate", "done"] as const) {
        await domain(left.address, "field-definition-create", field, workspaceId, "--text", field);
      }
      await domain(left.address, "template-field-create", "task", "task-status-template", "status", "--text", "Status");
      await domain(left.address, "template-field-discover", "task", "task-status-template", "status");
      await domain(left.address, "template-field-remove", "task", "task-status-template");
      await domain(left.address, "template-field-add-existing", "task", "task-status-readded", "status");
      await domain(left.address, "template-field-visibility", "task", "task-status-readded", "pinned");
      await domain(left.address, "template-field-default", "task", "task-status-readded", "Backlog");
      await domain(left.address, "template-field-add-existing", "project", "project-status-template", "status");
      await domain(
        left.address,
        "template-field-create",
        "project",
        "project-notes-template",
        "notes",
        "--text",
        "Notes",
      );
      await domain(left.address, "template-field-discover", "project", "project-notes-template", "notes");
      await domain(left.address, "optional-field-add", "task", "notes");
      await domain(left.address, "field-configure", "status", "options");
      await domain(left.address, "field-configure", "due", "date");
      await domain(left.address, "field-configure", "estimate", "number");
      await domain(left.address, "field-configure", "done", "checkbox");
      await domain(
        left.address,
        "field-configure",
        "project-field",
        "options-from-supertag",
        "--options-supertag",
        "project",
      );

      await domain(left.address, "node-create", "project-a", "projects", "--text", "Project A");
      await domain(left.address, "supertag-apply", "project-a", "project");
      for (const task of ["task-a", "task-b"] as const) {
        await domain(
          left.address,
          "node-create",
          task,
          "project-a",
          "--text",
          task === "task-a" ? "First task" : "Second task",
        );
        await domain(left.address, "supertag-apply", task, "task");
        await domain(left.address, "field-option-set", task, "project-field", "project-a");
      }
      await domain(left.address, "supertag-apply", "task-a", "urgent");
      await domain(left.address, "field-plain-set", "task-a", "status", "Backlog");
      await domain(left.address, "field-plain-set", "task-b", "status", "Done");
      await domain(left.address, "field-date-set", "task-a", "due", "2026-08-20");
      await domain(left.address, "field-date-set", "task-b", "due", "2026-08-21");
      await domain(left.address, "field-number-set", "task-a", "estimate", "3");
      await domain(left.address, "field-checkbox-set", "task-a", "done", "false");
      await domain(left.address, "supertag-remove", "task-a", "task");
      expect(
        array(value(await domain(left.address, "field-show", "task-a")).materialized, "retained Fields"),
      ).not.toHaveLength(0);
      await domain(left.address, "supertag-apply", "task-a", "task", "--application", "task-a-task-reapplied");

      await domain(left.address, "node-create", "open-tasks", "project-a", "--type", "search", "--text", "Open tasks");
      await domain(
        left.address,
        "search-create",
        "open-tasks",
        "--tag",
        "task",
        "--field-value",
        "status=Backlog",
        "--date-lt",
        "due=2026-09-01",
        "--descendant-of",
        "project-a",
      );
      await domain(left.address, "view-create", "open-tasks", "open-tasks-view", "table");
      await domain(
        left.address,
        "view-options",
        "open-tasks",
        "open-tasks-view",
        "--columns",
        "status,due,project-field,estimate,done",
        "--filter-field",
        "status=Backlog",
        "--sort",
        "due:descending",
        "--group",
        "status",
      );

      expect(nodeIds(await domain(left.address, "search-results", "open-tasks"), "results")).toEqual(["task-a"]);
      expect(nodeIds(await domain(left.address, "view-rows", "open-tasks"), "rows")).toEqual(["task-a"]);
      const fields = value(await domain(left.address, "field-show", "task-a"));
      expect(array(fields.typed, "typed Task fields")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fieldDefinitionId: "due", state: "value" }),
          expect.objectContaining({ fieldDefinitionId: "estimate", state: "value" }),
          expect.objectContaining({ fieldDefinitionId: "done", state: "value" }),
          expect.objectContaining({ fieldDefinitionId: "project-field", state: "value" }),
        ]),
      );

      await domain(
        left.address,
        "supertag-apply",
        "task-b",
        "urgent",
        "--proposal",
        "--channel",
        "task-proposal",
        "--application",
        "task-b-urgent-proposal",
      );
      const reviewHunks = array(value(await domain(left.address, "review-list")).hunks, "Review hunks");
      expect(
        reviewHunks.some(
          (hunk) => record(record(hunk, "Review hunk").diffSpace, "Review diff space").kind === "supertag-application",
        ),
      ).toBe(true);
      await domain(left.address, "review-accept", "supertag-application", "--channel", "task-proposal");
      expect(nodeIds(await domain(left.address, "supertag-instances", "urgent"), "nodeIds")).toEqual([
        "task-a",
        "task-b",
      ]);

      await domain(
        left.address,
        "node-create",
        "rejected-task",
        "project-a",
        "--proposal",
        "--channel",
        "rejected-task",
      );
      await domain(left.address, "review-reject", "lifecycle", "--channel", "rejected-task");
      expect(nodeIds(await domain(left.address, "outline", "project-a", "--depth", "1"), "rows")).not.toContain(
        "rejected-task",
      );

      await domain(left.address, "field-plain-set", "task-b", "status", "Backlog", "--channel", "task-status");
      expect(nodeIds(await domain(left.address, "view-rows", "open-tasks"), "rows")).toEqual(["task-b", "task-a"]);
      await domain(left.address, "history-undo", "--channel", "task-status");
      expect(nodeIds(await domain(left.address, "view-rows", "open-tasks"), "rows")).toEqual(["task-a"]);

      await left.stop();
      left = await daemon(leftRoot);
      expect(nodeIds(await domain(left.address, "search-results", "open-tasks"), "results")).toEqual(["task-a"]);
      expect(nodeIds(await domain(left.address, "view-rows", "open-tasks"), "rows")).toEqual(["task-a"]);

      right = await daemon(rightRoot);
      await domain(right.address, "workspace-show");
      let syncOutput = "";
      await runCli(["sync", left.address, workspaceId, right.address, "--access-token", accessToken], (text) => {
        syncOutput += text;
      });
      expect(record(JSON.parse(syncOutput) as unknown, "Sync result").status).toBe("ok");
      expect(nodeIds(await domain(right.address, "search-results", "open-tasks"), "results")).toEqual(["task-a"]);
      expect(nodeIds(await domain(right.address, "view-rows", "open-tasks"), "rows")).toEqual(["task-a"]);
      expect(
        array(value(await domain(right.address, "field-show", "task-a")).typed, "synced typed fields"),
      ).toHaveLength(4);
    } finally {
      await left.stop();
      await right?.stop();
    }
  }, 40_000);
});

async function daemon(dataRoot: string): Promise<Daemon> {
  const engine = await createEngine({ persistence: { dataRoot } });
  return startDaemon({ engine, listen: "tcp://127.0.0.1:0", accessToken });
}

async function domain(endpoint: string, ...args: readonly string[]): Promise<Record<string, unknown>> {
  let output = "";
  await runCli(["domain", endpoint, workspaceId, ...args, "--access-token", accessToken], (text) => {
    output += text;
  });
  const result = record(JSON.parse(output) as unknown, "domain CLI result");
  expect(result.status, `${args.join(" ")}\n${JSON.stringify(result, null, 2)}`).not.toBe("rejected");
  return result;
}

function value(result: Record<string, unknown>): Record<string, unknown> {
  expect(result.status, JSON.stringify(result, null, 2)).toBe("ok");
  return record(result.value, "domain CLI value");
}

function nodeIds(result: Record<string, unknown>, member: "results" | "rows" | "nodeIds"): unknown[] {
  const resultValue = value(result);
  return array(resultValue[member], `${member} values`).map((item) => {
    if (typeof item === "string") {
      return item;
    }
    const row = record(item, `${member} item`);
    return row.targetNodeId ?? row.nodeId;
  });
}

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `lode-task-project-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not an array`);
  }
  return value;
}
