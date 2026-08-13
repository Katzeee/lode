import type { Fact, FactBody } from "./types.js";

export type FactTransactionId = string;

export type FactTransactionPosition = Readonly<{
  transactionId: FactTransactionId;
  index: number;
  size: number;
}>;

export type FactTransaction = Readonly<{
  transactionId: FactTransactionId;
  facts: readonly Fact[];
}>;

export type FactTransactionPlan<B extends FactBody = FactBody> = Readonly<{
  kind: "transaction";
  bodies: readonly [B, ...B[]];
}>;

export type FactWrite = FactBody | FactTransactionPlan;
