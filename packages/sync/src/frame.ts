import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  BrokerDeliverSchema,
  BrokerFrameSchema,
  BrokerPublishSchema,
  BrokerSubscribeSchema,
  BrokerUnsubscribeSchema,
  type BrokerFrame as BrokerFrameProto,
} from "@lode/protocol/proto";

/**
 * The broker routing frame (design sync-design.md §3). Wire-encoded as protobuf (broker.proto); the
 * relay forwards `payload` opaque, never decoding it. WebSocket provides message boundaries, so one
 * WS message = one frame. This is the in-memory shape `broker-client` and `broker-server` work with;
 * encode/decode translate to/from the protobuf wire form.
 */
export type BrokerFrame =
  | { readonly kind: "subscribe"; readonly wsId: string }
  | { readonly kind: "unsubscribe"; readonly wsId: string }
  | { readonly kind: "publish"; readonly wsId: string; readonly payload: Uint8Array }
  | { readonly kind: "deliver"; readonly wsId: string; readonly payload: Uint8Array };

/** Serialize a frame to bytes for one WebSocket message. */
export function encodeFrame(frame: BrokerFrame): Uint8Array {
  return toBinary(BrokerFrameSchema, frameToProto(frame));
}

/** Parse one frame from a WebSocket message's bytes. Throws if the frame has no kind. */
export function decodeFrame(bytes: Uint8Array): BrokerFrame {
  return frameFromProto(fromBinary(BrokerFrameSchema, bytes));
}

function frameToProto(frame: BrokerFrame): BrokerFrameProto {
  switch (frame.kind) {
    case "subscribe":
      return create(BrokerFrameSchema, {
        kind: { case: "subscribe", value: create(BrokerSubscribeSchema, { wsId: frame.wsId }) },
      });
    case "unsubscribe":
      return create(BrokerFrameSchema, {
        kind: { case: "unsubscribe", value: create(BrokerUnsubscribeSchema, { wsId: frame.wsId }) },
      });
    case "publish":
      return create(BrokerFrameSchema, {
        kind: {
          case: "publish",
          value: create(BrokerPublishSchema, { wsId: frame.wsId, payload: frame.payload }),
        },
      });
    case "deliver":
      return create(BrokerFrameSchema, {
        kind: {
          case: "deliver",
          value: create(BrokerDeliverSchema, { wsId: frame.wsId, payload: frame.payload }),
        },
      });
  }
}

function frameFromProto(msg: BrokerFrameProto): BrokerFrame {
  const k = msg.kind;
  switch (k.case) {
    case "subscribe":
      return { kind: "subscribe", wsId: k.value.wsId };
    case "unsubscribe":
      return { kind: "unsubscribe", wsId: k.value.wsId };
    case "publish":
      return { kind: "publish", wsId: k.value.wsId, payload: k.value.payload };
    case "deliver":
      return { kind: "deliver", wsId: k.value.wsId, payload: k.value.payload };
    case undefined:
      throw new Error("decodeFrame: frame has no kind");
  }
}
