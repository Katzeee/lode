import { describe, expect, it } from "vitest";

import { renderHuman, renderJson } from "./index.js";
import type { CliOutcome } from "../outcome/index.js";
import { CliError, errorOutcome } from "../outcome/index.js";

function capture(): Readonly<{
  out: string[];
  err: string[];
  io: { stdout(t: string): void; stderr(t: string): void };
}> {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) } };
}

function outcome(overrides: Partial<CliOutcome>): CliOutcome {
  return {
    command: "test.command",
    workspace: { ref: "workspace:ws", label: "Personal" },
    status: "ok",
    data: null,
    page: null,
    view: null,
    error: null,
    warnings: [],
    ...overrides,
  };
}

describe("output renderers", () => {
  it("JSON renders exactly one envelope object on stdout", () => {
    const { out, err, io } = capture();
    renderJson(
      { outcome: outcome({ data: { items: [1, 2] }, page: { count: 2, next: "cursor-1" } }), exitCode: 0 },
      io,
    );
    expect(out.length).toBe(1);
    const envelope = JSON.parse(out.join("")) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual([
      "command",
      "data",
      "error",
      "page",
      "status",
      "version",
      "warnings",
      "workspace",
    ]);
    expect(envelope.version).toBe(1);
    expect(envelope.page).toEqual({ count: 2, next: "cursor-1" });
    expect(err.length).toBe(0);
  });

  it("JSON omits the human view from the envelope", () => {
    const { out, io } = capture();
    renderJson(
      {
        outcome: outcome({ data: { a: 1 }, view: { kind: "text", lines: ["human only"] } }),
        exitCode: 0,
      },
      io,
    );
    expect((JSON.parse(out.join("")) as Record<string, unknown>)["view"]).toBeUndefined();
  });

  it("human renders the family view plus warnings and a page hint", () => {
    const { out, io } = capture();
    renderHuman(
      {
        outcome: outcome({
          view: { kind: "table", columns: ["ref", "label"], rows: [["node:a", "Alpha"]] },
          warnings: ["One warning."],
          page: { count: 1, next: "next-cursor" },
        }),
        exitCode: 0,
      },
      io,
    );
    const text = out.join("");
    expect(text).toContain("node:a");
    expect(text).toContain("Alpha");
    expect(text).toContain("One warning.");
    expect(text).toContain("--cursor next-cursor");
  });

  it("human errors go to stderr with code, message, and candidates", () => {
    const { out, err, io } = capture();
    const cliError = new CliError("ambiguous-target", "Target matches 2 nodes.", {
      candidates: [{ ref: "node:a", link: "lode://workspace/ws/node/a", label: "Draft", parents: ["Projects"] }],
    });
    renderHuman(
      { outcome: { ...outcome({ status: "error" }), ...errorOutcome(cliError), view: null }, exitCode: 2 },
      io,
    );
    expect(out.length).toBe(0);
    expect(err.join("")).toContain("[ambiguous-target]");
    expect(err.join("")).toContain("node:a");
    expect(err.join("")).toContain("lode://workspace/ws/node/a");
  });

  it("committed-pending keeps stdout honest about projection lag", () => {
    const { out, io } = capture();
    renderHuman(
      {
        outcome: outcome({
          status: "committed-pending",
          view: null,
          warnings: ["Committed; the projection update is still in progress."],
        }),
        exitCode: 0,
      },
      io,
    );
    expect(out.join("")).toContain("projection is still updating");
  });
});
