# Lode Knowledge Model

Lode is a local-first knowledge outliner whose persistent meaning is expressed through Nodes, Schemas, Fields, references, and proposals. This language names the product concepts independently of storage, projection, and transport mechanisms.

The formal app transport authenticates every command, query, event stream, maintenance request, and replica sync exchange with an explicit access credential. Local socket ownership can restrict reachability, but it is not a substitute for protocol authentication.

## Language

**Engine**:
Lode's headless, embeddable application core, which owns domain commands and queries, Workspace state, persistence coordination, and replica-exchange semantics. An Engine does not own client transport, process lifetime, listening addresses, or access authentication.
_Avoid_: Engine Runtime, server, daemon

**Engine Host**:
A component that creates and closes an Engine instance, supplies platform resources, and makes the Engine available through a platform adapter. An Engine Host decides process and platform integration without redefining Engine semantics.
_Avoid_: Engine Runtime, application core

**Daemon**:
The desktop Engine Host, which exposes Engine capabilities through an authenticated local process and coordinates remote connections. The Daemon owns listeners, connections, and process shutdown, but not Workspaces or domain authority.
_Avoid_: Engine server, desktop Engine

**Workspace Session**:
The active Engine resources for one open Workspace, binding its domain capabilities to its persistent and replica state. Closing a Session stops new use and drains active work without changing the Workspace's persistent identity.
_Avoid_: Hosted Workspace, Workspace Host

**Engine Application Contract**:
The serializable command, query, result, and event semantics shared by every Engine client. It is independent of whether a call crosses an in-process, native, or network boundary.
_Avoid_: IPC contract, daemon API

**Replica**:
One independently evolving copy of a Workspace's Fact authority, identified separately so it can advance while disconnected and later exchange Facts with another Replica. A Replica is not a Projection cache or a client connection.
_Avoid_: Peer connection, synchronized view

**Replica Exchange**:
The Engine capability through which two Workspace Replicas compare versions and exchange authoritative data. Endpoint discovery, connection establishment, and retry belong to the Engine Host rather than Replica Exchange.
_Avoid_: Remote sync connection, transport authority

**Node**:
A persistent knowledge object with stable identity. Anything users can name, reference, nest, reuse, query, or authorize independently is a Node, including Workspaces, Schemas, Field Definitions, Fields, Search Nodes, Command Nodes, Calendars, Views, and ordinary outline content. A Node Type selects specialized behavior without creating a parallel identity system. Every non-Workspace Node has exactly one Owner Node; the Workspace Node is the ownership root and has no Owner.

**Node Type**:
The optional, immutable specialization of a Node: Schema, Field Definition, Field, Search, Command, Workspace, Calendar, or View. An ordinary Node has no Node Type. Node Type drives domain capability and presentation, while Reference appearance, URL or Code content, Entity classification, and access state remain independent axes. Concurrent incompatible type declarations suspend the effective type and expose a conflict.
_Avoid_: Facet, role, block kind, Reference type

**Occurrence**:
A Node's ordered placement in a parent Node's children list. An Occurrence has its own stable identity because order, local presentation metadata, deletion, movement, and review target the placement rather than the shared Node. A parent is always a Node, never another Occurrence or a synthetic root. The same Node can occur under several parent Nodes but cannot occur twice in one parent Node's children list.
_Avoid_: Copy, block instance

**Workspace**:
The Node of type Workspace that forms one ownership, authorization, and replication boundary. Workspace genesis atomically creates the Node and declares its type through the common Fact transaction path; root policy only fixes its Owner to `null` and prevents deletion. Top-level outline Occurrences are children of the Workspace Node itself; there is no separate Workspace Root entity, root Occurrence, root children list, or Workspace-specific placement path.
_Avoid_: Workspace Root, synthetic root Occurrence, graph-external Workspace identity

**Reference**:
A placement whose parent Node is not the placed Node's Owner. It preserves the target Node's identity and live content while contributing an independent contextual appearance. Reference edges may form cycles; traversal terminates by Node identity rather than forbidding graph-shaped knowledge.
_Avoid_: Link value, copied node

**Owner**:
The single parent Node of another Node's Original Occurrence, supplying its lifecycle and access parent. Every non-Workspace Node in active knowledge has one rooted Owner chain that reaches the Workspace; no Owner is inferred without a real Occurrence. Owner edges remain acyclic even though Reference edges may cycle.
_Avoid_: Canonical occurrence, owner type union, owning Occurrence

**Original**:
The unique Occurrence of a Node whose parent is that Node's Owner. Moving the Original moves ownership, while promoting an existing Reference makes that Occurrence the new Original without changing Node identity.
_Avoid_: Canonical Occurrence, main copy, source Node

**Fact**:
An immutable domain assertion whose identity, transaction position, observed Fact frontier, semantic evidence, and canonical content are independent of storage and replication technology. Admission decides whether a Fact belongs to authority; Projection derives current knowledge state from admitted Facts.
_Avoid_: Loro operation, mutable event row, projected Node

**Fact Transaction**:
The smallest authority unit that must become visible as a whole. An ordinary one-Fact write is an implicit singleton transaction; only a domain operation that expands into several inseparable Facts requests an explicit multi-Fact transaction. Every member carries the same transaction identity plus its index and total size, so Admission can withhold an incomplete replicated group without storing `begin` or `end` marker Facts. Review and authority indexes preserve the same boundary.
_Avoid_: Transaction marker Fact, one transaction per command, Loro transaction semantics

**Value Target**:
The Node or Occurrence whose properties or presentation metadata a Value Fact changes. It identifies the subject of a value assertion and never establishes Node ownership.
_Avoid_: Value Owner, property owner

**Fact Replication**:
The delivery of immutable Fact envelopes between Replicas. Loro owns replicated container versions, deltas, snapshots, duplicate delivery, and arrival order; it may deliver the members of one Fact Transaction separately, while Admission alone decides when the complete transaction becomes authoritative. Loro does not decide Node, Owner, Schema, Field, Proposal, Review, transaction, or deletion semantics.
_Avoid_: Domain authority, Loro-backed domain model

**Schema**:
A Node of type Schema that defines an “is a” classification whose template contributes Fields and content to Nodes that apply it. Schema is Lode's product name for the concept Tana calls a Supertag.
_Avoid_: Supertag, class, tag

**Schema Application**:
An independent relation stating that a Node is an instance of a Schema. A Node can have multiple Schema Applications.
_Avoid_: schemaId, assigned schema

**Schema Extension**:
A persistent subtype relation through which one Schema inherits another Schema's template and participates in its searches. Multiple bases are explicit; provenance is preserved, and cyclic or incompatible inherited semantics are exposed as conflicts instead of being silently ordered.
_Avoid_: Copied schema, implicit multi-schema

**Field Definition**:
A Node of type Field Definition that names and configures a “has a” attribute. It exists before any use, and multiple Schemas and Nodes can reuse the same identity.
_Avoid_: Field key, property name

**Field**:
A Node of type Field that is placed beneath an owner and bound to one Field Definition. A Field owns ordered value Occurrences and may be a Template Field under a Schema or a Materialized Field under an instance. An unmaterialized placeholder is Projection state, not a Field Node.
_Avoid_: Field occurrence, tuple object, scalar property, placeholder Node

**Node Tombstone**:
The deleted state of any Node. It preserves the Node identity and surviving References while preventing active use until the same identity is restored; Node Type and Schema and Field relationships remain projections over that common lifecycle.
_Avoid_: Definition Tombstone, cascading schema delete, missing definition

**Hard Delete**:
An independently gated maintenance operation that permanently prevents a tombstoned Node identity from re-entering Projection. Its preview includes bounded Reference, Schema, Field, Proposal, and History impacts. Every known Replica must causally acknowledge the deletion or be explicitly retired, and pending Proposals or unknown Invocation outcomes block execution.
_Avoid_: Delete mutation, garbage collection, best-effort purge

**Effective Field**:
A Field made available to a Node by its Schema Applications and Schema Extensions, whether or not the Node has stored a local value yet.
_Avoid_: Managed child, generated field

**Materialized Field**:
An Effective Field that binds one owner Node and one Field Definition to a stable Field Node and Field Occurrence because it has a default, initialization result, authored value, or other persistent local state. Default-generated and authored Materialized Fields remain owned by the instance when their final Schema source disappears.
_Avoid_: Field placeholder, scalar property

**Field Value**:
An ordered Node or Reference occurrence owned by a Materialized Field. A Field can contain multiple Field Values; Field type and cardinality guide presentation and validation without turning values into scalars or deleting extra Nodes.
_Avoid_: JSON value, scalar value

**Field Content Deletion**:
An instance action that either removes one selected Field Value occurrence or clears the whole Materialized Field occurrence. It retains the underlying Field and Value Node identities and content; clearing the Field reveals its Effective placeholder while a Schema source remains, and History restoration recovers the stored subtree without discarding concurrent authored values.
_Avoid_: Node deletion, scalar clear, cascading content loss

**View Node**:
A persistent Node of type View whose properties select a Schema, presentation layout, and ordered Field Definition columns. Properties alone never turn an ordinary Node into a View. A View query follows Schema Extension membership and presents the same Node, Field, Occurrence, and Reference identities; its rows and cells are bounded Projection data, never copied business records.
_Avoid_: Table row authority, duplicated database, saved result set

**Schema Template**:
The ordered Fields, Nodes, References, and searches that a Schema contributes to its instances.
_Avoid_: Field list, copied children

**Template Field**:
A Field Node whose Owner is a Schema Node and whose Field Occurrence occupies an ordered place in that Schema's template. It points to a reusable Field Definition while owning its own visibility, default, initializer, and provenance.
_Avoid_: Schema Field Contribution, Field Template Item, anonymous field entry

**Static Default**:
Template Field configuration whose values are captured into a Materialized Field when a new Schema Application first makes the Field effective. Conflicting incomparable defaults pause materialization and remain visible with provenance.
_Avoid_: Live default, fallback scalar

**Field Initializer**:
Template Field configuration evaluated once when a Schema Application is established. Its resulting Node and Reference values become ordinary instance-owned Field data and do not recompute when context changes.
_Avoid_: Formula, computed field

**Optional Field Contribution**:
A Schema Template relationship that offers a Field Definition as an instance suggestion without creating an Effective Field. Selecting it explicitly creates a Materialized Field, including when its value remains empty.
_Avoid_: Hidden field, optional placeholder

**Detached Template Content**:
An instance-owned Node snapshot of ordinary Template content. Detachment gives the snapshot and its placement explicit identities under the common Node and Occurrence lifecycle, while later definition changes no longer rewrite it.
_Avoid_: Stale managed child

**Placement Conflict**:
Concurrent moves that give one Occurrence different parent Nodes. Projection keeps one deterministic temporary placement while exposing every candidate parent Node, sequence anchor, author, Replica, and observed frontier until a later move observes the candidates and chooses the placement.
_Avoid_: Duplicate owner, winning move

**Proposal**:
A contribution that appears in Review without changing Origin until it is accepted. Rejection removes its participation without deleting its recorded intent.

**Unsupported Work**:
A Direct contribution whose required Proposal support is terminally rejected. It remains durable and publicly discoverable with its author, Replica, observed frontier, missing support, and recovery action; restoring independent support makes the work projectable again.
_Avoid_: Lost edit, hidden orphan, rejected Direct work

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
