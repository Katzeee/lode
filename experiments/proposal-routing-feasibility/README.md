# Proposal routing feasibility experiments

These are executable evidence for the Wayfinder ticket “同文档与 Overlay Diff 路线原型对比”.
Unlike the earlier illustrative TUI, these tests use the repository's installed `loro-crdt` and
real `Engine` implementation.

They test mechanism-level claims:

- whether a same-document rich-text representation can retain Proposal attribution and reject only
  the captured Proposal text while preserving interleaved Direct text;
- whether a fork/overlay can merge accepted-base drift and materialize idempotently;
- what a cross-document Accept must persist to recover after a crash;
- whether stable domain facts can replay create, edit, move, delete, property, transclusion, and
  semantic-child behavior through the real Engine.
- whether Origin and Review can share a deterministic graph of domain-owned rules with explicit
  inputs, outputs, scopes, and dependencies, independently of storage placement.

They do **not** claim that either route is production-integrated. In particular, the current Engine
still exposes full-text replacement rather than the fine-grained text command surface the Proposal
design requires.

Run:

```sh
npm run test:proposal-routing
```
