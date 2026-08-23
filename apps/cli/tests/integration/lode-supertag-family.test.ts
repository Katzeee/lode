import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { startHomeHarness, temporaryDirectories } from "./home-harness.js";

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("supertag and reference families through the product CLI", () => {
  it("authors definitions, template fields, applications, and extensions with distinct effects", async () => {
    const { run, stop } = await harness("supertag-family");
    try {
      expect((await run(["--request-id", "t1", "supertag", "create", "Task"])).exitCode).toBe(0);
      expect((await run(["--request-id", "t2", "supertag", "create", "Urgent"])).exitCode).toBe(0);
      expect((await run(["--request-id", "t3", "supertag", "extend", "Urgent", "--with", "Task"])).exitCode).toBe(0);

      const added = await run([
        "--request-id",
        "f1",
        "supertag",
        "field",
        "add-new",
        "Task",
        "--field",
        "Status",
        "--type",
        "plain",
      ]);
      expect(added.envelope?.status).toBe("ok");
      const fieldRef = ((added.envelope?.data as Record<string, unknown>)?.field as Record<string, unknown>)?.ref;
      expect(fieldRef).toBe("field:f1/field-definition");

      expect(
        (
          await run([
            "--request-id",
            "f2",
            "supertag",
            "field",
            "set-default",
            "Task",
            "--field",
            "Status",
            "--value",
            "Backlog",
          ])
        ).exitCode,
      ).toBe(0);
      expect(
        (await run(["--request-id", "f3", "supertag", "field", "pin", "Task", "--field", "Status"])).exitCode,
      ).toBe(0);

      const shown = await run(["supertag", "show", "Task"]);
      const data = shown.envelope?.data as Record<string, unknown>;
      const templateFields = data.templateFields as readonly Record<string, unknown>[];
      expect(templateFields).toHaveLength(1);
      const shownField = templateFields.at(0);
      if (shownField === undefined) {
        throw new Error("expected one template field");
      }
      expect(shownField.visibility).toBe("pinned");
      expect(shownField.owner).toBe("template-field");
      const shownFieldField = shownField.field as Record<string, string>;
      expect(shownFieldField.label).toBe("Status");
      expect(shownFieldField.ref).toBe("field:f1/field-definition");
      expect(data.extends).toEqual([]);

      expect((await run(["--request-id", "n1", "node", "create", "Quarterly plan"])).exitCode).toBe(0);
      expect(
        (await run(["--request-id", "a1", "supertag", "apply", "Urgent", "--to", "Quarterly plan"])).exitCode,
      ).toBe(0);
      const instances = await run(["supertag", "instances", "Urgent"]);
      expect((instances.envelope?.data as Record<string, unknown>)?.items).toEqual([
        expect.objectContaining({ label: "Quarterly plan" }),
      ]);
      const taskInstances = await run(["supertag", "instances", "Task"]);
      expect((taskInstances.envelope?.data as Record<string, unknown>)?.items).toEqual([
        expect.objectContaining({ label: "Quarterly plan" }),
      ]);

      expect(
        (await run(["--request-id", "a2", "supertag", "remove", "Urgent", "--to", "Quarterly plan"])).exitCode,
      ).toBe(0);
      expect(
        ((await run(["supertag", "instances", "Urgent"])).envelope?.data as Record<string, unknown>)?.items,
      ).toEqual([]);

      const wrongRemove = await run(["supertag", "remove", "Urgent", "--to", "Quarterly plan"]);
      expect(wrongRemove.envelope).toMatchObject({ error: { code: "invalid-value" } });
      const optionalRejected = await run([
        "--request-id",
        "f4",
        "supertag",
        "field",
        "add-new",
        "Task",
        "--field",
        "Notes",
        "--optional",
        "true",
      ]);
      expect(optionalRejected.envelope).toMatchObject({ error: { code: "usage" } });
    } finally {
      await stop();
    }
  }, 30_000);

  it("places block and inline references with backlinks and original navigation", async () => {
    const { run, stop } = await harness("reference-family");
    try {
      await run(["--request-id", "n1", "node", "create", "Target note"]);
      await run(["--request-id", "n2", "node", "create", "Host note"]);
      const block = await run(["--request-id", "r1", "reference", "add", "Target note", "--under", "Host note"]);
      expect(block.envelope?.status).toBe("ok");
      expect((block.envelope?.data as Record<string, unknown>)?.occurrence).toMatchObject({
        ref: "occurrence:r1/reference-occurrence",
      });

      const inline = await run([
        "--request-id",
        "r2",
        "reference",
        "add-inline",
        "Target note",
        "--on",
        "Host note",
        "--at",
        "4",
        "--alias",
        "the target",
      ]);
      expect(inline.envelope?.status).toBe("ok");

      const backlinks = await run(["reference", "backlinks", "Target note"]);
      const items = ((backlinks.envelope?.data as Record<string, unknown>)?.items ?? []) as Record<string, string>[];
      expect(items.map((item) => item.sourceKind).sort()).toEqual(["block", "inline"]);

      const original = await run(["reference", "original", "Target note"]);
      expect(original.envelope?.status).toBe("ok");
      expect((original.envelope?.data as Record<string, unknown>)?.owner).toMatchObject({ label: "Family" });

      const twice = await run(["--request-id", "r3", "reference", "add", "Target note", "--under", "Host note"]);
      expect(twice.exitCode, JSON.stringify(twice.envelope)).toBe(3);
      expect(twice.envelope).toMatchObject({ error: { code: "invalid-value" } });

      const badOffset = await run([
        "--request-id",
        "r4",
        "reference",
        "add-inline",
        "Target note",
        "--on",
        "Host note",
        "--at",
        "999",
      ]);
      expect(badOffset.envelope).toMatchObject({ error: { code: "invalid-value" } });
      const badAt = await run([
        "--request-id",
        "r5",
        "reference",
        "add-inline",
        "Target note",
        "--on",
        "Host note",
        "--at",
        "middle",
      ]);
      expect(badAt.envelope).toMatchObject({ error: { code: "invalid-value" } });
    } finally {
      await stop();
    }
  }, 30_000);
});

const harness = (label: string) => startHomeHarness(label, "Family");
