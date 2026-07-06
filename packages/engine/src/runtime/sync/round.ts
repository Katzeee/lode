import type { SyncContext } from "./context.js";
import type { RoundSummary } from "./deps.js";

/**
 * The membership half of a sync round: gossip the membership roster, persist any dirtied log state,
 * then refresh the wire security so the content round sees the live transit key + member set. Plain
 * collaborator (no lifecycle of its own) driven in order by the round driver — therefore NOT a
 * Component: only things with open/close/long-run lifecycle are Components, and a round body has none.
 */
export class MembershipRound {
  constructor(private readonly ctx: SyncContext) {}

  async runRound(): Promise<void> {
    await this.ctx.membershipSync.sync();
    await this.ctx.log.persistIfDirty();
    this.ctx.security.refresh();
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
    this.report(this.ctx.wsId, { pulled, pushed });
  }
}
