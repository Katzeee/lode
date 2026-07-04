#!/usr/bin/env node
import { configureLogger } from "@lode/logger";
import { startAppServerDaemon, startRelayDaemon } from "../app-server-daemon.js";
import { parseAppServerArgs } from "../app-server-args.js";

const options = parseAppServerArgs(process.argv.slice(2));

// Wire the file sink BEFORE the first log emit (startAppServerDaemon/startRelayDaemon run the engine
// + broker, whose loggers build their pino lazily on first emit — so this reads first). Default
// (no flag): stderr only.
if (options.logFile) {
  configureLogger({ file: { path: options.logFile } });
}

// One binary, three modes (design sync-design.md §5): --listen = engine daemon; --relay without
// --listen = relay-only (no engine/gRPC); both = combined. parseAppServerArgs discriminates by mode.
let stop: () => Promise<void>;
if (options.mode === "engine") {
  const daemon = await startAppServerDaemon(options);
  process.stdout.write(`lode daemon listening on: ${daemon.address}\n`);
  if (daemon.relayUrl) {
    process.stdout.write(`lode relay listening on: ${daemon.relayUrl}\n`);
  }
  stop = () => daemon.stop();
} else {
  const relay = await startRelayDaemon(options);
  process.stdout.write(`lode relay listening on: ${relay.relayUrl}\n`);
  stop = () => relay.stop();
}

process.once("SIGINT", () => {
  void stop().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void stop().then(() => process.exit(0));
});
