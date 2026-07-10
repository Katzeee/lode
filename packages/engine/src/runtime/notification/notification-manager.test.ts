import { create } from "@bufbuild/protobuf";
import { NodeUpdatedPayloadSchema } from "@lode/protocol/proto";
import { describe, expect, it } from "vitest";
import type { EngineOrigin } from "../identity/caller.js";
import { NotificationManager } from "./notification-manager.js";

describe("NotificationManager — purgeWorkspace", () => {
  it("drops the subscriber set so broadcasts no longer reach those connections", () => {
    const notify = new NotificationManager();
    notify.subscribeDoc("conn-1", "ws-A");
    const stream = notify.getOrCreateStream("conn-1");
    const pushed: number[] = [];
    // Spy on the stream the manager holds — broadcastNodeUpdated pushes to it per subscriber.
    stream.push = () => {
      pushed.push(1);
    };
    const origin: EngineOrigin = { nodeId: "node-1", actorId: "a", sessionId: "s" };
    const payload = create(NodeUpdatedPayloadSchema, {});
    notify.broadcastNodeUpdated("ws-A", [payload], origin);
    expect(pushed).toHaveLength(1); // subscribed → the broadcast reached the stream

    notify.purgeWorkspace("ws-A");
    notify.broadcastNodeUpdated("ws-A", [payload], origin);
    expect(pushed).toHaveLength(1); // purged → the second broadcast reached nobody
  });
});

describe("NotificationManager — close (lifecycle teardown)", () => {
  it("completes every open notification stream", async () => {
    const notify = new NotificationManager();
    const iter = notify.getOrCreateStream("conn-1")[Symbol.asyncIterator]();
    notify.close();
    await expect(iter.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("clears subscribers so a post-close broadcast reaches nobody", () => {
    const notify = new NotificationManager();
    notify.subscribeDoc("conn-1", "ws-A");
    const stream = notify.getOrCreateStream("conn-1");
    let pushes = 0;
    stream.push = () => {
      pushes++;
    };
    const origin: EngineOrigin = { nodeId: "node-1", actorId: "a", sessionId: "s" };
    const payload = create(NodeUpdatedPayloadSchema, {});
    notify.broadcastNodeUpdated("ws-A", [payload], origin);
    expect(pushes).toBe(1);

    notify.close();
    notify.broadcastNodeUpdated("ws-A", [payload], origin);
    expect(pushes).toBe(1); // subscribers cleared → the post-close broadcast reached nobody
  });
});
