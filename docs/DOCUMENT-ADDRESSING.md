# Document titles and addressing

[中文](DOCUMENT-ADDRESSING.zh-CN.md)

Related issues: [Support `/` in document titles](https://github.com/siyuan-note/siyuan/issues/19938), [Improve content preservation when converting headings to documents](https://github.com/siyuan-note/siyuan/issues/19235), [Improve document titles, notebook names, and plugin compatibility](https://github.com/siyuan-note/siyuan/issues/20837)

This document defines document titles, hierarchy addressing, readable paths, APIs, and migration behavior. Development implementation and release requirements are described separately; development capabilities do not establish availability in a released version. See [Document rename and path indexes](DOCUMENT-HPATH.md) (Chinese) for the current rename and index update mechanism.

### Current implementation scope

The development branch implements a shared title reader, document metadata organized by identity, and recovery markers for source commits. It provides the `getDocPaths`, `resolveDocPath`, `getDocCreateTarget`, `planDocCreate`, and `createDocByParent` contracts. Built-in document and reference creation, daily notes, database creation, and shorthands use identity-based creation or shared creation plans. Export allocates filenames by document identity before using the same mapping for internal links. Existing document IDs, title representations, and applicable `.sy` specifications remain intact; upgrading does not rewrite every source document.

Creation plans retain fixed IDs and never recreate confirmed ancestors. Desktop and mobile share failure handling: an uncertain response or a failure after source commit retains the plan until the user approves an identity check and continuation. Closing or locking a notebook clears its title and template caches. Local shorthands keep a recovery record containing only identities and digests, verify block identities in the actual source before consuming the input, and preserve unresolved input without automatically replaying the operation.

Administrators can read `documentCapabilities` from notebook configuration. It reports structured API support, title capabilities and index readiness; availability follows existing access boundaries. Whole-notebook imports still remap notebook and anchor IDs, partial imports retain destination configuration, and encrypted creation targets retain authentication, password-change and backup recovery boundaries.

All notebooks use structured title rules without a mode switch, mode-1 migration or capability floors. New writes with ASCII `/` in a title use Spec 6; legacy string interfaces check each candidate ancestor chain. Every device must still upgrade together. Default support does not establish release-package, historical-data, performance or platform acceptance; inline-title extension requirements remain unchanged.

## Goals and scope

Document IDs determine identity and hierarchy membership; titles express content; readable paths provide presentation. Creation, moves, and references must not recover document identity by parsing display text. Once the affected entry points have migrated and compatibility has been verified, document titles can contain the ASCII slash `/` while remaining distinct from existing fullwidth slashes `／`.

Inline titles and bidirectional conversion, literal `/` in notebook names, and actual third-party plugin compatibility remain tracked by #20837. Title representation, text extraction, display and identity stay separate; future rich titles require an explicit format and editing design, and current plain-text indexes must never overwrite unknown source representations.

The design covers desktop, browser, mobile, kernel APIs, and plugin-visible data, subject to the respective access boundaries of ordinary and encrypted notebooks. Notebook names participate in path presentation as separate display fields. Their character restrictions and rich text support require a separate assessment of configuration formats and older clients; document title rules do not automatically apply to notebook names.

### Design decisions

| Area | Selected approach |
| --- | --- |
| Document addressing | Notebook and document IDs; creation takes a parent identity and a separate title |
| Addressing rules | All notebooks use structured titles; configuration version `2` is diagnostic metadata |
| Plugins | Accept adaptation of plugins that depend on legacy `hPath` rules; deliver replacement APIs and migration guidance before enabling new characters |
| Legacy string addressing | Validate real candidate ancestry; retain clean paths and reject slash/empty-title conflicts |
| Readable paths | Join original ancestor title text for display; do not encode `/` or decode `／` or `%2F` |
| Indexes | Retain existing `hpath` columns and add internal document metadata; do not store full title segment arrays on every content block |
| Title sources | Keep ordinary titles in the first implementation, with an extension boundary for versioned inline content and one-way plain-text derivation |
| Upgrade policy | Stop all clients accessing the same workspace or synchronized data, upgrade every device to a version supporting mode `2` and Spec `6`, and resume only with those versions; implement rich titles separately |

`/A/B` can describe two documents or one literal title. Legacy queries return results only when every candidate ancestor has a nonempty title without `/`; collisions return an explicit error. Identity operations and structured replacement APIs remain available. Display strings are not stable identities.

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
| Legacy path protocol | Existing API/plugin `hPath` and `hpath` strings | Retain compatibility only for candidates with verified clean ancestry |
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

`DocumentPath` contains `notebook`, `id`, `parentID`, `path`, `title`, `segments`, `depth`, `displayPath`, and `revision`. `title` is `{format, text, empty}`; `segments` contains `{id, text, empty}` entries from the root through the current document. `displayPath` starts with `/` and joins segments with `/`, displaying `/` for an empty array, for presentation only. The notebook name is returned separately or obtained by the caller, not inserted into the segment array. Here, `title` is a summary, not a complete copy of a future rich source that can be written back.

An ordinary root document has `depth: 1` and `parentID: null`. With notebook documents enabled, the notebook document has `depth: 0` and empty `segments`; ordinary root documents remain at level one, with no additional physical directory. Passing the notebook document ID as a creation parent is equivalent to the explicit root, retaining the existing logical-root mapping. Root child-name queries exclude the notebook document itself so it cannot be mistaken for an ordinary root document.

Path revisions use versioned serialization with unambiguous field boundaries, covering ancestor IDs, title revisions, and current location, not just second-resolution modification times. Direct creation by parent ID may follow the parent's current location. A caller requiring a preview to remain valid submits `expectedParentRevision`; ancestor renames or location changes invalidate it. Digests check consistency and do not grant access across authorization boundaries.

## Extension requirements for inline titles

Title access must expose clear boundaries for source content, plain-text extraction, and presentation. The current implementation can continue storing ordinary strings, but addressing, depth calculations, creation target resolution, and filename allocation must not depend on the specific IAL string representation or pass title content to filesystem path normalization functions.

Future support for bold, italic, inline code, and other elements should reuse existing inline content models, parsers, and renderers, with an explicit format discriminator or version for document titles. Existing titles containing `**text**`, backticks, or link syntax remain literal content; upgrading must not automatically reinterpret them as rich text. A separate rich title design will select inline Markdown, a node structure, or another representation.

The new format must specify one authoritative title source. A plain-text title retained for compatibility is derived from that source; both must be saved and recovered consistently rather than becoming two writable sources that overwrite each other. Legacy APIs must not write the plain-text projection back over a rich title and silently discard formatting. Writes that do not support the title format must be rejected; body edits must also preserve the title source or explicitly refuse to save.

Plain-text extraction for rich titles needs rules for whitespace, line breaks, inline math, link text, empty titles, and length limits. Two titles differing only in style can produce the same plain text; IDs still distinguish identity and references. Search, sorting, and export filenames must not treat Markdown markup or rendered HTML as title text. Titles within exported content can preserve inline elements supported by the destination format.

Render ordinary titles as text through existing escaping or text-node mechanisms, not direct HTML concatenation enabled by new characters. Rich titles reuse validated nodes and renderers. The plain-text summary in `DocumentPath` and the editable source have separate read boundaries, with format-specific writes preventing presentation data from overwriting the source format.

Block references, dynamic anchor text, links, tags, and assets need additional rules for dependency updates, click behavior, reference and asset ownership, cycles, ID remapping during copying and import, and encryption boundaries. This design preserves representation space for those capabilities without committing to enabling every inline element at once. The later rich title implementation must also cover input methods, selection, undo, mobile interaction, history, sync, and export.

### Conversion between headings and documents

Currently, `Heading2Doc` uses `headingDocParagraph` to move inline nodes that the document name cannot fully represent into a body paragraph, including images, links, formatting, and original text altered by normalization or truncation. Foundational separation preserves that behavior. Once titles allow `/`, a preservation paragraph needed solely because of slash replacement may become unnecessary, but other content must not be discarded. Evaluate title text extraction separately from preservation of the original nodes.

Use #19235 as a later inline-title round-trip acceptance case: supported inline elements and asset references become title source content; unsupported elements remain in the body. Reverse conversion or merging back into a document preserves node content, asset ownership, and references, restoring heading levels under explicit rules. Equal plain text does not prove that a body paragraph duplicates the title and cannot justify deleting user content. Automatic merging requires verifiable conversion provenance and content revisions; retain content when provenance is uncertain or the user has edited it, rather than blindly deduplicating. Existing ordinary documents do not automatically move their first paragraph into the title.

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

Titles retain the 512 Unicode code-point limit and existing invisible/private-use character restrictions, preserving ZWJ for combined emoji. New APIs return `invalidTitle` for excessive length, forbidden characters, surrounding whitespace and standalone `.` or `..`, while allowing `/` inside titles without silently truncating or replacing input.

Structured title mode performs no filesystem path cleaning, width conversion, percent decoding, or Unicode normalization. `/`, `／`, `%2F`, repeated slashes, and `A/../B` remain literal text; only parent identity determines hierarchy. Ordinary creation permits duplicate titles under the same parent, returning a new ID without implicitly overwriting or reusing an existing document.

### Resolution by title segments

Creating a hierarchy by name requires an explicit starting location and a title segment array. Use known ancestor identities directly; resolve unknown ancestors one level at a time under the current parent. Create an absent match according to the operation's rules. Multiple matches produce ambiguity and candidate identities within the authorized scope, never an arbitrary first match. The generic resolver does not search descendants across same-named parents to guess user intent.

A `/` within a structured title segment does not create another level, and `.` or `..` does not navigate. Moving up a level, starting from the notebook root, and anchoring at the current document require separate representations. An empty segment array means the starting location itself. An empty string cannot automatically match an empty-title parent, while creation can explicitly submit an empty final title. The caller's `onMissingParent` policy determines whether missing ancestors may be created.

Name matches and parent path revisions are separate commit conditions. `nameConditions` records `{parentID, title, expectedID}`: `parentID` is a parent document ID or `null` for the logical root, and nonempty `title` uses the shared exact plain-text matching rules. `expectedID: null` means no same-named child may yet exist; a document ID means the sole match must still be that document. Omitting `expectedID` is invalid. Accept at most 128 conditions, limited to the destination notebook, the actual ancestor chain, and the final parent, without enumerating unrelated locations. Normalize a notebook document ID to the logical root first, excluding the notebook document itself and empty-title placeholders from name queries.

Creation of a missing ancestor must submit its absence condition and retain the unique-identity conditions for ancestors previously matched by name. The kernel rechecks them under coordination shared with creation, rename, move, and deletion, holding that coordination through source and metadata commits. Any mismatch returns `planChanged`; callers resolve again instead of automatically reusing a newly appeared document. If two callers concurrently create the same missing ancestor, at most one satisfies the original absence condition. Ordinary final-document creation may omit name conditions and still allow duplicate sibling titles; do not add a unique title index. `expectedParentRevision` does not replace these conditions.

### Commits, partial failures, and retries

There is no cross-file atomic creation API. Plans validate predictable title, depth, ambiguity, template and permission failures before writes, allocate fixed IDs and record ancestor identities and revisions. Submission revalidates these conditions; concurrent name changes require replanning rather than selecting another document.

General multi-level creation commits documents separately; existing template document trees retain the transaction and undo grouping shared by parent edits and child creation, rather than becoming unrelated user operations during addressing migration. Success requires durable source documents and all body and attribute changes required by that operation, with document metadata already readable; full-text search indexing can remain asynchronous. Templates, footnotes, math, clipping sources, tags, sorting, and refresh notifications retain their workflow semantics rather than being lost when location resolution is separated.

Keep documents already persisted when a later step fails. Error data distinguishes `commitState: "none"`, `"committed"`, and `"unknown"` and includes confirmed document IDs, the failed stage, and completed steps. `committed` means the source document was committed, not that all subsequent actions succeeded. If persistence cannot be determined, return `unknown` rather than claiming no write occurred. Multi-level workflows retain the original plan and completed IDs and show where processing can continue.

Callers retain allocated IDs before sending requests. After a lost response or unknown outcome, complete any necessary index recovery, then verify the source document and target by the original ID without allocating another ID. Submitting an existing ID returns `documentIDConflict`; it does not overwrite the document or interpret existence alone as proof of a successful identical request. The first implementation does not promise automatic idempotent replay. Side effects such as template application or body appends must not be repeated without verification.

Recovery handles only unfinished steps and does not automatically delete successfully created parent documents. Non-repeatable follow-up actions such as clearing source data require all necessary workflow steps to succeed. Partial success or merely receiving a document ID cannot trigger deletion of shorthand source data.

After successful template document tree creation, undo and redo retain the existing grouping and ID-remapping semantics for parent edits and documents created by that operation. After partial failure, recovery and undo records reflect actual completed steps and must not act on uncommitted documents. Redo uses retained plan snapshots instead of reevaluating time-sensitive templates. Subsequent edits to existing or newly created documents remain subject to transaction conflict checks and cannot be deleted merely to clean up a failed plan. If side-effect completion cannot be established, stop automatic continuation and present confirmed results; an index recovery marker is not proof of business success.

### Template versions

Legacy string save paths retain their current interpretation, including absolute and relative paths, `..`, trailing `/`, empty templates, cross-notebook context, and an explicit name replacing the final segment. New syntax must have an identifiable version and must not automatically reinterpret existing configurations.

The compatibility compiler evaluates legacy template syntax into structured plans, passing new titles separately. Relative navigation uses document IDs and parent relationships. A variable containing `/` still creates legacy syntax segments until the configuration explicitly adopts the new template format.

Built-in creation workflows use strict structured plans without selecting arbitrary same-name ancestors. The public legacy creator retains disambiguation by a valid matching `parentID` and its existing unambiguous fallback. Unresolved duplicate parents return `pathAmbiguous`.

`docCreateTarget`, `refCreateTarget` and `dailyNoteTarget` coexist with legacy template fields and are available in all notebooks. Each version `2` object specifies the notebook, start, upward traversal, ancestor segments, final title and missing-ancestor policy. Existing global templates and inheritance remain; save-path syntax and body-template syntax are interpreted separately.

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

An active new object is authoritative for its workflow. Unchanged legacy fields can be returned, but conflicting edits are rejected. Removing the object restores legacy template evaluation without changing addressing rules. Existing inheritance remains when no object is configured, and cross-notebook targets still require source-format and access checks.

Configuration-derived previews retain the source notebook, workflow purpose, effective configuration revision, and evaluated context. Submission checks configuration through `expectedTarget: {notebook, purpose, revision}`, where `notebook` identifies the configuration source and may differ from the creation destination. The revision covers the effective target, participating inherited configuration, and selected body-template path; unrelated settings do not invalidate a preview. Under coordination shared by configuration updates and document mutations, the kernel resolves effective configuration again and checks its revision and destination notebook before committing. A change returns `planChanged` even if the parent path is unchanged. Body-template previews separately retain rendered content and dependency snapshots; configuration revisions do not replace content snapshot checks.

### Workflow migration

| Entry point | Preserved behavior and migration focus |
| --- | --- |
| Ordinary creation and creation from block references | Create directly under known parent IDs; pass titles separately and retain document IDs in generated references |
| Daily-note button and shortcut | With no explicit date, reuse the target produced by today's naming and path template; renaming or moving the original note away from that target can result in another note being created |
| Date references and explicit-date APIs | First reuse notes with the date attribute in the target notebook; prefer the template target among matching notes, otherwise select by ascending ID; without a date match, reuse or create the template target |
| Shorthands | Distinguish appending to an explicit target from creating a new target; clear the source only after destination persistence succeeds |
| New database items | Preserve attribute values, bindings, and sorting; retain the final document ID in the creation plan |
| Template document trees | Preserve previews, ID remapping, insertion order, and grouped undo and redo; validate path, name, and configuration conditions on commit and expose partial completion |
| MCP and built-in Agent | Document tools prefer notebook plus `parentID`, with an empty string for root; legacy paths share ancestor validation and reject ambiguous single targets |
| Desktop, browser, and mobile | Inspect menus, shortcuts, dialogs, and handlers separately; shared utility migration does not replace platform verification |

Daily notes retain two entry-point policies: omitting `date`, passing an empty string, or passing `null` to `createDailyNote` uses the ordinary button's template-target policy; an explicit date (including today) and `getDailyNoteInfo` use date attributes. The date entry can still reuse a renamed or moved note while the ordinary button may create a new template target; once that target also carries the day's date attribute, the date entry prefers it. Neither entry reapplies body templates when reusing an existing note. Multiple date matches follow this selection order rather than always returning ambiguity; template-target matching compares structured identity chains.

## Search and derived indexes

Structured ancestor chains provide a common data source. UI presentation, legacy protocol output, plain-text search, and export each apply conversions appropriate to their purpose. The shared boundary is the source of titles and hierarchy, not a requirement for every consumer to use one serialized string.

Document depth, parent-child relationships, and subtree scope derive from ID data paths or explicit document relationships. Consumers must not derive structure by counting slashes in `hPath`, using `path.Base(hPath)` or `path.Clean(hPath)`, or slicing display strings by depth. Indexed document titles come from the title source; recovery reads must use the same data boundary.

Search scope filtering is separate from path text matching. Scope uses document identities or ID data paths. Text matching uses the plain-text title representation and ancestor text without replacing `/` with `／` or vice versa. Search highlight markers and HTML in results are presentation output; they cannot become title source content, and adding document titles to results must not overwrite existing match highlighting.

The first implementation retains `blocks.hpath`, `blocktrees.hpath`, and the existing batch update mechanism, adding the document metadata described above as the source for structured queries. Assemble ancestor chains per document with bounded caching, without copying full title arrays onto every content block. Plugins can still read string columns, but in the new mode they are display and text-search data only.

`RefreshDocHPaths` reconstructs ancestor titles from the ID subtree and metadata instead of slicing old `hPath` values by depth. `updateRootContent` obtains the document title from the shared title reader instead of `path.Base`. In steady state, renaming a parent does not read every descendant's full `.sy` file just to obtain its title. Missing or invalid metadata enters recovery rather than being filled from old display paths.

Renames still invalidate display paths, ancestor text search data, and related caches. Source saves, document metadata updates, background batch validation, and interruption recovery must remain ordered, and queued old trees must not restore stale titles or paths. ID-based addressing removes the effect of titles on identity; it does not eliminate every rename update task.

## Import and export

### Cross-notebook moves and recovery

Moves, copies, native imports and history recovery preflight the complete operation set before the first write, including descendants, source formats, title representations, depth and encryption boundaries. Unsupported formats are refused without rewriting titles or deleting sources. Source-version checks protect Spec conflicts independently of retired mode records.

Supported historical sources remain readable and recoverable; new writes using title capabilities carry the required Spec. Client upgrades neither rewrite every document nor lower an existing specification to pass validation.

Ready metadata may support whole-subtree preflight; imports and history use their authenticated source snapshots. Recover missing or stale indexes rather than inferring capabilities from old `hPath` values. Preflight records identities, membership, and title and location revisions for the whole operation set; revalidate under mutation coordination to catch descendant renames or additions before commit. Reject predictable incompatibilities before any write. Actual I/O failures follow partial-commit recording and recovery rules without claiming atomic multi-file moves. Existing isolation between ordinary and encrypted notebooks, and between different encrypted notebooks, remains unchanged.

### Filename and link mapping

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

Results contain `status`, `start`, `resolved`, `nextIndex`, `candidates`, `candidatesTruncated`, and `nameConditions`. `start` returns the starting identity and revision; `resolved` and `candidates` use `DocumentPath`. `nextIndex` is the zero-based index of the next segment. `status: "resolved"` means all segments matched; `"missing"` means no document exists from that segment onward; `"ambiguous"` means that segment has multiple candidates. Return at most 128 candidates ordered by ID, setting `candidatesTruncated` if more exist. Reaching the limit still reports ambiguity: callers must use an explicit parent ID, never default to the first truncated candidate.

`nameConditions` contains a condition for each uniquely matched segment. A missing result also includes the first missing segment's absence condition; an ambiguous result does not generate a successful condition for the ambiguous segment. An empty segment array returns an empty condition array. The chain and conditions come from one verifiable snapshot and still require revalidation on commit. After creating the first missing ancestor, plugins resolve again using the original start and complete original segment array so subsequent conditions use confirmed parent IDs. One missing result does not reserve the entire nonexistent path.

Resolution accepts at most 128 segments, each within the title length limit; actual creation still enforces the user's document depth restriction. Empty string segments fail; existing empty-title parents require ID selection. A root result uses an explicit root location, not an invented document ID. Root revisions cover notebook identity and relevant configuration, without invalidation by unrelated child changes. The notebook document ID, when used as a root alias, also uses root revision validation. Errors and candidates must not expose another notebook's titles.

### Creation by parent ID

The minimal `/api/filetree/createDocByParent` request follows; its required indexes must be ready and existing authorization requirements apply.

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
| `nameConditions` | Optional array of at most 128 name-match conditions; required when creating a missing ancestor, with its absence condition matching this creation's nonempty title and parent |
| `expectedTarget` | Optional configuration source `notebook`, `purpose`, and `revision`; required when submitting a preview derived from save-path configuration |
| `tags`, `withMath`, `clippingHref` | Optional, retaining the corresponding Markdown creation behavior |
| `sorts`, `sortTargetID`, `sortPosition` | Optional, preserving sort validation; relative targets must still be sibling documents, and conflicting sort specifications fail |
| `docCreateTemplatePath`, `listDocTree` | Optional, retaining existing body-template and document-tree refresh semantics |

Reject additional targeting fields such as `path` and `hPath` to avoid competing location sources. A parent mismatch fails directly without falling back to name resolution. Success returns `{id, document: DocumentPath}`; clients use the returned ID to open, reference, or append to the document.

Name conditions, parent path revisions, and configuration revisions are checked separately and do not replace one another. Omitting conditions means direct creation by known identity, without a guarantee that an earlier name- or configuration-derived preview remains valid. Conditions grant no authority; the kernel still validates access, ownership, and leases. Multi-level plans check applicable conditions before each commit and report actual commit states for the current and preceding steps on failure, without selecting another parent.

Business errors use `code: -1` with a stable `data.reason`. `msg` is for human readers, not plugin branching. The table collects reasons used across this design; each creation, move, import, or recovery endpoint declares only applicable error variants, retaining the corresponding commit state and recovery information. Authentication, role, locking, and general request-validation failures continue using their middleware contracts rather than replacing every existing error format.

| Reason | Meaning and caller action |
| --- | --- |
| `invalidTitle` | Invalid title representation, characters, or length; correct the input |
| `parentUnavailable` | Parent absent or outside the target notebook; do not search another notebook |
| `planChanged` | Location, title revision, name matches, configuration, or other preview dependencies changed; resolve and confirm the target again |
| `documentIDConflict` | ID exists; verify the original outcome without overwriting or immediately retrying with a new ID |
| `legacyPathUnsupported` | Only slash/empty-title ancestor candidates exist; use a structured API |
| `pathAmbiguous` | Clean and unsupported candidates collide, or a single target has multiple clean matches; select an explicit identity |
| `indexUnavailable` | Structured metadata is not ready; wait for recovery without falling back to display paths |
| `unsupportedTitleFormat` | Client or endpoint cannot handle the title format; upgrade or use an endpoint supporting that format |
| `targetModeUnsupported` | Source document format validation failed; preserve the source, inspect the reported specification or representation error, and repair or upgrade before replanning the move |
| `writeFailed` | A write or later processing failed; recover using `commitState` and the reported stage |

### Reading the effective creation target

`/api/filetree/getDocCreateTarget` accepts the current `notebook` and `purpose: "document" | "reference" | "dailyNote"`. It reuses each workflow's existing configuration precedence and returns the effective `target`, `docCreateTemplatePath`, and configuration `revision`. `target` is a union tagged by `version`: legacy templates return `{version: 1, notebook, path}`, while new templates return the complete version `2` object above. The returned `docCreateTemplatePath` is the effective body-template path for that workflow: ordinary creation follows existing inheritance, daily notes use `DailyNoteTemplatePath`, and reference creation retains its current behavior without automatic body-template application and returns an empty string. The endpoint only reads configuration; it neither evaluates templates nor guesses the current document or date. Callers supply context when generating the plan and include the source, purpose, and `revision` in submission conditions.

Legacy `getDocCreateSavePath` and `getRefCreateSavePath` retain their response for effective legacy templates. An active corresponding new object returns `code: -1`, `data: {reason: "structuredTemplateRequired"}`. The decision follows the configuration source and workflow, without inferring configuration from display strings or consulting retired addressing modes.

### Planning a configured creation target

`/api/filetree/planDocCreate` accepts `notebook`, `purpose`, and the final document's fixed `id`. Optional `contextID` identifies the current document; omission or `null` means there is no current document. Optional `title` overrides the final title, `placement` is `configured` or `child`, and `reuse` controls whether an existing final document may be reused. The endpoint evaluates and validates without writing documents. Time templates within a plan share one time snapshot. The response contains the final title, target notebook, optional `existingID`, and ordered `steps` with fixed IDs, parent identities, name conditions, and configuration revisions.

The caller submits each `createDocByParent` request in order, updating the next step's parent revision from the previous successful response. The returned identity is authoritative after submission. Failures follow their reported commit state; callers must not allocate a fresh set of IDs and blindly replay. A plan is not a transaction across multiple files, and successful planning does not replace validation at each commit.

### Capability discovery

Administrator `getNotebookConf` responses include read-only `documentCapabilities` with `structuredPaths`, `literalSlash`, `titleFormats`, `indexState` and `revision`. `structuredPaths` advertises ID and title-segment APIs; `literalSlash` is true only with a ready index. `indexState` reports `missing`, `building`, `ready` or `error`. All notebooks follow the same structured rules.

Capability reads do not write migration or floor records. `revision` summarizes the capability declaration, not an individual document path. Desktop, browser and mobile inputs use the same title rules without a runtime addressing-mode switch. Existing closed-notebook, lock, publish-access and request-lease restrictions remain; capability metadata grants no additional access.

### Contract and declaration maintenance

Implementation follows [Kernel API type contracts](API-CONTRACTS.md): define declarations in `kernel/apicontract/`, bind with `contractHandler`, generate types, and synchronize maintained Petal declarations and its changelog. Detailed new endpoint behavior belongs in the corresponding contract comments. When existing endpoint behavior changes, inspect and synchronize existing entries in the Chinese, English, and Japanese API references. Do not automatically add new endpoints to those references or add feature-specific endpoint descriptions to the contract maintenance guide.

## API and plugin compatibility

Legacy `getIDsByHPath` checks readiness and pending writes in the same metadata snapshot as the exact display-path candidates and their real ancestor chains. A clean chain has nonempty text, no empty-title flag and no ASCII `/` at every level. A slash, actual empty text or empty-title placeholder makes a candidate unsupported. Attribute entities are decoded once on source read, never again on metadata. Missing ancestors, cycles, inconsistent identities/path revisions and SQL errors return `indexUnavailable`. Even an empty result requires a proven ready index.

| Clean candidates | Unsupported candidates | Query result |
| --- | --- | --- |
| Present | Absent | All clean IDs |
| Present | Present | `pathAmbiguous` |
| Absent | Present | `legacyPathUnsupported` |
| Absent | Absent | Empty array |

Failures use `code: -1` and stable `data.reason`, with `cleanIDs` and `unsupportedIDs` candidate fields; empty lists may be omitted. IDs remain subject to publish-access filtering and encrypted response leases. Existing success values remain arrays or document IDs; callers must not match error prose.

Before its first source write, `createDocWithMd` checks every parent prefix, including later prefixes after an earlier missing one. Any slash/empty-title candidate returns `pathAmbiguous`. Multiple clean parents also return that error unless a valid matching `parentID` selects their real ancestor chain; an ID never overrides unsupported candidates. CLI and MCP single-target resolution shares this validation and cannot arbitrarily select a clean duplicate. Root locations retain their existing meaning.

Prefer `resolveDocPath` with independent title segments, `createDocByParent` with a parent ID and independent title, and `planDocCreate` for multiple levels. Legacy requests also return `indexUnavailable` during rebuilding; callers await recovery without falling back to unverified display strings or SQL prefix guesses.

## Versions, encryption, and recovery

### Coordinated upgrades and older-client risks

Mode 1 is retired. Every notebook follows structured rules without migrating or rewriting document IDs, source files, ciphertext or keys. Configuration saves do not generate an addressing-version marker; an existing marker is ignored and omitted on the next ordinary save. Missing notebook configuration or directories do not cause capability reads to stat missing directories or recreate data.

New writes with ASCII `/` in a title require at least Spec 6. Retain independent Spec detection, duplicate-property and single entity-decoding checks, and rejection of unknown title representations and future specifications. Supported historical low-Spec slash sources remain readable and recoverable; raw new writes must carry the required specification. Ordinary documents retain the specification required by body features, without bulk upgrades or version downgrades.

Stop all clients accessing the workspace or synchronized data before upgrading every desktop, mobile and server instance; offline older devices must upgrade before reconnecting. Older clients ignore mode records, and Spec 6 cannot protect every legacy-Spec document in the notebook, so retirement does not permit mixed-version use. The existing isolated `v3.8.9-alpha.4` source probe established direct Spec 6 rejection, continued legacy-Spec reads and stale-edit source overwrite, without covering every old-client operation or complete mixed-device synchronization. Older clients may use verified independent exports or pre-upgrade backups restored into separate workspaces, never overwrite original configuration and resume synchronization.

### Retired records and startup cleanup

Capability reads, imports, sync, snapshots and settings backups no longer read or generate capability floors, mode migration records or the settings `documentAddressing` field. That field in old settings is ignored. Sync and recovery still preflight source Spec, canonical paths and existing authentication boundaries before applying changes.

Startup idempotently removes local `conf/document-addressing.json` and `conf/document-addressing-recovery/`. Missing directories succeed, removal failures log warnings without blocking mounting, and read-only startup skips cleanup. Notebook `.siyuan/document-addressing.json` files are no longer read or created; existing files stay untouched to avoid synchronized deletions. Encryption recovery keys and source-recovery tasks are outside this cleanup.

### Index and task recovery

`document_metadata` uses an independent derived-index version and per-notebook states `missing`, `building`, `ready`, and `error`. Build the new table from source documents and ID locations, not segment boundaries guessed from old `hPath` values. Record incremental changes during construction and catch up before switching; mark the corresponding generation `ready` only after the full scan and incremental validation complete.

Structured and legacy path endpoints return `indexUnavailable` whenever required metadata is not ready. Recovery authenticates actual sources; never recreate missing parent files or replace corrupt sources using derived titles.

Update in order: persist the source document, update metadata and the corresponding document row within one block-tree database transaction, then submit subsequent `hpath` batches. There is no claimed atomic transaction between source files and databases or between block-tree and content databases. Preserve recovery markers across interruption at any step. After restart or unlock, verify source revisions and current ID locations before resuming derived updates. Revision, move, and deletion checks invalidate queued old trees so they cannot restore stale titles.

The existing `temp/queue/hpath-refresh.queue` stores only notebook IDs, document IDs, and ID data paths. Migration must not add title segments, rich titles, or body text to this global plaintext queue. Concurrent renames, moves, deletion, sync, and ordinary index rebuilds still need stale-task checks and must not discard unfinished encrypted-notebook recovery tasks.

To cover a crash after the source write but before recovery work is registered, persist an identity-only pending-verification marker before mutation, or use an existing durable transaction record proven to cover that window. Fault injection must establish recoverability. Clear the marker only after completion; repeated recovery produces the same derived result. Keep tasks for locked encrypted notebooks instead of skipping authentication just to empty the queue.

### Encryption compatibility

Existing encrypted data is the compatibility baseline, subject to the authenticated-read, isolation, and recovery requirements in [Encrypted notebooks](ENCRYPTED-NOTEBOOK.md). Title sources, plain-text titles, and ancestor chains are protected document content. Reads, caches, and responses must remain within the notebook's authorization scope and operation lease, with cleanup on lock following the existing lifecycle.

In encrypted notebooks, `docCreateTarget`, `refCreateTarget`, and `dailyNoteTarget` are protected configuration and must not be persisted directly as plaintext `BoxConf` fields. The current encrypted `BoxCrypt.Metadata` payload contains only icon and sorting metadata. Define an independent `version: 2` for this payload, retaining `icon`, `sort`, and `sortMode` and adding `documentTargets` for the three optional target objects. Authenticate and read existing payloads without `version` as version `1`; ordinary configuration saves remain compatible with them. Generate version `2` when writing new target objects and do not downgrade that payload after removing the objects. Interpret this version separately from `BoxCrypt.Spec`, target-object `version`, and `.sy` versions.

While unlocked, the configuration reader projects target objects into authorized administrator responses under a lease. Before persistence, clear them from the plaintext configuration copy and retain only authenticated ciphertext. Clear corresponding plaintext caches on lock, and omit these objects from locked status and configuration responses and from non-administrator responses. Omitted or filtered fields do not request deletion. Ordinary configuration saves while locked preserve existing ciphertext verbatim; creating or changing target objects requires unlocking first. Cover old payload fixtures in new-payload reads, password-change rewrapping, import/export, historical configuration, and backup recovery. Reject interpretation or overwriting on unknown payload versions or authentication failure; unrecognized struct fields must not cause new configuration to be discarded.

Derived indexes can be rebuilt only after authenticating source ciphertext and validating the document format. Unknown formats, corruption, and authentication failures must preserve original data and return errors, without falling back to plaintext, cross-notebook queries, or unauthenticated old indexes. Rebuilding ordinary indexes does not establish authentication of encrypted source data.

The versioned configuration-payload extension retains the existing authenticated container, `siyuan/box-metadata` subkey purpose, and notebook-bound AAD without changing encryption envelopes, AAD semantics, or key derivation. Any later change to those formats requires a separate explicit version, authenticated migration, and interruption recovery design that retains matching keys and backup material. Never regenerate `MasterSalt`, discard keys, or require users to recreate existing encrypted notebooks to avoid incompatibility. Supported formats in documents, history, backups, and sync snapshots must remain recoverable.

## Implementation stages and release gates

| Stage | Deliverables | Completion criteria |
| --- | --- | --- |
| A: Compatibility protection | Candidate ancestor-chain validation and source-version protection, existing behavior fixtures | Sources checked before sync and snapshot application; unsupported formats safely refused at applicable read, write, and repair entry points; existing data remains readable and recoverable |
| B: Internal separation | Shared title access, document metadata, ID hierarchy calculations, path refresh, and recovery | Ordinary titles retain behavior; structure is no longer derived from display strings; encrypted indexes rebuild from authenticated sources |
| C: APIs and consumers | New read, resolve, and conditional-create APIs, version `2` templates and encrypted payloads, built-in workflow and platform migration | Name and configuration conditions and old/new contracts verified; partial failures and undo recoverable; daily-note and other business behavior retained |
| D: New characters | Uniform structured rules and index recovery, legacy API rejection, plugin migration guidance, cross-notebook operations, and import/export checks | Ordinary builds support `/` by default; whole-subtree preflight, index recovery, and all release criteria must pass to complete external release acceptance |
| E: Inline titles | Separate source-format, editing, and rendering design | Retain this design's identity APIs and deliver separately after format and old-writer protection |

Stages A through D are implementation and acceptance groups, not a requirement to publish separate transitional releases. The development branch enables new characters by default; external release acceptance still requires their relevant conditions and the coordinated-upgrade instructions above. Stage E is not a prerequisite for the foundational separation, but A through D must not reintroduce assumptions that titles will permanently have plain-text sources.

Release gates include migrated built-in consumers, replacement APIs and plugin guidance shipped with the feature, verified existing-data compatibility and format/capability rejection, interruptible ordinary and encrypted index migration, exports that do not overwrite files due to display-path collisions, consistent desktop/browser/mobile behavior, and user guides in all four bundled languages covering default behavior, plugin impact, coordinated upgrades, and the consequences of older-client mixed use. Safe mixed use with older clients is not a supported release scenario.

The implementation allocates `.sy` specification `6`. Performance measurements, compatibility results, and platform acceptance remain release evidence. No separate protective-release number is required for this issue's completion. Feature-release compatibility claims must be supported by verification of the actual release and its capabilities. Completing documentation, passing isolated tests, or rebuilding an index once does not establish full feature acceptance.

## Verification and acceptance

### Behavior matrix

| Area | Required scenarios |
| --- | --- |
| Title content | `/`, `／`, repeated slashes, `%2F`, `.`, `..`, empty titles, Unicode, and length boundaries; no uncontracted character conversion |
| Identity and hierarchy | One title `A/B` versus two levels `A`, `B`; duplicate titles under the same or different parents; ownership checks for duplicate IDs; root locations and notebook documents |
| Creation and concurrency | Direct ID creation following parent location versus revisioned requests rejecting stale previews; concurrent same-named ancestor creation, changed match sets and configuration; parent deletion, cross-notebook moves, closure, or locking; lost responses, partial commits, fixed-ID conflicts, and multi-level recovery |
| Templates | All legacy syntax boundaries and legacy template syntax and matching parent-ID disambiguation; segment-by-segment rendering, variables containing `/`, relative operations, one time snapshot, configuration inheritance and body-template selection, daily-note and shorthand workflows, and grouped template-tree undo and redo |
| Search and presentation | Original title character search, ancestor text search, ID scope filtering, title highlights, breadcrumb boundaries, copied text, and ID links |
| Indexes and recovery | Deep subtrees, successive parent and child renames, stale edit snapshots, interrupted batches, restart, moves, deletion, sync, and ordinary and encrypted index migration |
| Import/export and cross-notebook operations | Duplicate names, invalid filenames, case collisions, path escape, relative links, cross-notebook references, title metadata, and lossless round-trip guarantees; moves, copies, and recovery preflight every descendant, with no partial writes on rejection |
| Legacy APIs and plugins | Clean legacy path compatibility and real ancestor-chain collision errors; both legacy target readers reject obsolete configuration independently of destination diagnostic markers; SQL display collisions, structured replacements, and missing capabilities distinguished from request errors |
| Legacy data, limited readers, and encryption | Supported historical source and configuration payload fixtures; fixed capabilities, snapshot compatibility, pending/unready-index rejection and read-only cleanup skipping, authentication failure, caches and responses during lock, history and backup recovery, and retained key material |
| Inline extension capability | Existing Markdown-like title text remains literal; representation changes do not affect identity or hierarchy; identical plain text does not merge documents; formatted source derives plain text in one direction; #19235 image/link round trips preserve content and asset references without duplication |
| Platforms and performance | Creation and rename on desktop, browser, and mobile; foreground latency, database batch time, memory, CPU, and disk I/O for large subtrees |

### Essential regression cases

Retain `TestCreateDocsByHPathUsesParentIDForDuplicateHPath` and `TestCreateDocsByHPathKeepsHPathFallbackForDifferentParent` to prove that new rules have not silently replaced the legacy compatibility entry point. Separately test the new endpoint following the same parent ID after a rename, rejecting a parent moved to another notebook, never selecting a same-named parent, and returning `planChanged` for stale revisioned requests.

Create a root document `A/B`, a root document `A` with child `B`, a root document `A／B`, and a root document `A%2FB` together. The first two may share a display path, but must retain correct IDs, `segments`, `depth`, subtree scope, and export links. Neither of the latter two may be converted into the former structures. Add repeated slashes, dot segments, empty titles, case differences, and different title formats with identical plain text.

Have two requests resolve the same missing ancestor and submit the same absence condition; exactly one succeeds and the other returns `planChanged`, while ordinary same-named final documents can still be created separately. A second same-named candidate invalidates a previously unique ancestor condition. Changing the destination notebook, inherited configuration, or body-template path after preview must reject submission even with the same parent path revision. Cover rename and configuration-update races between final validation and commit.

Build a subtree with an ordinary root and slash/unknown-representation descendants. Moves, copies, imports and recovery preflight every descendant, source specification and authentication boundary; changes after preflight are detected without lowering versions or relaxing encryption.

Verify old-configuration and snapshot restoration, missing configuration, ignored retired records and startup cleanup. Unready indexes refuse path resolution and creation. Retain ordinary and encrypted historical fixtures, unknown-format and authentication failures, protected target persistence, lock-time cache clearing, backups and password-change recovery.

`TestDocumentAddressingCheckoutSourcePreflight` uses actual repository snapshots to cover unmarked future specifications, unknown title representations, incompatible current sources, and mode-check precedence. Rejection occurs before additions, replacements, or removals in the batch, preserving source bytes, timestamps, and incoming snapshot contents. `TestDocumentAddressingCheckoutSourceRemoval` distinguishes partial removal from whole-notebook deletion. `TestDocumentAddressingCheckoutPreservesOpaqueEncryptedSource` uses historical ciphertext fixtures to verify byte-preserving transfer without unlocking, with configuration and recovery material unchanged. Path regressions cover backslashes, duplicate destinations, and Windows trailing-dot, trailing-space, and default-data-stream aliases so the actual write target cannot bypass source checks. Retain regressions for BOM-prefixed sources, valid slash titles, recovery of generally corrupted sources, and asset `.sy` files so source protection does not introduce unrelated file-operation restrictions.

Retain `TestHeadingDocParagraph` and `TestHeadingDocParagraphTextMark` so foundational separation continues covering images, links, and original heading content preserved in the body. Stage E additionally verifies supported nodes in title sources and both conversion directions without deleting user paragraphs based on equal plain text. Template document trees cover grouped undo and redo, partial commits, name or ID conflicts on redo, and user edits after creation, not just successful creation.

Actual HTTP regressions verify strict request types, required fields versus `null`, result ordering, truncated candidates, error data, administrator and writable access, encrypted response leases, and published-visitor rejection. Assert old compatibility behavior separately from new endpoints instead of replacing legacy expectations. Frontend tests cover old template configuration round-trips, new segment evaluation, one time snapshot, partial-success presentation, and mobile entry points.

Fault injection covers at least the boundaries before and after source persistence, before and after metadata transactions, interrupted content-index batches, lost success responses, and locking during response serialization. Use real fixtures from supported historical formats for reads, export, history, backup, and recovery, and verify rejection of unsupported formats with limited-reader regressions. These regressions do not make older released clients safe to mix with upgraded data. Testing only files generated by the current version does not establish backward compatibility.

### Performance and resources

Compare the baseline and implementation in the same environment using 1,000 and 10,000 documents, wide subtrees, and depth 7, with additional coverage for the option allowing deeper documents. Test ordinary and unlocked encrypted notebooks separately. Measure batch path reads, parent renames, moves, initial rebuilds, and incremental recovery, recording foreground latency, background duration, memory, database size, and `.sy` read counts, including median and high-percentile results.

Foreground creation and reads must not scan the entire notebook because of new metadata. Renaming a parent with ready metadata must not read each descendant's body. Index construction can scan source documents but needs progress and recovery points. Caches have explicit limits and clear corresponding titles on lock; do not retain every content block's entire ancestor chain in memory. Measure existing background content-block `hpath` updates separately, without treating scheduling delays as database time or claiming separation eliminates all subtree updates.

Reports explain changes relative to the baseline. Duration depends on hardware, body size, and encryption costs; this draft provides no unmeasured speedup or fixed millisecond promise. Investigate query counts, transaction batches, and repeated source reads before selecting cache optimizations for substantial regressions; do not trade title semantics for performance.

### Implementation checks

Behavior tests enter existing frontend and kernel discovery; new Go contract tests retain `Contract` in their names. After API implementation, run `pnpm run api:generate --petal ../../petal`, `pnpm run api:check --petal ../../petal`, `pnpm run lint`, and relevant frontend tests from `app/`. From `kernel/`, run `go test ./apicontract/...` and regressions covering affected APIs, models, filesystem, block-tree, and SQL behavior. Before release, existing complete test entry points cover `pnpm test` and `go test -tags "fts5 sqlcipher" ./... -count=1`.

New ancestor-chain, legacy creation, CLI, MCP and contract regressions are discovered by existing Go test selections. Run affected packages with `fts5 sqlcipher`, retaining Spec 6, historical plain/encrypted fixtures, unknown-format, sync and recovery coverage. No mode-1 overlay or stub for a removed mechanism remains. Documentation also checks bilingual consistency, examples, links and diffs.

## Related code

| Area | Entry points |
| --- | --- |
| Creation, rename, title normalization, and name resolution | [`model/file.go`](../kernel/model/file.go), [`model/path.go`](../kernel/model/path.go) |
| APIs, mode configuration, and contracts | [`api/filetree.go`](../kernel/api/filetree.go), [`api/notebook.go`](../kernel/api/notebook.go), [`apicontract/filetree_remaining.go`](../kernel/apicontract/filetree_remaining.go), [`conf/box.go`](../kernel/conf/box.go) |
| Source documents and read-only path recovery | [`filesys/tree.go`](../kernel/filesys/tree.go), [`filesys/hpath.go`](../kernel/filesys/hpath.go) |
| Path refresh, recovery queues, and document indexes | [`treenode/blocktree.go`](../kernel/treenode/blocktree.go), [`treenode/hpath.go`](../kernel/treenode/hpath.go), [`model/hpath_refresh.go`](../kernel/model/hpath_refresh.go), [`sql/queue.go`](../kernel/sql/queue.go) |
| Search and hierarchy calculations | [`model/search.go`](../kernel/model/search.go), [`sql/block_query.go`](../kernel/sql/block_query.go), [`search/config.ts`](../app/src/search/config.ts) |
| Creation entry points and save path parsing | [`util/newFile.ts`](../app/src/util/newFile.ts), [`util/configuredDocument.ts`](../app/src/util/configuredDocument.ts), [`mobile/util/initFramework.ts`](../app/src/mobile/util/initFramework.ts) |
| Templates, new database items, and shorthands | [`model/template_doc_tree.go`](../kernel/model/template_doc_tree.go), [`model/attribute_view_new_item.go`](../kernel/model/attribute_view_new_item.go), [`model/shortcuts.go`](../kernel/model/shortcuts.go) |
| Daily-note reuse and legacy creation regressions | [`model/daily_note.go`](../kernel/model/daily_note.go), [`model/file_test.go`](../kernel/model/file_test.go) |
| MCP and built-in Agent document targets | [`mcp/tools/document.go`](../kernel/mcp/tools/document.go), [`mcp/tools/inbox.go`](../kernel/mcp/tools/inbox.go), [`agent/agent.go`](../kernel/agent/agent.go) |
| Import and export | [`model/import.go`](../kernel/model/import.go), [`model/import_obsidian.go`](../kernel/model/import_obsidian.go), [`model/export.go`](../kernel/model/export.go) |
| Reusable rich-source validation pattern | [`treenode/table_cell_rich.go`](../kernel/treenode/table_cell_rich.go) |
| Heading/document conversion | [`model/heading.go`](../kernel/model/heading.go), [`model/heading_doc_test.go`](../kernel/model/heading_doc_test.go) |
| Configuration encryption and sync application | [`model/box_conf_crypto.go`](../kernel/model/box_conf_crypto.go), [`model/repository.go`](../kernel/model/repository.go), [`model/sync_checkout.go`](../kernel/model/sync_checkout.go) |
| Document versions | [`treenode/tree.go`](../kernel/treenode/tree.go), [`.sy` file structure](SY-FORMAT.md) |
