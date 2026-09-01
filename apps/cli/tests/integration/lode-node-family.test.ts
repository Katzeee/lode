import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { startHomeHarness, temporaryDirectories } from "./home-harness.js";

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("node family through the product CLI pipeline", () => {
  it("creates, shows, edits, moves, trashes, and restores through product commands", async () => {
    const { run, stop } = await harness("node-family");
    try {
      const created = await run(["--request-id", "q1", "node", "create", "Quarterly plan"]);
      expect(
        created.exitCode,
        `${created.stdout}
${created.stderr}`,
      ).toBe(0);
      expect(created.envelope?.status).toBe("ok");
      const data = created.envelope?.data as Record<string, unknown>;
      expect(data.intent).toBe("direct");
      expect(data.requestId).toBe("q1");
      expect((data.target as { label?: string } | undefined)?.label).toBe("Quarterly plan");
      expect(data.target).toMatchObject({ kind: "node", ref: "node:q1/node" });

      await run(["--request-id", "t1", "node", "create", "First task", "--under", "Quarterly plan"]);
      await run(["--request-id", "t2", "node", "create", "Second task", "--under", "Quarterly plan"]);

      const outline = await run(["node", "outline", "Quarterly plan"]);
      const rows = (outline.envelope?.data as Record<string, unknown>)?.rows as Record<string, unknown>[];
      expect(rows.map((row) => row.depth)).toEqual([1, 1]);

      const shown = await run(["node", "show", "First task"]);
      expect(shown.envelope?.data).toMatchObject({
        resource: { label: "First task", kind: "node" },
        location: "active",
      });

      const edited = await run(["--request-id", "e1", "node", "edit", "First task", "--text", "First task, edited"]);
      expect(edited.envelope?.status).toBe("ok");
      const afterEdit = await run(["node", "show", "First task, edited"]);
      expect(afterEdit.envelope?.data).toMatchObject({ resource: { label: "First task, edited" } });

      const moved = await run([
        "--request-id",
        "m1",
        "node",
        "move",
        "Second task",
        "--under",
        "Quarterly plan",
        "--before",
        "First task, edited",
      ]);
      expect(moved.exitCode).toBe(0);
      const afterMove = await run(["node", "outline", "Quarterly plan"]);
      const movedRows = ((afterMove.envelope?.data as Record<string, unknown>)?.rows as Record<string, unknown>[]).map(
        (row) => (row as { nodeId: string }).nodeId,
      );
      expect(movedRows.indexOf("t2/node")).toBeLessThan(movedRows.indexOf("t1/node"));

      await run(["--request-id", "d1", "node", "trash", "Second task"]);
      const trashed = await run(["node", "show", "Second task"]);
      expect(trashed.envelope?.data).toMatchObject({ location: "trash" });

      const restored = await run(["--request-id", "r1", "node", "restore", "Second task"]);
      expect(restored.exitCode).toBe(0);
      const afterRestore = await run(["node", "show", "Second task"]);
      expect(afterRestore.envelope?.data).toMatchObject({ location: "active" });
    } finally {
      await stop();
    }
  }, 30_000);

  it("fails reads and writes with stable codes and no partial changes", async () => {
    const { run, stop } = await harness("node-family-failures");
    try {
      const created = await run(["--request-id", "x1", "node", "create", "Draft"]);
      expect(created.exitCode).toBe(0);
      await run(["--request-id", "x0", "node", "create", "Notes"]);
      await run(["--request-id", "x2", "node", "create", "Draft", "--under", "Notes"]);

      const missing = await run(["node", "show", "Nope"]);
      expect(missing.exitCode).toBe(2);
      expect(missing.envelope).toMatchObject({
        workspace: { ref: "workspace:workspace", label: "Node Family" },
        status: "error",
        error: { code: "target-not-found" },
      });

      const ambiguous = await run(["node", "show", "Draft"]);
      expect(ambiguous.exitCode).toBe(2);
      const candidates = ((ambiguous.envelope?.error as Record<string, unknown>)?.candidates ?? []) as Record<
        string,
        unknown
      >[];
      expect(candidates).toHaveLength(2);
      expect(
        candidates.every((candidate) => typeof candidate.link === "string" && candidate.link.includes("lode://")),
      ).toBe(true);

      const beforeWrite = await run(["node", "outline", "Notes"]);
      const scopedCreate = await run([
        "--request-id",
        "x3",
        "node",
        "create",
        "Draft",
        "--under",
        "Notes",
        "--before",
        "Draft",
      ]);
      expect(scopedCreate.exitCode).toBe(2);
      const notFoundCreate = await run(["--request-id", "x4", "node", "create", "X", "--under", "Ghost"]);
      expect(notFoundCreate.envelope).toMatchObject({ error: { code: "target-not-found" } });
      const afterWrite = await run(["node", "outline", "Notes"]);
      expect(afterWrite.envelope?.data).toEqual(beforeWrite.envelope?.data);

      const restoreActive = await run(["node", "restore", "Notes"]);
      expect(restoreActive.envelope).toMatchObject({ error: { code: "unsupported" } });

      const readRejectsIntent = await run(["node", "show", "Draft", "--intent", "proposal"]);
      expect(readRejectsIntent.envelope).toMatchObject({ error: { code: "usage" } });
      const notPaginated = await run(["node", "show", "Draft", "--cursor", "c"]);
      expect(notPaginated.envelope).toMatchObject({ error: { code: "usage" } });
    } finally {
      await stop();
    }
  }, 30_000);

  it("retries the same request id and rejects a conflicting reuse", async () => {
    const { run, stop } = await harness("node-family-idempotency");
    try {
      const first = await run(["--request-id", "same", "node", "create", "Retry me"]);
      expect(first.exitCode).toBe(0);
      const retry = await run(["--request-id", "same", "node", "create", "Retry me"]);
      expect(retry.exitCode).toBe(0);
      const outline = await run(["node", "outline", "node:workspace"]);
      const rows = ((outline.envelope?.data as Record<string, unknown>)?.rows ?? []) as Record<string, string>[];
      expect(rows.filter((row) => row.nodeId === "same/node")).toHaveLength(1);

      const conflict = await run(["--request-id", "same", "node", "create", "Different"]);
      expect(conflict.exitCode).toBe(3);
      expect(conflict.envelope).toMatchObject({
        status: "error",
        error: { code: "invocation-conflict", details: { engineCode: "invocation-conflict" } },
      });
    } finally {
      await stop();
    }
  }, 30_000);
});

const harness = (label: string) => startHomeHarness(label, "Node Family");
