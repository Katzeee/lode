# Recorded observations

The standard run uses Node 26.4.0 on Windows, executes each route in a fresh process, and records the
median elapsed-time run of three repetitions. Fact loading is outside the measured region because
both Workspace startup routes must load the authoritative Facts. `rebuild` starts from the same
already loaded `FactSnapshot` that the restore routes use to select a generation.

The fixture produces 3,081 Facts for 1,000 Nodes, 15,081 Facts for 5,000 Nodes, and 45,081 Facts for
15,000 Nodes. The 30,000-Node extension contains 90,081 Facts and is a single recorded run because
of its cost.

## Rebuild and current restore

|  Nodes | Route           | Backend | Time (ms) | Peak heap delta (MiB) | Documents read |
| -----: | --------------- | ------- | --------: | --------------------: | -------------: |
|  1,000 | rebuild         | memory  |     53.41 |                  7.76 |              0 |
|  1,000 | current restore | memory  |     86.86 |                 34.24 |          9,154 |
|  1,000 | current restore | SQLite  |    358.02 |                 32.30 |          9,154 |
|  5,000 | rebuild         | memory  |    243.58 |                 30.31 |              0 |
|  5,000 | current restore | memory  |    407.85 |                121.69 |         45,002 |
|  5,000 | current restore | SQLite  |  1,755.93 |                219.65 |         45,002 |
| 15,000 | rebuild         | memory  |  1,248.26 |                213.86 |              0 |
| 15,000 | current restore | memory  |  1,259.10 |                350.12 |        134,596 |
| 15,000 | current restore | SQLite  |  6,322.67 |                399.71 |        134,596 |
| 30,000 | rebuild         | memory  |  4,992.53 |                277.17 |              0 |
| 30,000 | current restore | memory  |  2,766.71 |                707.41 |        269,002 |

Reconcile grows more steeply than storage restoration in this fixture, so a checkpoint has a real
large-scale purpose. The current representation reaches that benefit only with an in-memory store
around 30,000 Nodes. SQLite's per-document overhead makes the current persisted route substantially
slower than rebuild through the largest SQLite run.

## SQLite publication and storage

|  Nodes | Format      | Publish (ms) | Restore (ms) | Documents | Payload (MiB) | SQLite file (MiB) |
| -----: | ----------- | -----------: | -----------: | --------: | ------------: | ----------------: |
|  1,000 | current     |       677.42 |       358.02 |     9,205 |          7.74 |             12.01 |
|  1,000 | monolith    |         6.49 |        12.81 |         1 |          1.66 |              1.68 |
|  1,000 | chunked 256 |        19.14 |        12.46 |        44 |          2.52 |              2.57 |
|  5,000 | current     |     3,753.16 |     1,755.93 |    45,053 |         37.86 |             58.64 |
|  5,000 | monolith    |        49.59 |        65.71 |         1 |          8.16 |              8.19 |
|  5,000 | chunked 256 |       103.71 |        67.91 |       172 |         12.37 |             12.55 |
| 15,000 | current     |    12,766.43 |     6,322.67 |   134,647 |        113.28 |            176.14 |
| 15,000 | monolith    |       133.19 |       183.35 |         1 |         24.54 |             24.59 |
| 15,000 | chunked 256 |       316.00 |       203.72 |       500 |         37.15 |             37.69 |

The monolith is a checkpoint-only control: it stores the Projection and Review model but regenerates
internal indexes during validation. The chunked route persists the same logical materialized entries
as the current Store. Its chunks include the generation ID and its manifest is written last, so a
partial new publication does not make that generation visible. Cleanup and a production schema are
outside the spike.

## Cold 100-Node page at 15,000 Nodes

| Format      | Backend | Time (ms) | Documents read | Bytes read (MiB) | Peak heap delta (MiB) |
| ----------- | ------- | --------: | -------------: | ---------------: | --------------------: |
| current     | memory  |      3.55 |            111 |             0.12 |                  3.30 |
| current     | SQLite  |      8.65 |            111 |             0.12 |                  3.37 |
| monolith    | memory  |    184.75 |              1 |            24.54 |                 94.90 |
| chunked 256 | memory  |      0.79 |              2 |             0.14 |                  0.46 |
| chunked 256 | SQLite  |      1.17 |              2 |             0.14 |                  0.49 |

The current directory succeeds at bounded bytes, but one shard per entry turns a 100-entry page into
roughly 100 storage operations. A range chunk obtains the same bounded behavior with one manifest
and one data read. The monolith demonstrates why a checkpoint-only format cannot replace the online
read model without changing query ownership.

## Chunk-size probe at 15,000 Nodes on SQLite

| Entries per chunk | Publish (ms) | Restore (ms) | Page (ms) | Documents | Page reads | Page bytes (MiB) | SQLite file (MiB) |
| ----------------: | -----------: | -----------: | --------: | --------: | ---------: | ---------------: | ----------------: |
|                64 |       393.53 |       246.84 |      1.57 |     1,980 |          3 |             0.31 |             39.48 |
|               256 |       316.00 |       203.72 |      1.17 |       500 |          2 |             0.14 |             37.69 |
|             1,024 |       273.48 |       187.76 |      1.45 |       132 |          2 |             0.18 |             37.18 |

The probe does not select a production chunk size, but it shows the expected trade-off. Very small
chunks enlarge the global manifest and increase operations; very large chunks increase bounded-read
bytes. A production design can improve this further with one manifest per dataset root rather than
the spike's single global manifest.

## Interpretation and limits

The current Store is not merely more defensive in source code; its physical granularity defeats its
own recovery objective on SQLite at the measured sizes. Full restore issues one load for nearly every
materialized entry and currently launches shard decoding through broad `Promise.all` fan-out, which
also explains its peak-memory behavior.

The fixture stresses the dominant Node, Occurrence, ownership, and reverse-index surfaces but omits
proposals, resolutions, Supertags, Fields, and template instances. Absolute timings therefore do not
predict a product Workspace. Memory is sampled at storage boundaries and completion, so synchronous
intermediate peaks can be missed. The candidate formats validate values with the production dataset
contracts, but they intentionally omit durable format versioning, cleanup, caching, and cryptographic
digests. These omissions prevent direct promotion; they do not account for the orders-of-magnitude
difference caused by document count.
