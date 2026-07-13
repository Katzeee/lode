type ListenEndpoint = {
  host: string;
  port: number;
};

// Parses a tcp:// listen URL into a loopback endpoint. Examples:
//   tcp://                    -> 127.0.0.1:0 (ephemeral port)
//   tcp://127.0.0.1:31007     -> 127.0.0.1:31007
//   tcp://localhost:0         -> localhost:0
export function parseListenUrl(listen: string): ListenEndpoint {
  let url: URL;
  try {
    url = new URL(listen);
  } catch {
    throw new Error(`Invalid listen URL: ${listen}`);
  }
  if (url.protocol !== "tcp:") {
    throw new Error(`Unsupported listen protocol (expected tcp://): ${listen}`);
  }
  const host = url.hostname || "127.0.0.1";
  const port = url.port === "" ? 0 : Number.parseInt(url.port, 10);
  return { host, port };
}
