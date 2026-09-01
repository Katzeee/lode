#!/usr/bin/env node

import { runLode } from "../composition.js";

const argv = process.argv.slice(2);
const exitCode = await runLode({
  argv,
  environment: process.env,
  platform: process.platform,
  io: {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
});
process.exitCode = exitCode;
