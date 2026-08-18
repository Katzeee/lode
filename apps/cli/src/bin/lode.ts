#!/usr/bin/env node

import { runDaemon } from "@lode/daemon";
import { runLode } from "../composition.js";

const argv = process.argv.slice(2);
const exitCode =
  argv[0] === "--internal-daemon"
    ? await runDaemonMode(argv.slice(1))
    : await runLode({
        argv,
        environment: process.env,
        platform: process.platform,
        io: {
          stdout: (text) => process.stdout.write(text),
          stderr: (text) => process.stderr.write(text),
        },
      });
process.exitCode = exitCode;

/** Background Daemon mode of the single `lode` executable: `lode daemon start`
 * and the desktop-client launcher re-invoke this very program with this flag.
 * Not a product command — never shown in help. */
async function runDaemonMode(args: readonly string[]): Promise<number> {
  try {
    await runDaemon([...args]);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
