# Lode Knowledge Model

Lode is a local-first knowledge outliner whose persistent meaning is expressed through Nodes, Supertags, Fields, references, and proposals. This language names the product concepts independently of storage, projection, and transport mechanisms.

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
A persistent knowledge object with stable identity. Anything the domain names, nests, reuses, queries, or governs independently is a Node, including Workspaces, Supertag Definitions, Field Definitions, Fields, Search Nodes, Command Nodes, Metanodes, and ordinary outline content. A Node Type selects specialized behavior without creating a parallel identity system. Every non-Workspace Node has exactly one Owner Node; the Workspace Node is the ownership root and has no Owner.

**Node Type**:
The optional, immutable specialization of a Node: Supertag Definition, Field Definition, Field, Search, Command, Workspace, or Calendar. An ordinary Node has no Node Type. Node Type selects a closed set of invariants that cannot be expressed safely by adding ordinary Fields, while Reference appearance, View Definition, Workspace System Role, URL or Code content, Entity classification, and access state remain independent axes. Concurrent incompatible type declarations suspend the effective type and expose a conflict.
_Avoid_: Facet, role, block kind, Reference type

**Occurrence**:
A Node's ordered placement in a parent Node's children list. An Occurrence has its own stable identity because order, contextual presentation, deletion, movement, and review target the placement rather than the shared Node. A parent is always a Node, never another Occurrence or a synthetic root. The same Node can occur under several parent Nodes but cannot occur twice in one parent Node's children list.
_Avoid_: Copy, block instance

**Node Graph**:
The current Nodes, their ordered Occurrences, Metanode attachments, and the Owner relation. Outline-placed Nodes have one rooted Original; a Metanode is owned through its typed host attachment without appearing in the host's outline children. Reference edges may make the graph cyclic even though its Owner edges form a tree.
_Avoid_: Node tree, Projection index, recursive Node document

**Outline**:
A bounded, rooted unfolding of the Node Graph for navigation and editing. An Outline is tree-shaped for one traversal path, but it does not replace the shared Node identities or persist a second hierarchy.
_Avoid_: Stored tree, Workspace state, copied subtree

**Workspace Projection**:
The generation-bound semantic state derived from admitted Facts, composed from the Node Graph and the current Supertag, Field, and conflict relations. Rebuildable lookup indexes and individual query results are not part of the Workspace Projection.
_Avoid_: Projection index, query response, storage snapshot

**Projection Perspective**:
The choice between accepted authority (`origin`) and accepted authority plus pending Proposals (`review`) when deriving or reading a Workspace Projection. It is not a View Definition or a presentation mode.
_Avoid_: View Mode, View, renderer state

**Workspace**:
The Node of type Workspace that forms one ownership, authorization, and replication boundary. Workspace genesis atomically creates the Node and declares its type through the common Fact transaction path; root policy only fixes its Owner to `null` and prevents deletion. Top-level outline Occurrences are children of the Workspace Node itself; there is no separate Workspace Root entity, root Occurrence, root children list, or Workspace-specific placement path.
_Avoid_: Workspace Root, synthetic root Occurrence, graph-external Workspace identity

**Reference**:
A placement whose parent Node is not the placed Node's Owner. It preserves the target Node's identity and live content while contributing an independent contextual appearance. Reference edges may form cycles; traversal terminates by Node identity rather than forbidding graph-shaped knowledge.
_Avoid_: Inline Reference, link value, copied node

**Inline Reference**:
An identity-bearing item in one host Node's ordered content that targets another Node. It shares target identity and lifecycle semantics with a block Reference without becoming an Occurrence; deleting or restoring the target changes derived availability while preserving the Inline Reference identity and its position.
_Avoid_: Reference Occurrence, copied text, URL token, embedded Node

**Inline Alias**:
An ordinary Node owned beneath the host Node's Metanode and attached to one Inline Reference as its contextual display content. The attachment is typed and independently reviewable; the Alias does not rename, own, or replace the target Node.
_Avoid_: Alias string, target title override, Inline Reference metadata

**Backlink**:
A perspective-specific derived read of block Reference Occurrences and Inline Reference identities that target one Node. A Backlink records its source kind, source identity, host Node, and current target availability; it is not persistent authority or a second reverse edge.
_Avoid_: Stored reverse relation, global Reference count, index row

**Owner**:
The single structural and access parent of another Node. For outline content, the Owner is the parent of its Original Occurrence; for a Metanode, the typed host attachment establishes the Owner without adding a visible Occurrence. Every non-Workspace Node has one acyclic Owner chain that reaches the Workspace, including Nodes whose path passes through Trash.
_Avoid_: Canonical occurrence, owner type union, owning Occurrence

**Original**:
The unique outline Occurrence of an outline-placed Node whose parent is that Node's Owner. Moving the Original moves ownership, while promoting an existing Reference makes that Occurrence the new Original without changing Node identity. A Metanode is not outline-placed and therefore has no Original.
_Avoid_: Canonical Occurrence, main copy, source Node

**Fact**:
An immutable domain assertion whose identity, transaction position, observed Fact frontier, semantic evidence, and canonical content are independent of storage and replication technology. Admission decides whether a Fact belongs to authority; Projection derives current knowledge state from admitted Facts.
_Avoid_: Loro operation, mutable event row, projected Node

**Fact Transaction**:
The smallest authority unit that must become visible as a whole. An ordinary one-Fact write is an implicit singleton transaction; only a domain operation that expands into several inseparable Facts requests an explicit multi-Fact transaction. Every member carries the same transaction identity plus its index and total size, so Admission can withhold an incomplete replicated group without storing `begin` or `end` marker Facts. Review and authority indexes preserve the same boundary.
_Avoid_: Transaction marker Fact, one transaction per command, Loro transaction semantics

**Fact Replication**:
The delivery of immutable Fact envelopes between Replicas. Loro owns replicated container versions, deltas, snapshots, duplicate delivery, and arrival order; it may deliver the members of one Fact Transaction separately, while Admission alone decides when the complete transaction becomes authoritative. Loro does not decide Node, Owner, Supertag, Field, Proposal, Review, transaction, or deletion semantics.
_Avoid_: Domain authority, Loro-backed domain model

**Supertag Definition**:
A Node of type Supertag Definition that defines an “is a” classification whose template contributes Fields and content to Nodes that apply it. “Supertag” is the concise product-facing name for this definition when the distinction from its applications is already clear.
_Avoid_: Class, tag, Supertag Node

**Supertag Application**:
An independent typed relation stating that a Node is an instance of one Supertag Definition. A Node can have multiple Supertag Applications.
_Avoid_: supertagId, assigned supertag

**Supertag Instances Query**:
A bounded read of Nodes whose Supertag Applications match one Supertag Definition directly or through Supertag Extension. It reads derived membership and is not a persistent Search Node or query definition.
_Avoid_: Supertag Search, Search Node, saved query

**Search Node**:
A Node of type Search whose Configuration Graph owns an ordered query expression. Search identity, query clauses, Proposal, History, and Trash lifecycle are persistent domain state, while matching results are evaluated from the selected Projection perspective and remain derived reads.
_Avoid_: Saved result list, query blob, Supertag Instances Query

**Search Clause**:
An identity-bearing Node beneath a Search Node's Metanode that contributes one typed predicate to the Search expression. Clause Occurrences provide ordering, ordinary Node lifecycle provides removal and restoration, and the first supported expression is an implicit conjunction of Supertag-instance and materialized-Field predicates.
_Avoid_: Query JSON, filter callback, anonymous predicate

**Search Result Reference**:
A perspective-specific derived row that points from one Search Node to one matching target Node. It has a deterministic row identity for pagination and rendering, but it is not a Fact, an Occurrence, an Owner edge, or stored authority.
_Avoid_: Result Node, generated child, cached membership

**Supertag Extension**:
A persistent subtype relation through which one Supertag Definition inherits another Supertag Definition's template and participates in its searches. Multiple bases are explicit; provenance is preserved, and cyclic or incompatible inherited semantics are exposed as conflicts instead of being silently ordered.
_Avoid_: Copied supertag, implicit multi-supertag

**Field Definition**:
A Node of type Field Definition that names and configures a “has a” attribute. It exists before any use, and multiple Supertag Definitions and ordinary Nodes can reuse the same identity.
_Avoid_: Field key, property name

**Field Datatype**:
An identity-bearing configuration relation beneath a Field Definition's Metanode that selects the supported value interpretation, initially Plain or Options. Changing it does not replace the Field Definition, Field Nodes, or existing Field Values.
_Avoid_: Field Node Type, value conversion job, scalar schema column

**Field Cardinality**:
An identity-bearing configuration relation beneath a Field Definition's Metanode that declares Single or List presentation and validation semantics. Changing it never truncates or deletes stored Field Value Nodes; policies for excess values remain separate domain rules.
_Avoid_: Array flag, destructive migration, value count

**Field Initialization Expression**:
An identity-bearing expression Node beneath a Field Definition's Metanode that is evaluated once when a new Supertag Application makes that Field effective. The supported expression reads the same Field from an Outline ancestor; it produces ordinary instance-owned Field Values and does not recompute when the ancestor later changes.
_Avoid_: Template Field initializer, live formula, metadata callback

**Field**:
A Node of type Field that is placed beneath an owner and bound to one Field Definition. A Field owns ordered value Occurrences and may be a Template Field under a Supertag Definition or a Materialized Field under an instance. An unmaterialized placeholder is Projection state, not a Field Node.
_Avoid_: Field occurrence, tuple object, scalar property, placeholder Node

**Trash**:
A persistent Node assigned the Workspace's Trash System Role. A Node is in Trash exactly when its Owner path reaches this Node: deletion moves the same Original and Owner of the selected root beneath Trash, owned descendants follow through the existing Owner tree, and surviving References keep pointing to the same Node. Restoration reverses that structural placement using the deletion Fact as evidence; there is no separate Node status or deleted-Node partition.
_Avoid_: Node Tombstone, Deleted-Node store, Hard Delete queue, Trash Node Type

**Workspace System Role**:
A Workspace-scoped canonical relation assigning a built-in structural purpose, such as Trash, to one Node. The relation drives discovery and protection; the target's title, Node Type, or caller-editable metadata never establishes the role.
_Avoid_: System Node Type, system-role metadata, reserved title

**System Field Definition**:
A built-in Field Definition whose identity, value shape, and policy are owned by Lode. It lets Nodes carry typed configuration and relations through the ordinary Field and Node graph without exposing an untyped metadata key or a parallel configuration store.
_Avoid_: Metadata key, magic property, configuration column

**Calculated System Field**:
A read-only Field value derived for a Node from current semantic state under a System Field Definition. It is Projection state rather than authored Field content and does not require a persistent Field Node merely because clients can display or query it.
_Avoid_: Stored metadata, generated child, cached authority

**Configuration Graph**:
A hidden Node, Field, and Reference subgraph reached from a host through its Metanode. System Field Definitions type the relations inside the graph; Search expressions, View Definitions, commands, defaults, and other structured capabilities use it when their parts need identity, ordering, grouping, reuse, or composition. Ordinary Outline traversal does not expose this subgraph merely because its Nodes have Owners.
_Avoid_: Metadata blob, opaque JSON configuration, parallel document

**Metanode**:
The single persistent Node attached to a host by the canonical `metanode-attach` relation. Its Owner is the host, but it has no Outline Occurrence and does not appear in the host's ordered child Occurrences. Configuration descendants use ordinary Node, Field, Reference, Occurrence, Owner, Trash, Proposal, and History semantics beneath the Metanode. It cannot be deleted independently and follows the host through the Owner lifecycle. Metanode is a structural role established by the attachment, not a public Node Type or an intrinsic property bag.
_Avoid_: Hidden child Occurrence, metadata object, deterministic Metanode lookup

**Hard Delete**:
An independently gated maintenance operation that permanently prevents a Node already placed in Trash from re-entering Projection. Its preview includes bounded Reference, Supertag, Field, Proposal, and History impacts. Every known Replica must causally acknowledge the deletion or be explicitly retired, and pending Proposals, unknown Invocation outcomes, or owned descendants block execution; root-only purge never leaves an Owner subtree orphaned.
_Avoid_: Delete mutation, garbage collection, best-effort purge

**Effective Field**:
A Field made available to a Node by its Supertag Applications and Supertag Extensions, whether or not the Node has stored a local value yet.
_Avoid_: Managed child, generated field

**Materialized Field**:
An Effective Field that binds one owner Node and one Field Definition to a stable Field Node and Field Occurrence because it has a default, initialization result, authored value, or other persistent local state. Default-generated and authored Materialized Fields remain owned by the instance when their final Supertag source disappears.
_Avoid_: Field placeholder, scalar property

**Field Value**:
An ordered Node or Reference occurrence owned by a Materialized Field. A Field can contain multiple Field Values; Field type and cardinality guide presentation and validation without turning values into scalars or deleting extra Nodes.
_Avoid_: JSON value, scalar value

**Field Content Deletion**:
An instance action that either removes one selected Field Value occurrence or clears the whole Materialized Field occurrence. It retains the underlying Field and Value Node identities and content; clearing the Field reveals its Effective placeholder while a Supertag source remains, and History restoration recovers the stored subtree without discarding concurrent authored values.
_Avoid_: Node deletion, scalar clear, cascading content loss

**View Definition**:
A persistent ordinary Node beneath a host's Metanode that names one reusable set of child-projection configuration. It does not change the host's Node Type, own the projected children, or persist a result set.
_Avoid_: View Node Type, saved result set, renderer state, view blob

**Shared Default View**:
The Workspace-shared relation from one host Node to its default View Definition. A host has at most one effective Shared Default View; its relation remains separate from View Type and from any future personal presentation choice.
_Avoid_: Shared View, current renderer, personal View

**View Type**:
The projection mode selected by a View Definition, initially Outline or Table. View Type is independent of the identity-bearing option graph and does not determine child authority or ordering.
_Avoid_: View Definition, layout blob, Projection Perspective

**Implicit Outline**:
The derived Outline presentation used when a host has no Shared Default View. It has no persistent View Definition identity and does not create configuration Facts merely because a client reads it.
_Avoid_: Default View Node, generated View Definition

**View Row Reference**:
A perspective-specific derived row that retains the identity of its child source, either an ordinary Occurrence or a Search Result Reference. It is not a Fact, an Occurrence created for Search results, or stored result authority.
_Avoid_: View Occurrence, generated child, cached row Node

**Supertag Template**:
The ordered Fields, Nodes, References, and searches that a Supertag Definition contributes to its instances.
_Avoid_: Field list, copied children

**Template Field**:
A Field Node whose Owner is a Supertag Definition and whose Field Occurrence occupies an ordered place in that definition's template. It points to a reusable Field Definition while owning the Supertag-specific visibility and Static Default used by that template relationship.
_Avoid_: Supertag Field Contribution, Field Template Item, anonymous field entry

**Static Default**:
Template Field configuration whose values are captured into a Materialized Field when a new Supertag Application first makes the Field effective. Conflicting incomparable defaults pause materialization and remain visible with provenance.
_Avoid_: Live default, fallback scalar

**Optional Field Contribution**:
A Supertag Template relationship that offers a Field Definition as an instance suggestion without creating an Effective Field. Selecting it explicitly creates a Materialized Field, including when its value remains empty.
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
