#!/usr/bin/env node

import { AppServerClient, createSocketTransport, describeError } from "@lode/client";
import { parseCli } from "../args.js";
import { executeCommand } from "../commands.js";

async function main(): Promise<void> {
  let client: AppServerClient | undefined;

  try {
    const parsed = parseCli(process.argv.slice(2));
    client = new AppServerClient(createSocketTransport(parsed.url));
    // `actor new` mints a fresh identity — it has no mnemonic yet and must skip auth. Every other
    // command needs an authenticated session, established from the mnemonic alone (the daemon derives
    // the identity).
    const needsAuth = !(parsed.group === "actor" && parsed.action === "new");
    if (needsAuth) {
      if (!parsed.actorMnemonic) {
        throw new Error(
          'Missing actor mnemonic. Provide "--actor-mnemonic <words>" or set LODE_ACTOR_MNEMONIC.',
        );
      }
      await client.authenticate({
        actorMnemonic: parsed.actorMnemonic,
        client: { name: "lode" },
      });
    }
    const output = await executeCommand(client.rpc, parsed);
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = 1;
  } finally {
    client?.close();
  }
}

void main();
