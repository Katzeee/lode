# Development Guide

## Design

Optimize for the cost of future change. A structural decision is right when it leaves the
architecture more comprehensible, more extensible, and cheaper to maintain, whether that means
adding an abstraction or removing one.

- Design for team-scale extension. Ownership is discoverable, a representative new operation or
  state change stays local, and a newcomer finds the right module and its integration points
  without reconstructing implicit conventions. Keep explicit seams, exhaustive dispatch, and atomic
  state boundaries that enforce those properties, even when today's code could run as one linear
  procedure.
- Require evidence for both abstraction and deletion. Trace production consumers and walk a
  representative future change through the design before deciding that a registry, stage, index,
  or boundary is necessary or redundant. Delete speculative machinery and derived work with no
  consumer; keep intentional composition points. A necessary central module stays declarative, and
  each behavior it composes lives in its own searchable, cohesive module.
- Fix a smell when you find it, with the right mechanism. Deferral compounds: code accretes around
  the smell and the fix only gets harder.
- Comments explain why something is non-obvious.

## Present tense

The project has no production data or released compatibility surface. Unless the user asks
otherwise, define the requested system as it should be now: move code, data formats, and APIs
directly, and update every caller and generated contract in the same change. Old code paths,
compat shims, alias re-exports, and migration paths have no reader to serve.

## Module placement

Every unit has exactly one home, decided by the concept that owns it, never by how many places use
it. Ask in order:

1. Does it carry a layer's semantics? → that layer; layers above import downward.
2. Is it a cohesive substrate with no layer semantics (crypto, persistence, errors)? → its own
   leaf, named for what it is. It earns the leaf by being a real module, not by being reused; a
   `base/`, `shared/`, or `utils/` drawer is never a leaf.
3. Is it a helper serving specific consumers? → it lives with the concept-closest consumer lower
   in the dependency graph, so the other consumer imports it one-way downward. Colocate or
   duplicate one-offs; extract a helper file only for a cohesive cluster.

The **apex** (public entry and composition root) depends on everything and is depended on by
nothing; it is the only code loose at `src` root.

Resolve a bidirectional directory dependency at the concept boundary: move the bridging adapter to
the concept-owning side, introduce a seam, or merge the directories.

## Tests

A test earns its place by guarding what reading the code cannot confirm, such as convergence under
concurrent edits or behavior a dependency upgrade could silently change. It sits beside its module
as `<module>.test.ts` and opens with one line naming what it guards.

## Commits

Commit messages use `type: description` (a prefix, a colon, a space, and a concise description),
for example `feat: add entity persistence`.

## Documentation

- `docs/agents/` holds instructions for agent tools and workflows; read
  `docs/agents/wayfinder/wayfinder.md` before running Wayfinder.
- `docs/human/` holds architecture context for people: a few durable boundaries and invariants
  only. It is non-authoritative and may lag; the user's request, the code, generated contracts,
  and enforced architecture rules win any disagreement.
- `_local/` (git-ignored) is the first home for anything kept out of version control. Give each
  item its own named folder there so the tree stays clean. It is not a contract.
