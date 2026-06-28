import * as net from "node:net";
import { LoroDoc, VersionVector } from "loro-crdt";
import { FrameSocket } from "./wire.js";

/**
 * One doc's half of a sync round over a real framed TCP socket:
 *   1. send local VV (Loro-native encode)
 *   2. recv peer VV, decode
 *   3. push update `export({mode:"update", from: peerVV})` (captured AFTER recv, BEFORE import —
 *      so the push never echoes the peer's own ops back; same invariant as production
 *      `SyncManager.exchangeDoc`)
 *   4. recv + import peer's update
 * The byte-level logic is identical to the in-process `exchangeDocs` (P0); only the boundary
 * differs — that isolation is the point of the playground.
 */
async function exchangeDocOverSocket(
  doc: LoroDoc,
  sock: FrameSocket,
): Promise<{ sentUpdateLen: number; recvUpdateLen: number }> {
  sock.send({ kind: "vv", vv: doc.version().encode() });
  const peerVVMsg = await sock.recv();
  if (peerVVMsg.kind !== "vv") {
    throw new Error(`expected vv message, got ${peerVVMsg.kind}`);
  }
  const peerVV = VersionVector.decode(peerVVMsg.vv);
  const push = doc.export({ mode: "update", from: peerVV });
  sock.send({ kind: "update", bytes: push });
  const pullMsg = await sock.recv();
  if (pullMsg.kind !== "update") {
    throw new Error(`expected update message, got ${pullMsg.kind}`);
  }
  // Guard: Loro throws (message-less) on `import(new Uint8Array(0))`, so skip empty pulls.
  if (pullMsg.bytes.length > 0) {
    doc.import(pullMsg.bytes);
  }
  return { sentUpdateLen: push.length, recvUpdateLen: pullMsg.bytes.length };
}

/** Create a real loopback TCP pair (server-side socket ↔ client socket). Both ends live in the
 *  test process, but bytes traverse a genuine kernel TCP connection (serialization + framing +
 *  Loro encode/decode all round-trip). Returns a `close()` to tear the connection down. */
export function makeLoopbackPair(): Promise<{
  a: FrameSocket;
  b: FrameSocket;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      const clientSock = net.connect(addr.port, "127.0.0.1");
      server.once("connection", (serverSide) => {
        const a = new FrameSocket(serverSide);
        const b = new FrameSocket(clientSock);
        const close = (): void => {
          serverSide.destroy();
          clientSock.destroy();
          server.close();
        };
        resolve({ a, b, close });
      });
    });
  });
}

/**
 * Exchange two docs over a fresh real loopback TCP connection (both directions, one round).
 * A new connection is opened per call — so calling it twice models "relay/connection restart
 * between rounds" (P1 scenario S1.6) for free.
 */
export async function exchangeOverWire(
  a: LoroDoc,
  b: LoroDoc,
): Promise<{
  a: { sentUpdateLen: number; recvUpdateLen: number };
  b: { sentUpdateLen: number; recvUpdateLen: number };
}> {
  const { a: sa, b: sb, close } = await makeLoopbackPair();
  try {
    const [aStats, bStats] = await Promise.all([
      exchangeDocOverSocket(a, sa),
      exchangeDocOverSocket(b, sb),
    ]);
    return { a: aStats, b: bStats };
  } finally {
    close();
  }
}
