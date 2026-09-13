# Kernel API type contracts

[中文](API-CONTRACTS.zh-CN.md)

## Scope

This document defines type declarations, compatibility requirements, generated artifacts, and verification for kernel HTTP APIs. Endpoint definitions are maintained in `kernel/apicontract/contracts.go`. `kernel/apicontract/legacy_routes.json` records routes that use existing handling, including non-JSON responses, dynamic paths, and `ANY` registrations. New endpoints must define type contracts and must not be added to the legacy list.

## Contracts and implementation

`kernel/apicontract/contracts.go` defines requests, responses, and endpoints. The contract package is independent of kernel startup, databases, and persistence models, so the generator runs independently. API entry points bind endpoints through `contractHandler`; Go generic signatures constrain request parameters and successful return values. Constructors set response payloads rather than assigning directly to generic `ret.Data`. Existing helpers continue to validate business rules, and `contractFailure` preserves their error codes, messages, and supported error payloads.

The generator produces `app/src/types/api/index.d.ts` and `kernel/apicontract/schema.json` from the same Go types. The schema contains shared `$defs` and each endpoint's request and response schemas. Tests validate actual HTTP responses against those same schemas. Type declarations do not validate JSON at runtime; handler tests in CI validate serialized results.

Input and output are handled separately. The `json` tag determines wire field names. Request fields are required by default; `api:"optional"` permits omission, `nullable` accepts `null`, and pointers preserve nullability. Output `omitempty` controls omission only and does not determine request requirements. Embedded structs are flattened, and recursive types use references. Interface unions, constant fields, and custom encoding or decoding require explicit modeling. Unsupported types, conflicting fields, and unknown JSON tags fail generation without falling back to `any`.

Arrays, maps, and nested structs recursively validate request constraints. A `null` in a string array is not converted to an empty string; `null` values in batch attributes still mean deletion. The tag tree has a dedicated recursive transport structure. Notebook and document-path fields are optional in shared frontend tree nodes because tag nodes do not return them.

`Notebook` is an API payload. Business models map to it explicitly, and regression tests compare complete JSON across encryption states. Contract changes do not alter `.sy`, database, history, sync, or encryption formats.

Notebook creation, renaming, removal, closing, icon updates, and sorting use typed contracts. Renaming, removal, and icon updates trim notebook IDs; closing preserves whitespace for ID validation. Empty names and icons remain available to business validation, and rename failures retain their message display duration.

Encrypted notebook lifecycle endpoints use typed requests and responses while retaining password trimming, fractional-minute truncation, negative-minute clamping, administrative authorization, lease acquisition, and mount rollback. Key derivation, ciphertext formats, and recovery material remain model-layer responsibilities.

## Compatibility requirements

Contract maintenance must preserve existing observable API behavior. Changes to type definitions or handler structure alone must not change call semantics:

- Request semantics: preserve body requirements, field optionality, and distinctions between an empty body, missing fields, `null`, empty strings, empty objects, and empty arrays
- Parameter handling: preserve defaults, whitespace handling, numeric conversions, and supported historical input rules; do not implicitly widen or narrow accepted inputs
- Response structure: preserve field names, types, nullability, and omission rules; distinguish `{}`, `[]`, and `null`, and fully declare success, prompt, and failure variants
- Error behavior: preserve HTTP statuses, business error codes, messages, additional error payloads, and message display duration; do not reinterpret existing business failures as success
- Permissions and lifecycle: preserve authentication, roles, read-only and publish-access checks, and encrypted-notebook admission, lease scope, and release timing; compatibility handling must not bypass authorization or authenticated decryption

Endpoint-specific behavior is recorded jointly in contract definitions, compatibility decoding, and regression tests. Tests must cover actual HTTP serialization, boundary inputs, and permission scenarios rather than only checking whether types compile.

`ignoretype` and `filterstrings` apply only to explicitly declared historical parameter compatibility. Generated request types describe canonical calls; compatibility decoding may accept and ignore a wider set of old inputs, with tests covering those exceptions. There is no global switch to fall back to old parsing after binding fails.

Read-only middleware may still return a prompt object containing `closeTimeout`. Ordinary `fetchPost` callbacks receive only nonnegative codes retained after message processing; block-info code `3` still requires handling. `fetchSyncPost` and `fetchGet` preserve complete responses. Dynamic URLs retain existing signatures. Static POST paths must come from contracts or recorded legacy routes, and invalid parameters cannot fall back through another overload. Use an explicit `string` variable when constructing a template URL with an open-ended range.

Use `FailureWithTimeout` when a business error must preserve its message display duration. Contract-based block queries use `holdContractBlockRequest` to retain lease checks for explicit notebooks and accompanying IDs. Individual entry points still specify whether state queries permit deleted IDs.

`StructJSONBody` is reserved for endpoints that already use Go JSON struct binding. It preserves case-insensitive field matching, null handling, and parser errors; required business fields are validated by the handler. It must not be used to relax a migrated endpoint's request rules. Endpoints that return their result payload on failure explicitly set `DataOnError` and use the endpoint's typed `FailureWithData` method.

Notebook configuration updates use a typed partial object. The `legacyobject` field option preserves the existing JSON round-trip's numeric normalization and case-insensitive struct binding; optional pointer fields leave existing values unchanged when omitted or null. Encryption fields are decoded for input compatibility but never applied by the configuration patch. `Base64Bytes` explicitly models historical byte-slice inputs as Base64 strings or byte arrays.

`JSONValue` is reserved for fields whose wire protocol explicitly accepts arbitrary JSON, such as an echoed correlation ID. Its schema is a recursive union of null, booleans, numbers, strings, arrays, and objects; it does not stand in for a structured request or response. Word-count results retain their fixed statistics fields independently of the correlation value.

Heading transaction queries return `BlockTransaction` with typed operations and preserve empty, null, and undo-operation payloads. `BlockOperationResult` declares the finite union of text, block ID arrays, and null. Conversion from the model's polymorphic fields rejects unsupported types; attribute-view operations require their own payload contracts. The editor's operation type also accepts the empty column-type field returned by non-attribute-view operations.

All `/api/block/` routes use contracts. Heading-level queries retain batch-ID precedence, deduplication, fractional-level truncation, document struct binding, and message display durations. Document conversion results include the six heading counts and typed transactions. Reference checks validate only the fields used by the selected scope, preserve ignored fields and notebook trimming rules, and retain boolean error payloads, publish filtering, and notebook leases through response serialization. These exceptional input rules use private, endpoint-specific typed decoders; ordinary endpoints continue to use field declarations. Recent-update results use a recursive `SearchBlock` payload, including nullable references, children, and card metadata.

Storage contracts keep arbitrary JSON limited to storage values; keys, recent documents, search criteria, inline styles, and attribute-view palettes have structured types. Recent-document mutations retain their read-only no-op before parsing the body. An optional typed `beforeDecode` callback on `contractHandler` preserves this ordering and may return a response before decoding; route checks still require an explicit endpoint binding. Inline-style version 1 updates preserve existing built-in configuration, while version 2 and palette requests retain their struct-decoding compatibility.

## Multipart requests

Use `MultipartBody` for file uploads. Request structs declare string fields and `*multipart.FileHeader` fields using their wire names; file schemas use `type: string` and `format: binary`, generating `Blob` declarations. The adapter retains Gin multipart parsing and binds the first value for repeated fields. File contents remain available through `Open`, so handlers preserve their read and recovery logic. Unsupported field types and binding options fail generation.

Frontend callers construct `ContractFormData` from typed fields before passing it to the existing fetch functions. The generated signatures require the endpoint's fields and distinguish file values from strings; raw `FormData` cannot satisfy a migrated upload contract. Optional fields are omitted and string values are not trimmed. Plugin callers can implement the generated `APIFormData<Request>` interface when constructing their forms.

## Endpoint maintenance

1. Define or update transport types and endpoints in the contract package, specifying request bodies, error codes, null values, defaults, and historical input compatibility
2. Bind business entry points through `contractHandler`, preserving route middleware order, authorization, and lease scope
3. Routes with type contracts must not also appear in `legacy_routes.json`; remove records for deleted endpoints, and never add new endpoints to the list
4. Update actual-response, input-compatibility, and strict type tests; run generation and correct calls identified by the compiler
5. Synchronize generated and related public declarations in `petal`; update API documentation for public endpoints

Generation checks inspect actual route and handler declarations to verify methods, paths, handlers, and contract adapters. CI compares the legacy list with the pre-change list and prevents additional records. Do not bypass contract checks with `any`, type assertions, or changes to the legacy list.

## Generation and verification

Run from `app/`:

```text
pnpm run api:generate
pnpm run api:generate --petal ../../petal
pnpm run api:check --petal ../../petal
pnpm run lint
pnpm exec tsx --test src/util/fetch.test.ts src/util/fetchTimeout.test.ts
```

The `--petal` path is relative to the generator's working directory, `kernel/`; the example refers to a sibling repository. CI checks only this repository's artifacts. Local synchronization across repositories uses this option to verify plugin declarations.

Run from `kernel/`:

```text
go test ./apicontract/...
go test -tags "fts5 sqlcipher" ./api -run "TestAPIContract|TestBlockAttrsRespectPublishAccess|TestGetBlockInfoRecovery|TestGetBlockInfoPublishAccess|TestListNotebooksSortsBySubDocCount|TestContract.*NotebookResponseLease" -count=1
```

`tsconfig.api.json` separately enables strict checks and declaration-file checking for invalid parameters, misspelled fields, required bodies, success and failure branches, nullability, and method mismatches. The main application retains its existing configuration; do not assume strict null checks apply to every call. Handler tests use temporary workspaces and isolated test processes without starting or restarting the running kernel.
