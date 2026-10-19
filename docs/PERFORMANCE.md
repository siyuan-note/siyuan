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
| `document.load` | Transaction barrier, load/parse tree, locate blocks, render response; block count |
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

Main-block projection resolves heading parents once per physical sibling list within a projection. Transactions consisting entirely of tracked `update` operations can provide changed and removed subtree IDs and affected containers. Heading structure, inline HTML, untracked writes, missing or changed root metadata, and other transaction operations retain complete main-block projection. Queue coalescing unions hints only within the same notebook, document and path and preserves ordered delete, move, rename and other index-operation boundaries. Hints exist only in process memory; recovery loads the complete authenticated source and performs an idempotent full update. Complete auxiliary projection and the existing whole-document `.sy` save remain in place.

View order reuse applies only to live ordinary sources with at least 512 detached rows, static fields and closed pure templates required before pagination. It covers table, list and galleries without covers; query, grouping, context filters, target positioning, calculations, date/time, relation, rollup, assets and external or dynamic dependencies retain their existing paths. Plain views and views whose templates are all display-only do not pay for an order fingerprint. The key includes the source version and cache generation, actual data and view definition, carrier, language and write scope; temporary data or sort changes produce different keys. Fingerprinting encodes values in bounded chunks. It still validates and hashes the complete input, and source parsing still scales with source size.

The order cache retains only independent immutable ID strings, with 16 slots and a 4 MiB logical byte budget including metadata. It regenerates the current page's values instead of sharing rendered objects. Existing source replacement/removal and global cache clearing invalidate orders and reject in-flight writes from older versions. Encrypted sources, historical paths and in-memory snapshots do not enter this cache. Cache hits reduce repeated field evaluation, filtering and sorting; they do not make the whole request proportional only to page size. Compare first-use overhead, subsequent pages and mutation-heavy workloads separately.

Exact-count reuse applies only to fixed ordinary FTS queries without custom ignore SQL. Count SQL and bound string arguments fingerprint the query and scope. Database and native connection identity plus SQLite `data_version`, `total_changes()` and `schema_version` identify the index state; versions are compared on the same connection. Own writes and other connections' commits invalidate reuse, and rollbacks may cause harmless misses. Result rows and counts use one read snapshot; version sampling before and after establishing that snapshot disables reuse across a changing boundary. There is no TTL correctness shortcut. The fixed 512-slot count cache occupies less than 128 KiB and retains no query body. Database close/rebuild and SQL cache clearing reject old admissions. Encrypted queries, custom SQL and dynamic ignore conditions keep their existing paths. Cancellation releases the snapshot and reserved connection. See SQLite's [version semantics](https://sqlite.org/pragma.html#pragma_data_version) and [snapshot isolation](https://sqlite.org/isolation.html).

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
go test -tags fts5 ./sql -run '^$' -bench '^BenchmarkFTSExactCountReuse$' -benchmem -benchtime=200ms -count=3
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
| `BenchmarkFTSExactCountReuse` | 1,000 / 10,000 / 100,000 / 1,000,000 blocks, 100 per document; all, 0.1% or no blocks match; first 50 blocks | Warm in-memory FTS row decoding and exact block/document counts; uncached separate reads versus a cold or reused snapshot count; cold mode includes cache clearing |

Use sub-benchmark filters for smaller runs, for example `-bench '^BenchmarkDocumentSearch$/^10000$'`. Database setup and fixture generation are outside measured loops. Display/template benchmarks reuse the attribute view across iterations; order-reuse benchmarks parse a fresh view each time. Their raw/normalized source caches are warm, so none is a cold-open measurement. `-benchmem` measures Go allocations, not SQLite native allocations or total RSS. Benchmark results are baselines for those paths, not application latency or a general speedup claim. Include low-hit and no-hit FTS queries because version/snapshot validation can cost more than their small counts.

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
go test -tags 'fts5 sqlcipher' ./sql ./model -run 'TestTreeIndexChanges|TestIndexHeading|TestIndexProjection|TestTransactionIndexChanges|TestFTSCount|TestReusableTemplateKey|TestAttributeViewOrderReuse' -count=1
go test -race ./cache -run TestAVOrderedIDs -count=1
```

Cancellation tests cover running SQLite work and connection reuse in global and notebook-routed databases. The scoped in-memory database fixture tests routing, not SQLCipher format compatibility. Rendering tests use real browser DOM for insertion roots, whole replacement, selection identity, prepend scroll compensation and stale/removed roots, with component renderers replaced by spies. Component behavior and real device IME/touch interactions require their own regression checks. Semantic search retains serial scheduling because its backend cancellation is a separate change.

Auxiliary-index tests compare all five tables against complete replacement, including duplicates, removals, changed metadata, replay, failure rollback, NULL handling and batched deletion. A 20,000-block regression forbids any auxiliary-table write during an ordinary text edit. The SQLCipher test uses an actual encrypted database and verifies index migration/reopen, wrong-key rejection and isolation from the global database. Template-plan tests compare page values, order, counts, conditional colors and calculations against complete evaluation for table/list/gallery layouts, including original raw values and stale display state. These kernel changes are shared by desktop and mobile and do not change their frontend interactions.

Change-set tests compare complete SQL/FTS snapshots, coalesced transactions, removed/replaced children, root metadata fallback, ordered boundaries, failed writes and recovery without hints. Order-reuse tests compare complete responses for table/list/gallery and exercise saved and temporary edits, sort/write scope, empty results, excluded dependencies, byte limits, immutable IDs and concurrent invalidation. FTS tests place real WAL commits before snapshot establishment, before version confirmation and during row reads, then verify both snapshot counts and subsequent invalidation. They also cover rollback, SQL/argument isolation, cancellation and stale admissions. Run the surrounding SQL, AV, transaction and API permission regressions as appropriate; these focused tests do not replace real-workspace RSS or device interaction measurements.
