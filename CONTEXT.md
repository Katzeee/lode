# Lode Knowledge Model

Lode is a local-first knowledge outliner whose persistent meaning is expressed through Nodes, Supertags, Fields, references, and proposals. This language names the product concepts independently of storage, projection, and transport mechanisms.

The formal app transport authenticates every command, query, event stream, and replica sync exchange with an explicit access credential. Local socket ownership can restrict reachability, but it is not a substitute for protocol authentication.

## Language

**Engine**:
Lode's headless, embeddable application core, which owns domain commands and queries, Workspace state, persistence coordination, Replica Exchange semantics, and the runtime of an accepted Peer Transport. An Engine does not choose listening addresses or own Client Session transport, process lifetime, or client access authentication.
_Avoid_: Engine Runtime, server, daemon

**Engine Host**:
A component that constructs, starts, and stops an Engine instance, supplies platform resources, and makes the Engine API available through a platform adapter after startup succeeds. An Engine Host decides process and platform integration without redefining Engine semantics.
_Avoid_: Engine Runtime, application core

**Daemon**:
The desktop Engine Host, which exposes Engine capabilities through authenticated Client Sessions and supplies the desktop Peer Transport adapter. The Daemon owns its Client Session listener and connections, platform addresses, and process shutdown; the Engine owns the accepted Peer Transport runtime, Workspaces, and domain authority.
_Avoid_: Engine server, desktop Engine

**Client Session**:
One client's connection to an Engine Host. A Client Session may access several Workspaces and may share each Workspace with other Client Sessions; closing it ends that client's connection without owning or closing any Workspace.
_Avoid_: Workspace Session, Hosted Workspace, Workspace Host

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
One independently evolving copy of a Workspace's Loro Fact document. Its Replica identity is the document's Loro Peer ID, so one causal identity advances the CRDT and identifies the Facts it inserts. A Replica is not a Projection cache or a client connection.
_Avoid_: Peer connection, synchronized view

**Replica Exchange**:
The Engine capability through which two Workspace Replicas compare versions and exchange authoritative data. It uses physical communication owned by the Engine's accepted Peer Transport without treating a connection as authority; endpoint selection, explicit synchronization scheduling, and exchange retry remain caller or Engine Host decisions.
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
The generation-bound semantic state derived from effective Facts, composed from the Node Graph and the current Supertag, Field, and conflict relations. Rebuildable lookup indexes and individual query results are not part of the Workspace Projection.
_Avoid_: Projection index, query response, storage snapshot

**Authored Intent**:
A durable domain choice whose loss could change a current or future merged Workspace Projection, Review decision, or conflict. It records what was chosen, not the graph patches, previous state, support closure, or indexes used to realize that choice.
_Avoid_: Mutation evidence, Projection patch, command DTO

**Authored Action**:
One typed, indivisible expression of Authored Intent inside an Action Fact. Several Authored Actions may form one atomic Fact, while Nodes, Occurrences, relation endpoints, support, and conflicts that follow deterministically from them remain Projection. Proposal eligibility and terminal status constrain Action Fact structure; History Compensation and Action Support are derived interpretations rather than additional Action categories.
_Avoid_: Mutation, graph operation, Projection patch

**Proposable Action**:
An Authored Action that may be recorded with Proposal intent and interpreted in Review before it affects Origin. Direct-only system and terminal actions are not Proposable Actions.
_Avoid_: Any Authored Action, reviewable mutation

**History Compensation**:
An Action batch derived by comparing the current Projection with the counterfactual Projection that excludes selected History target Facts. A target may contribute no individual inverse when its attributable effect is carried by other actions in the same Fact.
_Avoid_: Compensable Action, stored inverse, Undo command

**Action Support**:
The derived set of other Fact Actions whose activation is required for one Authored Action to participate in Projection. Every Authored Action has an Action Support set, which is empty when it needs no such authority.
_Avoid_: Support-Dependent Action, Dependent Fact, validation prerequisite

**Terminal Action**:
A direct-only Authored Action whose durable effect permanently prevents explicitly named authority from contributing to later Projection. It remains on the ordinary Action Fact, identity, relation, activation, and replay path rather than creating a separate maintenance channel.
_Avoid_: Maintenance action, purge marker, special Fact body

**Projection Perspective**:
The choice between accepted authority (`origin`) and accepted authority plus pending Proposals (`review`) when deriving or reading a Workspace Projection. It is not a View Definition or a presentation mode.
_Avoid_: View Mode, View, renderer state

**Workspace**:
The Node of type Workspace that forms one ownership, authorization, and replication boundary. Workspace genesis atomically creates the Node and its Workspace-scoped role targets and assignments; the Engine-owned system manifest supplies built-in System Definition Nodes to the assigned Catalog. Root policy only fixes the Workspace Owner to `null` and prevents deletion. Top-level outline Occurrences are children of the Workspace Node itself; there is no separate Workspace Root entity, root Occurrence, root children list, or Workspace-specific placement path.
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
An immutable record of one domain transaction stored as one element of the authoritative Loro Fact list and committed by one Loro Change. Its value is an Action Fact, a Resolution, or a Governance decision; its transaction identity and causal metadata come from the enclosing Change. Structurally invalid records are protocol or code failures, while Transaction Activation deterministically handles every structurally valid concurrent record.
_Avoid_: Mutation row, graph patch, duplicated causal envelope, projected Node

**Action Fact**:
A Fact containing one non-empty atomic batch of Authored Actions from a compatible lifecycle family. Ordinary actions may carry Direct or Proposal intent, while bootstrap and terminal batches are Direct only; the body never mixes terminal actions with ordinary actions.
_Avoid_: Edit Fact, Maintenance Fact, command DTO

**Fact Replication**:
The unconditional exchange and merge of the authoritative Loro Fact document between configured Replicas. Loro owns transaction identity, causal versions, Change atomicity, deltas, snapshots, duplicate delivery, and authority convergence. Transaction Activation and domain projection decide Node, Owner, Supertag, Field, Proposal, Review, and deletion semantics after merge.
_Avoid_: Custom append-only protocol, domain validation gate, Projection replication

**Supertag Definition**:
A Node of type Supertag Definition that defines an “is a” classification whose template contributes Fields and content to Nodes that apply it. “Supertag” is the concise product-facing name for this definition when the distinction from its applications is already clear.
_Avoid_: Class, tag, Supertag Node

**Supertag Application**:
An identity-bearing relation Node owned beneath the host Node's Metanode. Its ordered definition endpoint is a Reference to one Supertag Definition. Removal makes the relation a Detached Relation rather than placing it in Trash, and every reapplication creates a new relation identity; concurrent Applications can support one Supertag Membership without being identity-merged.
_Avoid_: supertagId array, assigned supertag flag, anonymous relation

**Supertag Membership**:
The derived statement that one host Node currently applies one Supertag Definition, supported by one or more active Supertag Applications for that `(host, definition)` pair. Removing the membership deactivates only the Applications observed by that removal, so a concurrent unobserved Application remains support without creating a second displayed membership.
_Avoid_: Supertag Application, stored tag flag, add-wins set

**Supertag Instances Query**:
A bounded read of Nodes whose Supertag Applications match one Supertag Definition directly or through Supertag Extension. It reads derived membership and is not a persistent Search Node or query definition.
_Avoid_: Supertag Search, Search Node, saved query

**Search Node**:
A Node of type Search whose Configuration Graph owns one Search Expression. Search identity, expression, Proposal, History, and Trash lifecycle are persistent domain state, while matching results are evaluated from the selected Projection perspective and remain derived reads.
_Avoid_: Saved result list, query blob, Supertag Instances Query

**Search Expression**:
An identity-bearing recursive expression tree owned beneath a Search Node's Metanode or a View Filter. Each expression receives its identity from the Authored Action that adds it, so configuration, movement, removal, and restoration preserve the same semantic target without persisting the derived graph. Ordered `and`/`or` operands, negation, Supertag, text, Field presence and typed value, Date comparison, scope, and reference predicates define the persistent query, while evaluation produces derived Search Result References.
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
A protected hidden Owner subtree assigned the Workspace's System Definition Catalog role. Its role root belongs to Workspace authority, while its built-in Definition Nodes come from the Engine's versioned system manifest and use permanent registered identities. Adding a built-in extends the manifest and rebuilds Projection without migration Facts; an incompatible meaning receives a new identity, while old identities remain resolvable. These Nodes are reusable endpoints for typed relations and have no ordinary Outline Occurrences.
_Avoid_: Enum registry, metadata schema, global magic IDs, System Node Type

**System Field Definition**:
A built-in Field Definition whose permanent identity, value shape, and policy are owned by the Engine system manifest. It lets Nodes carry typed configuration and relations through the ordinary Field and Node graph without exposing an untyped metadata key or a parallel configuration store.
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
The deterministic hidden Node that owns host-scoped relation Tuples. Projection derives it when the current graph needs that container; authority does not store a Metanode identity or attachment action. Its Owner is the host, but it has no Outline Occurrence and does not appear in the host's ordered child Occurrences. It cannot be deleted independently and follows the host through the Owner lifecycle.
_Avoid_: Authored attachment, hidden child Occurrence, metadata object

**Debug node**:
A Tana-aligned read model for one existing Node. It returns the selected Projection's Node, Owner, derived Metanode when present, child Occurrences, materialized Fields, URL, and Code language without changing authority or Projection state.
_Avoid_: Debug Node, mutating query, debug JSON property bag

**URL Node**:
A Node whose URL capability is carried by a Materialized Field using the protected URL System Definition and one owned text Value Node. Direct creation establishes a new Node identity and the typed URL relation atomically. Automatic plain-text-to-URL replacement is a separate lifecycle operation and is not implied by this Node Type.
_Avoid_: URL Intrinsic Node Type, raw URL property, identity-preserving auto-conversion

**Code Node**:
A Node whose Code capability is carried by a Materialized Field using the protected Code block language System Definition and one owned language Value Node. Configuring Code preserves the host Node identity and remains independent of CRDT text editing and syntax highlighting.
_Avoid_: Code Intrinsic Node Type, language enum column, code text replacement

**Deletion Finalization**:
An irreversible transition that permanently prevents explicitly targeted Nodes and the contributions they own from participating in Projection while retaining every authoritative Fact. Planning accepts current Trash roots, expands their owned descendants into an explicit atomic Terminal Action batch, and never turns unrelated later Trash contents or incoming references owned by surviving Nodes into finalization targets.
_Avoid_: Hard Delete, purge, physical erasure, garbage collection

**Contribution Owner**:
A Node whose finalization prevents one Authored Action's contribution from participating in Projection. An Action may have zero or several Contribution Owners, and a referenced target is not an owner merely because the Action names it.
_Avoid_: Referenced Node, affected Node, deletion target

**Effective Field**:
A Field made available to a Node by at least one normal or pinned Template Field reached through its Supertag Applications and Supertag Extensions, whether or not the Node has stored local content yet. Sources merge by Field Definition identity while retaining each Template Field and Application or Extension provenance; pinned outranks normal presentation without becoming Definition-global configuration.
_Avoid_: Managed child, generated field

**Materialized Field**:
A persistent binding of one owner Node and one Field Definition to a stable Field Node and Field Occurrence because it has a default, initialization result, explicitly authored empty state, authored value, or other local content. Materialization records its cause and frozen ordinary value identities/content in the triggering domain transaction; rebuild never reruns the historical default or initializer. It can materialize from an Effective Field or by explicitly selecting an Optional Field Suggestion, and remains owned by the instance when its final Supertag source disappears.
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
The Workspace-shared typed attachment whose semantic identity comes from the Authored Action that adds it. Projection represents it as a relation Node beneath the host's Metanode and an owned View Definition, while columns, Filter, Sort, Group, and View Type remain independently authored configuration of that identity. Removing it replaces the selected View endpoint with an attachment-owned blank and moves both the attachment and View Definition to Trash; History restores the same identity, while explicit reapplication creates a new one. A host has at most one effective Shared Default View, and this authority remains separate from any future personal presentation choice.
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
An identity-bearing Field relation occupying an ordered place in a Supertag Template and carrying configuration specific to that direct use. Its identity comes from the Authored Action that adds it, while Projection derives its relation Node, Occurrences, endpoint, and Static Default slot. `Add new field` creates it with an owned Field Definition; making that definition discoverable moves the same definition to Schema while the Template Field keeps a non-owning endpoint. `Insert existing field` reuses a discoverable Field Definition but creates a new Template Field identity. Removing the currently observed uses of one `(Supertag, Field Definition)` pair preserves their recoverable identities; History restores the removed identity, while an explicit add creates a new one.
_Avoid_: Supertag Field Contribution, Field Template Item, anonymous field entry, Template Field Node

**Pinned Template Field**:
A Template Field marked as a primary dimension of one Supertag Definition, so instances and View controls present it prominently. Pinned is configuration of that Template Field use, not global configuration of the shared Field Definition.
_Avoid_: Pinned Field Definition, required Field, global Field priority

**Static Default**:
The stable text value configured on one Template Field use. Setting, modifying, or clearing it preserves the Template Field identity. A non-empty current value is copied into an instance-owned Materialized Field when a new Supertag Application first makes the Field effective; later changes never overwrite that copy, while an empty value leaves only an Effective placeholder. Concurrent incomparable values remain visible as candidates, and conflicting defaults from different sources pause materialization with their provenance intact.
_Avoid_: Live default, fallback scalar

**Optional Field Contribution**:
An identity-bearing Supertag Definition relationship that offers an existing Field Definition to instances without placing a direct Template Field in the Supertag Template or creating an Effective Field. Each add contributes independent provenance; removal deactivates the contributions for the `(Supertag, Field Definition)` pair that the author observes, and History re-adds the contribution because it owns no separate configuration. It materializes only when an instance explicitly supplies content.
_Avoid_: Hidden field, optional placeholder

**Optional Field Suggestion**:
A derived Add fields choice produced when an instance reaches one or more Optional Field Contributions for a Field Definition, has no normal or pinned Template Field source for that Definition, and has not already materialized it. The suggestion preserves every contribution and Application or Extension provenance but has no persistent Field identity of its own.
_Avoid_: Optional Effective Field, generated Field, persisted suggestion

**Detached Template Content**:
An instance-owned Node snapshot of ordinary Template content, frozen as ordinary Node, placement, and content authority in the transaction that first touches it. Detachment does not bind a historical projector or preserve a Projection snapshot blob, and later definition or rules changes no longer rewrite it.
_Avoid_: Stale managed child

**Placement Conflict**:
Concurrent moves that give one Occurrence different parent Nodes. Projection keeps one deterministic temporary placement while exposing every candidate parent Node, sequence anchor, author, Replica, and observed frontier until a later move observes the candidates and chooses the placement.
_Avoid_: Duplicate owner, winning move

**Proposal**:
A contribution that appears in Review without changing Origin until it is accepted. Rejection removes its participation without deleting its recorded intent.

**Transaction Activation**:
The deterministic derivation that decides which authored transactions participate in Origin or Review from their Direct or Proposal intent, Resolutions, causal identity dependencies, and conflicts. It does not modify authority or materialize the Node Graph.
_Avoid_: Fact admission, Interpreter repair, materialization

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
