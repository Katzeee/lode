#!/usr/bin/env node

import { AppServerClient } from "@lode/client";
import { parseCli } from "../args.js";
import { executeCommand } from "../commands.js";
import { establishCliSession } from "../session.js";

async function main(): Promise<void> {
  let client: AppServerClient | undefined;

  try {
    const parsed = parseCli(process.argv.slice(2));
    client = new AppServerClient({ url: parsed.url });
    client.connect();
    await establishCliSession(client.rpc, { actorId: parsed.actorId });
    const output = await executeCommand(client.rpc, parsed);
    process.stdout.write(`${output}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    client?.close();
  }
}

void main();
