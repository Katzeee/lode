#!/usr/bin/env node

import { runDaemon } from "@lode/daemon";

try {
  await runDaemon(process.argv.slice(2));
  process.exitCode = 0;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
