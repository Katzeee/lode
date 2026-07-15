import { describe, expect, it } from "vitest";
import { LodeCommands } from "@lode/protocol/proto";
import { createEngineRuntime } from "../src/engine-runtime.js";

// The single-funnel contract. The proto declares ONE client-facing service (`LodeCommands`); the
// engine must assemble EVERY one of its RPCs into its own auth-wrapped command bag
// (`createEngineRuntime().commands`) — the chokepoint `wrapCommands` gates. An RPC that bypasses the
// engine bag via a wire-layer side channel (a daemon hand-writing its own handler) is an auth hole:
// the chokepoint never sees it, so its `authed` wrapper never runs — unauthenticated access.
//
// This can't be caught by grepping handler names (grep can't see "an RPC took a wire-layer detour").
// It is caught by enumerating the proto service descriptor and diffing against the bag keys.
describe("LodeCommands service — every RPC is in the engine command bag", () => {
  it("createEngineRuntime().commands covers every proto RPC localName", async () => {
    const runtime = await createEngineRuntime();
    const bagKeys = new Set(Object.keys(runtime.commands));
    const protoRpcNames = Object.keys(LodeCommands.method);

    // Daemon-lifecycle RPCs live at the transport seam (connect-server), NOT the engine bag: they are
    // not engine commands, they are `open` by design (the socket is the permission boundary), and the
    // engine is also embedded in-process (mobile) where there is no daemon to shut down. Each entry
    // here is a reviewed exception to the single-funnel rule — add with a justification.
    const daemonLifecycle = new Set(["shutdown"]);

    const missing = protoRpcNames.filter(
      (name) => !bagKeys.has(name) && !daemonLifecycle.has(name),
    );

    expect(
      missing,
      "proto RPCs missing from the engine bag — each bypasses the auth chokepoint",
    ).toEqual([]);
  });
});
