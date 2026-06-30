#!/usr/bin/env node

import { AppServerClient } from "@lode/client";
import { parseCli } from "../args.js";
import { executeCommand } from "../commands.js";

async function main(): Promise<void> {
  let client: AppServerClient | undefined;

  try {
    const parsed = parseCli(process.argv.slice(2));
    client = new AppServerClient({ url: parsed.url });
    client.connect();
    if (!parsed.actorMnemonic) {
      throw new Error(
        'Missing actor mnemonic. Provide "--actor-mnemonic <words>" or set LODE_ACTOR_MNEMONIC.',
      );
    }
    // The daemon derives the keypair from the mnemonic and verifies it matches the declared actor
    // id — no key material lives client-side.
    await client.authenticate({
      actorMnemonic: parsed.actorMnemonic,
      actorId: parsed.actorId,
      client: { name: "lode" },
    });
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
