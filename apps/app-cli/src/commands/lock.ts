import { ConnectError, Code } from "@connectrpc/connect";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { VaultState } from "@lode/protocol/proto";
import type { ParsedCli } from "../args.js";
import { promptHidden } from "../prompt.js";

// `lode unlock` / `lode lock` — explicit vault verbs (lifecycle: they talk to the daemon directly via
// open RPCs, no header auth, no domain command). unlock picks PIN (when in GRACE with a PIN set) then
// falls back to the passphrase on disable / too many wrong PINs.
export async function executeLockCommand(parsed: ParsedCli, endpoint: string): Promise<string> {
  switch (parsed.group) {
    case "unlock":
      return unlock(endpoint);
    case "lock":
      return lock(endpoint);
    default:
      throw new Error(`Unknown lock command "${parsed.group}".`);
  }
}

async function unlock(endpoint: string): Promise<string> {
  const client = new AppServerClient(createSocketTransport(endpoint));
  try {
    await unlockVaultInteractive(client.rpc);
    return "Vault unlocked.";
  } finally {
    client.close();
  }
}

/** Prompt for the PIN (if in GRACE with a PIN set) then the passphrase and unlock. Shared by the
 *  `lode unlock` verb and the domain-command lazy-unlock retry (bin/lode.ts). */
export async function unlockVaultInteractive(rpc: {
  getVaultStatus(req: { readonly [k: string]: unknown }): Promise<{
    readonly state: VaultState;
    readonly hasPin: boolean;
  }>;
  unlockWithPin(req: { readonly pin: string }): Promise<unknown>;
  unlockVault(req: { readonly passphrase: string }): Promise<unknown>;
}): Promise<void> {
  const status = await rpc.getVaultStatus({});
  if (status.state === VaultState.VAULT_GRACE && status.hasPin) {
    // Try the PIN first (re-lock re-confirm); fall back to the passphrase on disable / too-many-wrong.
    for (let attempts = 0; attempts < 5; attempts += 1) {
      const pin = await promptHidden("PIN: ");
      try {
        await rpc.unlockWithPin({ pin });
        return;
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.FailedPrecondition) {
          process.stderr.write("PIN unavailable; use the passphrase.\n");
          break;
        }
        process.stderr.write("Wrong PIN.\n");
      }
    }
  }
  const passphrase = await promptHidden("Passphrase: ");
  await rpc.unlockVault({ passphrase });
}

async function lock(endpoint: string): Promise<string> {
  const client = new AppServerClient(createSocketTransport(endpoint));
  try {
    await client.rpc.lockVault({});
    return "Vault locked.";
  } finally {
    client.close();
  }
}
