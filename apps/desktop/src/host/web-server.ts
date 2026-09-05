import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { request as proxyRequest } from "node:http";
import type { DesktopHost } from "./desktop-host.js";

export async function startWebServer(host: DesktopHost, assetsPort: number, port: number) {
  const session = randomBytes(32).toString("hex");
  const streams = new Set<ServerResponse>();
  let origin = "";
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
  const stopEvents = host.onApplicationEvent((event) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const stream of streams) {
      if (!stream.write(data)) {
        stream.destroy();
        streams.delete(stream);
      }
    }
  });
  const heartbeat = setInterval(() => {
    for (const stream of streams) {
      stream.write(": keepalive\n\n");
    }
  }, 15_000);
  heartbeat.unref();
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin !== undefined && request.headers.origin !== origin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    ) {
      response.writeHead(403);
      response.end("Invalid request origin");
      return;
    }
    const path = new URL(request.url ?? "/", origin).pathname;
    if (path.startsWith("/api/")) {
      if (!(request.headers.cookie ?? "").split(";").some((cookie) => cookie.trim() === `lode_session=${session}`)) {
        response.writeHead(403);
        response.end("Local application session required");
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      if (path === "/api/events" && request.method === "GET") {
        response.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
        response.write(": connected\n\n");
        streams.add(response);
        response.on("close", () => streams.delete(response));
        return;
      }
      if (
        path !== "/api/application" ||
        request.method !== "POST" ||
        request.headers.origin !== origin ||
        !request.headers["content-type"]?.startsWith("application/json")
      ) {
        response.writeHead(403);
        response.end("Invalid application request");
        return;
      }
      const body = await readBody(request);
      const value: unknown = JSON.parse(body);
      if (typeof value !== "object" || value === null || !("method" in value) || typeof value.method !== "string") {
        throw new Error("Invalid application request");
      }
      const result = await host.request(value.method, "input" in value ? value.input : undefined);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ value: result }));
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end();
      return;
    }
    const upstream = proxyRequest(
      { host: "127.0.0.1", port: assetsPort, path: request.url, method: request.method },
      (asset) => {
        response.writeHead(asset.statusCode ?? 502, {
          ...asset.headers,
          "set-cookie": `lode_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
          "referrer-policy": "no-referrer",
        });
        asset.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502);
      response.end("Assets unavailable");
    });
    response.on("close", () => upstream.destroy());
    upstream.end();
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Web server has no TCP address");
  }
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    close: async () => {
      clearInterval(heartbeat);
      stopEvents();
      for (const stream of streams) {
        stream.end();
      }
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += bytes.length;
    if (size > 1_048_576) {
      throw new Error("Application request is too large");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}
