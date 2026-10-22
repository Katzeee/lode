import net, { type Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { dialNodeEndpoint } from "./index.js";

describe("Node endpoint dialing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps TCP endpoints to Connect-compatible HTTP URLs", () => {
    expect(dialNodeEndpoint("tcp://127.0.0.1:5100")).toEqual({ tcpUrl: "http://127.0.0.1:5100" });
  });

  it("opens Unix domain sockets through the Node transport callback", () => {
    const socket = {} as Socket;
    const connect = vi.spyOn(net, "connect").mockReturnValue(socket);
    const dial = dialNodeEndpoint("unix:///tmp/lode.sock");

    expect("createConnection" in dial && dial.createConnection()).toBe(socket);
    expect(connect).toHaveBeenCalledWith("/tmp/lode.sock");
  });

  it("adds the Windows named-pipe namespace before opening a pipe", () => {
    const socket = {} as Socket;
    const connect = vi.spyOn(net, "connect").mockReturnValue(socket);
    const dial = dialNodeEndpoint("pipe://lode-main");

    expect("createConnection" in dial && dial.createConnection()).toBe(socket);
    expect(connect).toHaveBeenCalledWith("\\\\.\\pipe\\lode-main");
  });
});
