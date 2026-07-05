import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { PeerIdentityTokenSchema } from "@lode/protocol/proto";
import type { ParsedCli } from "../args.js";
import { assertAllowedFlags } from "./shared.js";
import type { ClientLike } from "./types.js";

// A portable identity token: the ONE thing a user exports (`lode identity export`) and hands to an
// owner out-of-band; the owner pastes it into `lode member add`. Bundles the (actor + peer) tuple so
// the user never handles the individual cryptographic fields. Wire format:
// `lode-id1.<base64url(PeerIdentityToken)>`.

const TOKEN_PREFIX = "lode-id1.";

export type DecodedIdentity = {
  actorId: string;
  peerId: string;
  peerEncPub: Uint8Array;
  displayName: string;
  peerName: string;
};

/** Encode the local peer's identity (+ optional actor display name + peer name) into one opaque token. */
export function encodeIdentityToken(input: {
  actorId: string;
  peerId: string;
  peerEncPub: Uint8Array;
  displayName?: string;
  peerName?: string;
}): string {
  const bytes = toBinary(
    PeerIdentityTokenSchema,
    create(PeerIdentityTokenSchema, {
      actorId: input.actorId,
      peerId: input.peerId,
      peerEncPub: input.peerEncPub,
      displayName: input.displayName ?? "",
      peerName: input.peerName ?? "",
    }),
  );
  return TOKEN_PREFIX + Buffer.from(bytes).toString("base64url");
}

/** Decode + validate an identity token. Throws on a malformed/wrong-prefix/empty token. */
export function decodeIdentityToken(token: string): DecodedIdentity {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new Error(`Invalid identity token (expected "${TOKEN_PREFIX}" prefix).`);
  }
  let raw;
  try {
    const bytes = new Uint8Array(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url"));
    raw = fromBinary(PeerIdentityTokenSchema, bytes);
  } catch {
    throw new Error("Invalid identity token (undecodable).");
  }
  if (raw.actorId === "" || raw.peerId === "" || raw.peerEncPub.length !== 32) {
    throw new Error("Invalid identity token (missing fields).");
  }
  return {
    actorId: raw.actorId,
    peerId: raw.peerId,
    peerEncPub: raw.peerEncPub,
    displayName: raw.displayName,
    peerName: raw.peerName,
  };
}

export async function executeIdentityCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "export": {
      assertAllowedFlags(command, commandKey, ["--name", "--peer-name"]);
      const nameFlag = command.flags["--name"]?.[0];
      const peerNameFlag = command.flags["--peer-name"]?.[0];
      const { peerId, peerEncPub, owningActorId } = await client.getPeerPublicKeys({});
      return encodeIdentityToken({
        actorId: owningActorId,
        peerId,
        peerEncPub,
        ...(nameFlag !== undefined ? { displayName: nameFlag } : {}),
        ...(peerNameFlag !== undefined ? { peerName: peerNameFlag } : {}),
      });
    }
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
