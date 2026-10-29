# Long-term memory

[中文](LONG-TERM-MEMORY.zh-CN.md)

## Feature scope

This document defines the design goals, storage, and maintenance rules for workspace-level long-term memory in SiYuan. The capability is not implemented yet. The following sections describe target behavior and identify open decisions separately; they do not describe released APIs or configuration defaults.

Long-term memory retains sourced user background, preferences, project facts, conventions, and reasons for decisions. It serves current and future AI features that need contextual understanding, reducing repeated explanations across tasks and sessions. Features share the same memory rather than maintaining separate user profiles. Memory does not replace source notes, document search, conversation history, or manually maintained instructions.

The first version uses canonical Markdown records, system-generated concise overviews, and on-demand file search. It does not add SQLite, vector search, a knowledge graph, or an external memory service, and does not keep all records resident in memory. Hundreds to a thousand records is only an initial sizing assumption, not a hard limit or performance commitment. Extraction, judgment, and overview generation still incur model calls; they should use the user's configured AI service and expose the processing scope and failure state.

The capability targets desktop, browser, and mobile clients through shared kernel read, write, and retrieval services. File search must not depend on the user's system having `grep`, `find`, or other command-line tools installed. New consumers explicitly choose whether to use or maintain memory; the model protocol adapter must not unconditionally inject memory into every request.

Retention and use are separate. Preserve grounded information rather than discarding valid content based on a subjective judgment of long-term value or a fixed record count. Content with uncertain provenance, subject, or meaning may remain a candidate, but must not be used as a confirmed fact. Context budgets limit what is read and injected for a request, not what canonical records are retained.

## User interaction

### Remembering, correcting, and forgetting

Users can explicitly ask to remember, correct, or forget information. The system retrieves related records, checks their subject, scope, and time, and performs the corresponding operation with an accurate result. It must not claim to have remembered information before the write is confirmed. When several targets are plausible, resolve the ambiguity instead of overwriting all similar records.

| Operation | Target behavior |
|---|---|
| Remember new information | Create a canonical record with its evidence and scope |
| Repeat the same information | Keep the existing record ID, add provenance and the confirmation time, and avoid duplicate creation |
| Supplement existing information | Update the corresponding record while preserving existing conditions and content that has not been superseded |
| Correct information or change a requirement | Distinguish an incorrect record from a fact that changed over time; retain necessary replacement relationships and validity times |
| Suspend use | Retain the record but exclude it from subsequent retrieval results and overview injection |
| Forget | Stop using the content and persist the minimum withdrawal information needed to prevent older versions from becoming active again |

Users should be able to inspect memory content, provenance, scope, validity, and the reason for the latest change, and to correct, disable, or forget records through one management entry point. `USER.md` and `MEMORY.md` are displayed as system-generated, read-only overviews. Corrections must update canonical records rather than create a second source of facts by editing an overview independently.

An explicit current instruction takes precedence over an older preference. For example, a tutorial that requires detailed steps follows that task-specific instruction even if the global preference is concise answers; the task does not thereby rewrite the global preference. A temporary request must not automatically become a global long-term rule.

### Automatic consolidation and source scope

Automatic consolidation processes notes and interactions within the allowed scope. Note reading preserves `.sy` block identity, type, hierarchy, references, inline semantics, and typed attribute-view values, rather than inferring subjects or relationships solely from flattened text. Collected or quoted third-party articles must not automatically become the user's beliefs. Model-generated content is not user-confirmed merely because it appears in a conversation.

After an ordinary conversation or task reaches a suitable stopping point, candidates may be extracted in batches and compared with existing memory. Consolidation should coalesce successive edits and support cancellation and retries, rather than regenerate every file after each keystroke or sentence. A candidate that fails validation should retain a diagnosable failure state without discarding other valid records in the batch.

**Open decisions:** The default consolidation switch, source selection, task-completion event, initial processing of existing notes, and scan budget are not yet determined. The proposed starting point is user-selected source scope rather than sending the entire notebook collection to a model by default. Whatever defaults are chosen, disabling consolidation must prevent new jobs from being queued and require running jobs to recheck permission before committing results.

### Model and reasoning-effort configuration

Users must be able to select the model and its supported reasoning effort for long-term memory processing. The provider, model, and effort must not be hard-coded or required to match the current conversation. Reuse the existing AI provider and model configuration while exposing an independent choice for memory processing; changing the current conversation model must not implicitly change the choice for background memory work.

This configuration applies to model calls for candidate extraction, search-term generation, duplicate or change judgment, and overview generation. File traversal, text matching, metadata validation, and persistence remain program operations and do not thereby require model requests. The UI must explain the scope and cost of model calls and offer reasoning options according to the target model and protocol capabilities. When unsupported, disable the corresponding selection or clearly explain the limitation; do not send known unsupported parameters or assume that all models accept the same effort values.

If the selected model is removed, disabled, inaccessible, or incompatible with the configuration, preserve existing memory and report the affected tasks rather than silently switching providers or clearing records. Reading existing memory and suspending or withdrawing an unambiguous target without model involvement must not depend on the generation service recovering.

**Open decisions:** The configuration entry point and fields, initial model and reasoning effort, explicit inheritance or fallback options, and the treatment of queued and running tasks after configuration changes remain to be determined. Configuration choices must be traceable rather than chosen ad hoc by the model. Until fallback rules are defined, do not promise automatic completion with another model.

### Visible limitations and failures

No matching memory, incomplete search, inaccessible sources, malformed records, write conflicts, and model service failures must be distinguishable. A failed file search does not mean there is no relevant memory, and failed model generation must not clear existing records. When appropriate, continue the current task and disclose the lack of reliable memory rather than repeatedly interrupting the user to confirm low-value details.

The initial management entry point should support viewing, correcting, and forgetting on desktop and mobile. Its exact location, bulk operations, and support for editing record files directly in external editors remain open decisions.

## Data and storage

### File layout and ownership

All paths below are relative to the user's SiYuan workspace, not the source repository.

```text
data/storage/ai/
├── AGENTS.md
└── memos/
    ├── USER.md
    ├── MEMORY.md
    └── records/
        └── <SiYuanID>.md
```

`AGENTS.md` is the existing manually maintained instruction file. Memory consolidation must not rewrite it without the user's direction. `memos/` and its memory files are proposed additions. `records/` is the sole canonical source; file names use program-generated SiYuan IDs, which remain stable when titles or content change.

`USER.md` provides a concise overview of relatively stable user background and preferences. `MEMORY.md` provides a small selection of frequently useful background, conventions, and pointers to detailed records. Both are derived from canonical records and bounded by relevance and context budgets, rather than concatenating all memory or serving as a complete catalog. Both persist under `memos/`, participate in normal data synchronization, and can be rebuilt when needed.

Canonical records and overviews reuse existing snapshots and data synchronization, subject to the user's sync settings and ignore rules. The first version has no separate database or persistent retrieval index and does not create `temp/ai/memos/` in advance. If a cache becomes necessary later, that path may contain only rebuildable data; clearing it must not lose memory, corrections, or withdrawal decisions.

Model and reasoning-effort choices belong to AI configuration, not `records/` or either overview. Follow existing configuration persistence and export rules and reuse model references rather than copying provider credentials into memory files. Synchronizing memory files does not mean the receiving device automatically has the same model configuration or service access.

### Canonical records

Each record contains readable Markdown content and fixed metadata validated by the program. The following are conceptual constraints; exact field names, front matter encoding, and format version values are to be determined before implementation.

| Information | Constraint |
|---|---|
| Identity and format version | A unique record ID and explicit format version; file name and internal identity must agree |
| Subject and scope | Distinguish the user, third parties, and projects; scope may refer to the workspace, notebook, document, or explicit project, without relying on titles as identity |
| Content and type | Preserve background, preferences, facts, or decisions with their conditions; do not weaken or promote plans into completed facts |
| Provenance | Retain block, document, or conversation identity, necessary evidence excerpts, and source-version information; support multiple independent sources |
| Time | Distinguish recording time, source creation/modification time, confirmation time, and fact validity; leave unknown event times unknown |
| State | Distinguish candidate, usable, needs-review, disabled, superseded, and withdrawn semantics; only eligible records may be injected |
| Revision and replacement | Support stale-write checks, change reasons, and relationships between old and new content; file modification time does not establish factual recency |

Content should preserve the subject, action, state, conditions, and negation necessary for later judgments. A provenance link does not establish trust. The program can validate reference existence and access scope, while content judgments still require a model and, where necessary, user review. Metadata parsing must reject ambiguous structures and must not execute arbitrary tags, expressions, or instructions in the content.

Withdrawal information is canonical persistent state, not merely a cache entry. Retain only what is necessary to identify withdrawn records, relevant sources, and revision relationships, without duplicating the content the user asked to forget. Its exact representation, retention period, and cleanup conditions remain open decisions. Until these rules are settled, deletion must not be presented as already providing cross-device protection against resurrection.

### Overview consistency

Overviews must identify the version, or equivalent fingerprint, of usable memory on which they are based, and distinguish content changes from provenance-only changes. The program checks applicability before use. An older overview received through sync must not overwrite canonical records or be accepted solely because its file timestamp is newer.

Overview generation uses a verified record snapshot. If relevant records change before the result is saved, discard that stale result and reschedule it. The two overviews may refresh independently; every update need not rewrite both. If an overview is temporarily unavailable, eligible canonical records can be read on demand. Waiting for an overview must not reactivate invalidated content.

## Implementation and interfaces

### Responsibilities

| Component | Responsibility |
|---|---|
| Consumer | Supply the current task, allowed sources, and scope; choose whether to retrieve or consolidate memory |
| Model | Extract grounded candidates, propose search terms, judge duplicates/supplements/changes, and generate overview text |
| Shared memory service | Validate identities and permissions, search files, allocate IDs, check revisions, commit records, maintain state, and refresh overviews |
| File and sync mechanisms | Persist files reliably, reuse existing snapshots and transport, and preserve data needed for conflicts and recovery |

Model output is a proposed operation subject to validation, not unrestricted file-write access. The shared service must constrain the target directory, validate paths and file identities, prevent symlink escapes, and reuse existing read-only workspace and access-control rules. Memory content does not elevate source instructions or authorize other actions.

Reading, searching, maintenance, and status queries should use the same kernel service, rather than separate deduplication and update rules in each AI feature. HTTP routes, tool names, and parameters are not yet defined. New interfaces must follow the [API type contracts](API-CONTRACTS.md); conceptual names in this design are not existing APIs.

### Write and update triggers

| Trigger | Canonical record handling | Overview handling |
|---|---|---|
| Explicit request to remember | Retrieve and compare candidates, then create, merge provenance, or update | Schedule the relevant overview when usable content changes |
| Explicit correction or forgetting | Prioritize committing the correction, invalidation, or withdrawal | Immediately prevent use of the stale overview, then refresh affected content |
| Completion of an ordinary task | Consolidate candidates in batches within the allowed scope and validate each | Coalesce meaningful content changes into a batch refresh |
| Source edits, deletion, or access changes | Review affected records and mark them as needing review or invalid | Exclude invalid or inaccessible content |
| Sync, snapshot restoration, or file changes | Validate format, revisions, conflicts, and withdrawal relationships | Check the source version, then rebuild or suspend stale overviews |
| Additional duplicate provenance only | Keep the ID and update sources and confirmation time | No text regeneration is needed if content and validity are unchanged |

Deleting a source must neither mechanically delete all related memory nor leave unverifiable content treated as certain. A historical fact still supported by several sources and a preference supported only by a deleted source require different review. An explicit request to forget takes precedence over extraction from the same old source. A later explicit request to remember again may establish a new valid relationship.

Commit records reliably before deriving overviews. A refresh failure does not roll back a successful correction or withdrawal; reported state must distinguish saved records from an overview refresh still pending. Retries need source and operation identity checks so timeouts or process interruptions do not repeatedly create the same memory.

### Retrieval and use

1. Determine the subject, scope, access permissions, and usable state for the current task, excluding ineligible records
2. Search files using the current text and model-proposed keyword groups, names, or aliases, reading matching candidates on demand instead of retaining every record body in memory
3. Let the model assess relevance using candidate content and provenance; before writes, also distinguish the same fact, supplementary information, and temporal changes
4. Expand terms or scope when results are insufficient without crossing access boundaries; preserve the distinction between incomplete search and no match
5. Return relevant memory and provenance within the context budget, consulting original sources when needed; if no reliable memory is available, follow the current request without inventing background

The first version uses cross-platform file traversal and text matching. It must not assume semantic search already exists. Paraphrases, aliases, and Chinese tokenization may cause misses; no match alone is insufficient justification for creating a duplicate. When identity remains uncertain, retain a candidate for review rather than merging different subjects or projects.

Search can stream through files without keeping them all resident, but still incurs disk I/O. Concurrency, cancellation, response size, and model-call budgets require controls. Maintaining response speed must not silently discard records or broaden external data transmission. Requests such as simple summaries or titles may omit memory retrieval when long-term context is unnecessary.

### Concurrency and security

Updates require the revision read by the caller and an atomic save under a lock or equivalent protection. Stale writes return a conflict while preserving current content and the pending proposal, without forced overwrite. Single-file atomic writes do not guarantee cross-file overview consistency or offline-device consistency; overview version validation and sync conflict handling require separate verification.

Model output, note quotations, and memory content are data. Current requests and manual instructions retain their existing priority rules. Memory retrieval must not bypass permissions, expand tool access, or accept operational instructions from collected material. Logs and diagnostics should record states, identifiers, and timing rather than complete memory or sensitive source content by default.

Ordinary global Markdown records must not contain plaintext extracted from encrypted notebooks. If the first version lacks memory storage and lifecycle rules that preserve the original encryption boundary, it must exclude those sources and explain the limitation. A notebook being unlocked is not sufficient permission to write its contents into global files. See [Encrypted notebooks](ENCRYPTED-NOTEBOOK.md) for authenticated reads, lock-time cleanup, and recovery requirements.

## Compatibility and recovery

`data/storage/ai/AGENTS.md` already has independent read, revision, and compatibility migration rules. This feature does not migrate or overwrite it. Compatibility handling for the old `data/ai/AGENTS.md` path follows the existing implementation. Session compaction and conversation history retain their separate lifecycles; deleting a session must not be described as having deleted all memory derived from it.

Canonical records must carry a format version. Unknown formats, malformed metadata, and incomplete writes must not trigger clearing, silent reconstruction, or full-corpus extraction. Preserve the original file, exclude the affected record from use, and report the error while other valid records remain usable. Rebuilding applies only to derived overviews and optional caches; an overview must not replace canonical records in reverse.

Sync conflicts should preserve recoverable versions from both sides and suspend unresolved records from use, rather than use last-write time to decide which preference is correct. An overview written by another device must be checked against source versions before use or regeneration. Concurrent consolidation on several devices must avoid repeatedly overwriting the same overview. The exact merge protocol and generation coordination remain open decisions.

Forgetting must consistently invalidate records, overviews, and retrieval results, accounting for older devices, retry queues, repeated extraction, and historical restoration. Historical snapshots may still contain the previous content. Ordinary forgetting is not permanent erasure of all backups, and the UI must explain the distinction. How an explicit historical snapshot restore handles newer withdrawal decisions requires a separate product rule; resurrection prevention must not be promised unconditionally.

Before implementation, settle automatic consolidation defaults and budgets, automatic handling of invalid sources, external file editing, withdrawal-state representation, and snapshot restoration rules. These decisions do not change the directory layout, but they determine safe defaults and acceptance criteria and must not be left for the model to choose ad hoc.

## Verification

The specified behavior requires tests after implementation. Neither file format nor existing synchronization proves it already holds. Coverage must include at least the following scenarios:

| Scenario | Required verification |
|---|---|
| Cross-session use | A new task applies a preference without repetition, within the correct scope and with traceable provenance |
| Paraphrased repetition and supplementation | Different wording retains one ID; additional provenance does not duplicate records or merge different subjects |
| Facts and time | Plans, completion, negation, and conditions remain faithful; modification time does not become event time |
| Project isolation | Conflicting requirements in different projects coexist; temporary instructions do not contaminate global preferences |
| Correction and forgetting | The next call avoids stale overviews; extraction retries and older-device sync do not silently resurrect content |
| Source changes | Edits, deletion, access changes, and support from multiple sources trigger appropriate review |
| Concurrency and recovery | Multiple AI requests, offline devices, interrupted generation, and malformed files do not silently overwrite or lose information |
| User control and privacy | Disabling consolidation prevents later commits; read-only, encrypted, and restricted sources do not leak |
| Model configuration | Use the user's selected model and supported reasoning effort; changing the conversation model does not implicitly alter memory configuration; unsupported parameters and invalid configuration produce clear feedback while preserving existing memory |
| Cross-platform search | Desktop, browser, and mobile use the same kernel semantics without external search-command dependencies |
| Cost and performance | Measure search latency, reads, misses, model calls, and cancellation/recovery across dataset sizes |

Evaluate effectiveness through repeated explanations and manual corrections in real tasks, alongside irrelevant-memory use, misses, and cost. Existing small extraction, question-answering, and representation comparisons offer design evidence only. They do not establish effective automatic memory formation, long-term personalization, or synchronized forgetting. Neither record count nor perfect reading-question scores are completion criteria for the first version.
