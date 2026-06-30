#!/usr/bin/env node

import { AppServerClient } from "@lode/client";
import { deriveActorKeypairFromMnemonic, signWithActor } from "@lode/engine";
import { parseCli } from "../args.js";
import { executeCommand } from "../commands.js";
import { establishCliSession } from "../session.js";

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
    const actor = deriveActorKeypairFromMnemonic(parsed.actorMnemonic);
    if (actor.actorId !== parsed.actorId) {
      throw new Error("--actor must match the actor id derived from the mnemonic.");
    }
    await establishCliSession(client.rpc, {
      actorId: actor.actorId,
      signPub: actor.publicKey,
      signChallenge: (challenge) => signWithActor(actor.privateKey, challenge),
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
