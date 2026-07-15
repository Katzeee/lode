import { ConnectError, Code } from "@connectrpc/connect";
import type { LodeHomePaths } from "@lode/daemon/home";
import type { ParsedCli } from "../args.js";
import { assertAllowedFlags, getOptionalSingleFlag, getRequiredSingleFlag } from "./shared.js";
import type { LodeCommandsClient } from "@lode/client";
import { writeActiveActor } from "../client-headers.js";
import { promptHidden, promptHiddenConfirmed } from "../prompt.js";

// Vault-backed identity commands. `new` initializes the vault on first run (or unlocks an existing
// one) and mints an identity; the mnemonic is shown ONCE. `import`/`use` select the active actor
// (written to LODE_HOME/active-actor). `export` lives on the `identity` group (unchanged).
export async function executeActorCommand(
  client: LodeCommandsClient,
  command: ParsedCli,
  commandKey: string,
  paths: LodeHomePaths,
): Promise<string> {
  switch (command.action) {
    case "new":
      return actorNew(client, command, commandKey, paths);
    case "import":
      return actorImport(client, command, commandKey, paths);
    case "list":
      return actorList(client);
    case "use":
      return actorUse(client, command, commandKey, paths);
    case "pin":
      return actorPin(client, command, commandKey);
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}

/** Set/change the PIN (prompted, never on argv — it's a credential). The vault must be UNLOCKED. */
async function actorPin(
  client: LodeCommandsClient,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, []);
  const pin = await promptHiddenConfirmed("Choose a PIN: ", "Confirm PIN: ");
  await client.setPin({ pin });
  return "PIN set.";
}

async function actorNew(
  client: LodeCommandsClient,
  command: ParsedCli,
  commandKey: string,
  paths: LodeHomePaths,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--label"]);
  const label = getOptionalSingleFlag(command, "--label") ?? "default";
  const passphrase = await promptHiddenConfirmed("Choose a passphrase: ", "Confirm passphrase: ");
  // Initialize a fresh vault, or — if one already exists — unlock it with the same passphrase.
  try {
    await client.initVault({ passphrase });
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.FailedPrecondition) {
      await client.unlockVault({ passphrase });
    } else {
      throw error;
    }
  }
  const { actorId, mnemonic } = await client.createIdentity({ label });
  await writeActiveActor(paths, actorId);
  return [
    `Created identity ${actorId} (label "${label}").`,
    "Recovery mnemonic (save these words; shown ONCE):",
    mnemonic,
  ].join("\n");
}

async function actorImport(
  client: LodeCommandsClient,
  command: ParsedCli,
  commandKey: string,
  paths: LodeHomePaths,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--mnemonic", "--label"]);
  const mnemonic = getRequiredSingleFlag(command, "--mnemonic");
  const label = getOptionalSingleFlag(command, "--label") ?? "imported";
  const passphrase = await promptHidden("Passphrase: ");
  await client.unlockVault({ passphrase });
  const { actorId } = await client.importIdentity({ mnemonic, label });
  await writeActiveActor(paths, actorId);
  return `Imported identity ${actorId} (label "${label}").`;
}

async function actorList(client: LodeCommandsClient): Promise<string> {
  const { identities } = await client.getVaultStatus({});
  if (identities.length === 0) {
    return "No identities in the vault.";
  }
  return identities.map((i) => `${i.actorId}  ${i.label}`).join("\n");
}

async function actorUse(
  client: LodeCommandsClient,
  command: ParsedCli,
  commandKey: string,
  paths: LodeHomePaths,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--id"]);
  const id = getRequiredSingleFlag(command, "--id");
  const { identities } = await client.getVaultStatus({});
  if (!identities.some((i) => i.actorId === id)) {
    throw new Error(`Actor ${id} is not in the vault.`);
  }
  await writeActiveActor(paths, id);
  return `Active actor set to ${id}.`;
}
