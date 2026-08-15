// The single owner of endpoint-string syntax. An endpoint is one of:
//   unix:///<path>       a Unix domain socket (POSIX)
//   pipe://<name>        a Windows named pipe (\\.\pipe\<name>)
//   tcp://<host>:<port>  TCP loopback (tests / explicit remote; http:// is also accepted)
//
// This is the ONE place that knows the scheme grammar, the listen shape (http2.listen), the dial
// shape (net.connect), the canonical address (what clients connect to / what is written to
// LODE_HOME/endpoint), and the platform default endpoint. Every other module reaches an endpoint
// through these functions — no inline `unix://`/`pipe://`/`\\.\pipe\` literals anywhere else. The
// Windows named-pipe prefix and the UDS placeholder authority live only here.

import { createHash } from "node:crypto";
import net from "node:net";
import { platform } from "node:os";
import { join } from "node:path";

/** `\\.\pipe\` — the Windows named-pipe path prefix that net.connect / http2.listen consume. */
const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\";
/** Placeholder HTTP/2 authority for socket dials — the socket IS the channel; the `:authority`
 *  pseudo-header just needs a value. */
const SOCKET_AUTHORITY = "http://lode.local";

/** The parsed endpoint in its logical form — a pipe *name*, not the `\\.\pipe\` string. */
export type ParsedEndpoint =
  | { readonly scheme: "unix"; readonly socketPath: string }
  | { readonly scheme: "pipe"; readonly pipeName: string }
  | { readonly scheme: "tcp"; readonly host: string; readonly port: number };

/** Parse an endpoint string into its logical form. `tcp://` and `http://` are both TCP. */
export function parseEndpoint(endpoint: string): ParsedEndpoint {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid endpoint: ${endpoint}`);
  }
  switch (url.protocol) {
    case "unix:":
      // URL.pathname already percent-decodes; a socket path is a real fs path.
      if (url.pathname === "") {
        throw new Error(`unix:// endpoint requires a path: ${endpoint}`);
      }
      return { scheme: "unix", socketPath: url.pathname };
    case "pipe:":
      // pipe://<name> — url.host is the pipe name (no port).
      if (url.host === "") {
        throw new Error(`pipe:// endpoint requires a pipe name: ${endpoint}`);
      }
      return { scheme: "pipe", pipeName: url.host };
    case "tcp:":
    case "http:":
      return {
        scheme: "tcp",
        host: url.hostname || "127.0.0.1",
        port: url.port === "" ? 0 : Number.parseInt(url.port, 10),
      };
    default:
      throw new Error(`Unsupported endpoint protocol (expected tcp://, unix://, or pipe://): ${endpoint}`);
  }
}

/** The default endpoint when `--listen` is absent: a Unix domain socket on POSIX, a Windows named
 *  pipe on Win32. `pipe://lode-<sha1(home)[:16]>` keeps each home's pipe name distinct. */
export function defaultEndpoint(home: string): string {
  if (platform() === "win32") {
    const hash = createHash("sha1").update(home).digest("hex").slice(0, 16);
    return `pipe://lode-${hash}`;
  }
  return `unix://${join(home, "daemon.sock")}`;
}

/** The on-disk socket path of a `unix://` endpoint (for stale-file cleanup); undefined for any other
 *  scheme or an unparseable string. Never throws. */
export function socketPathOf(endpoint: string): string | undefined {
  try {
    const parsed = parseEndpoint(endpoint);
    return parsed.scheme === "unix" ? parsed.socketPath : undefined;
  } catch {
    return undefined;
  }
}

/** The shape `http2.Server.listen` consumes for this endpoint — a POSIX socket path, a Windows
 *  pipe path, or a host/port. */
export function listenTarget(parsed: ParsedEndpoint): net.ListenOptions {
  switch (parsed.scheme) {
    case "unix":
      return { path: parsed.socketPath };
    case "pipe":
      return { path: `${WINDOWS_PIPE_PREFIX}${parsed.pipeName}` };
    case "tcp":
      return { host: parsed.host, port: parsed.port };
  }
}

/** The canonical address string (what is written to `LODE_HOME/endpoint` and what clients connect
 *  to). TCP takes the OS-assigned `boundPort` (the listen port may have been 0 = ephemeral); the
 *  other schemes ignore it. */
export function canonicalAddress(parsed: ParsedEndpoint, boundPort: number): string {
  switch (parsed.scheme) {
    case "tcp":
      return `http://${parsed.host}:${boundPort}`;
    case "unix":
      return `unix://${parsed.socketPath}`;
    case "pipe":
      return `pipe://${parsed.pipeName}`;
  }
}

function rawSocket(parsed: ParsedEndpoint): net.Socket {
  switch (parsed.scheme) {
    case "unix":
      return net.connect(parsed.socketPath);
    case "pipe":
      return net.connect(`${WINDOWS_PIPE_PREFIX}${parsed.pipeName}`);
    case "tcp":
      return net.connect(parsed.port, parsed.host);
  }
}

/** The dial descriptor used by daemon-to-daemon Fact synchronization. */
export type EndpointDial =
  { readonly tcpUrl: string } | { readonly authority: string; readonly createConnection: () => net.Socket };

/** Resolve an endpoint string to the dial descriptor the client transport takes. */
export function dialTarget(endpoint: string): EndpointDial {
  const parsed = parseEndpoint(endpoint);
  switch (parsed.scheme) {
    case "tcp":
      return { tcpUrl: `http://${parsed.host}:${parsed.port}` };
    case "unix":
    case "pipe":
      return {
        authority: SOCKET_AUTHORITY,
        createConnection: () => rawSocket(parsed),
      };
  }
}
