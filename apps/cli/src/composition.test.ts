import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runLode } from "./composition.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("CLI composition failure context", () => {
  it("uses the configured default format for failures after preferences load", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "lode-cli-composition-"));
    temporaryDirectories.push(configDir);
    await writeFile(join(configDir, "lode.toml"), '[cli]\ndefault_format = "json"\n', "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runLode({
      argv: ["workspace", "list"],
      environment: { LODE_CONFIG_DIR: configDir },
      platform: process.platform,
      io: { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
    });

    expect(exitCode).toBe(2);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "workspace.list",
      status: "error",
      error: { code: "configuration-missing" },
    });
  });
});
