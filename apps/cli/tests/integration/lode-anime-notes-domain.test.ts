import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startDaemon, type Daemon } from "@lode/daemon";
import { createEngine } from "@lode/engine/host";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli.js";

const accessToken = "anime-notes-domain-access-token";
const workspaceId = "anime-notes-domain";
const directSummary = "A direct edit while its Field source removal is pending";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Anime Notes through task-oriented CLI commands", () => {
  it("models, searches, presents, reviews, restarts, and syncs connected notes without raw JSON", async () => {
    const leftRoot = await temporaryDirectory("left");
    const rightRoot = await temporaryDirectory("right");
    let left = await daemon(leftRoot);
    let right: Daemon | null = null;
    try {
      for (const [nodeId, text] of [
        ["definition-library", "Definition Library"],
        ["library", "Library"],
        ["notes", "Notes"],
      ] as const) {
        await domain(left.address, "node-create", nodeId, workspaceId, "--text", text);
      }
      for (const [supertagId, text] of [
        ["anime-work", "AnimeWork"],
        ["character", "Character"],
        ["anime-context", "AnimeContext"],
        ["quick-impression", "QuickImpression"],
        ["review", "Review"],
      ] as const) {
        await domain(left.address, "supertag-create", supertagId, "definition-library", "--text", text);
      }

      await domain(
        left.address,
        "template-field-create",
        "quick-impression",
        "quick-work-template",
        "work-field",
        "--text",
        "Work",
      );
      await domain(left.address, "template-field-discover", "quick-impression", "quick-work-template", "work-field");
      await domain(left.address, "template-field-add-existing", "review", "review-work-template", "work-field");
      await domain(
        left.address,
        "template-field-create",
        "quick-impression",
        "quick-impression-template",
        "impression-field",
        "--text",
        "Impression",
      );
      await domain(
        left.address,
        "template-field-create",
        "review",
        "review-rating-template",
        "rating-field",
        "--text",
        "Rating",
      );
      await domain(
        left.address,
        "field-configure",
        "work-field",
        "options-from-supertag",
        "--options-supertag",
        "anime-work",
      );
      await domain(left.address, "field-configure", "impression-field", "plain");
      await domain(left.address, "field-configure", "rating-field", "number");

      for (const [nodeId, parentNodeId, text, supertagId] of [
        ["frieren", "library", "Frieren: Beyond Journey's End", "anime-work"],
        ["fern", "library", "Fern", "character"],
        ["quick-note", "notes", "Quick note", "quick-impression"],
        ["review-note", "notes", "Review note", "review"],
      ] as const) {
        await domain(left.address, "node-create", nodeId, parentNodeId, "--text", text);
        await domain(left.address, "supertag-apply", nodeId, supertagId);
      }
      await domain(left.address, "supertag-apply", "quick-note", "anime-context");
      await domain(left.address, "field-option-set", "quick-note", "work-field", "frieren");
      await domain(left.address, "field-option-set", "review-note", "work-field", "frieren");
      await domain(left.address, "field-plain-set", "quick-note", "impression-field", "Quiet, patient, and humane");
      await domain(left.address, "field-number-set", "review-note", "rating-field", "9");
      await domain(left.address, "reference-create", "fern", "quick-note-impression-field", "quick-note-cast-fern");
      await domain(left.address, "reference-create", "frieren", "quick-note-impression-field", "quick-note-cast-work");

      await domain(left.address, "node-create", "anime-search", "notes", "--type", "search", "--text", "Anime notes");
      await domain(left.address, "search-create", "anime-search", "--tag", "quick-impression", "--text", "Quick note");
      await domain(left.address, "view-create", "anime-search", "anime-table", "table");
      await domain(
        left.address,
        "view-options",
        "anime-search",
        "anime-table",
        "--columns",
        "work-field,impression-field",
        "--filter-field",
        "impression-field=Quiet, patient, and humane",
        "--sort",
        "impression-field:ascending",
        "--group",
        "work-field",
      );
      await expectAnimeNotes(left.address);

      await domain(
        left.address,
        "template-field-create",
        "review",
        "review-summary-template",
        "summary-field",
        "--text",
        "Summary",
        "--proposal",
        "--channel",
        "summary-proposal",
      );
      await domain(left.address, "review-accept", "lifecycle", "--channel", "summary-proposal");
      await domain(left.address, "template-field-discover", "review", "review-summary-template", "summary-field");
      await domain(left.address, "field-plain-set", "review-note", "summary-field", "Initial summary");
      await domain(
        left.address,
        "template-field-remove",
        "review",
        "review-summary-template",
        "--proposal",
        "--channel",
        "summary-removal",
      );
      await domain(
        left.address,
        "field-plain-set",
        "review-note",
        "summary-field",
        directSummary,
        "--channel",
        "summary-content",
      );
      expect(fieldDefinitions(await domain(left.address, "field-show", "review-note"))).toContain("summary-field");
      await domain(left.address, "review-accept", "structure", "--channel", "summary-removal");
      expect(fieldDefinitions(await domain(left.address, "field-show", "review-note"))).toContain("summary-field");
      expect(await nodeText(left.address, "review-note-summary-field-value")).toBe(directSummary);

      await domain(
        left.address,
        "supertag-apply",
        "quick-note",
        "review",
        "--application",
        "quick-note-review-proposal",
        "--proposal",
        "--channel",
        "review-proposal",
      );
      expect(
        nodeIds(await domain(left.address, "supertag-instances", "review", "--perspective", "review"), "nodeIds"),
      ).toContain("quick-note");
      await domain(left.address, "review-reject", "supertag-application", "--channel", "review-proposal");
      expect(nodeIds(await domain(left.address, "supertag-instances", "review"), "nodeIds")).toEqual(["review-note"]);

      await left.stop();
      left = await daemon(leftRoot);
      await expectAnimeNotes(left.address);
      expect(fieldDefinitions(await domain(left.address, "field-show", "review-note"))).toContain("summary-field");
      expect(await nodeText(left.address, "review-note-summary-field-value")).toBe(directSummary);

      right = await daemon(rightRoot);
      await domain(right.address, "workspace-show");
      await sync(left.address, right.address);
      await expectAnimeNotes(right.address);
      expect(fieldDefinitions(await domain(right.address, "field-show", "review-note"))).toContain("summary-field");
      expect(await nodeText(right.address, "review-note-summary-field-value")).toBe(directSummary);
    } finally {
      await left.stop();
      await right?.stop();
    }
  }, 45_000);
});

async function expectAnimeNotes(endpoint: string): Promise<void> {
  expect(nodeIds(await domain(endpoint, "search-results", "anime-search"), "results")).toEqual(["quick-note"]);
  expect(nodeIds(await domain(endpoint, "view-rows", "anime-search"), "rows")).toEqual(["quick-note"]);
  expect(nodeIds(await domain(endpoint, "supertag-instances", "anime-work"), "nodeIds")).toEqual(["frieren"]);
  expect(fieldDefinitions(await domain(endpoint, "field-show", "quick-note"))).toEqual(
    expect.arrayContaining(["work-field", "impression-field"]),
  );
  expect(nodeIds(await domain(endpoint, "outline", "quick-note-impression-field", "--depth", "1"), "rows")).toEqual([
    "impression-field",
    "quick-note-impression-field-value",
    "fern",
    "frieren",
  ]);
}

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

async function sync(sourceEndpoint: string, targetEndpoint: string): Promise<void> {
  let output = "";
  await runCli(["sync", sourceEndpoint, workspaceId, targetEndpoint, "--access-token", accessToken], (text) => {
    output += text;
  });
  expect(record(JSON.parse(output) as unknown, "Sync result").status).toBe("ok");
}

async function nodeText(endpoint: string, nodeId: string): Promise<string> {
  const node = record(value(await domain(endpoint, "node-show", nodeId)).node, `Node ${nodeId}`);
  return array(node.content, `Node ${nodeId} content`)
    .filter((item) => record(item, `Node ${nodeId} content item`).kind === "text")
    .map((item) => String(record(item, `Node ${nodeId} text atom`).value))
    .join("");
}

function fieldDefinitions(result: Record<string, unknown>): unknown[] {
  return array(value(result).materialized, "Materialized Fields").map(
    (field) => record(field, "Materialized Field").fieldDefinitionId,
  );
}

function nodeIds(result: Record<string, unknown>, member: "results" | "rows" | "nodeIds"): unknown[] {
  return array(value(result)[member], `${member} values`).map((item) => {
    if (typeof item === "string") {
      return item;
    }
    const row = record(item, `${member} item`);
    return row.targetNodeId ?? row.nodeId;
  });
}

function value(result: Record<string, unknown>): Record<string, unknown> {
  expect(result.status, JSON.stringify(result, null, 2)).toBe("ok");
  return record(result.value, "domain CLI value");
}

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `lode-anime-notes-domain-${label}-`));
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
