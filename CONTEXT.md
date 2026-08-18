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

**Task-oriented CLI**:
The human-facing client that accepts explicit knowledge-model targets and values, resolves them without exposing storage identities, and compiles the requested action into the Engine Application Contract. It does not define parallel Node, Supertag, Field, Search, View, History, Review, or Sync semantics.
_Avoid_: Raw command CLI, domain JSON CLI, Engine shell

**CLI Command Family**:
A user-facing namespace that groups related CLI actions by the Tana-aligned or Lode-owned product concept they target. A family compensates for the terminal's lack of UI focus by making the target kind explicit; it is not an Engine mutation family or a persistent Command Node.
_Avoid_: Schema command, context menu, mutation family

**CLI Target**:
The Node, Definition, relation use, saved collection, View, Review item, or conflict explicitly selected for one Task-oriented CLI action. The Current Workspace may be implicit, but the CLI never infers a mutable Current Node from a previous invocation.
_Avoid_: Focused Node, cursor context, last-used object

**Current Workspace**:
The Workspace explicitly selected as the durable default boundary for Task-oriented CLI actions. It is the CLI's only implicit knowledge-model context and never implies a Current Node, Search, View, Origin/Review perspective, or multi-node selection.
_Avoid_: CLI context, Current Node, active View

**Replica**:
One independently evolving copy of a Workspace's Fact authority, identified separately so it can advance while disconnected and later exchange Facts with another Replica. A Replica is not a Projection cache or a client connection.
_Avoid_: Peer connection, synchronized view

**Replica Exchange**:
The Engine capability through which two Workspace Replicas compare versions and exchange authoritative data. Endpoint discovery, connection establishment, and retry belong to the Engine Host rather than Replica Exchange.
_Avoid_: Remote sync connection, transport authority

**Node**:
A persistent knowledge object with stable identity. Anything the domain names, nests, reuses, queries, or governs independently is a Node, including Workspaces, Supertag Definitions, Field Definitions, Fields, Search Nodes, Command Nodes, Metanodes, and ordinary outline content. A Node can present several compatible Node Types without creating a parallel identity system. Every attached non-Workspace Node has exactly one Owner Node; a typed relation lifecycle may retain a detached Node without an Owner or active placement, while the Workspace Node is the ownership root and has no Owner.

**Node Type**:
A Tana-aligned product category describing how a Node behaves or appears. Plain, Reference, Search, Entity, contextual content, Supertag Definition, Field Definition, Field, Command, URL, Code, Workspace, media, access placeholders, Views, and system or configuration Nodes all belong to this vocabulary. Node Type is not one persistent discriminator: it can arise from an Intrinsic Node Type, an Occurrence, typed content or attachments, a typed relation or configuration graph, derived classification, or an access Projection. Compatible Node Types can apply to the same Node at once.
_Avoid_: NodeType enum, universal role bag, single discriminator

**Intrinsic Node Type**:
The optional, immutable intrinsic specialization currently supported by Lode: Supertag Definition, Field Definition, Field, Search, Command, Workspace, or Calendar. An ordinary Node has no Intrinsic Node Type. Only a type whose closed invariants require this exclusive axis enters it; Reference appearance, View Definition, Workspace System Role, URL or Code content, Entity classification, and access state remain independent. Concurrent incompatible declarations suspend the effective Intrinsic Node Type and expose a conflict.
_Avoid_: Declared Node Type, unqualified Node Type, Facet, role, block kind, Reference type

**Occurrence**:
A Node's ordered placement in a parent Node's children list. An Occurrence has its own stable identity because order, contextual presentation, deletion, movement, and review target the placement rather than the shared Node. A parent is always a Node, never another Occurrence or a synthetic root. The same Node can occur under several parent Nodes but cannot occur twice in one parent Node's children list.
_Avoid_: Copy, block instance

**Node Graph**:
The current Nodes, their ordered Occurrences, Metanode attachments, and the Owner relation. Attached Nodes form an Owner tree rooted at the Workspace; outline-placed Nodes have one rooted Original, while a Metanode and protected system-definition Nodes use explicit hidden Owner relations without ordinary outline placements. Typed relation lifecycles may retain detached relation Nodes outside that tree. Reference edges may make the graph cyclic even though attached Owner edges remain acyclic.
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
The Node of type Workspace that forms one ownership, authorization, and replication boundary. Workspace genesis atomically creates the Node, declares its Intrinsic Node Type, and installs its protected Trash and System Definition Catalog through the common Fact transaction path; root policy only fixes its Owner to `null` and prevents deletion. Top-level outline Occurrences are children of the Workspace Node itself; there is no separate Workspace Root entity, root Occurrence, root children list, or Workspace-specific placement path.
_Avoid_: Workspace Root, synthetic root Occurrence, graph-external Workspace identity

**Reference**:
A placement whose parent Node is not the placed Node's Owner. It preserves the target Node's identity and live content while contributing an independent contextual appearance. Reference edges may form cycles; traversal terminates by Node identity rather than forbidding graph-shaped knowledge.
_Avoid_: Inline Reference, link value, copied node

**Inline Reference**:
An identity-bearing item in one host Node's ordered content that targets another Node. It shares target identity and lifecycle semantics with a block Reference without becoming an Occurrence; deleting or restoring the target changes derived availability while preserving the Inline Reference identity and its position.
_Avoid_: Reference Occurrence, copied text, URL token, embedded Node

**Inline Alias**:
An ordinary Node owned by the host Node and associated with an Inline Reference target as contextual display content. The association is typed and independently reviewable; the Alias does not rename, own, or replace the target Node, and whether several Inline References to the same target share one Alias remains outside the current contract.
_Avoid_: Alias string, target title override, Inline Reference metadata

**Backlink**:
A perspective-specific derived read of block Reference Occurrences and Inline Reference identities that target one Node. A Backlink records its source kind, source identity, host Node, and current target availability; it is not persistent authority or a second reverse edge.
_Avoid_: Stored reverse relation, global Reference count, index row

**Owner**:
The single structural and access parent of an attached Node. For outline content, the Owner is the parent of its Original Occurrence; for a Metanode, the typed host attachment establishes the Owner without adding a visible Occurrence. Every attached non-Workspace Node has one acyclic Owner chain that reaches the Workspace, including Nodes whose path passes through Trash. Absence of an Owner is admitted only by a typed detached-relation lifecycle and never means that arbitrary content can float outside the Workspace tree.
_Avoid_: Canonical occurrence, owner type union, owning Occurrence

**Detached Relation**:
An identity-bearing relation Node retained after its typed removal operation clears both its Owner and owning Occurrence. It is absent from the active Workspace tree and is not in Trash; the relation family authorizes this state and defines whether later operations restore the old identity or create a new one.
_Avoid_: Deleted Node, Trash item, orphan Node

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
An identity-bearing relation Node owned beneath the host Node's Metanode. Its ordered definition endpoint is a Reference to one Supertag Definition, while the typed application relation states that the host is an instance of that definition. A host can own multiple independently ordered Supertag Applications; removal makes the relation a Detached Relation rather than placing it in Trash, and reapplication creates a new relation identity.
_Avoid_: supertagId array, assigned supertag flag, anonymous relation

**Supertag Instances Query**:
A bounded read of Nodes whose Supertag Applications match one Supertag Definition directly or through Supertag Extension. It reads derived membership and is not a persistent Search Node or query definition.
_Avoid_: Supertag Search, Search Node, saved query

**Search Node**:
A Node of type Search whose Configuration Graph owns one Search Expression. Search identity, expression, Proposal, History, and Trash lifecycle are persistent domain state, while matching results are evaluated from the selected Projection perspective and remain derived reads.
_Avoid_: Saved result list, query blob, Supertag Instances Query

**Search Expression**:
An identity-bearing recursive expression tree owned beneath a Search Node's Metanode. Ordered `and`/`or` operands, negation, Supertag, text, Field presence and typed value, Date comparison, scope, and reference predicates define the persistent query; updates preserve reusable expression identities, while evaluation produces derived Search Result References.
_Avoid_: Search Clause, Query JSON, filter callback, anonymous predicate

**Search Result Reference**:
A perspective-specific derived row that points from one Search Node to one matching target Node. It has a deterministic row identity for pagination and rendering, but it is not a Fact, an Occurrence, an Owner edge, or stored authority.
_Avoid_: Result Node, generated child, cached membership

**Supertag Extension**:
A persistent subtype relation through which one Supertag Definition inherits another Supertag Definition's template and participates in its searches. Multiple bases are explicit; provenance is preserved, and cyclic or incompatible inherited semantics are exposed as conflicts instead of being silently ordered.
_Avoid_: Copied supertag, implicit multi-supertag

**Field Definition**:
A Node of type Field Definition that names and configures a “has a” attribute. It exists before any use, and multiple Supertag Definitions and ordinary Nodes can reuse the same identity.
_Avoid_: Field key, property name

**Field Optionality**:
An identity-bearing configuration relation Node directly owned and ordered beneath a Field Definition whose protected value endpoint states Yes or No. Tana presents No as `Required`; changing that toggle updates the same Definition-owned relation rather than a Template Field relation.
_Avoid_: Template Field Required, required flag

**Field Datatype**:
An identity-bearing configuration relation Node directly owned and ordered beneath a Field Definition. Its definition endpoint is the built-in Datatype Field Definition and its value endpoint is a protected System Definition Node, initially Plain or Options. Endpoint identity is the semantic value; changing it does not replace the relation, Field Definition, Field Nodes, or existing Field Values.
_Avoid_: Field Node Type, value conversion job, scalar schema column

**Date Value**:
A Field Value that expresses a point or range in time with explicit granularity. Its comparison and Search semantics come from time rather than rendered text; it does not imply a Calendar View or Calendar Node.
_Avoid_: Date string, Calendar item, Day Node

**Date Field**:
A Field Definition whose Datatype accepts Date Values for structured entry, validation, Search, sorting, and grouping. Date Field is ordinary Field authority and remains independent of any View Type or Workspace calendar hierarchy.
_Avoid_: Calendar Field, Daily Note Field, Calendar View

**Field Cardinality**:
An identity-bearing configuration relation Node directly owned and ordered beneath a Field Definition. Its definition endpoint is the built-in Cardinality Field Definition and its value endpoint is a protected System Definition Node declaring Single or List presentation and validation semantics. Changing the endpoint never replaces the relation or truncates stored Field Value Nodes; policies for excess values remain separate domain rules.
_Avoid_: Array flag, destructive migration, value count

**Field Initialization Expression**:
An identity-bearing `findFieldValues` expression Node used as the value endpoint of an Initialize expression relation directly owned beneath a Field Definition. Its ordered operands are a Reference to the same Field Definition followed by an expression-owned `ABOVE` context Node. It is evaluated once when a new Supertag Application makes that Field effective, produces ordinary instance-owned Field Values, and does not recompute when the ancestor later changes.
_Avoid_: Template Field initializer, live formula, metadata callback

**Field**:
A Node of type Field that is placed beneath an owner and bound to one Field Definition. A Field owns ordered value Occurrences and represents authored content such as a Materialized Field; Template Field and Optional Field Contribution are distinct Supertag Definition relations, not Field Nodes. An unmaterialized placeholder is Projection state, not a Field Node.
_Avoid_: Field occurrence, tuple object, scalar property, placeholder Node

**Trash**:
A persistent Node assigned the Workspace's Trash System Role. A Node is in Trash exactly when its Owner path reaches this Node: deletion moves the same Original and Owner of the selected root beneath Trash, owned descendants follow through the existing Owner tree, and surviving References keep pointing to the same Node. Restoration reverses that structural placement using the deletion Fact as evidence; there is no separate Node status or deleted-Node partition.
_Avoid_: Node Tombstone, Deleted-Node store, Hard Delete queue, Trash Node Type

**Workspace System Role**:
A Workspace-scoped canonical relation assigning a built-in structural purpose, such as Trash or System Definition Catalog, to one Node. The relation drives discovery and protects the target's entire Owner subtree; title, Intrinsic Node Type, stable identity, or caller-editable metadata alone never establishes the role.
_Avoid_: System Node Type, system-role metadata, reserved title

**System Definition Catalog**:
A protected hidden Owner subtree assigned the Workspace's System Definition Catalog role. It has ordinary Node identities but no ordinary Outline Occurrences. Its stable Definition Nodes are reusable endpoints for built-in typed relations, initially Field configuration definitions, Datatypes, and Cardinalities, so configuration authority remains inside the Node graph instead of becoming an enum column or raw property map. Lode owns the catalog's Workspace lifecycle without claiming that its IDs or ownership root duplicate Tana's private storage.
_Avoid_: Enum registry, metadata schema, global magic IDs, System Node Type

**System Field Definition**:
A built-in Field Definition whose identity, value shape, and policy are owned by Lode. It lets Nodes carry typed configuration and relations through the ordinary Field and Node graph without exposing an untyped metadata key or a parallel configuration store.
_Avoid_: Metadata key, magic property, configuration column

**Calculated System Field**:
A read-only Field value derived for a Node from current semantic state under a System Field Definition. It is Projection state rather than authored Field content and does not require a persistent Field Node merely because clients can display or query it.
_Avoid_: Stored metadata, generated child, cached authority

**Configuration Graph**:
A Node, Field, and Reference subgraph whose typed relations carry structured capability. Host-scoped capabilities such as Search expressions and View Definitions live beneath the host's Metanode, while Definition-owned configuration such as Datatype, Cardinality, and Initialize expression is ordered directly beneath its Field Definition. The graph is hidden only where its owning relation is hidden; Metanode is not a universal container for every configuration relation.
_Avoid_: Metadata blob, opaque JSON configuration, parallel document

**Tuple**:
An internal identity-bearing relation container Node whose Owner, when attached, is independent of its ordered endpoint Occurrences. A typed relation lifecycle may retain the Tuple as a Detached Relation without an Owner. Endpoint ownership and arity belong to the typed relation family: a Tuple may have zero or many endpoints, and any endpoint may be owning or non-owning according to the target Node's Owner. Tuple is an Engine substrate, not a public generic write API.
_Avoid_: Binary relation, anonymous tuple object, universal Field shape

**Metanode**:
The single persistent Node attached to a host by the canonical `metanode-attach` relation. Its Owner is the host, but it has no Outline Occurrence and does not appear in the host's ordered child Occurrences. Configuration descendants use ordinary Node, Field, Reference, Occurrence, Owner, Trash, Proposal, and History semantics beneath the Metanode. It cannot be deleted independently and follows the host through the Owner lifecycle. Metanode is a structural role established by the attachment, not an Intrinsic Node Type or an intrinsic property bag.
_Avoid_: Hidden child Occurrence, metadata object, deterministic Metanode lookup

**Debug node**:
A Tana-aligned diagnostic operation and read model for one existing Node. Opening it ensures that the target has its persistent Metanode; reading it returns the selected Projection's Node, Owner, Metanode, child Occurrences, materialized Fields, URL, and Code language without creating a persistent Debug Node or a second diagnostic authority.
_Avoid_: Debug Node, mutating query, debug JSON property bag

**URL Node**:
A Node whose URL capability is carried by a Materialized Field using the protected URL System Definition and one owned text Value Node. Direct creation establishes a new Node identity and the typed URL relation atomically. Automatic plain-text-to-URL replacement is a separate lifecycle operation and is not implied by this Node Type.
_Avoid_: URL Intrinsic Node Type, raw URL property, identity-preserving auto-conversion

**Code Node**:
A Node whose Code capability is carried by a Materialized Field using the protected Code block language System Definition and one owned language Value Node. Configuring Code preserves the host Node identity and remains independent of CRDT text editing and syntax highlighting.
_Avoid_: Code Intrinsic Node Type, language enum column, code text replacement

**Hard Delete**:
An independently gated maintenance operation that permanently prevents a Node already placed in Trash from re-entering Projection. Its preview includes bounded Reference, Supertag, Field, Proposal, and History impacts. Every known Replica must causally acknowledge the deletion or be explicitly retired, and pending Proposals, unknown Invocation outcomes, or owned descendants block execution; root-only purge never leaves an Owner subtree orphaned.
_Avoid_: Delete mutation, garbage collection, best-effort purge

**Effective Field**:
A Field made available to a Node by at least one normal or pinned Template Field reached through its Supertag Applications and Supertag Extensions, whether or not the Node has stored local content yet. Sources merge by Field Definition identity while retaining each Template Field and Application or Extension provenance; pinned outranks normal presentation without becoming Definition-global configuration.
_Avoid_: Managed child, generated field

**Materialized Field**:
A persistent binding of one owner Node and one Field Definition to a stable Field Node and Field Occurrence because it has a default, initialization result, explicitly authored empty state, authored value, or other local content. It can materialize from an Effective Field or by explicitly selecting an Optional Field Suggestion; default-generated and authored Materialized Fields remain owned by the instance when their final Supertag source disappears.
_Avoid_: Field placeholder, scalar property

**Field Value**:
An ordered Node or Reference occurrence owned by a Materialized Field. A Field can contain multiple Field Values; Field type and cardinality guide presentation and validation without turning values into scalars or deleting extra Nodes.
_Avoid_: JSON value, scalar value

**Field Content Deletion**:
An instance action that either removes one selected Field Value occurrence or clears the whole Materialized Field occurrence. It retains the underlying Field and Value Node identities and content; clearing the Field reveals its Effective placeholder while a Supertag source remains, and History restoration recovers the stored subtree without discarding concurrent authored values.
_Avoid_: Node deletion, scalar clear, cascading content loss

**View Definition**:
A persistent ordinary Node owned by a typed View attachment relation beneath a host's Metanode. It names one child-projection configuration without changing the host's Intrinsic Node Type, owning the projected children, or persisting a result set.
_Avoid_: View Node Type, saved result set, renderer state, view blob

**Shared Default View**:
The Workspace-shared typed attachment represented by an identity-bearing relation Node beneath the host's Metanode. The attachment owns the selected View Definition through an ordered Occurrence, while View Type remains configuration of that View Definition. Removing it replaces the selected View endpoint with an attachment-owned blank and moves both the attachment and View Definition to Trash; reapplication creates new identities. A host has at most one effective Shared Default View, and this authority remains separate from any future personal presentation choice.
_Avoid_: Shared View, current renderer, personal View

**View Type**:
The projection mode selected by a View Definition, initially Outline or Table. View Type is independent of the identity-bearing option graph and does not determine child authority or ordering.
_Avoid_: View Definition, layout blob, Projection Perspective

**Calendar View**:
A future View Type that projects a host's existing child source by selected Date Fields. It owns presentation configuration, not Date Values, child Nodes, or Workspace time hierarchy, and it is outside the current MVP.
_Avoid_: Calendar Node, Daily Notes, date authority

**Calendar Node**:
A future Workspace time-identity Node representing a day, week, month, or year and hosting time-based outline content. It is distinct from Date Values and Calendar View and is outside the current MVP.
_Avoid_: Calendar View, Date Value, Today renderer

**View Sort by Node Name**:
The first bounded View option: a View Definition-owned Sort order Field whose single owned value is a nested Sort field Field with ordered Node name and ASC System Definition endpoints. Applying it also records the current case-folded, text-ordered child sequence through ordinary Occurrence moves; the option graph never owns rows or hides reorder authority inside the View Projection.
_Avoid_: Sort enum, comparator blob, derived-only child order

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
An identity-bearing Field relation occupying an ordered place in a Supertag Template and carrying configuration specific to that direct use. `Add new field` creates it with an owned Field Definition; making that definition discoverable moves the same definition to Schema while the Template Field keeps a non-owning endpoint. `Insert existing field` in the template reuses a discoverable Field Definition but creates a new Template Field identity and default slot. Removing the use moves that relation and its owned slot to Trash without deleting the Field Definition; adding the definition again does not revive the removed relation.
_Avoid_: Supertag Field Contribution, Field Template Item, anonymous field entry, Template Field Node

**Pinned Template Field**:
A Template Field marked as a primary dimension of one Supertag Definition, so instances and View controls present it prominently. Pinned is configuration of that Template Field use, not global configuration of the shared Field Definition.
_Avoid_: Pinned Field Definition, required Field, global Field priority

**Static Default**:
The stable text slot owned by one Template Field use. Setting, modifying, or clearing it preserves the slot identity. A non-empty current value is copied into an instance-owned Materialized Field when a new Supertag Application first makes the Field effective; later changes never overwrite that copy, while an empty slot leaves only an Effective placeholder. Concurrent edits preserve CRDT text authorship, and conflicting incomparable defaults from different sources pause materialization and remain visible with provenance.
_Avoid_: Live default, fallback scalar

**Optional Field Contribution**:
A Supertag Definition relationship that offers an existing Field Definition to instances without placing a direct Template Field in the Supertag Template or creating an Effective Field. It is authored through the Optional fields section's existing-field branch and materializes only when an instance explicitly supplies content.
_Avoid_: Hidden field, optional placeholder

**Optional Field Suggestion**:
A derived Add fields choice produced when an instance reaches one or more Optional Field Contributions for a Field Definition, has no normal or pinned Template Field source for that Definition, and has not already materialized it. The suggestion preserves every contribution and Application or Extension provenance but has no persistent Field identity of its own.
_Avoid_: Optional Effective Field, generated Field, persisted suggestion

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
