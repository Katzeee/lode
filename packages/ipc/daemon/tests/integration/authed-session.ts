import { deriveActorKeypairFromMnemonic, generateMnemonic } from "@lode/engine";
import type { AppServerClient } from "@lode/client";
import type { SessionInfo } from "@lode/protocol/proto";

/**
 * Open an authenticated session by generating a fresh mnemonic, deriving its actor id, and running
 * the standard handshake. Most daemon integration tests want a random throwaway actor; the production
 * SDK call lives in `client.authenticate`. Returns the session + the actor id.
 */
export async function openAuthedSession(
  client: AppServerClient,
  opts: { displayName?: string; client?: { name?: string; version?: string } } = {},
): Promise<{ session: SessionInfo; actorId: string }> {
  const mnemonic = generateMnemonic();
  const actorId = deriveActorKeypairFromMnemonic(mnemonic).actorId;
  const session = await client.authenticate({
    actorMnemonic: mnemonic,
    actorId,
    ...(opts.displayName === undefined ? {} : { displayName: opts.displayName }),
    ...(opts.client === undefined ? {} : { client: opts.client }),
  });
  return { session, actorId };
}
