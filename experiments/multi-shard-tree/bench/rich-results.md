# rich-results — treeDoc size under the REAL (production) data model

_loro-crdt, raw-Loro docs in production container shape, 2026-06-26_

Does the treeDoc-stays-small win survive per-occurrence `props`+`meta` (managed-child
state) living in the treeDoc? `Plain` reproduces the prototype's simplified treeDoc
(no occurrence data); `Rich` adds the occurrence-level data production actually stamps.
`full` is the production-shaped single doc (occ props+meta AND entity content+props+meta).

## realistic — managedFraction=0.3, provenanceCount=1

| N      | full B/node | treeDocPlain B/node | plain/full | treeDocRich B/node | rich/full |
| ------ | ----------- | ------------------- | ---------- | ------------------ | --------- |
| 1,000  | 262.7       | 59.7                | 0.227      | 123.2              | 0.469     |
| 10,000 | 271.7       | 61.9                | 0.228      | 124.2              | 0.457     |
| 50,000 | 274.1       | 63.7                | 0.233      | 127.2              | 0.464     |

## worst-case — managedFraction=1, provenanceCount=3

| N      | full B/node | treeDocPlain B/node | plain/full | treeDocRich B/node | rich/full |
| ------ | ----------- | ------------------- | ---------- | ------------------ | --------- |
| 1,000  | 317.3       | 59.7                | 0.188      | 169.6              | 0.534     |
| 10,000 | 324.5       | 61.9                | 0.191      | 172.2              | 0.531     |
| 50,000 | 336.0       | 63.7                | 0.190      | 175.1              | 0.521     |

## Reading

- `plain/full` (≈0.23 here) is LOWER than the prototype's 0.35 only because this `full`
  is richer (it includes occurrence props+meta + entity meta). Same treeDoc shape either way.
- `rich/full` is the honest treeDoc/full ratio for a production treeDoc. Compare to 0.35.
- Occurrence props+meta roughly DOUBLE the treeDoc byte cost (plain → rich per-node).
- The win still holds structurally: treeDoc omits entity CONTENT (the unbounded, grows-
  with-text part). But it is materially smaller than the 0.35 headline implied.
