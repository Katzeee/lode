import { generateActorKeypair, signWithActor, type ActorKeypair } from "@lode/engine";
import type { AppServerClient } from "@lode/client";
import type { SessionInfo } from "@lode/protocol/proto";

/**
 * F4 helper: open an authenticated session — `sessionChallenge` → sign the nonce with a fresh actor
 * Ed25519 key → `sessionHello`. The daemon verifies the signature against the declared `sign_pub`
 * before creating the session (mandatory auth). Returns the session + the actor keypair (callers may
 * need the actorId, or want to reuse the key across calls).
 */
export async function openAuthedSession(
  client: AppServerClient,
  opts: { displayName?: string; client?: { name?: string; version?: string } } = {},
): Promise<{ session: SessionInfo; actor: ActorKeypair }> {
  const actor = generateActorKeypair();
  const { challenge } = await client.rpc.sessionChallenge({});
  const signature = signWithActor(actor.privateKey, challenge);
  const session = await client.rpc.sessionHello({
    actor: {
      actorId: actor.actorId,
      signPub: actor.publicKey,
      ...(opts.displayName === undefined ? {} : { displayName: opts.displayName }),
    },
    challenge,
    signature,
    ...(opts.client === undefined ? {} : { client: opts.client }),
  });
  return { session, actor };
}
