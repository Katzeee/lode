import { describe, expect, it } from "vitest";

import { CommandCatalog } from "./index.js";
import { buildCatalog } from "../composition.js";

describe("command catalog", () => {
  it("gives every registered definition a unique path, parser inputs, handler, and help", () => {
    const catalog = buildCatalog();
    const definitions = catalog.all();
    expect(definitions.length).toBeGreaterThan(0);
    const paths = new Set<string>();
    for (const definition of definitions) {
      const key = definition.path.join(" ");
      expect(paths.has(key), `duplicate command path ${key}`).toBe(false);
      paths.add(key);
      expect(definition.path.length).toBeGreaterThanOrEqual(2);
      expect(definition.summary.length).toBeGreaterThan(0);
      expect(
        [definition.run, definition.runManagement].filter((handler) => typeof handler === "function"),
      ).toHaveLength(1);
      for (const positional of definition.positionals) {
        expect(positional[0].length).toBeGreaterThan(0);
        expect(positional[1].length).toBeGreaterThan(0);
      }
      for (const option of definition.options) {
        expect(option.name.startsWith("--")).toBe(true);
        expect(option.description.length).toBeGreaterThan(0);
        for (const conflict of option.conflicts ?? []) {
          expect(definition.options.some((candidate) => candidate.name === conflict)).toBe(true);
        }
      }
      const help = catalog.help(definition);
      expect(help).toContain(key.replace(/ /g, " ").split(" ").join(" "));
      expect(help).toContain(definition.summary);
    }
  });

  it("derives dispatch and family help from the same registry", () => {
    const catalog = buildCatalog();
    expect(catalog.resolve(["workspace", "create"])).toBeDefined();
    expect(catalog.resolve(["workspace", "create"])?.path).toEqual(["workspace", "create"]);
    expect(catalog.resolve(["workspace", "nope"])).toBeUndefined();
    expect(catalog.families()).toContain("workspace");
    expect(catalog.rootHelp()).toContain("workspace");
    expect(catalog.rootHelp()).not.toContain("domain");
    expect(catalog.rootHelp()).not.toContain("execute");
  });

  it("rejects duplicate registrations", () => {
    const catalog = new CommandCatalog();
    catalog.register({
      path: ["sample", "action"],
      summary: "Sample.",
      positionals: [],
      options: [],
      kind: "read",
      paginated: false,
      needsWorkspace: true,
      run: async () => {
        await Promise.resolve();
        return { status: "ok", data: null };
      },
    });
    expect(() =>
      catalog.register({
        path: ["sample", "action"],
        summary: "Duplicate.",
        positionals: [],
        options: [],
        kind: "read",
        paginated: false,
        needsWorkspace: true,
        run: async () => await Promise.resolve({ status: "ok", data: null }),
      }),
    ).toThrow(/Duplicate command path/u);
  });
});
