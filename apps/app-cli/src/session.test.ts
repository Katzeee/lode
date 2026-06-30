import { describe, expect, it } from "vitest";
import { establishCliSession } from "./session.js";

describe("establishCliSession", () => {
  it("signs a server challenge before session hello", async () => {
    const calls: { method: string; params: unknown }[] = [];
    const challenge = new Uint8Array([1, 2, 3]);
    const signPub = new Uint8Array([4, 5, 6]);
    const signature = new Uint8Array([7, 8, 9]);
    const client = {
      sessionChallenge: (params: unknown) => {
        calls.push({ method: "sessionChallenge", params });
        return Promise.resolve({ challenge });
      },
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

    await establishCliSession(client as never, {
      actorId: "alice",
      signPub,
      signChallenge: (value) => {
        expect(value).toBe(challenge);
        return signature;
      },
    });

    expect(calls).toEqual([
      {
        method: "sessionChallenge",
        params: {},
      },
      {
        method: "sessionHello",
        params: {
          actor: { actorId: "alice", signPub },
          client: {
            name: "lode",
            metadata: {
              pid: process.pid,
              platform: process.platform,
            },
          },
          challenge,
          signature,
        },
      },
    ]);
  });
});
