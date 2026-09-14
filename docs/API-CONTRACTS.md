# Kernel API type contracts

[中文](API-CONTRACTS.zh-CN.md)

## Scope

This document defines type declarations, compatibility requirements, generated artifacts, and verification for kernel HTTP APIs. Transport types and endpoint definitions are maintained in the module files under `kernel/apicontract/`; `contracts.go` collects the endpoint registry. The migration is complete and `kernel/apicontract/legacy_routes.json` is empty. New endpoints must define type contracts and must not be added to the legacy list.

## Endpoint maintenance

1. Define or update transport types and endpoints in the contract package, specifying request bodies, error codes, null values, defaults, and historical input compatibility
2. Bind business entry points through `contractHandler`, preserving route middleware order, authorization, and lease scope
3. Keep `legacy_routes.json` empty; when deleting an endpoint, remove both its route registration and contract definition
4. Update actual-response, input-compatibility, and strict type tests; run generation and correct calls identified by the compiler
5. Synchronize generated and related public declarations in `petal`; update API documentation for public endpoints

Generation checks inspect actual route and handler declarations to verify methods, paths, handlers, and contract adapters. CI compares the legacy list with the pre-change list and prevents additional records. Do not bypass contract checks with `any`, type assertions, or changes to the legacy list.

## Contracts and implementation

Module files under `kernel/apicontract/` define requests, responses, and endpoints; `contracts.go` collects them in the endpoint registry. The contract package is independent of kernel startup, databases, and persistence models, so the generator runs independently. API entry points bind endpoints through `contractHandler`; Go generic signatures constrain request parameters and successful return values. Constructors set response payloads rather than assigning directly to generic `ret.Data`. Existing helpers continue to validate business rules, and `contractFailure` preserves their error codes, messages, and supported error payloads.

The generator produces `app/src/types/api/index.d.ts` and `kernel/apicontract/schema.json` from the same Go types. The schema contains shared `$defs` and each endpoint's request and response schemas. Tests validate actual HTTP responses against those same schemas. Type declarations do not validate JSON at runtime; handler tests in CI validate serialized results.

Input and output are handled separately. The `json` tag determines wire field names. Request fields are required by default; `api:"optional"` permits omission, `nullable` accepts `null`, and pointers preserve nullability. Output `omitempty` controls omission only and does not determine request requirements. Embedded structs are flattened, and recursive types use references. Interface unions, constant fields, and custom encoding or decoding require explicit modeling. Unsupported types, conflicting fields, and unknown JSON tags fail generation without falling back to `any`.

Arrays, maps, and nested structs recursively validate request constraints. A `null` in a string array is not converted to an empty string; `null` values in batch attributes still mean deletion. The tag tree has a dedicated recursive transport structure. Notebook and document-path fields are optional in shared frontend tree nodes because tag nodes do not return them.

`Notebook` is an API payload. Business models map to it explicitly, and regression tests compare complete JSON across encryption states. Contract changes do not alter `.sy`, database, history, sync, or encryption formats.

Notebook creation, renaming, removal, closing, icon updates, and sorting use typed contracts. Renaming, removal, and icon updates trim notebook IDs; closing preserves whitespace for ID validation. Empty names and icons remain available to business validation, and rename failures retain their message display duration.

Encrypted notebook lifecycle endpoints preserve passwords exactly, including leading, trailing, and all-whitespace strings. The `nonempty` string option rejects only an empty string without normalization; required password fields also reject omission, null, and non-string values. Backup import preserves multipart password text and retains its optional-field behavior, with authentication performed by the model. Fractional-minute truncation, negative-minute clamping, administrative authorization, lease acquisition, and mount rollback remain unchanged. Key derivation, ciphertext formats, and recovery material remain model-layer responsibilities.

## Compatibility requirements

At migration completion on September 14, 2026, all 629 method/path registrations in `kernel/api/router.go` were contracted and the legacy list was empty. At that baseline, four `ANY` registrations expanded to 661 concrete method/path pairs in generated metadata. Use the generator and route coverage checks for current counts as endpoints are added. Static resources, the main application WebSocket, and other transport services registered by `kernel/server/serve.go` are outside this API route inventory.

System contracts retain complete configuration, workspace management, uploads, authentication, OIDC response variants, boot streams, and empty or binary responses. Persisted layout and shortcut values are narrowed where the frontend consumes them, preserving existing default repair, obsolete-key cleanup, and binding filtering. Configuration export, import, and shutdown keep their existing lifecycle and encryption behavior.

Transaction contracts discriminate all 97 known operation actions and exclude those names from the explicit unknown-action compatibility branch. The frontend uses the same finite operation union. Private raw input preserves historical fields, ignored values, asynchronous model errors, and echoed payloads; schema declarations do not move model validation into HTTP admission. Undo, redo, heading operations, response leases, and transaction persistence formats retain their existing behavior.

Extension clipping retains first-value multipart handling, dynamically named uploaded files, partial results, original messages, and encrypted-notebook admission. Dynamic icons retain SVG bytes, security and cache headers, and empty failure responses. Broadcast streams declare raw SSE bytes with dynamic event names, IDs, and retry values, and raw WebSocket frames with their upgrade errors; payloads are not converted to JSON or Base64, and channel cleanup retains its original scope.

Plugin private services declare their existing serialization modes, raw files, redirects, proxy responses, SSE events, and WebSocket frames. Plugin-defined payloads remain protocol extension data; branch-specific validation distinguishes serialized formats from arbitrary bytes. Request bodies, explicit response headers, admission failures, and cancellation retain the plugin service lifecycle.

Network contracts retain request bytes, multipart fields, headers, URL and TLS diagnostics, including complete certificate public-key structures and large integers. Forward proxy options preserve validation order, numeric truncation, response encodings, and protocol-defined JSON payloads. HTTP, EventSource, and WebSocket proxies retain upstream statuses and bytes, repeated-header behavior, security headers, stream cancellation, and connection cleanup. Echo wildcard paths bind their own adapter while sharing the same handler behavior.

Attribute-view contracts declare table, gallery, and kanban results separately and retain missing base fields, cell patches, and null values. Known patch fields retain their supplied presence without filling omitted fields with zero values. Current, history, and snapshot rendering use their corresponding request types; callers handle error payloads before updating views. Row sorting, publish admission, encrypted-notebook leases, and fast JSON rendering preserve their existing behavior. Shared frontend and plugin declarations reflect the fields actually present in each view and cell.

AI contracts retain provider configuration, model discovery and matching, confirmation decisions, session extensions, and numeric and omission semantics. Editor and agent streams declare their actual SSE events; disconnection closes upstream requests, and stream lifetimes remain within the request. OAuth pages retain their media types, HTTP statuses, and security headers. Session permission notifications use `WithAfterWrite` to preserve response-before-broadcast ordering. Arbitrary JSON remains limited to protocol extension fields and tool results.

Setting contracts retain partial configuration merging, existing defaults, case-insensitive struct fields, explicit null values, JSON number normalization, and parser error messages. Keyboard shortcuts and cloud authentication results declare their fixed fields while preserving their protocol-defined JSON extensions. Cloud-user admission still precedes body reads for non-administrators, and two-factor authentication keeps cloud error codes and extension fields. Frontend callers normalize persisted display settings at the same existing boundaries.

Document-tree contracts retain conditional parameter validation, path and sorting semantics, omitted callbacks, pagination defaults, and document response variants. Publish authentication preserves HTTP 429 and `Retry-After` through explicitly declared additional error statuses. Publish and encrypted-notebook admission remain before deferred field validation, and document leases cover response serialization.

Asset contracts retain nullable result lists, per-file upload order and duplicate names, successful partial-upload messages, and local-insertion failure payloads. OCR columns remain string-valued. Annotation validation, published-file admission, encrypted reads and writes, deferred downloads, and upload target selection keep their existing behavior. The non-API upload entry uses the same typed model operation.

Export contracts retain Markdown option defaults and numeric truncation, notebook-list filtering, ignored title-option types, optional HTML folders, and file-upload field selection. Error responses preserve message durations and empty-string resource payloads. Publish filtering, encrypted-notebook admission, response-held leases, and temporary export cleanup remain in the existing lifecycle.

Repository contracts retain key encoding, snapshot metadata, numeric truncation and retention defaults, cloud pagination, and file access leases. Repository-file reads retain their media type and bytes; empty files retain the success envelope. Both file success and JSON failure use HTTP 200. For this explicitly declared shared status, `ValidateHTTPResponse` accepts raw file bytes and `ValidateErrorResponse` separately verifies known error payloads. No key material, encrypted file format, or snapshot recovery behavior changes.

Flashcard contracts retain numeric truncation, pagination defaults, optional reviewed-card lists, nullable block results, and non-null deck lists. Notebook and document admission still occurs before deferred pagination errors. Card and deck mutations keep their model-layer validation and persistence behavior; encrypted notebook restrictions remain unchanged.

Sync contracts retain numeric truncation, conditional direction validation in manual mode, configuration field matching and JSON numeric normalization, and message display durations. Provider imports require exactly one file and preserve encrypted package contents and recovery paths. Authorization and read-only checks still precede body decoding; synchronization and notebook encryption remain in the model layer.

Marketplace contracts retain required-field ordering, whitespace handling, theme mode dependencies, rating availability and rate-limit payloads, and local-package upload errors. Package and appearance responses declare their complete nested structures, including the fixed five-element rating distribution. Upload requests keep first-file selection and overwrite parsing. Installation, removal, authentication, and publish restrictions remain in the existing business handlers and middleware.

Plugin information queries retain path, query-string, and JSON-body name precedence, including whitespace and business error codes 1 through 4. URL parameters bypass body decoding, and list queries ignore the body. Plugin and RPC-method lists retain nullable arrays and entries. HTTP JSON-RPC has a separate contract for single and batch requests, success and error replies, and notification-only HTTP 204 responses. Plugin admission occurs before body reads, batch errors retain their order, and arbitrary JSON is limited to RPC parameters, results, and error details. RPC WebSocket routes declare HTTP 101 upgrades, HTTP 404 plugin admission errors, HTTP 400 text rejections, and separate incoming calls and outgoing replies or notifications. Origin authorization and connection cleanup remain in the existing upgrade lifecycle.

Search contracts retain pagination defaults and numeric truncation, path validation and deduplication, ignored historical subtype filters, and null versus empty arrays. Reference search distinguishes correlation-only responses from block results and retains notebook admission before deferred parameter validation. SQL search authorization, publish filtering, encrypted notebook leases, cancellation responses, and read-only embed-update no-ops remain in their original order. Desktop and mobile callers share generated request types.

History contracts retain path trimming, optional highlight defaults, fractional history-type truncation, and null versus empty result arrays. Version comparison checks both reference objects before their fields and acquires notebook leases in sorted order. Content reads and document, asset, and attribute-view rollbacks retain their history-path lease checks; notebook rollback keeps its existing model-level recovery behavior.

Import contracts preserve archive cleanup, first-upload selection, untrimmed Markdown paths, and staged-token trimming and lifetime. Automatic SiYuan imports declare document, token, notebook, and notebook-collection results; mount failures retain the document payload. Obsidian task cancellation retains its task snapshot on failure. Notebook mounting, encrypted import handling, and creation notifications remain in the existing business operations.

Backlink contracts preserve untrimmed query fields, optional flag defaults, source-filter normalization, and revision hashes. Missing list IDs still return null; unchanged revisions retain the existing fields with null arrays. Candidate-definition failures retain their empty `refDefs` payload. Publish filtering, encrypted-notebook admission, and request-held leases remain in the handlers, and context payloads retain recursive block paths and attribute-view reference targets.

Graph contracts preserve partial configuration defaults, case-insensitive configuration fields, and numeric normalization. Query responses distinguish full graph data from correlation-only payloads, including errors and local queries without an ID; node and link arrays retain their original nullability. Configuration persistence still requires administrator access outside read-only mode. Publish filtering and encrypted-notebook rejection retain their existing order relative to configuration decoding.

Template contracts retain path checks before mode and source validation, explicit-mode precedence over the legacy preview flag, database-mode defaults, and the code `1` overwrite prompt. File management keeps Go struct JSON binding and its fixed parse-error message, with separate list, source, revision, and null payloads. Revision checks, symlink restrictions, and sync invalidation remain in the existing model operations.

SQL query contracts retain `limit` and `truncated` at the success envelope's top level. `SuccessSQL` attaches this metadata while failures omit it. Row names come from the query; each value is a JSON scalar, preserving integer digits and Base64 serialization of binary values. Statement trimming, optional mode handling, single-statement and read-only checks, and code `1` query errors remain unchanged.

Contract maintenance must preserve existing observable API behavior. Changes to type definitions or handler structure alone must not change call semantics:

- Request semantics: preserve body requirements, field optionality, and distinctions between an empty body, missing fields, `null`, empty strings, empty objects, and empty arrays
- Parameter handling: preserve defaults, whitespace handling, numeric conversions, and supported historical input rules; do not implicitly widen or narrow accepted inputs
- Response structure: preserve field names, types, nullability, and omission rules; distinguish `{}`, `[]`, and `null`, and fully declare success, prompt, and failure variants
- Error behavior: preserve HTTP statuses, business error codes, messages, additional error payloads, and message display duration; do not reinterpret existing business failures as success
- Permissions and lifecycle: preserve authentication, roles, read-only and publish-access checks, and encrypted-notebook admission, lease scope, and release timing; compatibility handling must not bypass authorization or authenticated decryption

Endpoint-specific behavior is recorded jointly in contract definitions, compatibility decoding, and regression tests. Tests must cover actual HTTP serialization, boundary inputs, and permission scenarios rather than only checking whether types compile.

`ignoretype` and `filterstrings` apply only to explicitly declared historical parameter compatibility. Generated request types describe canonical calls; compatibility decoding may accept and ignore a wider set of old inputs, with tests covering those exceptions. There is no global switch to fall back to old parsing after binding fails.

Read-only middleware may still return a prompt object containing `closeTimeout`. Ordinary `fetchPost` callbacks receive only nonnegative codes retained after message processing; block-info code `3` still requires handling. `fetchSyncPost` and `fetchGet` preserve complete responses. Dynamic URLs retain existing signatures. Static POST paths must come from contracts, and invalid parameters cannot fall back through another overload. Use an explicit `string` variable when constructing a template URL with an open-ended range.

Use `FailureWithTimeout` when a business error must preserve its message display duration. Contract-based block queries use `holdContractBlockRequest` to retain lease checks for explicit notebooks and accompanying IDs. Individual entry points still specify whether state queries permit deleted IDs.

`StructJSONBody` is reserved for endpoints that already use Go JSON struct binding. It preserves case-insensitive field matching, null handling, and parser errors; required business fields are validated by the handler. It must not be used to relax an existing endpoint's request rules. Endpoints that return their result payload on failure explicitly set `DataOnError` and use the endpoint's typed `FailureWithData` method.

Notebook configuration updates use a typed partial object. The `legacyobject` field option preserves the existing JSON round-trip's numeric normalization and case-insensitive struct binding; optional pointer fields leave existing values unchanged when omitted or null. Encryption fields are decoded for input compatibility but never applied by the configuration patch. `Base64Bytes` explicitly models historical byte-slice inputs as Base64 strings or byte arrays.

`JSONValue` is reserved for fields whose wire protocol explicitly accepts arbitrary JSON, such as an echoed correlation ID. Its schema is a recursive union of null, booleans, numbers, strings, arrays, and objects; it does not stand in for a structured request or response. Word-count results retain their fixed statistics fields independently of the correlation value.

Heading transaction queries return `BlockTransaction` with typed operations and preserve empty, null, and undo-operation payloads. `BlockOperationResult` declares the finite union of text, block ID arrays, and null. Conversion from the model's polymorphic fields rejects unsupported types; attribute-view operation payloads use their action-specific contracts. The editor's operation type also accepts the empty column-type field returned by non-attribute-view operations.

All `/api/block/` routes use contracts. Heading-level queries retain batch-ID precedence, deduplication, fractional-level truncation, document struct binding, and message display durations. Document conversion results include the six heading counts and typed transactions. Reference checks validate only the fields used by the selected scope, preserve ignored fields and notebook trimming rules, and retain boolean error payloads, publish filtering, and notebook leases through response serialization. These exceptional input rules use private, endpoint-specific typed decoders; ordinary endpoints continue to use field declarations. Recent-update results use a recursive `SearchBlock` payload, including nullable references, children, and card metadata.

Storage contracts keep arbitrary JSON limited to storage values; keys, recent documents, search criteria, inline styles, and attribute-view palettes have structured types. Recent-document mutations retain their read-only no-op before parsing the body. An optional typed `beforeDecode` callback on `contractHandler` preserves this ordering and may return a response before decoding; route checks still require an explicit endpoint binding. Inline-style version 1 updates preserve existing built-in configuration, while version 2 and palette requests retain their struct-decoding compatibility.

`DirectJSONOutput` preserves protocols that return their own JSON objects or arrays without the kernel envelope. Use `SuccessDirectJSON` for these payloads. Endpoints that also support empty notification responses explicitly declare `NoContent` and return `SuccessNoContent`; HTTP validation requires status 204 and an empty body. Authentication and read-only failures retain the kernel error envelope. Generated declarations record the direct output mode and optional empty-response support.

## File and streaming protocols

`RawSSEOptions` and `RawWebSocketOptions` declare byte-oriented broadcast protocols. Use `ValidateRawSSEEvent` and `ValidateRawWebSocketFrame` to check their event and frame metadata independently; JSON event and RPC message declarations retain their existing validation. Raw WebSocket failures are written by the upgrader rather than `RejectWebSocket`.

JSON SSE endpoints declare each event name and payload with `SSEOptions` and `SSEEvent`. `StreamSSE` executes the existing stream lifecycle within the request; cancellation and cleanup remain inside that lifecycle. HTTP validation distinguishes `text/event-stream` from the declared pre-stream JSON failures, while `ValidateSSEEvent` checks each JSON event payload separately. Generated metadata exposes the event types. `fetchPost` and `fetchGet` buffer streams as text; `fetchSyncPost` continues to parse JSON and is not a stream reader.

Endpoints with an empty HTTP response list its permitted statuses in `EmptyResponseStatuses` and return `EmptyHTTPResponse`; other responses retain their own declared shapes. `RedirectHTTPContent` preserves the standard redirect status, Location header, and escaped HTML body. `RawBody` leaves the original request stream unread for protocol handlers. `ProxyOptions` distinguishes HTTP bytes, EventSource bytes, and WebSocket frames, preserving upstream statuses instead of treating them as kernel business codes. Proxy admission errors and middleware envelopes are validated separately. `ANY` registrations remain one coverage record and expand to the router's nine HTTP methods in generated metadata. Response validation preserves JSON number precision, including certificate integers outside the floating-point range; it does not change request numeric conversion.

Page responses use `HTTPContentOptions` to declare permitted HTTP status and media-type pairs and `SuccessHTTPContent` to preserve their bytes. This uses the existing binary transport and keeps JSON middleware errors separate. `FastJSON` preserves selected large responses' accelerated JSON encoder without changing their typed payloads or response envelope; encoding failures retain the standard encoder fallback.

`WebSocketOutput` uses `WebSocketOptions` to declare incoming and outgoing message types and the plugin admission failure status. `UpgradeWebSocket` hands the response writer to the connection lifecycle from `contractHandler`; `RejectWebSocket` serializes the declared rejection payload. Generated route metadata includes both message schemas, and `ValidateWebSocketMessage` validates frames separately from handshake responses and middleware envelopes. Handshake validation checks HTTP status and body; network regression tests verify upgrade headers, Origin rejection, message exchange, and cancellation.

Optional `*string` form fields preserve omission separately from an explicit empty string; use `nonnullable` because multipart text fields cannot contain JSON null. Import handlers use this distinction for defaults and delayed field validation. Upload progress starts before multipart parsing, and parse failures clear it before responding; Gin's cached form is reused for typed binding.

`BinaryOutput` declares raw file responses with `BinaryContent` and `SuccessBinary`. The adapter preserves bytes and media type, while `ErrorStatus` declares the distinct HTTP status for JSON failures (`getFile` uses 202). The schema records binary success and typed JSON errors; `ValidateHTTPResponse` checks the status and media type before validating an error envelope. Generated route responses expose `Blob`, while the existing fetch helpers expose `JSONValue` because they parse file contents as text or JSON according to their existing behavior. JSON file contents can contain arbitrary JSON; this does not relax the structured error contract.

`FormBody` supports endpoints such as `putFile` that accept both URL-encoded and multipart forms. It preserves Gin `PostForm` parsing, including first-value selection and available fields after parsing errors. Conditional requirements and delayed validation remain in the handler: directory creation does not require a file, and modification-time validation occurs after writing. The generated caller type uses the same typed form interface as multipart uploads.

Use `MultipartBody` for file uploads. Request structs declare string fields and `*multipart.FileHeader` fields using their wire names; file schemas use `type: string` and `format: binary`, generating `Blob` declarations. The adapter retains Gin multipart parsing and binds the first value for repeated fields. File contents remain available through `Open`, so handlers preserve their read and recovery logic. Unsupported field types and binding options fail generation.

Fixed fields declared as `[]*multipart.FileHeader` receive all files in their original order and generate `Array<Blob>`. An optional absent file list remains nil. Text and single-file fields still select the first value. `SuccessWithMessage` retains nonempty messages on successful responses, including partial batch uploads.

Frontend callers construct `ContractFormData` from typed fields before passing it to the existing fetch functions. The generated signatures require the endpoint's fields and distinguish file values from strings; raw `FormData` cannot satisfy an upload contract. Optional fields are omitted and string values are not trimmed. Plugin callers can implement the generated `APIFormData<Request>` interface when constructing their forms.

Dynamic multipart endpoints use `MultipartFields` to retain every text value and file under each field name. Its request schema maps field names to arrays of text or binary values; `ContractFormData` appends each array item as a repeated form field. This is distinct from fixed-field uploads, which continue to bind the first value. Broadcast publication preserves text-before-file processing and its per-message error results. Endpoint-specific `DecodeFailure` handling preserves existing parsing error codes and payloads.

## Generation and verification

`swapBlockRef` accepts the optional boolean `originalToEmbed`. Omission or `false` keeps the reference at the original definition position; `true` replaces it with an embed querying the moved definition ID. `includeChildren` retains its heading and list behavior. `TestSwapBlockRefContractCompatibility` and `TestSwapBlockRefNodes` cover request defaults, invalid options, and both replacement modes across document, heading, and list cases; they run in the full kernel command below.

Asset-reference scans report missing attribute-view definitions and invalid definition IDs in the optional `unavailableAttributeViews` list without blocking queries, previews, or replacement. Each entry identifies the notebook ID/name, document ID/path/human-readable path, block ID, view ID, and reason. Existing unreadable or corrupt definitions remain errors. Missing-file snapshots are revalidated before writing so a definition restored during scanning cannot be silently omitted. Attribute-view definitions are not deferred assets under the current download-path policy; the regression suite checks this assumption. The unavailable-definition regressions run through the model and actual HTTP contracts, including closed notebooks and shared definitions.

Asset-reference query and replacement contracts preserve scalar requests and also accept batches. Batch results retain input order and report each mapping's status, reason, references, and changed-file count; the top-level count includes each shared file once. Empty batches, duplicate sources, and chained or cyclic mappings are rejected. Independent mappings may succeed when another mapping fails; a shared-file write failure belongs to every affected mapping. Scans allow editing and validate the workspace snapshot before saving; cancellation and unchanged retries preserve source data. `TestAssetRelink` regressions cover scalar compatibility, batch validation, shared document/database/OCR persistence, history, and concurrent edits and are included in the full kernel command below.

Run from `app/`:

```text
pnpm run api:generate --petal ../../petal
pnpm run api:check --petal ../../petal
pnpm run lint
pnpm test
```

The generation command updates both this repository and `petal`; a separate generation run without `--petal` is unnecessary. The `--petal` path is relative to the generator's working directory, `kernel/`; the example refers to a sibling repository. CI checks only this repository's artifacts. Local synchronization across repositories uses this option to verify plugin declarations.

Run from `kernel/`:

```text
go test -tags "fts5 sqlcipher" ./... -count=1
```

`tsconfig.api.json` separately enables strict checks and declaration-file checking for invalid parameters, misspelled fields, required bodies, success and failure branches, nullability, and method mismatches. The main application retains its existing configuration; do not assume strict null checks apply to every call. Handler tests use temporary workspaces and isolated test processes without starting or restarting the running kernel.

Import and static-file fixtures use `internal/testutil.PublicDataDir` to create and clean up explicitly validated non-sensitive directories independently of `TMPDIR` and `GOTMPDIR`. The helper tries the user home, current directory, and filesystem root, and reports a fixture setup failure if none is safe and writable. CI also reruns the affected path tests with `/tmp` as `TMPDIR` and a separate `GOTMPDIR` to cover environment overrides.

CI runs all kernel packages on Linux and all frontend, Electron, and packaging-script tests on Windows. Frontend discovery is restricted to `src/**/*.test.ts`, `tests/**/*.test.js`, `electron/**/*.test.js`, and `scripts/**/*.test.js`, so packaged copies under `app/build` are excluded. Test files run serially to avoid Electron process startup contention. New regression tests in these locations are included automatically; update the test command and this document when adding a new test location or filename convention. Keep `Contract` in Go contract regression test names so they remain easy to run separately.
