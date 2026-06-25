import { describe, expect, it } from "vitest";
import { establishCliSession } from "./session.js";

describe("establishCliSession", () => {
  it("sends a local actor session hello for the typed client", async () => {
    const calls: { method: string; params: unknown }[] = [];
    const client = {
      sessionHello: (params: unknown) => {
        calls.push({ method: "sessionHello", params });
        return Promise.resolve({
          sessionId: "session-1",
          actor: { actorId: "alice" },
          connectedAt: 1,
          client: { name: "lode" },
        });
      },
    };

    await establishCliSession(client as never, { actorId: "alice" });

    expect(calls).toEqual([
      {
        method: "sessionHello",
        params: {
          actor: { actorId: "alice" },
          client: {
            name: "lode",
            metadata: {
              pid: process.pid,
              platform: process.platform,
            },
          },
        },
      },
    ]);
  });
});
