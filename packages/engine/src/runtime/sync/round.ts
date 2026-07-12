import type { SyncContext } from "./context.js";
import type { RoundSummary } from "./deps.js";

/**
 * The membership half of a sync round: gossip the membership roster, then persist any dirtied log
 *  state. No security refresh — wire security is a lazy projection of the log (re-derives on read
 *  when the frontier moves), so the content round's `isMember()` gate picks up the new roster
 *  automatically. Plain collaborator (no lifecycle of its own) driven in order by the round driver —
 *  therefore not a managed resource: only things with open/close/long-run lifetime need ownership, and a
 *  round body has none.
 */
export class MembershipRound {
  constructor(private readonly ctx: SyncContext) {}

  async runRound(): Promise<void> {
    await this.ctx.membershipSync.sync();
    await this.ctx.log.persistIfDirty();
  }
}

/**
 * The content half of a sync round: sealed content exchange, only once the local actor is a member
 * (before the membership log converges it isn't, so content is skipped, not errored — the membership
 * round is what lets it join). Reports the round's pulled/pushed counts to the host seam. Plain
 * collaborator driven by the round driver.
 */
export class ContentRound {
  constructor(
    private readonly ctx: SyncContext,
    private readonly report: (wsId: string, summary: RoundSummary) => void,
  ) {}

  async runRound(): Promise<void> {
    if (!this.ctx.security.isMember()) {
      return;
    }
    const { pulled, pushed } = await this.ctx.syncManager.sync();
    // Persist what the round delivered (tree edits + imported shards) — the content analog of
    // MembershipRound's log.persistIfDirty. Without this a pure receiver that crashes after a round
    // loses the synced content on restart (the round landed only in memory): tree always, plus any
    // resident shard not already write-backed by an eviction.
    await this.ctx.engine.asOutliner().flushDirty();
    this.report(this.ctx.wsId, { pulled, pushed });
  }
}
