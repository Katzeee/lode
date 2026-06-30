import type { LodeCommandsClient } from "@lode/client";
import type { SessionInfo } from "@lode/protocol/proto";

export type CliSessionOptions = {
  actorId: string;
  signPub: Uint8Array;
  signChallenge(challenge: Uint8Array): Uint8Array;
};

export async function establishCliSession(
  client: LodeCommandsClient,
  options: CliSessionOptions,
): Promise<SessionInfo> {
  const { challenge } = await client.sessionChallenge({});
  return client.sessionHello({
    actor: { actorId: options.actorId, signPub: options.signPub },
    client: {
      name: "lode",
      metadata: {
        pid: process.pid,
        platform: process.platform,
      },
    },
    challenge,
    signature: options.signChallenge(challenge),
  });
}
