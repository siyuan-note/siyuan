# Document titles and addressing

[中文](DOCUMENT-ADDRESSING.zh-CN.md)

Related issue: [Improve hPath by separating display text from document addressing](https://github.com/siyuan-note/siyuan/issues/19938)

This is an implementation design draft defining document titles, hierarchy addressing, readable paths, APIs, and migration behavior. The new fields, endpoints, and version mechanisms below are proposed contracts, not capabilities already supported by the current release. See [Document rename and path indexes](DOCUMENT-HPATH.md) (Chinese) for the current rename and index update mechanism.

## Goals and scope

Document IDs determine identity and hierarchy membership; titles express content; readable paths provide presentation. Creation, moves, and references must not recover document identity by parsing display text. Once the affected entry points have migrated and compatibility has been verified, document titles can contain the ASCII slash `/` while remaining distinct from existing fullwidth slashes `／`.

Future support for inline elements in document titles is a required extension capability of this design. Addressing, title presentation, plain-text extraction, and storage representation must remain separate. The design must not permanently constrain titles to a single plain-text string interpreted directly by every consumer. A complete rich title format, editing interactions, and the supported element set are outside the current scope.

The design covers desktop, browser, mobile, kernel APIs, and plugin-visible data, subject to the respective access boundaries of ordinary and encrypted notebooks. Notebook names participate in path presentation as separate display fields. Their character restrictions and rich text support require a separate assessment of configuration formats and older clients; document title rules do not automatically apply to notebook names.

### Design decisions

| Area | Selected approach |
| --- | --- |
| Document addressing | Notebook and document IDs; creation takes a parent identity and a separate title |
| Compatibility modes | Explicitly enable structured title mode per notebook; existing notebooks default to compatibility mode |
| Plugins | Accept adaptation of plugins that depend on legacy `hPath` rules; deliver replacement APIs and migration guidance before enabling new characters |
| Legacy string addressing | Preserve existing behavior in compatibility mode; reject legacy string lookup and creation in structured title mode |
| Readable paths | Join original ancestor title text for display; do not encode `/` or decode `／` or `%2F` |
| Indexes | Retain existing `hpath` columns and add internal document metadata; do not store full title segment arrays on every content block |
| Title sources | Keep ordinary titles in the first implementation, with an extension boundary for versioned inline content and one-way plain-text derivation |
| Release order | Release compatibility protection and structured capabilities first, enable `/` after migration verification, and implement rich titles separately |

The compatibility boundary is the notebook, avoiding guesses about a caller's title intent from individual requests. For example, `/A/B` can describe two levels or display one literal title; the legacy request cannot distinguish them. Once structured title mode is enabled, legacy string addressing fails explicitly throughout that notebook, even for documents whose titles remain ordinary. ID-based operations and ordinary text display remain available. This is the defined plugin adaptation boundary, not a promise that all old plugins work unchanged.

The foundational separation requires no new external service, network transmission, or dependency. Implementation continues under the repository's and existing dependencies' licenses; selecting a new dependency later requires its own license review. The main costs are consumer migration, index rebuilding, and cross-version verification. Title and ancestor caches, logs, and errors remain subject to encrypted-notebook boundaries; structured fields must not expand data visibility.

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
| Legacy path protocol | Existing `hPath`, `hpath`, and related fields used by APIs and plugins | Preserve existing behavior in compatibility mode; apply the explicit display and rejection rules below in structured title mode |
| Export relative path | File location assigned to a document by an export operation | Determined by an export mapping, separately from titles and UI paths |

The current frontend search configuration's `idPath` is an array of search scope strings. Each entry can contain a notebook ID and a document ID path; it is not an array of successive IDs for one path. Migration must preserve the interpretation of existing configurations. Similarly, blocktree `parent_id` identifies a block node's parent and cannot be reused directly as a document's parent document ID.

The following structures can both display as `/A/B`, but must retain different document identities and ancestor chains:

| Title segments | Document structure |
| --- | --- |
| `["A/B"]` | One document titled `A/B` at the notebook root |
| `["A", "B"]` | A document titled `A` with a child document titled `B` |

Breadcrumbs should present boundaries using the structured hierarchy. A copied plain-text path is for reading; links and references used for navigation must carry IDs. Documents with the same title under the same parent are allowed, and matching title segments must not merge their identities.

### Title access and document metadata

The kernel establishes a shared title reader returning `format`, `text`, `empty`, and the source version. The first implementation supports only `format: "plain"`, reading IAL `title` and the existing `custom-sy-title-empty` attribute; the flag and stored title text remain distinct. Existing placeholder titles are not rewritten in bulk, and empty-title UI hints do not become new lookup keys. Future rich sources provide plain text through the same boundary without requiring addressing consumers to change.

Add an internal `document_metadata` table with one row per document to ordinary `blocktree.db` and each encrypted notebook's corresponding block-tree database. Keep the existing `blocktrees` column order unchanged to avoid changing existing scanners and plugin query layouts.

| Field | Meaning |
| --- | --- |
| `box_id`, `id` | Composite primary key: notebook ID and document ID |
| `parent_id` | Parent document ID, with SQL `NULL` for the logical root; distinct from block-node `parent_id` |
| `title_text`, `title_empty` | Text derived from the title source and its empty-title flag |
| `title_format`, `source_spec` | Title representation and source document version |
| `revision` | Version digest covering identity, location, title source, and empty-title state |

An index on `(box_id, parent_id, title_text, id)` supports exact name lookup under the current parent. Matching is case-sensitive on original Unicode text, without width conversion, percent decoding, or Unicode normalization; search retains its own tokenization and case rules. An empty title cannot automatically identify an unknown parent; use its ID.

`document_metadata` is a rebuildable internal index, not a new public SQL table contract. Addressing uses current metadata in the block-tree database; plugins obtain parent IDs, titles, and depth through structured reads. Document rows in the existing content database continue storing plain-text titles in `content` and readable path copies in `hpath`.

Update document metadata and the block-tree document row in the same database transaction. Creation, rename, move, deletion, copying, import, and sync rebuilds must update or remove the corresponding rows. Title caches are keyed by notebook and document identity and validated with version digests; same-named documents in another notebook are never substitutes.

### Structured path output

`DocumentPath` contains `notebook`, `id`, `parentID`, `path`, `title`, `segments`, `depth`, `displayPath`, `revision`, and `addressingVersion`. `title` is `{format, text, empty}`; `segments` contains `{id, text, empty}` entries from the root through the current document. `displayPath` starts with `/` and joins segments with `/`, displaying `/` for an empty array, for presentation only. The notebook name is returned separately or obtained by the caller, not inserted into the segment array. Here, `title` is a summary, not a complete copy of a future rich source that can be written back.

An ordinary root document has `depth: 1` and `parentID: null`. With notebook documents enabled, the notebook document has `depth: 0` and empty `segments`; ordinary root documents remain at level one, with no additional physical directory. Passing the notebook document ID as a creation parent is equivalent to the explicit root, retaining the existing logical-root mapping. Root child-name queries exclude the notebook document itself so it cannot be mistaken for an ordinary root document.

Path revisions use versioned serialization with unambiguous field boundaries, covering ancestor IDs, title revisions, and current location, not just second-resolution modification times. Direct creation by parent ID may follow the parent's current location. A caller requiring a preview to remain valid submits `expectedParentRevision`; ancestor renames or location changes invalidate it. Digests check consistency and do not grant access across authorization boundaries.

## Extension requirements for inline titles

Title access must expose clear boundaries for source content, plain-text extraction, and presentation. The current implementation can continue storing ordinary strings, but addressing, depth calculations, creation target resolution, and filename allocation must not depend on the specific IAL string representation or pass title content to filesystem path normalization functions.

Future support for bold, italic, inline code, and other elements should reuse existing inline content models, parsers, and renderers, with an explicit format discriminator or version for document titles. Existing titles containing `**text**`, backticks, or link syntax remain literal content; upgrading must not automatically reinterpret them as rich text. A separate rich title design will select inline Markdown, a node structure, or another representation.

The new format must specify one authoritative title source. A plain-text title retained for compatibility is derived from that source; both must be saved and recovered consistently rather than becoming two writable sources that overwrite each other. Legacy APIs must not write the plain-text projection back over a rich title and silently discard formatting. Writes that do not support the title format must be rejected; body edits must also preserve the title source or explicitly refuse to save.

Plain-text extraction for rich titles needs rules for whitespace, line breaks, inline math, link text, empty titles, and length limits. Two titles differing only in style can produce the same plain text; IDs still distinguish identity and references. Search, sorting, and export filenames must not treat Markdown markup or rendered HTML as title text. Titles within exported content can preserve inline elements supported by the destination format.

Render ordinary titles as text through existing escaping or text-node mechanisms, not direct HTML concatenation enabled by new characters. Rich titles reuse validated nodes and renderers. The plain-text summary in `DocumentPath` and the editable source have separate read boundaries, with format-specific writes preventing presentation data from overwriting the source format.

Block references, dynamic anchor text, links, tags, and assets need additional rules for dependency updates, click behavior, reference and asset ownership, cycles, ID remapping during copying and import, and encryption boundaries. This design preserves representation space for those capabilities without committing to enabling every inline element at once. The later rich title implementation must also cover input methods, selection, undo, mobile interaction, history, sync, and export.

Acceptance of this decoupling must establish that adding a title representation does not change addressing or hierarchy rules, that existing ordinary titles retain their literal content, and that consumers obtain titles through the defined access boundary instead of guessing title syntax independently.

## Creation and path templates

### Creation by identity

When the parent document is known, a creation request expresses the target notebook, parent document ID or root location, separate title, and body. Immediately before writing, the kernel resolves the ID data path from current identity and revalidates ownership, writability, parent validity, and the encrypted-notebook operation lease. A cross-notebook move can change ownership; a stale notebook parameter must fail rather than trigger a fallback lookup in another notebook or a same-named document.

Direct creation without a preview revision follows the same parent's current location after a rename or a move within the notebook. Requests carrying `expectedParentRevision`, creation previews, and template document-tree plans validate the relevant title and location revisions, returning `planChanged` when they differ so the caller can preview again. The request distinguishes these behaviors; an unchanged document ID alone does not establish that a preview remains valid.

Parent resolution, final validation, and source-document commit must share mutation coordination with rename, move, and deletion so the parent cannot change location between validation and commit. Reuse the existing transaction queue and lock order; do not wait for the queue while holding a lock it needs to execute. Cancellation, notebook closure, and locking must not leave a stale operation lease usable.

Currently, `createDocWithMd` can fall back from `parentID` to name resolution when `hPath` does not match, and a regression test requires that behavior. The new protocol adds a separate strict parent-ID endpoint rather than changing the old parameter's meaning. Migrated internal consumers pass structured targets directly, never reassembling an `hPath` and passing it to the old parser.

Ordinary creation, daily note reuse, and appending to an existing document are different operations. Callers must express whether a target may be reused instead of implicitly selecting a write target through a title search. Migration must retain template application, attribute writes, sorting, notifications, and synchronous persistence requirements. For example, shorthand workflows that remove source data after success must first confirm that the destination was written successfully.

### Title validation in the new protocol

The new creation endpoint requires an explicit `title: {format: "plain", text: string}`. An omitted `title`, `null`, or an unknown `format` is an error. `text: ""` means an empty title, retaining `custom-sy-title-empty` and the existing storage placeholder mechanism. Reads return both the actual plain text and `empty`; editors restore empty input from the flag instead of treating a localized placeholder as a user title.

The first implementation retains the limit of 512 Unicode code points and existing restrictions on invisible and private-use characters, preserving ZWJ needed by combined emoji. The new endpoint returns `invalidTitle` for excessive length, prohibited characters, and surrounding whitespace rather than silently truncating, trimming, or replacing them. A UI that deliberately cleans input shows the resulting title before submission. In compatibility mode the new endpoint rejects `/` and standalone `.` or `..`; structured title mode allows them as ordinary text. Existing legacy normalization behavior remains unchanged in compatibility mode.

Structured title mode performs no filesystem path cleaning, width conversion, percent decoding, or Unicode normalization. `/`, `／`, `%2F`, repeated slashes, and `A/../B` remain literal text; only parent identity determines hierarchy. Ordinary creation permits duplicate titles under the same parent, returning a new ID without implicitly overwriting or reusing an existing document.

### Resolution by title segments

Creating a hierarchy by name requires an explicit starting location and a title segment array. Use known ancestor identities directly; resolve unknown ancestors one level at a time under the current parent. Create an absent match according to the operation's rules. Multiple matches produce ambiguity and candidate identities within the authorized scope, never an arbitrary first match. The generic resolver does not search descendants across same-named parents to guess user intent.

A `/` within a structured title segment does not create another level, and `.` or `..` does not navigate. Moving up a level, starting from the notebook root, and anchoring at the current document require separate representations. An empty segment array means the starting location itself. An empty string cannot automatically match an empty-title parent, while creation can explicitly submit an empty final title. The caller's `onMissingParent` policy determines whether missing ancestors may be created.

### Commits, partial failures, and retries

The first implementation does not add a general atomic multi-file creation API. Kernel workflows use creation plans; plugins compose the resolver and single-document creation endpoint. Before writing, a plan validates predictable title, depth, ambiguity, template, and authorization errors and assigns a fixed ID to each document to be created. Matched ancestors retain their identities and revisions. Recheck matches and revisions during execution; concurrently introduced same-named candidates require replanning instead of silently selecting another document.

Each creation step commits independently. A success response requires synchronous persistence of the source document and required body and attribute changes, with readable document metadata; full-text indexing can remain asynchronous. Preserve the workflow's template, footnote, math, clipping-source, tag, sorting, and refresh-notification behavior when separating addressing.

Keep documents already persisted when a later step fails. Error data distinguishes `commitState: "none"`, `"committed"`, and `"unknown"` and includes confirmed document IDs, the failed stage, and completed steps. `committed` means the source document was committed, not that all subsequent actions succeeded. If persistence cannot be determined, return `unknown` rather than claiming no write occurred. Multi-level workflows retain the original plan and completed IDs and show where processing can continue.

Callers retain allocated IDs before sending requests. After a lost response or unknown outcome, complete any necessary index recovery, then verify the source document and target by the original ID without allocating another ID. Submitting an existing ID returns `documentIDConflict`; it does not overwrite the document or interpret existence alone as proof of a successful identical request. The first implementation does not promise automatic idempotent replay. Side effects such as template application or body appends must not be repeated without verification.

Recovery handles only unfinished steps and does not automatically delete successfully created parent documents. Non-repeatable follow-up actions such as clearing source data require all necessary workflow steps to succeed. Partial success or merely receiving a document ID cannot trigger deletion of shorthand source data.

### Template versions

Legacy string save paths retain their current interpretation, including absolute and relative paths, `..`, trailing `/`, empty templates, cross-notebook context, and an explicit name replacing the final segment. New syntax must have an identifiable version and must not automatically reinterpret existing configurations.

The compatibility compiler evaluates legacy templates using their original grammar and produces structured creation plans. A separately supplied new title remains separate and is not joined back into a path string. Relative anchors and upward navigation use the current document ID and parent relationships, never a split of its display path into legacy segments. This internal adapter does not call public string-addressing endpoints disabled by the new mode, so existing daily-note configurations still work. A `/` produced by a variable within a legacy template continues to create a level; it remains one segment only after an explicit switch to the new template format. Compatibility compilation preserves grammar, not arbitrary selection of a same-named parent; unknown ancestors still require ambiguity checks.

New configuration uses `docCreateTarget`, `refCreateTarget`, and `dailyNoteTarget` alongside the original string save-path fields. Initially, these objects are available only in the configuration of notebooks with mode `2` enabled. Global settings retain legacy string templates and existing inheritance rules, avoiding configuration unknown to old clients before notebook activation. Each object requires `version: 2`, specifying the destination notebook, anchor, number of upward steps, ancestor segments, final title, and missing-parent policy. Each segment reuses the existing save-path template evaluator. The example's `{{now | date ...}}` syntax is for save-path templates and must not be confused with body-template syntax.

```json
{
  "version": 2,
  "notebook": "20210808180117-6v0mkxr",
  "anchor": {"kind": "notebookRoot"},
  "up": 0,
  "parents": ["Daily notes", "{{now | date \"2006-01\"}}"],
  "title": "{{now | date \"2006-01-02\"}}",
  "onMissingParent": "create"
}
```

`anchor` also supports `{kind: "context"}` and `{kind: "document", id: string}`. `context` must resolve to the current document within the destination notebook; do not guess an anchor across notebooks, and fail when context is missing. `up` is a nonnegative integer and fails if it goes above the logical root. `parents` can be empty; `onMissingParent` must be `create` or `error`. An explicit caller-supplied title replaces the result of evaluating `title`. Workflows such as daily notes determine reuse of the final document; the generic path template does not.

New templates establish segment boundaries before rendering and evaluate each title segment separately. A variable whose value is `A/B` remains one title segment; rendering a single string and then calling `split("/")` violates the protocol. All segments use the same context and time snapshot. Daily notes supply `now` from the requested calendar date to prevent date or context changes during evaluation.

When a new object exists, it is the sole authoritative configuration for that creation target; the old string is retained only as the original configuration. Changing the old field to a different value returns an explicit configuration conflict instead of silently overriding the new object; sending the unchanged old value remains acceptable. Explicitly removing the new object re-enables the legacy template without downgrading the notebook to compatibility mode. Without a new object, retain the existing notebook/global configuration precedence. Cross-notebook targets still validate titles under the destination mode; an enabled source cannot bypass destination restrictions.

### Workflow migration

| Entry point | Preserved behavior and migration focus |
| --- | --- |
| Ordinary creation and creation from block references | Create directly under known parent IDs; pass titles separately and retain document IDs in generated references |
| Daily notes | Reuse by the daily-note date attribute first; retain template-target preference for multiple matches and ID ordering otherwise; do not reapply body templates to existing notes |
| Shorthands | Distinguish appending to an explicit target from creating a new target; clear the source only after destination persistence succeeds |
| New database items | Preserve attribute values, bindings, and sorting; retain the final document ID in the creation plan |
| Template document trees | Preserve previews, ID remapping, and insertion order; validate preview revisions on commit and expose partial completion |
| Desktop, browser, and mobile | Inspect menus, shortcuts, dialogs, and handlers separately; shared utility migration does not replace platform verification |

Daily-note reuse is an explicit existing business rule. The generic resolver's ambiguity policy must not turn every multiple-date match into an error; template-target preference compares structured identity chains instead.

## Search and derived indexes

Structured ancestor chains provide a common data source. UI presentation, legacy protocol output, plain-text search, and export each apply conversions appropriate to their purpose. The shared boundary is the source of titles and hierarchy, not a requirement for every consumer to use one serialized string.

Document depth, parent-child relationships, and subtree scope derive from ID data paths or explicit document relationships. Consumers must not derive structure by counting slashes in `hPath`, using `path.Base(hPath)` or `path.Clean(hPath)`, or slicing display strings by depth. Indexed document titles come from the title source; recovery reads must use the same data boundary.

Search scope filtering is separate from path text matching. Scope uses document identities or ID data paths. Text matching uses the plain-text title representation and ancestor text without replacing `/` with `／` or vice versa. Search highlight markers and HTML in results are presentation output; they cannot become title source content, and adding document titles to results must not overwrite existing match highlighting.

The first implementation retains `blocks.hpath`, `blocktrees.hpath`, and the existing batch update mechanism, adding the document metadata described above as the source for structured queries. Assemble ancestor chains per document with bounded caching, without copying full title arrays onto every content block. Plugins can still read string columns, but in the new mode they are display and text-search data only.

`RefreshDocHPaths` reconstructs ancestor titles from the ID subtree and metadata instead of slicing old `hPath` values by depth. `updateRootContent` obtains the document title from the shared title reader instead of `path.Base`. In steady state, renaming a parent does not read every descendant's full `.sy` file just to obtain its title. Missing or invalid metadata enters recovery rather than being filled from old display paths.

Renames still invalidate display paths, ancestor text search data, and related caches. Source saves, document metadata updates, background batch validation, and interruption recovery must remain ordered, and queued old trees must not restore stale titles or paths. ID-based addressing removes the effect of titles on identity; it does not eliminate every rename update task.

## Import and export

Export first assigns a unique relative file path to each document identity, then uses the same mapping to write files and generate inter-document links. The mapping must handle slashes in titles, invalid filename characters, duplicate names, case-insensitive collisions, length limits, and duplicate names across notebooks. Overwrite checks and link generation cannot independently choose filenames while processing individual items.

The allocator determines export directories from ID relationships, then converts each filename independently. Preserve existing unambiguous filenames; use safe names for reserved or empty names, `.`, `..`, trailing spaces or dots, and similar cases. Append a stable document ID on collision and the notebook ID if also necessary. Compare names under the destination filesystem's case and naming rules, retaining the unique suffix and extension when truncating. After allocating all names, recheck uniqueness and destination-directory boundaries before writing files and links. A `/` within a title affects only its filename conversion and never creates a directory.

The title content `.`, `..`, and path separators may only participate in filename conversion and must not escape the export directory. Plain-text titles and rich titles supported by the destination format provide document content. Export filenames can undergo necessary conversion, but cannot become the sole source for restoring titles. Formats promising lossless reimport must preserve original title and corresponding identity metadata; ordinary Markdown filenames alone cannot provide that guarantee.

Initially, native exports and backups continue preserving title sources and versions in source documents; Markdown export does not introduce a new general source format. Ordinary Markdown exports can retain titles in the body without promising lossless restoration of all title metadata. A later manifest-based round-trip format would require its own version and import rules.

Import maps source file paths and source identifiers to new document IDs, and resolves links through that mapping rather than using `hPath` as a unique key. Duplicate source names, relative links, heading anchors, and ambiguous links follow explicit conflict rules. Existing source path mappings in importers such as Obsidian should remain in use; their title and readable-path generation can migrate independently.

## Structured API contracts

The following paths and fields are proposed new contracts using `POST` with JSON requests. Initially, new read endpoints require workspace administrator access; write endpoints additionally require writable access. They do not automatically expose ancestor enumeration to published-page visitors. Existing published pages retain document-level visibility checks, and any added structured presentation data needs equivalent filtering. Encrypted-notebook operations retain valid leases through resolution, queries, and response serialization.

### Batch reads by ID

`/api/filetree/getDocPaths` accepts `notebook` and `ids`, where `ids` contains 1 to 128 document IDs; excess input fails instead of being silently truncated. Deduplicate in first-occurrence order and return `{documents: DocumentPath[], missingIDs: string[]}`. IDs that are absent, outside the requested notebook, or not readable as documents enter `missingIDs`, with no fallback lookup in another notebook. Denied access to the whole notebook fails the request.

Each `DocumentPath` contains titles and ancestors from one verifiable revision. Results follow deduplicated input order, with missing entries listed separately. An unavailable index, unsupported source format, or authentication failure is an error, not a missing document. Batch reads do not promise a global snapshot across documents; callers retain individual `revision` values and revalidate on preview submission.

### Resolution by title segments

`/api/filetree/resolveDocPath` accepts `notebook`, `start`, and `segments`. `start` is `{kind: "root"}` or `{kind: "document", id: string}`; `segments` is an array of independent title strings. The endpoint only resolves, never creates. An empty array returns the starting location; otherwise, lookup proceeds one level at a time by exact name without interpreting navigation characters inside strings.

Results contain `status`, `start`, `resolved`, `nextIndex`, `candidates`, and `candidatesTruncated`. `start` returns the starting identity and revision; `resolved` and `candidates` use `DocumentPath`. `nextIndex` is the zero-based index of the next segment. `status: "resolved"` means all segments matched; `"missing"` means no document exists from that segment onward; `"ambiguous"` means that segment has multiple candidates. Return at most 128 candidates ordered by ID, setting `candidatesTruncated` if more exist. Reaching the limit still reports ambiguity: callers must use an explicit parent ID, never default to the first truncated candidate.

Resolution accepts at most 128 segments, each within the title length limit; actual creation still enforces the user's document depth restriction. Empty string segments fail; existing empty-title parents require ID selection. A root result uses an explicit root location, not an invented document ID. Root revisions cover notebook identity and relevant configuration, without invalidation by unrelated child changes. The notebook document ID, when used as a root alias, also uses root revision validation. Errors and candidates must not expose another notebook's titles.

### Creation by parent ID

The minimal request for `/api/filetree/createDocByParent` follows. This example requires structured title mode on the destination notebook.

```json
{
  "notebook": "20210808180117-6v0mkxr",
  "parentID": "20261015090000-abcdefg",
  "id": "20261015100000-hijklmn",
  "title": {"format": "plain", "text": "卷01·第一章/第二节"},
  "markdown": ""
}
```

| Field | Constraint |
| --- | --- |
| `notebook` | Required destination notebook ID |
| `parentID` | Required document ID or `null` for the notebook root; an empty string does not mean root |
| `id` | Required valid new document ID allocated and retained by the caller; never overwrite an existing ID |
| `title` | Required; initially accepts only a plain title object; empty text differs from omission |
| `markdown` | Required; an empty string is valid |
| `expectedParentRevision` | Optional validation of the parent path revision when submitting a preview; use the resolver's root revision for a root target |
| `tags`, `withMath`, `clippingHref` | Optional, retaining the corresponding Markdown creation behavior |
| `sorts`, `sortTargetID`, `sortPosition` | Optional, preserving sort validation; relative targets must still be sibling documents, and conflicting sort specifications fail |
| `docCreateTemplatePath`, `listDocTree` | Optional, retaining existing body-template and document-tree refresh semantics |

Reject additional targeting fields such as `path` and `hPath` to avoid competing location sources. A parent mismatch fails directly without falling back to name resolution. Success returns `{id, document: DocumentPath}`; clients use the returned ID to open, reference, or append to the document.

Business errors use `code: -1` with a stable `data.reason`. `msg` is for human readers, not plugin branching. Contract declarations retain error data carrying commit state and recovery information. Authentication, role, locking, and general request-validation failures continue using their middleware contracts rather than replacing every existing error format.

| Reason | Meaning and caller action |
| --- | --- |
| `invalidTitle` | Invalid title representation, characters, or length; correct the input |
| `parentUnavailable` | Parent absent or outside the target notebook; do not search another notebook |
| `planChanged` | Location, title revision, or preview dependencies changed; resolve and confirm the target again |
| `documentIDConflict` | ID exists; verify the original outcome without overwriting or immediately retrying with a new ID |
| `legacyPathUnsupported` | Legacy string addressing is disabled for the notebook; use the new API |
| `indexUnavailable` | Structured metadata is not ready; wait for recovery without falling back to display paths |
| `unsupportedTitleFormat` | Client or endpoint cannot handle the title format; upgrade or use an endpoint supporting that format |
| `writeFailed` | A write or later processing failed; recover using `commitState` and the reported stage |

### Reading the effective creation target

`/api/filetree/getDocCreateTarget` accepts the current `notebook` and `purpose: "document" | "reference" | "dailyNote"`. It reuses each workflow's existing configuration precedence and returns the effective `target`, `docCreateTemplatePath`, and configuration `revision`. `target` is a union tagged by `version`: legacy templates return `{version: 1, notebook, path}`, while new templates return the complete version `2` object above. The endpoint only reads configuration; it neither evaluates templates nor guesses the current document or date. Callers supply context when generating the plan afterward.

Legacy `/api/filetree/getDocCreateSavePath` retains its response while the effective configuration is a legacy template. When a new object is active, it returns `code: -1`, `data: {reason: "structuredTemplateRequired"}` instead of returning the obsolete old path. Declare that error variant on the legacy contract. Both built-in consumers and plugins use the new reader to avoid reimplementing configuration inheritance independently.

### Capability discovery and activation

Add an optional read-only `documentCapabilities` object to `data` in `/api/notebook/getNotebookConf`, retaining existing `box`, `name`, `conf`, and access filtering. It contains `addressingVersion`, `structuredPaths`, `literalSlash`, `titleFormats`, `indexState`, `minimumReaderVersion`, and `revision`. `structuredPaths` means the server implements the new protocol; `indexState` indicates this notebook's readiness. These are distinct. Initially, `titleFormats` is `["plain"]`; `literalSlash` is `true` only in mode `2` with a ready index.

`revision` is the configuration revision relevant to activation, not an individual document's path revision. Capability declarations grant no access; closed or locked notebooks retain existing restrictions, and status reads expose neither titles nor protected template content. When an older server omits the object, plugins use only legacy capabilities. Authorization, locking, and network errors must not be interpreted as unsupported capabilities or trigger fallback writes.

`/api/notebook/enableStructuredTitles` accepts `notebook` and `expectedRevision`. It checks the configuration revision, index state, and local client compatibility, persists mode `2`, and returns current `documentCapabilities`. If already enabled with a matching revision, it may return the current state. The endpoint cannot prove that every offline sync client has upgraded; the activation UI explains the minimum version and plugin adaptation requirements, and the user explicitly enables the mode. General configuration updates cannot bypass this activation flow, and old requests omitting new fields cannot reset the mode to `1`.

### Contract and declaration maintenance

Implementation follows [Kernel API type contracts](API-CONTRACTS.md): define declarations in `kernel/apicontract/`, bind with `contractHandler`, generate types, and synchronize maintained Petal declarations and its changelog. Detailed new endpoint behavior belongs in the corresponding contract comments. When existing endpoint behavior changes, inspect and synchronize existing entries in the Chinese, English, and Japanese API references. Do not automatically add new endpoints to those references or add feature-specific endpoint descriptions to the contract maintenance guide.

## API and plugin compatibility

Mode `1` is compatibility mode; mode `2` is explicitly enabled structured title mode. An old notebook without the field reads as `1`. The mode determines availability of legacy protocols, not a guess based on whether a particular request happens to contain `/`.

| Use case | Compatibility mode `1` | Structured title mode `2` | Plugin migration |
| --- | --- | --- | --- |
| Reads, moves, and deletion by ID | Preserve existing contracts | Preserve identity, authorization, and response variants | Keep using IDs; reread location after moves |
| Rename by ID and creation using ID data paths | Preserve existing title rules | Plain titles can retain `/`; still validate mode and title format | Pass title and location separately; do not overwrite unknown rich formats with plain text |
| `getIDsByHPath` | Preserve legacy name-path grammar | Reject throughout the notebook with `legacyPathUnsupported` | Use known IDs directly, or `resolveDocPath` for unknown locations |
| `createDocWithMd` | Preserve legacy grammar and `parentID` fallback | Reject throughout the notebook, even with `parentID` supplied | Use `createDocByParent` without a string path |
| `getHPathByID`, `getHPathByPath` | Preserve existing output | Join original ancestor titles for display only | Use `getDocPaths` for structure |
| `getFullHPathByID` | Preserve notebook-name inclusion and nullability | Still display the notebook name; no reverse addressing | Display notebook names separately from document segments |
| `blocks.hpath`, `blocktrees.hpath` | Preserve column types and existing behavior | Remain strings that can contain indistinguishable title slashes | Query subtrees with ID `path`, read titles from document-row `content`, and obtain parents and depth through structured APIs |
| `Criterion.hPath`, `SearchPath`, search results | Preserve existing configuration and highlighting semantics | Display text remains searchable; scope and hierarchy use IDs | Do not resubmit highlighted text or displayed paths as locations |
| Legacy save-path templates | Run with original grammar | Compile internally into structured plans | Explicitly use version `2` templates when `/` in a variable must remain within one segment |
| `getDocCreateSavePath` | Preserve legacy configuration results | Preserve results for old templates; return `structuredTemplateRequired` for new templates | Use `getDocCreateTarget` for the effective versioned configuration |

Do not change legacy field types, remove old APIs, or encode mode `2` display paths to present them as compatible addresses. Different structures can display the same string in the new mode, so SQL equality on `hpath` can also match both. Plugins that count separators, take the final segment, or query subtrees by display prefixes must adapt; that is the compatibility cost of enabling the capability.

Legacy string endpoints gain an explicit mode `2` error variant: `code: -1`, `data: {reason: "legacyPathUnsupported"}`. Declare this variant on the existing contracts and retain its error data. Existing success, null, and error responses in mode `1` stay unchanged. Merely changing error prose and requiring plugins to match localized text is insufficient.

Existing `／`, `%2F`, and similar title content remain literal data without inferred historical encoding. An external channel needing reversible encoding must use a separate version and adapter boundary, never internal identity or title sources.

Plugins migrate through capability discovery, reading known targets by ID, resolving unknown ancestors structurally, creating by parent ID, and operating on returned IDs. Publish this matrix and minimal examples with the replacement APIs; migrate built-in consumers before opening mode `2`. The server cannot identify every plugin SQL query and its later use, so it cannot promise to prevent all plugin misuse of display strings automatically.

## Versions, encryption, and recovery

### Mixed-version access

Notebook configuration adds `documentAddressingVersion`: absent or `1` means compatibility mode, and `2` means structured title mode. This is independent of encryption-envelope versions and must not reuse `BoxCrypt.Spec`. Enabling the mode does not rewrite existing document titles or IDs in bulk; it changes subsequent operation eligibility and representation rules for new content.

Even if `.sy` continues storing a string title, older clients can remove `/` or interpret title text as hierarchy. Release in two steps: first a protective version that recognizes notebook capability markers and safely rejects unsupported modes, then a feature version that allows enabling mode `2`. The protective version rejects unsupported modes before mounting, indexing, repairing, editing, or applying sync changes; it must not modify data before requesting an upgrade.

Documents actually using new title capabilities adopt a new `DocumentTitleSpec`. Allocate its numeric value against the `.sy` versions in use at implementation time, rather than reserving a number in this draft. Enabling a notebook does not rewrite every document that does not use the capability. Future rich representations also need explicit format versions, and tolerant parsing must never overwrite unknown content.

Version protection covers full reads, attribute-only reads, read-only path recovery, import, history, backups, and sync. Currently, the non-strict `readDocIAL` branch does not execute the same `CheckSpecJSON` validation as the strict branch; checking only ordinary editor loads is insufficient. A source version requiring mode `2` in a mode `1` notebook produces a mode conflict first. Import continues only after explicit activation, never by silently cleaning titles to fit the old mode.

Determine the minimum compatible version through read, write, and rejection tests against actual releases. Clients predating the protective release that ignore capability markers cannot be constrained automatically by new fields and are outside the safe mixed-version promise. All sync devices must upgrade before activation. Offline device state cannot be proven and must be explained. If a supported version still has a path that rewrites data, keep the capability disabled rather than substituting documentation for necessary protection.

Mode `2` has no direct switch back to `1`. Even after current titles no longer contain `/`, history and backups can retain new formats. Older clients may use a verified compatible export copy or a complete pre-activation backup restored into a separate workspace; do not overwrite the original workspace with old configuration and continue syncing. Any future downgrade converter requires its own conversion manifest, conflict policy, and recovery design while preserving original data.

### Index and task recovery

`document_metadata` uses an independent derived-index version and per-notebook states `missing`, `building`, `ready`, and `error`. Build the new table from source documents and ID locations, not segment boundaries guessed from old `hPath` values. Record incremental changes during construction and catch up before switching; mark the corresponding generation `ready` only after the full scan and incremental validation complete.

In compatibility mode, existing functionality retains its behavior during rebuilding, while new structured endpoints return `indexUnavailable` if required data is not ready. Mode `2` cannot fall back to old name addressing when indexes are corrupt. Recover through existing source-read paths and hold structured writes until required metadata is ready. Do not automatically recreate missing parent source files or replace corrupt source data with old titles from an index.

Update in order: persist the source document, update metadata and the corresponding document row within one block-tree database transaction, then submit subsequent `hpath` batches. There is no claimed atomic transaction between source files and databases or between block-tree and content databases. Preserve recovery markers across interruption at any step. After restart or unlock, verify source revisions and current ID locations before resuming derived updates. Revision, move, and deletion checks invalidate queued old trees so they cannot restore stale titles.

The existing `temp/queue/hpath-refresh.queue` stores only notebook IDs, document IDs, and ID data paths. Migration must not add title segments, rich titles, or body text to this global plaintext queue. Concurrent renames, moves, deletion, sync, and ordinary index rebuilds still need stale-task checks and must not discard unfinished encrypted-notebook recovery tasks.

To cover a crash after the source write but before recovery work is registered, persist an identity-only pending-verification marker before mutation, or use an existing durable transaction record proven to cover that window. Fault injection must establish recoverability. Clear the marker only after completion; repeated recovery produces the same derived result. Keep tasks for locked encrypted notebooks instead of skipping authentication just to empty the queue.

### Encryption compatibility

Existing encrypted data is the compatibility baseline, subject to the authenticated-read, isolation, and recovery requirements in [Encrypted notebooks](ENCRYPTED-NOTEBOOK.md). Title sources, plain-text titles, and ancestor chains are protected document content. Reads, caches, and responses must remain within the notebook's authorization scope and operation lease, with cleanup on lock following the existing lifecycle.

Derived indexes can be rebuilt only after authenticating source ciphertext and validating the document format. Unknown formats, corruption, and authentication failures must preserve original data and return errors, without falling back to plaintext, cross-notebook queries, or unauthenticated old indexes. Rebuilding ordinary indexes does not establish authentication of encrypted source data.

Internal decoupling does not require changes to encryption envelopes, AAD, or key derivation. Any later change to those formats requires a separate explicit version, authenticated migration, and interruption recovery design that retains matching keys and backup material. Never regenerate `MasterSalt`, discard keys, or require users to recreate existing encrypted notebooks to avoid incompatibility. Supported formats in documents, history, backups, and sync snapshots must remain recoverable.

## Implementation stages and activation gates

| Stage | Deliverables | Completion criteria |
| --- | --- | --- |
| A: Compatibility protection | Notebook capability markers, unknown-mode and source-version protection, existing behavior fixtures | Protective version released; unsupported modes safely rejected at every write and repair entry point |
| B: Internal separation | Shared title access, document metadata, ID hierarchy calculations, path refresh, and recovery | Ordinary titles retain behavior; structure is no longer derived from display strings; encrypted indexes rebuild from authenticated sources |
| C: APIs and consumers | New read, resolve, and create APIs, version `2` templates, built-in workflow and platform migration | New and old contracts verified; partial failures recoverable; daily-note and other business behavior retained |
| D: New characters | Mode activation, legacy API rejection rules, plugin migration guidance, import/export and cross-version verification | Allow explicit user activation of `/` only after all gates pass |
| E: Inline titles | Separate source-format, editing, and rendering design | Retain this design's identity APIs and deliver separately after format and old-writer protection |

Stages B and C may ship while retaining legacy title restrictions. New characters require all relevant conditions in A through D. Stage E is not a prerequisite for the foundational separation, but A through D must not reintroduce assumptions that titles will permanently have plain-text sources.

Activation gates include migrated built-in consumers, released replacement APIs and plugin guidance, verified minimum client versions and mixed-version rejection, interruptible ordinary and encrypted index migration, exports that do not overwrite files due to display-path collisions, consistent desktop/browser/mobile behavior, and user guides in all four bundled languages covering activation, plugin impact, and sync-device requirements.

Implementation still needs actual release version numbers, an available `.sy` version allocation, performance measurements, and compatibility test results. These are release evidence, not unresolved decisions about identity, templates, plugin boundaries, or failure semantics. Proposed endpoints and fields must become verifiable contracts; finishing this document or rebuilding an index once is not feature acceptance.

## Verification and acceptance

### Behavior matrix

| Area | Required scenarios |
| --- | --- |
| Title content | `/`, `／`, repeated slashes, `%2F`, `.`, `..`, empty titles, Unicode, and length boundaries; no uncontracted character conversion |
| Identity and hierarchy | One title `A/B` versus two levels `A`, `B`; duplicate titles under the same or different parents; ownership checks for duplicate IDs; root locations and notebook documents |
| Creation and concurrency | Direct ID creation following parent location versus revisioned requests rejecting stale previews; parent deletion, cross-notebook moves, closure, or locking; lost responses, partial commits, fixed-ID conflicts, and multi-level recovery |
| Templates | All legacy syntax boundaries, segment-by-segment rendering, variables containing `/`, relative operations, one time snapshot, and daily note, shorthand, and related entry points |
| Search and presentation | Original title character search, ancestor text search, ID scope filtering, title highlights, breadcrumb boundaries, copied text, and ID links |
| Indexes and recovery | Deep subtrees, successive parent and child renames, stale edit snapshots, interrupted batches, restart, moves, deletion, sync, and ordinary and encrypted index migration |
| Import and export | Duplicate names, invalid filenames, case collisions, path escape, relative links, cross-notebook references, title metadata, and lossless round-trip guarantees |
| Legacy APIs and plugins | Unchanged mode `1` responses; notebook-wide legacy-addressing rejection in mode `2`; SQL display collisions, structured replacements, and missing capabilities distinguished from request errors |
| Older clients and encryption | Supported historical format fixtures, mixed-version sync, authentication failure, caches and responses during lock, history and backup recovery, and retained key material |
| Inline extension capability | Existing Markdown-like title text remains literal; representation changes do not affect identity or hierarchy; identical plain text does not merge documents; formatted source derives plain text in one direction |
| Platforms and performance | Creation and rename on desktop, browser, and mobile; foreground latency, database batch time, memory, CPU, and disk I/O for large subtrees |

### Essential regression cases

Retain `TestCreateDocsByHPathUsesParentIDForDuplicateHPath` and `TestCreateDocsByHPathKeepsHPathFallbackForDifferentParent` to prove that new rules have not silently replaced the legacy compatibility entry point. Separately test the new endpoint following the same parent ID after a rename, rejecting a parent moved to another notebook, never selecting a same-named parent, and returning `planChanged` for stale revisioned requests.

Create a root document `A/B`, a root document `A` with child `B`, a root document `A／B`, and a root document `A%2FB` together. The first two may share a display path, but must retain correct IDs, `segments`, `depth`, subtree scope, and export links. Neither of the latter two may be converted into the former structures. Add repeated slashes, dot segments, empty titles, case differences, and different title formats with identical plain text.

Actual HTTP regressions verify strict request types, required fields versus `null`, result ordering, truncated candidates, error data, administrator and writable access, encrypted response leases, and published-visitor rejection. Assert old compatibility behavior separately from new endpoints instead of replacing legacy expectations. Frontend tests cover old template configuration round-trips, new segment evaluation, one time snapshot, partial-success presentation, and mobile entry points.

Fault injection covers at least the boundaries before and after source persistence, before and after metadata transactions, interrupted content-index batches, lost success responses, and locking during response serialization. Use real fixtures from supported historical formats for reads, export, history, backup, and recovery, and verify safe rejection of new formats by the protective release. Testing only files generated by the current version does not establish backward compatibility.

### Performance and resources

Compare the baseline and implementation in the same environment using 1,000 and 10,000 documents, wide subtrees, and depth 7, with additional coverage for the option allowing deeper documents. Test ordinary and unlocked encrypted notebooks separately. Measure batch path reads, parent renames, moves, initial rebuilds, and incremental recovery, recording foreground latency, background duration, memory, database size, and `.sy` read counts, including median and high-percentile results.

Foreground creation and reads must not scan the entire notebook because of new metadata. Renaming a parent with ready metadata must not read each descendant's body. Index construction can scan source documents but needs progress and recovery points. Caches have explicit limits and clear corresponding titles on lock; do not retain every content block's entire ancestor chain in memory. Measure existing background content-block `hpath` updates separately, without treating scheduling delays as database time or claiming separation eliminates all subtree updates.

Reports explain changes relative to the baseline. Duration depends on hardware, body size, and encryption costs; this draft provides no unmeasured speedup or fixed millisecond promise. Investigate query counts, transaction batches, and repeated source reads before selecting cache optimizations for substantial regressions; do not trade title semantics for performance.

### Implementation checks

Behavior tests enter existing frontend and kernel discovery; new Go contract tests retain `Contract` in their names. After API implementation, run `pnpm run api:generate --petal ../../petal`, `pnpm run api:check --petal ../../petal`, `pnpm run lint`, and relevant frontend tests from `app/`. From `kernel/`, run `go test ./apicontract/...` and regressions covering affected APIs, models, filesystem, block-tree, and SQL behavior. Before release, existing complete test entry points cover `pnpm test` and `go test -tags "fts5 sqlcipher" ./... -count=1`.

Change CI filters or maintenance guides only if existing discovery would miss new tests. These are implementation acceptance requirements, not functional tests already executed for this design document. Documentation changes themselves verify bilingual consistency, examples, links, and diff formatting.

## Related code

| Area | Entry points |
| --- | --- |
| Creation, rename, title normalization, and name resolution | [`model/file.go`](../kernel/model/file.go), [`model/path.go`](../kernel/model/path.go) |
| APIs, mode configuration, and contracts | [`api/filetree.go`](../kernel/api/filetree.go), [`api/notebook.go`](../kernel/api/notebook.go), [`apicontract/filetree_remaining.go`](../kernel/apicontract/filetree_remaining.go), [`conf/box.go`](../kernel/conf/box.go) |
| Source documents and read-only path recovery | [`filesys/tree.go`](../kernel/filesys/tree.go), [`filesys/hpath.go`](../kernel/filesys/hpath.go) |
| Path refresh, recovery queues, and document indexes | [`treenode/blocktree.go`](../kernel/treenode/blocktree.go), [`treenode/hpath.go`](../kernel/treenode/hpath.go), [`model/hpath_refresh.go`](../kernel/model/hpath_refresh.go), [`sql/queue.go`](../kernel/sql/queue.go) |
| Search and hierarchy calculations | [`model/search.go`](../kernel/model/search.go), [`sql/block_query.go`](../kernel/sql/block_query.go), [`search/config.ts`](../app/src/search/config.ts) |
| Creation entry points and save path parsing | [`util/newFile.ts`](../app/src/util/newFile.ts), [`util/parseNewDocTarget.ts`](../app/src/util/parseNewDocTarget.ts), [`mobile/util/initFramework.ts`](../app/src/mobile/util/initFramework.ts) |
| Templates, new database items, and shorthands | [`model/template_doc_tree.go`](../kernel/model/template_doc_tree.go), [`model/attribute_view_new_item.go`](../kernel/model/attribute_view_new_item.go), [`model/shortcuts.go`](../kernel/model/shortcuts.go) |
| Daily-note reuse and legacy creation regressions | [`model/daily_note.go`](../kernel/model/daily_note.go), [`model/file_test.go`](../kernel/model/file_test.go) |
| Import and export | [`model/import.go`](../kernel/model/import.go), [`model/import_obsidian.go`](../kernel/model/import_obsidian.go), [`model/export.go`](../kernel/model/export.go) |
| Reusable rich-source validation pattern | [`treenode/table_cell_rich.go`](../kernel/treenode/table_cell_rich.go) |
| Document versions | [`treenode/tree.go`](../kernel/treenode/tree.go), [`.sy` file structure](SY-FORMAT.md) |
