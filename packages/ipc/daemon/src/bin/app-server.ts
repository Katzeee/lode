#!/usr/bin/env node
import { startAppServerDaemon } from "../app-server-daemon.js";
import { parseAppServerArgs } from "../app-server-args.js";

const options = parseAppServerArgs(process.argv.slice(2));
const daemon = await startAppServerDaemon(options);
process.stdout.write(`lode daemon listening on: ${daemon.address}\n`);
if (daemon.relayUrl) {
  process.stdout.write(`lode relay listening on: ${daemon.relayUrl}\n`);
}

const stop = async () => {
  await daemon.stop();
};

process.once("SIGINT", () => {
  void stop().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void stop().then(() => process.exit(0));
});
