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
| `index.update` | Full tree projection, block comparison, auxiliary-index comparison, writes; total and changed blocks, planned auxiliary deletions and insertions |
| `database.view`, `database.fields`, `database.rows` | Load and sync wait, field calculation, filter, sort, aggregation, pagination, conditional colors; row counts before filtering, after filtering and after pagination |
| `database.templates` | Template evaluation; evaluated values, including attempts that report template errors; `database.fields` also counts required and deferred template fields when a plan is used |
| `search`, `search.fts`, `search.path`, `search.regexp`, `search.document` | Query, result processing, exact count, grouping/references; method, returned results, matches and cancellation |
| `editor.content` | Parse/normalize, DOM insertion, synchronous render dispatch, global state; render roots and loaded top-level blocks |
| `editor.databases` | Elapsed time until serial database initialization finishes; candidate root count |

The initial stage is named `prepare`. Repeated stages accumulate time. A canceled search has `counts.canceled = 1`; analyze canceled requests separately from successful requests. The multiword document query computes counts inside the query, so its stage is `query_count`. Regex matching and highlighting share a stage. A save skipped by the existing equality check has no written-byte counter. The index age is the oldest known enqueue time in the captured batch; recovered operations can lack that timestamp. It is not transaction queue wait time.

Nested operations overlap: do not add a parent duration to its children. `editor.content` measures synchronous work and dispatch, excluding later math/chart script loading, embedded queries and browser layout. `editor.databases` includes asynchronous database waits and does not represent all components becoming visible. Global heading numbering, fold state, readonly state, focus and plugin events retain their existing scope.

Auxiliary-index updates compare complete business-field snapshots in the existing transaction. Equal per-block multisets retain their stored IDs; changed blocks replace only their affected table records. Full projection remains necessary for reference and asset metadata that can change independently of a block hash. Counters describe planned row writes, including operations in transactions that subsequently fail; they are not committed-row totals.

Ordinary table, list and gallery views can evaluate templates needed by filters, sorting, calculations and conditional colors, plus their transitive dependencies, before pagination. Other templates run on the current page. Both passes share original raw-value snapshots and preserve required display output. Search, grouped layouts, unresolved/cyclic dependencies, opaque template expressions and dependencies that would change the original evaluation order retain full evaluation. Existing views eligible for deferring every template keep that behavior.

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
```

| Benchmark | Fixed workload | Included work |
|---|---|---|
| `BenchmarkDocumentJSON` | 1,000 / 5,000 / 20,000 paragraph blocks, 112 ASCII content bytes per block, no references/assets, flat structure | Document preparation/JSON serialization or JSON parsing/validation; preparation uses a temporary directory; no product binary or workspace is replaced |
| `BenchmarkDatabaseDisplayPage` | 1,000 / 10,000 / 50,000 detached rows, block/text/display-template fields, page size 50, no filter/group/sort | Render fields using the existing display-template deferral, paginate and evaluate the current page's template |
| `BenchmarkDocumentSearch` | 10,000 / 100,000 / 1,000,000 indexed blocks, 100 blocks per document, two keywords in separate paragraphs, every document matches, first 50 documents | Warm in-memory SQLite document query, exact count and result-row decoding; no FTS, disk I/O, full API formatting or frontend |
| `BenchmarkUpsertTreeAuxiliaryIndexes` | 1,000 / 5,000 / 20,000 paragraphs with a tag and custom attribute per block, one document tag; alternate one paragraph's ordinary text | Complete auxiliary replacement versus incremental comparison and writes, including identical full projections, block/FTS updates and transaction commit; SQLite `total_changes()` delta is reported as `sqlite_changes/op` and includes internal FTS writes |
| `BenchmarkDatabaseTemplateDependencies` | 1,000 / 10,000 / 50,000 detached rows, two dependent templates required by filter/sort and five display templates, page size 50 | Complete versus dependency-based evaluation, including plan creation, field rendering, filter/sort and pagination; each iteration clears the rendered-collection cache |

Use sub-benchmark filters for smaller runs, for example `-bench '^BenchmarkDocumentSearch$/^10000$'`. Database setup and fixture generation are outside measured loops. The database benchmark reuses the attribute view across iterations; it is not a cold-open measurement. `-benchmem` measures Go allocations, not SQLite native allocations or total RSS. Benchmark results are baselines for those paths, not application latency or a general speedup claim.

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
```

Cancellation tests cover running SQLite work and connection reuse in global and notebook-routed databases. The scoped in-memory database fixture tests routing, not SQLCipher format compatibility. Rendering tests use real browser DOM for insertion roots, whole replacement, selection identity, prepend scroll compensation and stale/removed roots, with component renderers replaced by spies. Component behavior and real device IME/touch interactions require their own regression checks. Semantic search retains serial scheduling because its backend cancellation is a separate change.

Auxiliary-index tests compare all five tables against complete replacement, including duplicates, removals, changed metadata, replay, failure rollback, NULL handling and batched deletion. A 20,000-block regression forbids any auxiliary-table write during an ordinary text edit. The SQLCipher test uses an actual encrypted database and verifies index migration/reopen, wrong-key rejection and isolation from the global database. Template-plan tests compare page values, order, counts, conditional colors and calculations against complete evaluation for table/list/gallery layouts, including original raw values and stale display state. These kernel changes are shared by desktop and mobile and do not change their frontend interactions.
