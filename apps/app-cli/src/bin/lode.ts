#!/usr/bin/env node

import { describeError } from "@lode/client";
import { runCli } from "../cli.js";

try {
  await runCli(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${describeError(error)}\n`);
  process.exitCode = 1;
}
