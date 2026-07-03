import { deriveActorKeypairFromMnemonic, generateMnemonic } from "@lode/engine";
import type { AppServerClient } from "@lode/client";
import type { SessionInfo } from "@lode/protocol/proto";

/**
 * Open an authenticated session by generating a fresh mnemonic and running the standard handshake.
 * The daemon derives the identity from the mnemonic. Most daemon integration tests want a random
 * throwaway actor; the production SDK call lives in `client.authenticate`. Returns the session +
 * the derived actor id.
 */
export async function openAuthedSession(
  client: AppServerClient,
  opts: { client?: { name?: string; version?: string } } = {},
): Promise<{ session: SessionInfo; actorId: string }> {
  const mnemonic = generateMnemonic();
  const actorId = deriveActorKeypairFromMnemonic(mnemonic).actorId;
  const session = await client.authenticate({
    actorMnemonic: mnemonic,
    ...(opts.client === undefined ? {} : { client: opts.client }),
  });
  return { session, actorId };
}
