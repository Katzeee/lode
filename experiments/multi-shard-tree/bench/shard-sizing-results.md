# shard-sizing — the numbers behind numShards

_loro-crdt, 2026-06-26_

## 1. Per-shard fixed overhead + per-entity marginal

- **C_fixed (empty shard doc): 141 B**
- per-entity marginal (at 100 entities): **133.6 B/entity**
- (slope at 1 / 10 entities: 430.0 / 150.7 B/entity — front-loaded container cost amortizes)

## 2. Total storage vs numShards (N = 50,000 nodes, ~20-char content)

- single-doc baseline: **208.2 B/node** (9.9 MB)

| S    | sum of shard snaps | + treeDoc | total B/node | shard-fixed overhead | overhead % of content |
| ---- | ------------------ | --------- | ------------ | -------------------- | --------------------- |
| 16   | 5771 KB            | 4135 KB   | 202.9        | 2 KB                 | 0.03%                 |
| 64   | 5798 KB            | 4223 KB   | 205.2        | 9 KB                 | 0.14%                 |
| 128  | 5848 KB            | 4265 KB   | 207.1        | 18 KB                | 0.27%                 |
| 256  | 5918 KB            | 4290 KB   | 209.1        | 35 KB                | 0.54%                 |
| 512  | 6110 KB            | 4293 KB   | 213.1        | 71 KB                | 1.08%                 |
| 1024 | 6355 KB            | 4279 KB   | 217.8        | 141 KB               | 2.16%                 |

_shard-fixed overhead = S × C_fixed (141 B). "% of content" = overhead ÷ (N × per-entity)._

## 3. Cold start (treeDoc + shards touched by a 50-node view) vs S

| S    | shards touched (expected) | cold-start ms | vs eager-all |
| ---- | ------------------------- | ------------- | ------------ |
| 64   | ~35 (actual 34)           | 11.10         | 0.759×       |
| 256  | ~45 (actual 50)           | 15.07         | 0.429×       |
| 1024 | ~49 (actual 50)           | 7.10          | 0.089×       |

## Reading

- C_fixed = 141 B is the per-doc price. At S shards the fixed overhead is S × 141 B.
- Pick S so that fixed overhead is an acceptable % of content (the table's last column),
  while keeping shards granular enough that a view's cold-start (§3) stays a small fraction
  of eager-all. Power-of-two S keeps future split-doubling clean.
