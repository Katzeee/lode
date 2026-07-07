import type { BrokerFrame } from "@lode/protocol/proto";

/** Approximate byte size of a frame (payload + small overhead). The size estimator the bounded send
 *  queue uses to cap buffered outgoing bytes — not a wire framer; Connect/gRPC frames the stream. */
export const estimateFrameBytes = (f: BrokerFrame): number => {
  const k = f.kind;
  if ((k.case === "publish" || k.case === "deliver") && k.value.payload !== undefined) {
    return k.value.payload.length + 64;
  }
  return 64;
};

/** Per-connection send-buffer cap — generous for normal burst (a Loro update blob is KB–MB), tight
 *  enough that a wedged counterparty can't grow the send queue without bound and OOM the host
 *  (the daemon, for a client; the relay, for a server). */
export const DEFAULT_MAX_SEND_BUFFERED_BYTES = 4 * 1024 * 1024;
