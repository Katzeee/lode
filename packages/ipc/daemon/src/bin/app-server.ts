#!/usr/bin/env node
import { startAppServerDaemon } from "../app-server-daemon.js";

const options = parseArgs(process.argv.slice(2));
const daemon = await startAppServerDaemon(options);
process.stdout.write(`lode daemon listening on: ${daemon.address}\n`);

const stop = async () => {
  await daemon.stop();
};

process.once("SIGINT", () => {
  void stop().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void stop().then(() => process.exit(0));
});

function parseArgs(args: string[]): { listen: string; dataRoot?: string } {
  const index = args.indexOf("--listen");
  const listen = index === -1 ? undefined : args[index + 1];
  if (!listen) {
    throw new Error("Usage: app-server --listen <url> [--data-root <path>]");
  }
  const dataRootIndex = args.indexOf("--data-root");
  const dataRoot = dataRootIndex === -1 ? undefined : args[dataRootIndex + 1];
  if (dataRootIndex !== -1 && !dataRoot) {
    throw new Error("Usage: app-server --listen <url> [--data-root <path>]");
  }
  return dataRoot ? { listen, dataRoot } : { listen };
}
