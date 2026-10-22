export type ParsedEndpoint =
  | Readonly<{ scheme: "unix"; socketPath: string }>
  | Readonly<{ scheme: "pipe"; pipeName: string }>
  | Readonly<{ scheme: "tcp"; host: string; port: number }>;

/** Parses the endpoint grammar shared by daemon listeners and desktop dialers. */
export function parseEndpoint(endpoint: string): ParsedEndpoint {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid endpoint: ${endpoint}`);
  }
  switch (url.protocol) {
    case "unix:":
      if (url.pathname === "") {
        throw new Error(`unix:// endpoint requires a path: ${endpoint}`);
      }
      return { scheme: "unix", socketPath: url.pathname };
    case "pipe:":
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
