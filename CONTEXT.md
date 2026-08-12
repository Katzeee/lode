# Lode Knowledge Model

Lode is a local-first knowledge outliner whose persistent meaning is expressed through Nodes, Schemas, Fields, references, and proposals. This language names the product concepts independently of storage, projection, and transport mechanisms.

## Language

**Node**:
A persistent knowledge object with stable identity and one owning location. The same Node can appear elsewhere through References.

**Occurrence**:
A Node's ordered appearance under a parent. One occurrence owns the Node; other occurrences can present the same Node as References.
_Avoid_: Copy, block instance

**Reference**:
A non-owning Occurrence of an existing Node that preserves the target Node's identity and live content.
_Avoid_: Link value, copied node

**Schema**:
A Node-defined “is a” type whose template contributes Fields and content to Nodes that apply it. This is Lode's product term for the concept Tana calls a Supertag.
_Avoid_: Supertag, class, tag

**Schema Application**:
An independent relation stating that a Node is an instance of a Schema. A Node can have multiple Schema Applications.
_Avoid_: schemaId, assigned schema

**Schema Extension**:
A persistent subtype relation through which one Schema inherits another Schema's template and participates in its searches. Multiple bases are explicit; provenance is preserved, and cyclic or incompatible inherited semantics are exposed as conflicts instead of being silently ordered.
_Avoid_: Copied schema, implicit multi-schema

**Field Definition**:
A stable Node that names and configures a “has a” attribute. Multiple Schemas and Nodes can reuse the same Field Definition.
_Avoid_: Field key, property name

**Effective Field**:
A Field made available to a Node by its Schema Applications and Schema Extensions, whether or not the Node has stored a local value yet.
_Avoid_: Managed child, generated field

**Materialized Field**:
An Effective Field that binds one owner Node and one Field Definition to a stable Field Node and Field Occurrence because it has a default, initialization result, authored value, or other persistent local state. Default-generated and authored Materialized Fields remain owned by the instance when their final Schema source disappears.
_Avoid_: Field placeholder, scalar property

**Field Value**:
An ordered Node or Reference occurrence owned by a Materialized Field. A Field can contain multiple Field Values; Field type and cardinality guide presentation and validation without turning values into scalars or deleting extra Nodes.
_Avoid_: JSON value, scalar value

**Schema Template**:
The ordered Fields, Nodes, References, and searches that a Schema contributes to its instances.
_Avoid_: Field list, copied children

**Schema Field Contribution**:
An ordered Schema Template relationship that contributes one stable Field Definition to every applicable Node. Multiple Schemas can contribute the same Field Definition without creating duplicate Fields.
_Avoid_: Field key, managed slot, copied field

**Field Template Item**:
The stable identity of one Schema Field Contribution. It owns that contribution's order, visibility, static default or initializer configuration, and provenance independently of the reused Field Definition.
_Avoid_: Field configuration on the shared definition, anonymous field entry

**Static Default**:
Field Template Item configuration whose values are captured into a Materialized Field when a new Schema Application first makes the Field effective. Conflicting incomparable defaults pause materialization and remain visible with provenance.
_Avoid_: Live default, fallback scalar

**Field Initializer**:
Field Template Item configuration evaluated once when a Schema Application is established. Its resulting Node and Reference values become ordinary instance-owned Field data and do not recompute when context changes.
_Avoid_: Formula, computed field

**Optional Field Contribution**:
A Schema Template relationship that offers a Field Definition as an instance suggestion without creating an Effective Field. Selecting it explicitly creates a Materialized Field, including when its value remains empty.
_Avoid_: Hidden field, optional placeholder

**Detached Template Content**:
Instance content that originated from a Schema Template but is now owned by the instance because the user changed it.
_Avoid_: Stale managed child

**Proposal**:
A contribution that appears in Review without changing Origin until it is accepted. Rejection removes its participation without deleting its recorded intent.

**Origin**:
The accepted knowledge state.
_Avoid_: Base document, main branch

**Review**:
The knowledge state that combines Origin with pending Proposals and exposes their observable effects for decision.
_Avoid_: Preview document, proposal branch

**Resolution Conflict**:
Concurrent opposite decisions about the same Proposal contribution. The contribution stays out of Origin and remains visible in Review until an explicit adjudication resolves both decisions.
_Avoid_: Winning resolution, last decision

**Adjudication**:
A Resolution that observes every current candidate in one Resolution Conflict and chooses its terminal decision.
_Avoid_: Conflict overwrite, forced winner
