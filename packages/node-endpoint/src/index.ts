import net, { type Socket } from "node:net";

import { parseEndpoint } from "@lode/sdk";

const socketAuthority = "http://lode.local";
const windowsPipePrefix = "\\\\.\\pipe\\";

export type NodeEndpointDial =
  Readonly<{ tcpUrl: string }> | Readonly<{ authority: string; createConnection: () => Socket }>;

export function dialNodeEndpoint(endpoint: string): NodeEndpointDial {
  const parsed = parseEndpoint(endpoint);
  switch (parsed.scheme) {
    case "tcp":
      return { tcpUrl: `http://${parsed.host}:${parsed.port}` };
    case "unix":
      return {
        authority: socketAuthority,
        createConnection: () => net.connect(parsed.socketPath),
      };
    case "pipe":
      return {
        authority: socketAuthority,
        createConnection: () => net.connect(`${windowsPipePrefix}${parsed.pipeName}`),
      };
  }
}
