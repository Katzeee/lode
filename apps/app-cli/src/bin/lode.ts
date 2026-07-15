#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  AppServerClient,
  createSocketTransport,
  describeError,
  isVaultLockedError,
  type LodeCommandsClient,
} from "@lode/client";
import { parseCli, type ParsedCli } from "../args.js";
import { executeCommand } from "../commands.js";
import { executeActorCommand } from "../commands/actor.js";
import { executeConfigCommand } from "../commands/config.js";
import { executeDaemonCommand, executeRelayCommand } from "../commands/daemon.js";
import { executeLockCommand, unlockVaultInteractive } from "../commands/lock.js";
import { buildHeaders } from "../client-headers.js";
import { ensureDaemon, resolveDaemonEnv } from "../daemon-launch.js";

const LODE_ENTRY = fileURLToPath(import.meta.url);

async function main(): Promise<void> {
  let client: AppServerClient | undefined;

  try {
    const parsed = parseCli(process.argv.slice(2));

    // In-process lifecycle verbs that own their process / need no daemon.
    if (parsed.group === "daemon") {
      print(await executeDaemonCommand(parsed, LODE_ENTRY));
      return;
    }
    if (parsed.group === "relay") {
      print(await executeRelayCommand(parsed, LODE_ENTRY));
      return;
    }
    if (parsed.group === "config") {
      print(await executeConfigCommand(parsed));
      return;
    }

    const env = resolveDaemonEnv(parsed.home);
    const endpoint = await ensureDaemon(env, {
      explicitUrl: parsed.url,
      noAutospawn: parsed.noAutospawn,
      lodeEntry: LODE_ENTRY,
    });

    // Explicit vault verbs (open RPCs, no header auth, no domain command).
    if (parsed.group === "unlock" || parsed.group === "lock") {
      print(await executeLockCommand(parsed, endpoint));
      return;
    }

    // actor commands + domain commands: send the identity headers on every RPC.
    const headers = await buildHeaders(env.paths, parsed.actor);
    client = new AppServerClient(createSocketTransport(endpoint, { headers }));
    const output =
      parsed.group === "actor"
        ? await executeActorCommand(client.rpc, parsed, `actor ${parsed.action ?? ""}`, env.paths)
        : await runDomainCommand(client.rpc, parsed);
    print(output);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = 1;
  } finally {
    client?.close();
  }
}

// A domain command with lazy unlock: on VaultLockedError, prompt to unlock (PIN/passphrase) then retry.
async function runDomainCommand(rpc: LodeCommandsClient, parsed: ParsedCli): Promise<string> {
  try {
    return await executeCommand(rpc, parsed);
  } catch (error) {
    if (!isVaultLockedError(error)) {
      throw error;
    }
    await unlockVaultInteractive(rpc);
    return await executeCommand(rpc, parsed);
  }
}

function print(output: string): void {
  process.stdout.write(`${output}\n`);
}

void main();
