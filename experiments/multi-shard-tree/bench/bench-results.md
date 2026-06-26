# bench-results — multi-shard single-tree engine

_loro-crdt 1.11.0, node v26.4.0, --expose-gc, 1000/10000/50000/100000 nodes, 2026-06-26_

## 1. Sizing — full single-doc vs treeDoc-only (per node, RSS via fresh child process)

| N       | variant | build ms | RSS KB/node | snap B/node | snap ratio | rss ratio |
| ------- | ------- | -------- | ----------- | ----------- | ---------- | --------- |
| 1,000   | full    | 66       | 18.67       | 166.8       | 1.000      | 1.000     |
| 1,000   | treeDoc | 71       | 1.79        | 58.2        | 0.349      | 0.096     |
| 10,000  | full    | 400      | 11.67       | 171.9       | 1.000      | 1.000     |
| 10,000  | treeDoc | 449      | 0.03        | 60.4        | 0.351      | 0.002     |
| 50,000  | full    | 1982     | 11.10       | 175.9       | 1.000      | 1.000     |
| 50,000  | treeDoc | 2194     | 0.02        | 62.2        | 0.354      | 0.002     |
| 100,000 | full    | 4525     | 10.83       | 178.8       | 1.000      | 1.000     |
| 100,000 | treeDoc | 4468     | 0.00        | 62.4        | 0.349      | 0.000     |

_treeDoc row RSS is a treeDoc-only (lazy) engine: structure without content._

## 2. Cold load — import a snapshot (median, N=50,000)

- full single-doc: **8.65 ms**
- treeDoc-only: **2.26 ms** (tree/full = 0.261)
  _Structure is available at the treeDoc cost; content streams in per shard._

## 3. Lazy shard load (N=50,000, 64 shards)

- cold tree-only start: **2.47 ms**
- incremental per-shard load: **0.463 ms**
- touch ONE shard (cold tree + 1 shard): **4.00 ms**
- eager load ALL 64 shards: **22.75 ms**
- view touching 1 shard costs ~0.176x of eager-all.

## 4. Sync update bytes — edit 100 of 2,000 nodes

- single-doc update (all edits, one doc): **2442 B**
- sharded sum (tree + every shard delta): **6443 B** (treeDoc=22 B, shards touched=64)
- largest single-shard delta: **188 B** — a peer wanting one shard pays this, not the whole-doc update.
  _Partial sync: peers exchange only the shards they hold, not the entire edit set._

## 5. Sweep cost — delete 1,000 of 5,000, then sweepTombstones

- sweepTombstones fixpoint scan: **22.6 ms** (0.025 ms/delete)
