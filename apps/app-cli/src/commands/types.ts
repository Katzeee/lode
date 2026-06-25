import type { LodeCommandsClient } from "@lode/client";

export type ClientLike = LodeCommandsClient;
export type NodeNameResolver = (nodeId: string) => string | undefined;
