# Document titles and addressing

[中文](DOCUMENT-ADDRESSING.zh-CN.md)

Related issue: [Improve hPath by separating display text from document addressing](https://github.com/siyuan-note/siyuan/issues/19938)

This design draft defines the responsibilities of document titles, hierarchy resolution, and readable paths, together with compatibility requirements for enabling new title capabilities. The target behavior is not fully implemented. See [Document rename and path indexes](DOCUMENT-HPATH.md) (Chinese) for the current rename and index update mechanism.

## Goals and scope

Document IDs determine identity and hierarchy membership; titles express content; readable paths provide presentation. Creation, moves, and references must not recover document identity by parsing display text. Once the affected entry points have migrated and compatibility has been verified, document titles can contain the ASCII slash `/` while remaining distinct from existing fullwidth slashes `／`.

Future support for inline elements in document titles is a required extension capability of this design. Addressing, title presentation, plain-text extraction, and storage representation must remain separate. The design must not permanently constrain titles to a single plain-text string interpreted directly by every consumer. A complete rich title format, editing interactions, and the supported element set are outside the current scope.

The design covers desktop, browser, mobile, kernel APIs, and plugin-visible data, subject to the respective access boundaries of ordinary and encrypted notebooks. Notebook names participate in path presentation as separate display fields. Their character restrictions and rich text support require a separate assessment of configuration formats and older clients; document title rules do not automatically apply to notebook names.

## Titles, identity, and paths

### Current data sources

The document root's IAL `title` currently stores the title, while `.sy` files and directories use IDs as names. `tree.HPath`, `blocks.hpath`, and `blocktrees.hpath` are derived from document and ancestor titles. Title writes still pass through `normalizeDocTitle`, which removes ASCII slashes. Changing only the UI input restriction is insufficient to support this character.

Some current consumers use `hPath` to locate or create documents by name, calculate depth, or extract a title. Each use needs migration; renaming `hPath` as a display field is insufficient. Reversible encoding can resolve delimiter ambiguity in a particular string protocol, but still requires format versions and compatibility rules. This design reduces internal dependence on that protocol by separating responsibilities.

### Target model

The names below describe concepts rather than prescribe new API or storage field names.

| Concept | Content and purpose | Constraint |
| --- | --- | --- |
| Document identity | Notebook ID and document ID | Validate access against actual ownership; titles cannot substitute for identity |
| Parent document identity | Target notebook and parent document ID, or an explicit notebook root location | Validate that the parent still exists and belongs to the target notebook when creating or moving |
| ID data path | Directory path and `.sy` filename composed of IDs | Supports storage and subtree queries; moves can change it, so it is not a permanent identity |
| Title source | Currently IAL `title`; extensible to versioned inline content | Each format must define its authoritative source and read rules |
| Plain-text title | Ordinary text extracted from the title source | Used for text search, sorting, and compatibility output; contains neither HTML nor search highlight markers |
| Structured ancestor chain | Document IDs and corresponding title information in hierarchy order | Preserves segment boundaries; keeps notebook names separate; never reconstructed from display strings |
| Title segment array | Input for matching or creating documents level by level from an explicit location | Removes delimiter ambiguity, but does not make names unique |
| Readable path | Presentation for breadcrumbs, tooltips, or copied paths | May have different display forms; does not provide addressing or source recovery |
| Legacy path protocol | Existing `hPath`, `hpath`, and related fields used by APIs and plugins | Maintained through compatibility adapters; field semantics cannot be replaced in place |
| Export relative path | File location assigned to a document by an export operation | Determined by an export mapping, separately from titles and UI paths |

The current frontend search configuration's `idPath` is an array of search scope strings. Each entry can contain a notebook ID and a document ID path; it is not an array of successive IDs for one path. Migration must preserve the interpretation of existing configurations. Similarly, blocktree `parent_id` identifies a block node's parent and cannot be reused directly as a document's parent document ID.

The following structures can both display as `/A/B`, but must retain different document identities and ancestor chains:

| Title segments | Document structure |
| --- | --- |
| `["A/B"]` | One document titled `A/B` at the notebook root |
| `["A", "B"]` | A document titled `A` with a child document titled `B` |

Breadcrumbs should present boundaries using the structured hierarchy. A copied plain-text path is for reading; links and references used for navigation must carry IDs. Documents with the same title under the same parent are allowed, and matching title segments must not merge their identities.

## Extension requirements for inline titles

Title access must expose clear boundaries for source content, plain-text extraction, and presentation. The current implementation can continue storing ordinary strings, but addressing, depth calculations, creation target resolution, and filename allocation must not depend on the specific IAL string representation or pass title content to filesystem path normalization functions.

Future support for bold, italic, inline code, and other elements should reuse existing inline content models, parsers, and renderers, with an explicit format discriminator or version for document titles. Existing titles containing `**text**`, backticks, or link syntax remain literal content; upgrading must not automatically reinterpret them as rich text. A separate rich title design will select inline Markdown, a node structure, or another representation.

The new format must specify one authoritative title source. A plain-text title retained for compatibility is derived from that source; both must be saved and recovered consistently rather than becoming two writable sources that overwrite each other. Legacy APIs must not write the plain-text projection back over a rich title and silently discard formatting. Writes that do not support the title format must be rejected; body edits must also preserve the title source or explicitly refuse to save.

Plain-text extraction for rich titles needs rules for whitespace, line breaks, inline math, link text, empty titles, and length limits. Two titles differing only in style can produce the same plain text; IDs still distinguish identity and references. Search, sorting, and export filenames must not treat Markdown markup or rendered HTML as title text. Titles within exported content can preserve inline elements supported by the destination format.

Block references, dynamic anchor text, links, tags, and assets need additional rules for dependency updates, click behavior, reference and asset ownership, cycles, ID remapping during copying and import, and encryption boundaries. This design preserves representation space for those capabilities without committing to enabling every inline element at once. The later rich title implementation must also cover input methods, selection, undo, mobile interaction, history, sync, and export.

Acceptance of this decoupling must establish that adding a title representation does not change addressing or hierarchy rules, that existing ordinary titles retain their literal content, and that consumers obtain titles through the defined access boundary instead of guessing title syntax independently.

## Creation and path templates

### Creation by identity

When the parent document is known, a creation request should express the target notebook, parent document ID or root location, title, and body. Immediately before writing, the kernel resolves the data path from current identity and revalidates ownership, writability, parent validity, and the encrypted-notebook operation lease. A cross-notebook move can change ownership; a stale notebook parameter must fail rather than trigger a fallback lookup in another notebook.

Renames, moves, deletion, or sync changes between a creation preview or template document-tree plan and its application must be detected using a version value or equivalent snapshot covering changes relevant to the plan. The operation must request a new preview or reject application. An unchanged document ID alone does not establish that the plan is still valid.

Ordinary creation, daily note reuse, and appending to an existing document are different operations. Callers must express whether a target may be reused instead of implicitly selecting a write target through a title search. Migration must retain template application, attribute writes, sorting, notifications, and synchronous persistence requirements. For example, shorthand workflows that remove source data after success must first confirm that the destination was written successfully.

### Resolution by title segments

Creating a hierarchy by name requires an explicit starting location and a title segment array. Use known ancestor identities directly; resolve unknown ancestors one level at a time under the current parent. Create an absent match according to the operation's rules. Multiple matches produce an ambiguity error and candidate identities within the authorized scope, never an arbitrary first match. Whether an ordinary creation's final segment permits a duplicate title is defined separately from reuse of an existing document.

A `/` within a structured title segment no longer creates another level. Text such as `.` and `..` cannot act as navigation; a value disallowed by title validation produces a title error. Moving up a level, starting from the notebook root, and anchoring at the current document require separate representations. Empty segment arrays, empty titles, and omitted titles must also remain distinct rather than being inferred from trailing slashes or UI placeholders.

Multi-level creation must define failure and retry behavior. Validate predictable input errors and ambiguity before writing. If writing fails partway through, preserve documents already created, return the creation results that can be confirmed, and let callers recover from them. A retry must neither overwrite a same-named document nor treat a lost success response as a reason to create another document. Define operation identifiers and retry semantics with the API contract; do not claim unimplemented atomicity across files.

### Template versions

Legacy string save paths retain their current interpretation, including absolute and relative paths, `..`, trailing `/`, empty templates, cross-notebook context, and an explicit name replacing the final segment. New syntax must have an identifiable version and must not automatically reinterpret existing configurations.

New templates should determine the starting location, navigation operations, ancestor segments, and final title boundaries before rendering, then evaluate each title segment separately. A variable whose value is `A/B` remains one title segment. Rendering a single string and subsequently calling `split("/")` cannot satisfy this requirement. All segments in one creation use the same context and time snapshot to avoid date or context changes between evaluations.

Daily notes, document creation from block references, shorthands, new database items, and template document trees must share the same target resolution conventions while retaining their own reuse and commit rules. Both desktop and mobile entry points require verification; migrating shared utilities alone does not establish compatibility across all interfaces.

## Search and derived indexes

Structured ancestor chains provide a common data source. UI presentation, legacy protocol output, plain-text search, and export each apply conversions appropriate to their purpose. The shared boundary is the source of titles and hierarchy, not a requirement for every consumer to use one serialized string.

Document depth, parent-child relationships, and subtree scope derive from ID data paths or explicit document relationships. Consumers must not derive structure by counting slashes in `hPath`, using `path.Base(hPath)` or `path.Clean(hPath)`, or slicing display strings by depth. Indexed document titles come from the title source; recovery reads must use the same data boundary.

Search scope filtering is separate from path text matching. Scope uses document identities or ID data paths. Text matching uses the plain-text title representation and ancestor text without replacing `/` with `／` or vice versa. Search highlight markers and HTML in results are presentation output; they cannot become title source content, and adding document titles to results must not overwrite existing match highlighting.

Initially, `blocks.hpath`, `blocktrees.hpath`, and the existing batch update mechanism can remain, avoiding a combined protocol migration and unverified storage optimization. Actual queries and performance measurements should determine whether to use document-level title metadata, add dedicated hierarchy fields, or assemble paths on demand. The design does not presume that each content block needs a copy of the full title segment array.

Renames still invalidate display paths, ancestor text search data, and related caches. Source saves, document metadata updates, background batch validation, and interruption recovery must remain ordered, and queued old trees must not restore stale titles or paths. ID-based addressing removes the effect of titles on identity; it does not eliminate every rename update task.

## Import and export

Export first assigns a unique relative file path to each document identity, then uses the same mapping to write files and generate inter-document links. The mapping must handle slashes in titles, invalid filename characters, duplicate names, case-insensitive collisions, length limits, and duplicate names across notebooks. Overwrite checks and link generation cannot independently choose filenames while processing individual items.

The title content `.`, `..`, and path separators may only participate in filename conversion and must not escape the export directory. Plain-text titles and rich titles supported by the destination format provide document content. Export filenames can undergo necessary conversion, but cannot become the sole source for restoring titles. Formats promising lossless reimport must preserve original title and corresponding identity metadata; ordinary Markdown filenames alone cannot provide that guarantee.

Import maps source file paths and source identifiers to new document IDs, and resolves links through that mapping rather than using `hPath` as a unique key. Duplicate source names, relative links, heading anchors, and ambiguous links follow explicit conflict rules. Existing source path mappings in importers such as Obsidian should remain in use; their title and readable-path generation can migrate independently.

## API and plugin compatibility

Record the compatibility meaning of legacy fields for each use case. Keeping a field typed as `string` does not establish compatibility. Add structured information through new fields or explicit protocol versions, preserving each legacy API's input, nullability, response variants, authorization, and operation lease contract.

| Use case | Migration constraint |
| --- | --- |
| Reading and operating on documents by ID | Preserve identity and authorization semantics; identify whether added title or hierarchy data is plain text |
| `getIDsByHPath` and legacy string creation inputs | Retain the legacy grammar; `/` inside a title must not be mistaken for legacy hierarchy and select the wrong document |
| Path outputs such as `getHPathByID` and `getFullHPathByID` | Record notebook-name inclusion, machine parsing expectations, and round-trip requirements with legacy resolution inputs |
| `Criterion.hPath`, `SearchPath`, and search results | Distinguish saved criteria, display paths, search scopes, and highlighted presentation content |
| Paths in databases, templates, asset relinking, and history diffs | Determine each field's purpose and migrate to an explicit identity or presentation representation |
| `blocks.hpath` and `blocktrees.hpath` in plugin SQL | Maintain plugin-visible semantics; do not directly change string columns into arrays or silently change hierarchy rules |

Compatibility entry points retain existing behavior for data representable by existing title rules. When data using new title capabilities cannot round-trip losslessly through a legacy path string, legacy addressing and write entry points must return an explicit unsupported or ambiguity error instead of guessing the target or silently replacing characters. A per-interface compatibility matrix must determine how legacy read results and SQL columns present such data before enabling the capability. Until those decisions are made, new title writes remain restricted.

Existing `／`, `%2F`, and similar title content are literal data. Do not infer whether a user once applied an encoding convention. If a particular external channel needs reversible encoding, it must define a version and a separate adapter boundary; that encoding must not become internal document identity or title source content.

Actual HTTP API additions and changes follow [Kernel API type contracts](API-CONTRACTS.md). Record behavior, defaults, limits, and compatibility in contract declarations, and synchronize the corresponding maintained Petal declarations and changelog. Generated types do not substitute for semantic compatibility review. Deprecating legacy fields requires an explicit replacement and transition policy; they cannot be removed immediately when new title characters are enabled.

## Versions, encryption, and recovery

### Mixed-version access

Even if `.sy` continues storing a string title, older clients can remove `/` during normalization or interpret title text as hierarchy while constructing `hPath`. Rebuilding indexes alone cannot address those behaviors. Before enabling new characters, define the minimum compatible client, sync access restrictions, and any necessary document format version protection, and verify editing, import, history restore, and backup restore entry points.

Existing `Spec` checks provide a starting point for evaluating version protection, but cannot be assumed to run in every released client and every entry point. Do not claim compatibility with an older version without establishing safe rejection or correct reads. Future rich titles also require an explicit format version and protection against tolerant parsing that overwrites unknown content. Existing ordinary titles and supported older formats remain readable.

### Index and task recovery

Derived index migration needs an explicit version and coverage for full rebuilds, incremental updates, and recovery after interruption. Recovery uses source documents and current ID locations; it must not guess titles from old `hPath` values or recreate missing parent source files automatically. Update derived state only after confirming valid source data, preserving recoverable tasks and source files on failure.

The existing `temp/queue/hpath-refresh.queue` stores only notebook IDs, document IDs, and ID data paths. Migration must not add title segments, rich titles, or body text to this global plaintext queue. Concurrent renames, moves, deletion, sync, and ordinary index rebuilds still need stale-task checks and must not discard unfinished encrypted-notebook recovery tasks.

### Encryption compatibility

Existing encrypted data is the compatibility baseline, subject to the authenticated-read, isolation, and recovery requirements in [Encrypted notebooks](ENCRYPTED-NOTEBOOK.md). Title sources, plain-text titles, and ancestor chains are protected document content. Reads, caches, and responses must remain within the notebook's authorization scope and operation lease, with cleanup on lock following the existing lifecycle.

Derived indexes can be rebuilt only after authenticating source ciphertext and validating the document format. Unknown formats, corruption, and authentication failures must preserve original data and return errors, without falling back to plaintext, cross-notebook queries, or unauthenticated old indexes. Rebuilding ordinary indexes does not establish authentication of encrypted source data.

Internal decoupling does not require changes to encryption envelopes, AAD, or key derivation. Any later change to those formats requires a separate explicit version, authenticated migration, and interruption recovery design that retains matching keys and backup material. Never regenerate `MasterSalt`, discard keys, or require users to recreate existing encrypted notebooks to avoid incompatibility. Supported formats in documents, history, backups, and sync snapshots must remain recoverable.

## Implementation dependencies

1. Establish boundaries for title access and structured hierarchy, with consistent identity-based ownership validation and creation target resolution; retain existing title input rules and external protocols at this point
2. Migrate creation, templates, search, indexes, import, export, desktop consumers, and mobile consumers, covering duplicate titles, concurrent changes, and recovery
3. Enable `/` in titles only after completing the legacy API and SQL compatibility matrix, template versioning, mixed-client protection, and acceptance checks; synchronize plugin declarations and the user guide in all four bundled languages
4. Decide cache and index layout optimizations from measurements; design and implement rich titles separately under the extension requirements above

Before enabling new characters, decisions remain necessary for legacy path output and SQL representations of new titles, final structured creation and template contracts, partial-creation retry semantics, and the minimum client version and protection mechanism. Each decision must be reflected in the relevant interface or format definition and regression cases. Editing this document or rebuilding indexes does not satisfy those requirements.

## Verification

| Area | Required scenarios |
| --- | --- |
| Title content | `/`, `／`, repeated slashes, `%2F`, `.`, `..`, empty titles, Unicode, and length boundaries; no uncontracted character conversion |
| Identity and hierarchy | One title `A/B` versus two levels `A`, `B`; duplicate titles under the same or different parents; ownership checks for duplicate IDs; root locations and notebook documents |
| Creation and concurrency | Parent rename, move, deletion, close, or lock; invalidated previews; partial multi-level creation and retries; ordinary creation versus reuse |
| Templates | All legacy syntax boundaries, segment-by-segment rendering, variables containing `/`, relative operations, one time snapshot, and daily note, shorthand, and related entry points |
| Search and presentation | Original title character search, ancestor text search, ID scope filtering, title highlights, breadcrumb boundaries, copied text, and ID links |
| Indexes and recovery | Deep subtrees, successive parent and child renames, stale edit snapshots, interrupted batches, restart, moves, deletion, sync, and ordinary and encrypted index migration |
| Import and export | Duplicate names, invalid filenames, case collisions, path escape, relative links, cross-notebook references, title metadata, and lossless round-trip guarantees |
| Legacy APIs and plugins | Field meanings, nullability and response variants, SQL hierarchy assumptions, legacy string round-trips, explicit failures for new titles, and replacement entry points |
| Older clients and encryption | Supported historical format fixtures, mixed-version sync, authentication failure, caches and responses during lock, history and backup recovery, and retained key material |
| Inline extension capability | Existing Markdown-like title text remains literal; representation changes do not affect identity or hierarchy; identical plain text does not merge documents; formatted source derives plain text in one direction |
| Platforms and performance | Creation and rename on desktop, browser, and mobile; foreground latency, database batch time, memory, CPU, and disk I/O for large subtrees |

Performance evaluation compares against current rename, query, and index mechanisms, reporting foreground response and background work separately rather than treating elapsed time including scheduling waits as database time. Behavior regressions belong in existing frontend and kernel test discovery. Before enabling a new format, use actual supported older-format fixtures to verify reads, export, history, backup, and recovery.

## Related code

| Area | Entry points |
| --- | --- |
| Creation, rename, title normalization, and name resolution | [`model/file.go`](../kernel/model/file.go), [`model/path.go`](../kernel/model/path.go) |
| Source documents and read-only path recovery | [`filesys/tree.go`](../kernel/filesys/tree.go), [`filesys/hpath.go`](../kernel/filesys/hpath.go) |
| Path refresh, recovery queues, and document indexes | [`treenode/hpath.go`](../kernel/treenode/hpath.go), [`model/hpath_refresh.go`](../kernel/model/hpath_refresh.go), [`sql/queue.go`](../kernel/sql/queue.go) |
| Search and hierarchy calculations | [`model/search.go`](../kernel/model/search.go), [`sql/block_query.go`](../kernel/sql/block_query.go), [`search/config.ts`](../app/src/search/config.ts) |
| Creation entry points and save path parsing | [`util/newFile.ts`](../app/src/util/newFile.ts), [`util/parseNewDocTarget.ts`](../app/src/util/parseNewDocTarget.ts), [`mobile/util/initFramework.ts`](../app/src/mobile/util/initFramework.ts) |
| Templates, new database items, and shorthands | [`model/template_doc_tree.go`](../kernel/model/template_doc_tree.go), [`model/attribute_view_new_item.go`](../kernel/model/attribute_view_new_item.go), [`model/shortcuts.go`](../kernel/model/shortcuts.go) |
| Import and export | [`model/import.go`](../kernel/model/import.go), [`model/import_obsidian.go`](../kernel/model/import_obsidian.go), [`model/export.go`](../kernel/model/export.go) |
| Document versions | [`treenode/tree.go`](../kernel/treenode/tree.go), [`.sy` file structure](SY-FORMAT.md) |
