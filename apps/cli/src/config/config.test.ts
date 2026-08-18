import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCliPreferences, readSyncEndpoint, setSyncEndpoint } from "./index.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("CLI preferences ([cli] in lode.toml)", () => {
  it("reads default_format and default_limit", async () => {
    const configDir = await temporaryDirectory();
    await writeFile(join(configDir, "lode.toml"), '[cli]\ndefault_format = "json"\ndefault_limit = 20\n', "utf8");
    expect(await readCliPreferences(join(configDir, "lode.toml"))).toEqual({
      defaultFormat: "json",
      defaultLimit: 20,
    });
  });

  it("treats a missing file or table as no preferences", async () => {
    const configDir = await temporaryDirectory();
    expect(await readCliPreferences(join(configDir, "lode.toml"))).toEqual({});
    await writeFile(join(configDir, "lode.toml"), 'default_home = "main"\n', "utf8");
    expect(await readCliPreferences(join(configDir, "lode.toml"))).toEqual({});
  });

  it("rejects malformed preferences", async () => {
    const configDir = await temporaryDirectory();
    await writeFile(join(configDir, "lode.toml"), '[cli]\ndefault_format = "yaml"\n', "utf8");
    await expect(readCliPreferences(join(configDir, "lode.toml"))).rejects.toThrow(
      /default_format must be human or json/u,
    );
  });

  it("keeps a torn file readable as no preferences", async () => {
    const configDir = await temporaryDirectory();
    await writeFile(join(configDir, "lode.toml"), "not toml [", "utf8");
    await expect(readCliPreferences(join(configDir, "lode.toml"))).rejects.toThrow(/not valid TOML/u);
  });
});

describe("home-scoped sync endpoint persistence", () => {
  it("stores and reads endpoints per workspace under the home root", async () => {
    const home = await temporaryDirectory();
    expect(await readSyncEndpoint(home, "ws-personal")).toBeNull();
    await setSyncEndpoint(home, "ws-personal", "tcp://127.0.0.1:5100");
    await setSyncEndpoint(home, "ws-work", "tcp://127.0.0.1:5101");
    expect(await readSyncEndpoint(home, "ws-personal")).toBe("tcp://127.0.0.1:5100");
    await setSyncEndpoint(home, "ws-personal", "tcp://127.0.0.1:5200");
    expect(await readSyncEndpoint(home, "ws-personal")).toBe("tcp://127.0.0.1:5200");
    expect(await readSyncEndpoint(home, "ws-work")).toBe("tcp://127.0.0.1:5101");
  });

  it("keeps a torn store readable as empty", async () => {
    const home = await temporaryDirectory();
    await writeFile(join(home, "sync-endpoints.json"), "{not json", "utf8");
    expect(await readSyncEndpoint(home, "ws-personal")).toBeNull();
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lode-cli-config-"));
  directories.push(directory);
  return directory;
}
