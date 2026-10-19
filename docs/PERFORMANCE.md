# Performance measurement

[中文](PERFORMANCE.zh-CN.md)

## Scope

Performance measurements separate synchronous kernel work, asynchronous component initialization, and browser layout. Stage records are local diagnostics. They do not change API responses, transaction completion, search counts, notebook access checks, or persisted formats. They do not upload measurements.

## Stage records

Set the environment variable `SIYUAN_PERFORMANCE=1` before starting a development kernel to enable records in its existing log. Stop sampling by removing the variable before the next start. The developer controls building and restarting the kernel. With sampling disabled, the kernel recorder performs no allocations.

In the renderer's developer tools, run `performance.mark("siyuan-performance")` to enable console records and `performance.clearMarks("siyuan-performance")` to disable them. The mark is temporary and is not a saved preference. The recorder does not create a growing collection of per-operation browser marks or measures.

Records start with `siyuan-performance ` followed by JSON. `duration_us` and `stages_us` are elapsed microseconds; `counts` contains operation sizes or explicitly named durations such as `oldest_wait_us`. Names are fixed in code. Records contain no query strings, note content, document identifiers, paths, credentials, or keys. Existing logs outside these records can contain other diagnostics; review a capture before sharing it.

| Operation | Stage boundary and counters |
|---|---|
| `transaction` | Begin, automations, apply, finalize, commit; operation count |
| `document.load` | `wait_transactions` waits for the serial boundary, `flush_transactions` executes the captured batch, `load_tree` captures or fully loads the source, and `parse_source` parses cached source bytes outside the lock, followed by lookup and response rendering; block count, `flushed_transactions` counts transactions actively executed by this read, and `source_snapshot = 1` identifies an ordinary cached source |
| `document.save` | Prepare/serialize, encrypt, compare, write, notify; prepared and written bytes |
| `index.flush` | Lock wait, take queue, begin/execute/commit, notify, persist queue completion; batch size and oldest enqueue age |
| `index.update` | Main-block and complete auxiliary projection, block comparison, auxiliary-index comparison, writes; `blocks_total` counts previously indexed blocks, `blocks_projected` counts generated main blocks, `changeset = 1` identifies a usable transaction hint; changed blocks and planned auxiliary deletions and insertions |
| `database.view`, `database.fields`, `database.rows` | Load and sync wait, field calculation, filter, sort, aggregation, pagination, conditional colors; row counts before filtering, after filtering and after pagination |
| `database.templates` | Template evaluation; evaluated values, including attempts that report template errors; `database.fields` also counts required and deferred template fields when a plan is used |
| `search`, `search.fts`, `search.path`, `search.regexp`, `search.document` | Query, result processing, exact count, grouping/references; method, returned results, matches and cancellation |
| `search.snapshot` | Ordinary FTS snapshot preparation, result rows and exact count; `count_cache_hit = 1` identifies a reused count |
| `editor.content` | Parse/normalize, DOM insertion, synchronous render dispatch, global state; render roots and loaded top-level blocks |
| `editor.databases` | Elapsed time until serial database initialization finishes; candidate root count |

The initial stage is named `prepare`. Repeated stages accumulate time. A canceled search has `counts.canceled = 1`; analyze canceled requests separately from successful requests. The multiword document query computes counts inside the query, so its stage is `query_count`. Regex matching and highlighting share a stage. A save skipped by the existing equality check has no written-byte counter. The index age is the oldest known enqueue time in the captured batch; recovered operations can lack that timestamp. It is not transaction queue wait time.

Nested operations overlap: do not add a parent duration to its children. `editor.content` measures synchronous work and dispatch, excluding later math/chart script loading, embedded queries and browser layout. `editor.databases` includes asynchronous database waits and does not represent all components becoming visible. Global heading numbering, fold state, readonly state, focus and plugin events retain their existing scope.

Auxiliary-index updates compare complete business-field snapshots in the existing transaction. Equal per-block multisets retain their stored IDs; changed blocks replace only their affected table records. Full projection remains necessary for reference and asset metadata that can change independently of a block hash. Counters describe planned row writes, including operations in transactions that subsequently fail; they are not committed-row totals.

Ordinary table, list and gallery views can evaluate templates needed by filters, sorting, calculations and conditional colors, plus their transitive dependencies, before pagination. Other templates run on the current page. Both passes share original raw-value snapshots and preserve required display output. Search, grouped layouts, unresolved/cyclic dependencies, opaque template expressions and dependencies that would change the original evaluation order retain full evaluation. Existing views eligible for deferring every template keep that behavior. `database.fields` records `order_cache_hit = 1` when it regenerates a page from a reusable order. An ordinary FTS request using `search.snapshot` includes its count in the parent query stage; the parent's separate count stage then contains only dispatch overhead.

## Projection and reuse boundaries

Ordinary cached document opening waits for the serial execution lock, including any dequeued transaction still executing. With queued work, it completes the single batch captured after acquiring that lock and captures the document source before releasing it. Transactions arriving after that batch do not extend this path to a globally empty queue. Empty-queue captures can share the read lock. Writes, undo/replay and the existing global flush operation keep their completion rules; this is a global editing boundary, without document-specific transaction routing.

`wait_transactions` includes lock waiting for writes already in progress. `flush_transactions` and `flushed_transactions` describe only the batch actively captured and executed by this read; earlier in-flight transactions are not included in that count. These records distinguish waiting, queued execution and source-processing costs. They do not establish that transactions for other documents can be skipped.

Ordinary cached documents copy their independently decoded source bytes and parent titles at that boundary, then parse and render after releasing the transaction lock. Later edits, moves, cache invalidation or parent renames cannot change that captured source; parsing cannot recreate a subsequently removed file. The snapshot is local to one read and introduces no retained cache. Encrypted documents, cache misses and parent chains requiring repair retain the original global queue wait and complete loader, including authentication, compatibility repair and index refresh. They release the transaction lock before that wait/load to preserve lifecycle lock ordering, and do not gain the finite-batch guarantee. Source copying and reading parent titles also have costs proportional to their input. SQL-derived reference counts, virtual references and other response metadata retain their existing asynchronous index behavior; this is not a combined filesystem/SQL/sync snapshot.

Main-block projection resolves heading parents once per physical sibling list within a projection. Transactions consisting entirely of tracked `update` operations can provide changed and removed subtree IDs and affected containers. Heading structure, inline HTML, untracked writes, missing or changed root metadata, and other transaction operations retain complete main-block projection. Queue coalescing unions hints only within the same notebook, document and path and preserves ordered delete, move, rename and other index-operation boundaries. Hints exist only in process memory; recovery loads the complete authenticated source and performs an idempotent full update. Complete auxiliary projection and the existing whole-document `.sy` save remain in place.

View order reuse applies only to live ordinary sources with at least 512 detached rows, static fields and closed pure templates required before pagination. It covers table, list and galleries without covers; query, grouping, context filters, target positioning, calculations, date/time, relation, rollup, assets and external or dynamic dependencies retain their existing paths. Plain views and views whose templates are all display-only do not pay for an order fingerprint. The key includes the source version and cache generation, actual data and view definition, carrier, language and write scope; temporary data or sort changes produce different keys. Common block, plain text and template values use a streaming fingerprint with types, pointer-presence markers and length boundaries; other values retain complete chunked JSON. The buffer does not grow with an ordinary field's content. Regression checks require new persisted value fields to update fingerprint coverage. This representation is only an in-process cache key. It still validates and hashes the complete input, and source parsing still scales with source size; a saved source version alone cannot establish that temporary values are unchanged.

The order cache retains only independent immutable ID strings, with 16 slots and a 4 MiB logical byte budget including metadata. It regenerates the current page's values instead of sharing rendered objects. Existing source replacement/removal and global cache clearing invalidate orders and reject in-flight writes from older versions. Encrypted sources, historical paths and in-memory snapshots do not enter this cache. Cache hits reduce repeated field evaluation, filtering and sorting; they do not make the whole request proportional only to page size. Compare first-use overhead, subsequent pages and mutation-heavy workloads separately.

Exact-count reuse applies only to fixed ordinary FTS queries without custom ignore SQL. Count SQL and bound string arguments fingerprint the query and scope. Database and native connection identity plus SQLite `data_version`, `total_changes()` and `schema_version` identify the index state; versions are compared on the same connection. Own writes and other connections' commits invalidate reuse, and rollbacks may cause harmless misses. Result rows and counts use one read snapshot; version sampling before and after establishing that snapshot disables reuse across a changing boundary. There is no TTL correctness shortcut. The fixed 512-slot count cache occupies less than 128 KiB and retains no query body. Database close/rebuild and SQL cache clearing reject old admissions. Encrypted queries, custom SQL and dynamic ignore conditions keep their existing paths. Cancellation releases the snapshot and reserved connection. See SQLite's [version semantics](https://sqlite.org/pragma.html#pragma_data_version) and [snapshot isolation](https://sqlite.org/isolation.html).

Search cancellation reaches individual-field highlighting and document keyword partitioning. Text up to 4 KiB keeps complete matching, followed by cancellation checks while generating markup. Larger cancelable literal highlighting scans 64 KiB windows with overlap sufficient for the longest keyword's UTF-8 representation, checks cancellation between individual matches, and avoids duplicate temporary match collections. Window crossings, case/Han variants and empty matches remain equivalent to complete matching. Cancellation does not return partial fields or result collections. Result formatting generates only the highlighting it consumes; other callers requesting similarity scores retain the existing scoring. Regex compilation, an individual arbitrary-regex match, whole-tree or database-definition parsing, and underlying file reads remain non-preemptible individual operations, so there is no universal cancellation-latency bound.

Export kernel and browser captures separately as UTF-8 files. From `app/`, summarize each run with:

```text
node scripts/performance.mjs before.log after.log
```

The summarizer groups each capture by operation and reports sample counts, medians and maxima. P95 requires at least 20 samples; P99 requires at least 100. Stage samples and counters retain their own sample counts. Keep workload, result status and size consistent within a capture. Empty or malformed measurements fail explicitly. Keep the raw files alongside summaries.

## Reproducible microbenchmarks

Run from `kernel/` using the same Go toolchain, machine, power settings and otherwise idle environment:

```text
go test ./filesys -run '^$' -bench '^BenchmarkDocumentJSON$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkDatabaseDisplayPage$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkDocumentSearch$' -benchmem -benchtime=200ms -count=3
go test -tags fts5 ./sql -run '^$' -bench '^BenchmarkUpsertTreeAuxiliaryIndexes$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkDatabaseTemplateDependencies$' -benchmem -benchtime=200ms -count=3
go test -tags fts5 ./sql -run '^$' -bench '^BenchmarkIndexProjection$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkDatabaseViewOrderReuse$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkAttributeViewOrderFingerprint$' -benchmem -benchtime=300ms -count=3
go test ./search -run '^$' -bench '^BenchmarkMarkTextContext$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkSearchProcessingContext$' -benchmem -benchtime=300ms -count=3
go test -tags fts5 ./sql -run '^$' -bench '^BenchmarkFTSExactCountReuse$' -benchmem -benchtime=200ms -count=3
go test -tags 'fts5 sqlcipher' ./model -run '^$' -bench '^Benchmark(DocumentReadBoundarySource|DocumentReadBoundaryEmpty|FlushTxQueueEmpty)$' -benchmem -benchtime=1s -count=3
go test -tags 'fts5 sqlcipher' ./model -run '^$' -bench '^BenchmarkDocument(SearchCandidates|CandidateIndexWrite)$' -benchmem -benchtime=200ms -count=3
```

| Benchmark | Fixed workload | Included work |
|---|---|---|
| `BenchmarkDocumentJSON` | 1,000 / 5,000 / 20,000 paragraph blocks, 112 ASCII content bytes per block, no references/assets, flat structure | Document preparation/JSON serialization or JSON parsing/validation; preparation uses a temporary directory; no product binary or workspace is replaced |
| `BenchmarkDatabaseDisplayPage` | 1,000 / 10,000 / 50,000 detached rows, block/text/display-template fields, page size 50, no filter/group/sort | Render fields using the existing display-template deferral, paginate and evaluate the current page's template |
| `BenchmarkDocumentSearch` | 10,000 / 100,000 / 1,000,000 indexed blocks, 100 blocks per document, two keywords in separate paragraphs, every document matches, first 50 documents | Warm in-memory SQLite document query, exact count and result-row decoding; no FTS, disk I/O, full API formatting or frontend |
| `BenchmarkUpsertTreeAuxiliaryIndexes` | 1,000 / 5,000 / 20,000 paragraphs with a tag and custom attribute per block, one document tag; alternate one paragraph's ordinary text | Complete auxiliary replacement, incremental writes with complete main projection, or a root/paragraph change set; all use batched heading-parent resolution, complete auxiliary projection, block/FTS updates and transaction commit; `sqlite_changes/op` includes internal FTS writes and compaction |
| `BenchmarkDatabaseTemplateDependencies` | 1,000 / 10,000 / 50,000 detached rows, two dependent templates required by filter/sort and five display templates, page size 50 | Complete versus dependency-based evaluation, including plan creation, field rendering, filter/sort and pagination; each iteration clears the rendered-collection cache |
| `BenchmarkIndexProjection` | 1,000 / 5,000 / 20,000 paragraphs, one ordinary text change | Independent heading-parent lookup versus request-local sibling resolution versus a two-block main projection; all include complete auxiliary projection, without SQL writes |
| `BenchmarkDatabaseViewOrderReuse` | 100 / 1,000 / 10,000 / 50,000 detached rows, the same template dependency fixture, page size 50 | Source parsing plus complete, uncached-order or reused-order rendering; the identical comparison snapshot shares the raw/normalized cache but is ineligible for cross-request reuse; cold mode varies a temporary view name to include fingerprint/admission costs |
| `BenchmarkAttributeViewOrderFingerprint` | 1,000 / 10,000 / 50,000 rows, the same template dependency fixture, a fixed parsed ordinary source | Eligibility checks, dependency planning and complete fingerprinting; excludes source parsing and page rendering, and its independent medians cannot be subtracted exactly from whole-page medians |
| `BenchmarkMarkTextContext` | 20 / 20,000 repetitions of `alpha & beta `, matching `alpha` | Complete highlighting with a non-cancelable or cancelable context; the cancelable context stays active to measure checking costs for successful requests |
| `BenchmarkSearchProcessingContext` | One block whose content and first-child content contain 20 / 20,000 repetitions of `alpha & beta `, plus name, alias, memo, tag and path | Complete block-result formatting under an active cancelable request, including highlighting, truncation and escaping; excludes querying, counts and frontend work |
| `BenchmarkFTSExactCountReuse` | 1,000 / 10,000 / 100,000 / 1,000,000 blocks, 100 per document; all, 0.1% or no blocks match; first 50 blocks | Warm in-memory FTS row decoding and exact block/document counts; uncached separate reads versus a cold or reused snapshot count; cold mode includes cache clearing |
| `BenchmarkDocumentReadBoundarySource` | 1,000 / 5,000 / 20,000 flat paragraphs with 128 ASCII content bytes each | Source capture alone, or full loading using a global flush versus the read boundary; warm mode uses the content cache, cold mode removes it each iteration; both reuse the OS file cache and exclude queue backlog and response rendering |
| `BenchmarkDocumentSearchCandidates` | 10,000 / 100,000 / 1,000,000 blocks, 100 per document; every document, one document or no document matches | Complete document query/count/row decoding without candidates, with a block scan producing root IDs, or with a prebuilt document trigram index; `candidate_build_ms` and `candidate_bytes` separately report index construction and SQLite page growth |
| `BenchmarkDocumentCandidateIndexWrite` | One document containing 100 / 1,000 / 20,000 blocks; alternate one block's SQL content | One block-table update/commit versus that update plus full-document aggregation and trigram replacement; excludes document serialization, file writes and the product's existing block FTS work; SQLite changes include internal index writes |

Use sub-benchmark filters for smaller runs, for example `-bench '^BenchmarkDocumentSearch$/^10000$'`. Database setup and fixture generation are outside measured loops. Display/template benchmarks reuse the attribute view across iterations; order-reuse benchmarks parse a fresh view each time. Their raw/normalized source caches are warm, so none is a cold-open measurement. `-benchmem` measures Go allocations, not SQLite native allocations or total RSS. Benchmark results are baselines for those paths, not application latency or a general speedup claim. Include low-hit and no-hit FTS queries because version/snapshot validation can cost more than their small counts.

## Fingerprint and result-formatting comparison

On 2026-10-19, the follow-up working tree based on `9539ed7d` was measured on Windows amd64, Intel i7-8750H, Go 1.27.2, with `fts5 sqlcipher`. Go source overlays restored the original fingerprint planner, or the original search result formatter and highlighting implementation; other code and fixtures were identical. View fixtures contain nine fields, including two template dependencies required by filter/sort and five display-only templates, with page size 50. View figures are medians of three samples with three timed operations per sample. Formatting uses `BenchmarkSearchProcessingContext`, at least 300 ms per sample, repeated three times.

| Path | Original implementation | Follow-up implementation |
|---|---|---|
| 1,000 rows, order cache hit | 41.6 ms | 25.8 ms |
| 10,000 rows, order cache hit | 281 ms | 177 ms |
| 10,000 rows, order cache miss | 949 ms | 727 ms |
| 10,000 rows, control without order reuse | 710 ms | 706 ms |
| Complete result formatting, 260-byte content | 38.3 µs | 34.4 µs |
| Complete result formatting, 260,000-byte content | 25.7 ms | 21.7 ms |
| Result-formatting Go allocations, 260,000-byte content | 10.0 MB/op | 7.81 MB/op |

The separate 10,000-row eligibility, dependency-plan and complete-fingerprint benchmark is approximately 42 ms and excludes source parsing. The empty-queue transaction boundary is approximately 29 ns/op with zero allocations. An order-cache miss varies a temporary view name; it is not a cold OS file cache. Three-sample measurements still show variance. These figures describe fixed paths, not P95, real-workspace interaction, peak process memory or processing proportional only to page size.

## Document candidate experiment

Candidate queries and the trigram index exist only in tests and benchmarks; production search and storage do not use them. The scan experiment admits one literal substring and retains the complete query for exact results, counts and ordering. Commas, LIKE wildcards and NUL require fallback for that candidate term. Its fixture comparisons include case sensitivity, path matching, filters, quotes, cross-block keywords, separators, NUL, all sort modes and pagination. They establish equivalence for those fixtures, rather than a proof for every query plan and aggregation order.

The index experiment uses a fixed field concatenation. A regular word tokenizer misses a query such as `alpha` inside `malpha`. A trigram index of all fields can also miss `alpha` formed by enabled `content + alias` when a disabled `name` would intervene in the indexed concatenation. The negative regression preserves both counterexamples. Adopting an index would first require complete recall across field settings, type/scope filtering and aggregation boundaries, plus authenticated rebuild/recovery and an acceptable write/storage budget. No new persisted index or migration is enabled by this change.

On 2026-10-19, Windows amd64, Intel i7-8750H, Go 1.27.2, `fts5 sqlcipher`, measurements on the batch-four working tree based on `9436ff6100` were as follows. Query/load/write times are three-sample medians; index construction and page growth were sampled once for the shared fixture:

| Workload | Comparison | Measurement |
|---|---|---|
| 20,000-block warm source | Original loader / captured-source loader / capture held under the transaction lock | 138 / 123 / 3.46 ms |
| 20,000-block content-cache miss | Original loader / capture miss followed by global fallback | 261 / 256 ms |
| 1,000,000 blocks, all documents match | Original / scan candidates / fixed-field trigram candidates | 660 / 1,012 / 991 ms |
| 1,000,000 blocks, one document matches | Original / scan candidates / fixed-field trigram candidates | 867 / 1,224 / 2.12 ms |
| 1,000,000 blocks, no document matches | Original / scan candidates / fixed-field trigram candidates | 810 / 553 / 0.337 ms |
| Candidate index at 1,000,000 blocks | Construction / SQLite page growth | 2.25 s / 96.3 MB |
| One SQL block update in a 20,000-block document | Block update only / update plus document trigram replacement | 0.015 / 63.3 ms; 1 / 789 SQLite changes |

The read change confines transaction exclusion to source capture on the warm path; whole-tree parsing remains expensive. Total source-load measurements showed substantial variance, especially on smaller fixtures, and do not establish faster product opens. The selective candidate index has substantial potential, but misses valid field combinations and increases high-hit query and write costs in this experiment, so it is not adopted. Large query samples sometimes contain only one operation and also show substantial variance; these are directional microbenchmarks, without latency percentiles, real-device interaction, recovery measurements or process RSS.

## Product captures

For each comparison, record commit, toolchain and Electron versions, OS, hardware, build mode, actual data sizes, query hit rate, sample count, cache state and concurrent background work. Keep fixed content length, nesting, reference/asset count, database field definitions and templates. Capture cold open, warm reopen, subsequent pages, continuous typing and interaction during sync/indexing separately. Include small workspaces, low-hit queries, encrypted notebooks and desktop/browser/mobile paths.

Use the browser Performance panel for long tasks, style/layout work and time until affected content is visible. Use OS process measurements for kernel and renderer RSS separately. Go profiles measure Go heap/CPU; they do not include all SQLite or Electron native memory. Kernel profiling endpoints require explicit `--enable-pprof` and existing administrator authentication. Collect profiler runs separately from low-overhead timings. No profiler endpoint is enabled by the recorder.

Do not infer SQL changed-row counts, query counts, cache hit rates or peak RSS from stage durations; collect those metrics separately when evaluating the corresponding optimization. Do not infer UI correctness, encrypted-data recovery, or concurrency correctness from microbenchmark throughput.

## Regression checks

Frontend tests are discovered by `app/scripts/test.mjs`; Go tests and benchmarks are discovered by their package commands. Focused checks from `app/`:

```text
node --import tsx --test --test-concurrency=1 src/search/request.test.ts src/protyle/util/renderContent.test.ts src/protyle/util/performance.test.ts src/protyle/util/onGetPositioning.test.ts
node --test scripts/performance.test.js
pnpm run lint
```

The test launcher initializes Electron before parallel browser tests. When running browser tests directly after installing dependencies, first load `require("electron")` once to finish installation. Do not start several first-time Electron installations concurrently.

Focused checks from `kernel/`:

```text
go test -tags fts5 ./model -run 'TestFullTextSearchRejectsCanceledRequest|TestSearchContextPreservesResultsCountsAndPagination' -count=1
go test ./sql -run 'TestParameterizedSearchQueriesCancelAndReleaseConnection|TestSearchQueriesRejectCanceledContextBeforeReading|TestBlockQueriesBeyondVariableLimit' -count=1
go test ./util -run Performance -count=1
go test -tags fts5 ./sql -run 'TestAuxiliary|TestUpsertTree|TestStaticTemplateKeyDependencies' -count=1
go test ./model -run 'TestAttributeViewTemplatePlan|TestRenderAttributeViewUsesTemplateDependencyPlan|TestShouldDeferAttributeViewTemplateValues|TestRenderAttributeViewDefersDisplayOnlyTemplatesUntilAfterPagination' -count=1
go test -tags 'fts5 sqlcipher' ./sql -run '^TestAuxiliaryIndexEncryptedUpdateAndReopen$' -count=1
go test -tags 'fts5 sqlcipher' ./sql ./model -run 'TestTreeIndexChanges|TestIndexHeading|TestIndexProjection|TestTransactionIndexChanges|TestFTSCount|TestReusableTemplateKey|TestAttributeViewOrder' -count=1
go test ./search -run 'TestMarkTextContext' -count=1
go test -tags 'fts5 sqlcipher' ./model -run 'TestSearchProcessing' -count=1
go test ./search -run '^$' -fuzz '^FuzzMarkTextContextMatchesComplete$' -fuzztime=20s -parallel=2
go test -race ./cache -run TestAVOrderedIDs -count=1
go test -tags 'fts5 sqlcipher' ./model ./filesys -run 'TestDocumentReadBoundary|TestCachedTreeSource|TestAssetRelinkLockCancels|TestDocumentSearchCandidate' -count=1
go test -race -tags 'fts5 sqlcipher' ./model ./filesys -run 'TestDocumentReadBoundary|TestCachedTreeSource|TestAssetRelinkLockCancels|TestQueuedTransactionWaitForCommit|TestFlushTxQueueWaitsForDequeuedTransaction|TestWaitForSubmittedTransactionBatch|TestTransactionCompletion' -count=1
```

Cancellation tests cover running SQLite work and connection reuse in global and notebook-routed databases. The scoped in-memory database fixture tests routing, not SQLCipher format compatibility. Rendering tests use real browser DOM for insertion roots, whole replacement, selection identity, prepend scroll compensation and stale/removed roots, with component renderers replaced by spies. Component behavior and real device IME/touch interactions require their own regression checks. Semantic search retains serial scheduling because its backend cancellation is a separate change.

Auxiliary-index tests compare all five tables against complete replacement, including duplicates, removals, changed metadata, replay, failure rollback, NULL handling and batched deletion. A 20,000-block regression forbids any auxiliary-table write during an ordinary text edit. The SQLCipher test uses an actual encrypted database and verifies index migration/reopen, wrong-key rejection and isolation from the global database. Template-plan tests compare page values, order, counts, conditional colors and calculations against complete evaluation for table/list/gallery layouts, including original raw values and stale display state. These kernel changes are shared by desktop and mobile and do not change their frontend interactions.

Change-set tests compare complete SQL/FTS snapshots, coalesced transactions, removed/replaced children, root metadata fallback, ordered boundaries, failed writes and recovery without hints. Order-reuse tests compare complete responses for table/list/gallery and exercise saved and temporary edits, sort/write scope, empty results, excluded dependencies, byte limits, immutable IDs and concurrent invalidation. FTS tests place real WAL commits before snapshot establishment, before version confirmation and during row reads, then verify both snapshot counts and subsequent invalidation. They also cover rollback, SQL/argument isolation, cancellation and stale admissions. Run the surrounding SQL, AV, transaction and API permission regressions as appropriate; these focused tests do not replace real-workspace RSS or device interaction measurements.

Read-boundary tests cover shared reads and writer exclusion, already executing commits, captured batch completion and later arrivals, cross-document moves, failed writes, undo replay, panic/error cleanup, cached bytes parsed after a later edit and complete GetDoc projection comparisons across focus/paging modes and highlights. Source tests compare complete trees and metadata after parent renames and file removal, including cache misses, repair fallback, stale paths and authorization. The SQLCipher case uses an encrypted block tree and content database and verifies authentication failure, preserved ciphertext, unrelated transaction progress during lifecycle waiting, response-lease waiting and rejection after locking. The shared kernel path serves desktop and mobile without changing their interaction code.
