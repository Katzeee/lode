// Parses a listen URL into the shape http2.Server.listen consumes. The transport is a Unix domain
// socket (macOS/Linux) or Windows named pipe by default — file-permission-isolated, no TCP port. TCP
// is kept for tests and explicit remote/loopback use.
//
//   tcp://                    -> 127.0.0.1:0 (ephemeral port)
//   tcp://127.0.0.1:31007     -> 127.0.0.1:31007
//   unix:///home/x/lode.sock  -> { path: "/home/x/lode.sock" }
//   pipe://lode-abc           -> { path: "\\\\.\\pipe\\lode-abc" }  (Windows named pipe)
export type ListenEndpoint =
  | { kind: "tcp"; host: string; port: number }
  | { kind: "unix"; path: string }
  | { kind: "pipe"; path: string };

export function parseListenUrl(listen: string): ListenEndpoint {
  let url: URL;
  try {
    url = new URL(listen);
  } catch {
    throw new Error(`Invalid listen URL: ${listen}`);
  }
  switch (url.protocol) {
    case "tcp:":
      return {
        kind: "tcp",
        host: url.hostname || "127.0.0.1",
        port: url.port === "" ? 0 : Number.parseInt(url.port, 10),
      };
    case "unix:":
      // URL.pathname already percent-decodes; a socket path is a real fs path.
      if (url.pathname === "") {
        throw new Error(`unix:// listen URL requires a path: ${listen}`);
      }
      return { kind: "unix", path: url.pathname };
    case "pipe:":
      // pipe://<name> -> the Windows named pipe \\.\pipe\<name>. Node's http2.listen({path}) accepts it.
      if (url.host === "") {
        throw new Error(`pipe:// listen URL requires a pipe name: ${listen}`);
      }
      return { kind: "pipe", path: `\\\\.\\pipe\\${url.host}` };
    default:
      throw new Error(
        `Unsupported listen protocol (expected tcp://, unix://, or pipe://): ${listen}`,
      );
  }
}

/** The canonical endpoint string written to `LODE_HOME/endpoint` (and what clients connect to). */
export function canonicalAddress(endpoint: ListenEndpoint, boundPort: number): string {
  switch (endpoint.kind) {
    case "tcp":
      return `http://${endpoint.host}:${boundPort}`;
    case "unix":
      return `unix://${endpoint.path}`;
    case "pipe":
      return `pipe://${endpoint.path.slice("\\\\.\\pipe\\".length)}`;
  }
}
