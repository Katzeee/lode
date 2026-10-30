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

## Reference alignment

Match the reference system's observable serial behaviour; give concurrent-only states explicit Lode
policies; treat its implementation mechanisms as replaceable, and justify any copied mechanism by the
observable effect it produces. Before reproducing anything, classify each requirement, with evidence:

- **Observable (A)**: what one user's sequential operations show in the UI or an export. Match it. It
  counts as observable only with evidence that a serial path reaches it (an export, a reproducible UI
  path, or a source call path); without that it stays unclassified until checked.
- **Mechanism (B)**: how the reference system produces a result (ghost proxies, in-memory ids,
  children arrays, separate files, single-transaction undo). Replace it with a CRDT-native
  representation whenever the observable results stay the same.
- **Concurrent (C)**: states only concurrent replicas reach. Lode sets the policy, and it reduces to
  the reference system's result when the history is serial.

A copied mechanism earns its place only through an observable effect it alone produces. When that
effect appears only in edge structures, weigh it against the mechanism's cost and record an explicit
deviation instead of copying the mechanism. A review finding is checked against this classification
before it is fixed.

## Code comments

- Comments and docstrings explain this project's semantics and design rationale; keep reference-project
  names out of them, using "reference system" when a reference needs mentioning.
- Every handwritten code file, including tests, scripts and executable configuration, starts with
  `// Purpose: <One sentence describing this file's responsibility.>`, followed by a blank line. Use the
  language's comment syntax and place it after a required shebang; test headers name the behavior
  they guard.
- Prefer self-explanatory code. Beyond the required file headers, keep comments sparse and reserve
  them for non-obvious rationale.

## Present tense

The project has no production data or released compatibility surface. Unless the user asks
otherwise, define the requested system as it should be now: move code, data formats, and APIs
directly, and update every caller and generated contract in the same change. Old code paths,
compat shims, alias re-exports, and migration paths have no reader to serve.

## Tests

A test earns its place by guarding what reading the code cannot confirm, such as convergence under
concurrent edits or behavior a dependency upgrade could silently change. It sits beside its module
as `<module>.test.ts`.

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
