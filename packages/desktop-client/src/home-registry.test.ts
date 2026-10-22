import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  homeNamePattern,
  normalizeHomePath,
  readHomeRegistry,
  registeredHomeAtPath,
  writeHomeRegistry,
} from "./home-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("home registry (lode.toml)", () => {
  it("reads homes, the default, and preserves unknown keys across updates", async () => {
    const configDir = await temporaryDirectory();
    await writeHomeRegistry(configDir, (document) => {
      document["default_home"] = "main";
      document["homes"] = { main: { path: "/srv/lode/personal" } };
      document["experimental"] = true;
    });
    expect(await readHomeRegistry(configDir)).toEqual({
      defaultHome: "main",
      homes: { main: { path: "/srv/lode/personal" } },
    });

    await writeHomeRegistry(configDir, (document) => {
      document.homes = { ...document.homes, work: { path: "/mnt/fast-disk/work" } };
      document["default_home"] = "work";
    });

    expect(await readHomeRegistry(configDir)).toEqual({
      defaultHome: "work",
      homes: {
        main: { path: "/srv/lode/personal" },
        work: { path: "/mnt/fast-disk/work" },
      },
    });
    const text = await readFile(join(configDir, "lode.toml"), "utf8");
    expect(text).toContain("experimental");
  });

  it("removing the default home clears the default", async () => {
    const configDir = await temporaryDirectory();
    await writeHomeRegistry(configDir, (document) => {
      document["default_home"] = "main";
      document["homes"] = { main: { path: "/srv/lode/personal" } };
    });
    await writeHomeRegistry(configDir, (document) => {
      document.homes = Object.fromEntries(Object.entries(document.homes ?? {}).filter(([name]) => name !== "main"));
      if (document["default_home"] === "main") {
        delete document["default_home"];
      }
    });
    const registry = await readHomeRegistry(configDir);
    expect(registry.defaultHome).toBeUndefined();
    expect(registry.homes).toEqual({});
  });

  it("rejects malformed registries with actionable errors", async () => {
    const configDir = await temporaryDirectory();
    await writeHomeRegistry(configDir, (document) => {
      document["homes"] = { Bad_Name: { path: "/srv/lode/personal" } };
    });
    await expect(readHomeRegistry(configDir)).rejects.toThrow(/home name "Bad_Name"/u);
  });

  it("treats a missing registry as empty", async () => {
    const configDir = await temporaryDirectory();
    expect(await readHomeRegistry(configDir)).toEqual({ homes: {} });
  });

  it("does not reinterpret an unreadable registry path as an empty registry", async () => {
    const configDir = await temporaryDirectory();
    await mkdir(join(configDir, "lode.toml"));
    await expect(readHomeRegistry(configDir)).rejects.toThrow(/Cannot read lode\.toml/u);
    await expect(writeHomeRegistry(configDir, () => {})).rejects.toThrow(/Cannot read lode\.toml/u);
  });

  it("refuses duplicate registration of the same normalized path", () => {
    const registry = {
      homes: { main: { path: "/srv/lode/personal" } },
    };
    expect(registeredHomeAtPath(registry, normalizeHomePath("/srv/lode/personal/../personal"))).toBe("main");
    expect(registeredHomeAtPath(registry, normalizeHomePath("/mnt/other"))).toBeUndefined();
    expect(homeNamePattern.test("main")).toBe(true);
    expect(homeNamePattern.test("2fast")).toBe(false);
    expect(homeNamePattern.test("Work")).toBe(false);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lode-home-registry-"));
  temporaryDirectories.push(directory);
  return directory;
}
