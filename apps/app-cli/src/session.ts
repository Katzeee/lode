import type { LodeCommandsClient } from "@lode/client";
import type { SessionInfo } from "@lode/protocol/proto";

export type CliSessionOptions = {
  actorId: string;
};

export function establishCliSession(
  client: LodeCommandsClient,
  options: CliSessionOptions,
): Promise<SessionInfo> {
  return client.sessionHello({
    actor: { actorId: options.actorId },
    client: {
      name: "lode",
      metadata: {
        pid: process.pid,
        platform: process.platform,
      },
    },
  });
}
