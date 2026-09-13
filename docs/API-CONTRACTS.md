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
