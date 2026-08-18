import { describe, expect, it } from "vitest";

import { decodeInvocation } from "./index.js";
import { CliError } from "../outcome/index.js";
import { buildCatalog } from "../composition.js";

const catalog = buildCatalog();
const files = {
  readFile: async (path: string) => await Promise.resolve(`content of ${path}`),
  readStdin: async () => await Promise.resolve("stdin content"),
};

async function decode(argv: readonly string[]) {
  return decodeInvocation(argv, catalog, files);
}

async function usageError(argv: readonly string[]): Promise<string> {
  try {
    await decode(argv);
    throw new Error("expected a usage error");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return (error as CliError).message;
  }
}

describe("invocation decoding", () => {
  it("decodes global options and one command without dialing", async () => {
    const invocation = await decode([
      "--home",
      "work",
      "--workspace",
      "Personal",
      "--format",
      "json",
      "--limit",
      "10",
      "workspace",
      "create",
      "Notes",
    ]);
    expect(invocation.kind).toBe("command");
    if (invocation.kind !== "command") {
      return;
    }
    expect(invocation.definition.path).toEqual(["workspace", "create"]);
    expect(invocation.globals.home).toBe("work");
    expect(invocation.globals.workspace).toBe("Personal");
    expect(invocation.globals.format).toBe("json");
    expect(invocation.globals.limit).toBe(10);
    expect(invocation.args.positional("name")).toBe("Notes");
  });

  it("routes help and version without touching the network", async () => {
    expect(await decode(["--version"])).toMatchObject({ kind: "version" });
    expect(await decode([])).toMatchObject({ kind: "version" });
    expect(await decode(["--help"])).toMatchObject({ kind: "help" });
    expect(await decode(["help"])).toMatchObject({ kind: "help" });
    expect(await decode(["workspace", "--help"])).toMatchObject({ kind: "family-help", family: "workspace" });
    expect(await decode(["workspace", "create", "--help"])).toMatchObject({
      kind: "action-help",
      definition: { path: ["workspace", "create"] },
    });
  });

  it("rejects malformed globals, unknown commands, and invalid enumerations", async () => {
    await expect(usageError(["--workspace"])).resolves.toContain("requires a value");
    await expect(usageError(["--format", "yaml", "workspace", "list"])).resolves.toContain("--format");
    await expect(usageError(["--limit", "100", "workspace", "list"])).resolves.toContain("--limit");
    await expect(usageError(["nonfamily", "action"])).resolves.toContain("Unknown command family");
    await expect(usageError(["workspace", "nonexistent"])).resolves.toContain("Unknown command");
  });

  it("rejects options the command does not declare and extra positionals", async () => {
    await expect(usageError(["workspace", "list", "--bogus"])).resolves.toContain("Unknown option");
    await expect(usageError(["workspace", "create", "A", "B"])).resolves.toContain("Unexpected positional");
  });

  it("keeps global options before the family path", async () => {
    await expect(usageError(["workspace", "list", "--format", "json"])).resolves.toContain("Unknown option");
  });
});
