# Theme and icon synchronization

[中文](APPEARANCE-SYNC.zh-CN.md)

Related issue: https://github.com/siyuan-note/siyuan/issues/18883

## Feature scope

Third-party themes and icons synchronize as complete packages, including installation state, updates, and deletions. Desktop and mobile clients share the kernel implementation. Full and on-demand download modes both fetch complete appearance packages, including images, fonts, and other resources required by package code.

Built-in `daylight`, `midnight`, and `litheness` resources remain part of the application and do not enter synchronized package storage. Data directories with these names must not override the built-in resources. Light and dark theme selections, the icon package, appearance mode, and following the system appearance remain device settings in `conf/conf.json`.

Older clients continue synchronizing notes without upgrading. They transport internal package files using the existing synchronization mechanism; package installation, deletion, conflict resolution, and appearance restoration require a client that supports this feature. Ordinary documents and other data retain their existing file-level synchronization rules.

## User interaction

Installing, updating, or uninstalling a third-party theme or icon package publishes a complete package change. Receiving a newly installed package does not automatically select it on another device. After synchronization or snapshot restoration, the client refreshes the available package list and the resources used by the current selection.

`theme.json` and `icon.json` do not introduce an author-controlled synchronization switch. Themes continue to use `frontends`: an absent or empty value does not enable mobile support, and `all` supports every frontend. Runtime loading also checks `minAppVersion`. An unavailable local selection falls back to the built-in appearance.

Users may edit local CSS, scripts, and images. Package digests describe synchronized content; normal runtime loading and exports do not require users to regenerate them after each edit. Before creating a snapshot, the kernel records local changes and verifies the complete package. A package involved in an unfinished installation, an authenticated pending synchronization operation, or legacy deferred resource downloads remains temporarily unavailable. The frontend uses a built-in appearance while retaining the local selection, then refreshes it after recovery.

If a package is incomplete or fails validation, the operation returns an error and preserves its directory, state, and recovery history. Recovery must use a consistent complete package or an explicit reinstall. Deleting state files to bypass validation is not a supported recovery procedure.

## Data and storage

### Directories and package state

| Path | Purpose | Synchronization scope |
|---|---|---|
| `data/themes/<name>/` | Local third-party theme directory | Restored from package events; excluded from ordinary file synchronization |
| `data/icons/<name>/` | Local third-party icon directory | Restored from package events; excluded from ordinary file synchronization |
| `data/storage/bazaar/themes/<name>.json` | Per-theme installation state | Restored with the package event; not synchronized independently |
| `data/storage/bazaar/icons/<name>.json` | Per-icon-package installation state | Restored with the package event; not synchronized independently |
| `data/storage/appearance-v1/` | Immutable package events and format marker | Retained through existing file synchronization and snapshots |
| `conf/conf.json` | Device appearance selection | Excluded from package synchronization |

Themes and icons no longer update the shared `storage/bazaar.json` file. Its existing contents remain a migration fallback for installation time and package source information. Other marketplace package types continue using the existing mechanism.

The state is an internal kernel format, separate from the manifest maintained by a package author:

```json
{
  "version": 1,
  "deleted": false,
  "migration": false,
  "installTime": 0,
  "updateTime": 0,
  "repoURL": "https://github.com/owner/package",
  "repoRef": "main",
  "files": {
    "theme.css": "64-character-lowercase-sha256"
  }
}
```

`files` maps relative POSIX paths within the package to the SHA-256 digests of plaintext files. The inventory follows existing synchronization filtering rules: ordinary hidden directories, dot-prefixed files, and `.tmp` files are excluded, while permitted `.siyuan` directories are retained. Unknown versions, invalid paths, case or Unicode normalization collisions, missing files, and digest mismatches return errors and preserve the source material.

A deletion state retains installation source information, sets `deleted: true`, and contains an empty `files` object; the package directory is absent. Migration creates a state with `migration: true`. Explicit installation, updates, and local edits create ordinary states. A late migration must not remove an existing deletion record. An explicit reinstall creates a new non-deleted state.

### Immutable package events

DejaVu stores each complete package event at `data/storage/appearance-v1/<kind>/<name>/<sha256>.sypkg`, where `<kind>` is `themes` or `icons`. Each event is a ZIP Store archive containing `appearance.json`, `state.json`, and the payload under `files/`. Entry ordering, timestamps, and permissions are fixed, so identical inputs produce identical archive bytes. The filename digest covers the entire archive. A deletion event contains metadata and deletion state without a payload.

`appearance.json` identifies the format, package, and predecessor events:

```json
{
  "version": 1,
  "kind": "themes",
  "name": "example",
  "parents": []
}
```

`parents` contains sorted, unique predecessor digests. Updates, deletions, and merge resolutions create new event paths and never overwrite existing events. The fixed `data/storage/appearance-v1/format.json` marker contains `{"version":1,"type":"siyuan-appearance-events"}` followed by a newline. It distinguishes a snapshot that supports this feature but contains no packages from a legacy snapshot without appearance events.

Archives retain the existing `File.ID` algorithm. That algorithm uses the path and second-resolution modification time, so different local contents can receive the same identifier before either device synchronizes. A cloud lock serializes synchronization operations but cannot distinguish identifiers already created from the same path and second. Immutable event paths include the content digest, so package changes do not rely on modification times for identity. The existing snapshot, chunking, encryption, and authentication formats remain unchanged.

Before publishing a local package directory, the reader verifies the archive filename digest, package identity, predecessor relationships, paths, state format, and all payload digests. The event graph must contain every referenced predecessor and must not contain cycles. The fixed format marker requires separate authentication; a cached object with the expected legacy identifier does not prove that the authoritative source still contains a supported marker.

## Implementation and interfaces

### Merge rules

New clients retain all known shared events before selecting a complete version for each package. Descendants supersede their ancestors. Concurrent events are resolved as complete packages, and a new event records the selected version with all concurrent heads as parents. This preserves the decision across later synchronization operations.

| Situation | Behavior |
|---|---|
| Only one device changes a complete package | Use that device's package |
| Concurrent updates | Use the cloud package and preserve the other complete package in conflict history; use a stable digest ordering when no cloud head distinguishes the candidates |
| Concurrent update and deletion | Prefer deletion and preserve the discarded complete package in history |
| Late migration encounters an existing cloud deletion | Retain the deletion without restoring the old installation |
| Explicit reinstall after observing a deletion | Synchronize a new installation descended from the known deletion |
| Legacy snapshot without the format marker | Retain existing appearances; missing event records do not imply uninstalling packages |
| Restore an earlier package version from a new-format snapshot | Create a new restoration event while retaining current known events and recovery material |
| Archive, state, or payload validation fails | Stop applying the package and preserve source data without publishing a partial directory |

DejaVu's `EnableAppearanceSync` option enables package handling. `AppearanceIgnoreLines` supplies the user's rules after removing the valid managed isolation block. `BeforeAppearanceApply` lets the kernel ensure isolation rules exist after ordinary file restoration and before local appearance directories are applied. The callback must run without holding the appearance lock. These are internal integration interfaces; the feature does not add public HTTP endpoints or change public configuration fields.

Package resources must download together with package code in both full and on-demand modes. Ordinary attachments may still be deferred in on-demand mode. Bidirectional, upload-only, and download-only synchronization use the same complete-package boundary. Existing deferred-download state and version 1 recovery journals remain readable, and legacy deferred appearance resources are completed before applying their package.

### Runtime loading and exports

Resource URLs remain `/appearance/themes/...` and `/appearance/icons/...`. The kernel resolves them to built-in resources or the corresponding local third-party directory. Exports copy the complete theme and icon resource sets, including auxiliary files referenced by scripts.

Runtime loading and exports validate state format and deletion status without automatically rewriting content digests. Packages with authenticated pending operations are not activated. This permits normal manual editing while ensuring that digest regeneration cannot conceal incomplete synchronization.

After synchronization or snapshot recovery, the kernel refreshes available packages, rebinds theme file watchers, and sends the internal `refreshAppearance` notification. The frontend advances a resource cache revision for changed packages while retaining the public theme and icon version fields. Updating a package without changing its declared version therefore still reloads current resources. The desktop main window, detached windows, and mobile frontend use the same notification protocol.

Theme script loading and unloading are serialized. Historical theme scripts retain their unload lifecycle. If a script cannot be safely unloaded, the interface reloads before applying the new appearance.

### Cache and concurrency

Package installation, scanning, resource reads, and publication share an appearance lock. Windows directory replacement may have a brief interval when the directory is unavailable; coordinated reads must not observe a partially replaced package. Before snapshot creation, pending local operations are recovered and local changes are scanned. Indexing verifies the stored chunks again and rejects an inconsistent package if files changed during scanning.

Historical archive metadata uses a bounded in-memory cache. Entries are reused only after complete validation and while the source identity remains unchanged; full package contents are loaded only for event heads. Windows checks file identity, timestamps, and file USN. Supported other systems require complete identity information and a stable high-resolution change time. If reliable change information is unavailable, the archive is read and validated again. The format marker is always authenticated separately and does not use this cache.

Cache keys distinguish repository sources, file contents, chunk sequences, and encryption keys. Validation must detect closed-file rewrites that preserve modification time, ciphertext corruption, and incorrect keys. Archive decoding allocates payload buffers from declared lengths and verifies sizes and CRCs. When multiple packages reuse a font or another content chunk, per-chunk read and write serialization prevents concurrent publication and reading conflicts on Windows. Snapshot change detection remains read-only.

### Related repositories

| Repository | Integration scope |
|---|---|
| `siyuan` | Data directories, migration, installation state, resource routes, runtime fallback, exports, synchronization and snapshot hooks, frontend refresh, and user guides |
| `dejavu` | Archives compatible with legacy file identifiers, event merging, recovery references, complete digest validation, deletion records, complete conflict history, on-demand compatibility, package application, and interrupted-operation recovery |
| `theme-sample`, `icon-sample` | English and Chinese development-directory documentation and theme frontend support documentation |
| `siyuan-testing` | Tests for resources in actual data directories, same-version CSS refresh, and built-in fallback after uninstalling |
| `bazaar` | Existing theme and icon manifest validation remains sufficient; no new author fields or packaging format changes |
| `siyuan-android`, `siyuan-ios`, `siyuan-harmony` | Shared kernel and existing resource URLs; no native bridge changes, with device verification required for upgrades and cold starts |
| `petal`, `plugin-sample`, `siyuan-chrome`, `protyle`, `go-sdk` | No public configuration or HTTP API changes requiring declaration or caller updates |
| `lute`, `riff`, `gulu`, `filelock`, `eventbus`, `httpclient`, `logging`, and other Go dependencies | Existing formats and capabilities remain in use without additional protocol changes |

## Compatibility and recovery

### Existing data and clients

Older clients transport immutable archives as ordinary files and continue synchronizing notes. They do not use the new runtime directories or apply complete appearance packages. No repository-wide upgrade gate or new file identifier format is required.

Existing encrypted notebooks, snapshots, backups, history, and supported deferred-download states remain compatibility baselines. Their authenticated readers and recovery paths must remain available. The feature does not change key envelopes, MasterSalt, AAD semantics, or key derivation. Unknown formats, corruption, and authentication failures preserve original data and return errors; they must not bypass authentication, regenerate MasterSalt, discard keys, or fall back to plaintext. Staging data and derived caches do not replace authenticated source content.

### Migration and ignore rules

Migration copies and validates third-party packages from legacy directories while retaining the originals. Existing destination directories and states take precedence. Untracked directories without synchronizable files remain untouched and are skipped without blocking other packages. The completion marker `conf/appearance-migration.json` is local to the device and prevents repeated startup migration from reimporting uninstalled packages.

For development packages using symbolic links, migration retains a link to the original package. A package-root link without synchronization state remains local, and ordinary synchronization does not follow it into an external directory. A package that already has synchronization state must be explicitly excluded as a whole before being changed to a link, so the change is not interpreted as deletion or reinstallation.

Before creating local appearance directories, the kernel persists this versioned managed block at the end of `.siyuan/syncignore`:

```text
# siyuan-appearance-isolation:v1:begin
/themes/
/icons/
/storage/bazaar/themes/
/storage/bazaar/icons/
# siyuan-appearance-isolation:v1:end
```

Older engines honor these rules, and new clients additionally protect the local directories through path filters. The kernel preserves the user's existing rules and bytes. An unknown, incomplete, or modified managed block returns an error and preserves the original file. If synchronization or snapshot restoration restores earlier rules, isolation must be re-established before the next index or package application.

The local `.siyuan/.appearance-syncignore-clock-v1` file records reserved modification-time seconds for rule updates and is excluded from snapshots and cloud synchronization. A new second is durably reserved before changing the isolation rules, preventing legacy file identifier reuse after restoring old rules or moving the system clock backward. Unknown or corrupt clock records return errors and preserve the original file.

New clients remove only a complete valid managed block when evaluating the user's appearance rules. Existing user rules still apply. For example, `/themes/example/` excludes a complete package; `/themes/` or `/icons/` excludes an entire category. Excluding `/storage/` or `/storage/appearance-v1/` disables the internal appearance protocol. Excluding only part of a tracked package or its state record must not produce an incomplete package: integrity checks return an error. Whole-directory replacement preserves existing ignored files and checks for local edits made during application.

Whole-package exclusion prevents uploading or applying that package. Unknown, damaged, or missing archive payloads belonging to an excluded package are not fetched from the cloud or LAN, are not decoded, and do not block note synchronization. Protocol path, identity, and format-marker checks remain effective. Private local events that were never uploaded must not enter a cloud recovery reference. Already shared cloud events, including deletion records, remain referenced even after their package is excluded; retaining their references does not require downloading, repairing, or re-uploading the excluded payloads.

### Interrupted operations and snapshot restoration

Application first downloads, validates, and stages the complete package. It then backs up the old directory on the same filesystem, replaces the directory, and publishes the state. Synchronization uses the existing asset recovery journal. Local installation uses journals under `data/.siyuan-appearance-ops`, with previous directories retained under `data/.siyuan-appearance-backups`. Synchronization replacements preserve previous directories in history; if a cross-filesystem rename is unavailable, recovery retains a backup on the original volume.

Startup, the next operation, and snapshot preparation can continue an unfinished transaction. Journals record the expected source state. If recovery discovers additional local changes, it preserves current files, staging data, and recovery material and returns an error. Retries must retain changes already applied and must not publish partially verified packages.

A legacy snapshot without the format marker does not imply deletion of current appearances. Restoring a new-format snapshot creates restoration events relative to currently known event heads, preserving later events and recovery material. Single-file cloud restoration must reject package payloads, installation state, and files in the internal archive namespace; these require the complete snapshot and package recovery flow. Complete snapshots and their required content must be available before restoration; partial cloud snapshots must not silently discard package or ordinary workspace data.

### Recovery references and limitations

The internal `.siyuan-appearance-v1` tag references a complete ordinary workspace snapshot containing retained appearance events. It must not reference an appearance-only snapshot, because an older client restoring that snapshot could otherwise delete notes. Publication uploads the complete objects and snapshot first, then publishes the recovery reference, and finally publishes the latest reference. If an older client restores and republishes an early snapshot without appearance events, a new client uses the recovery reference to restore event knowledge, including deletion records.

The cloud recovery reference combines the target workspace snapshot with previously shared cloud events. It must not copy private, unshared events from a local recovery reference. If only excluded events disappear from the latest snapshot and no new events need publication, the previous cloud recovery reference remains unchanged while note synchronization proceeds.

New clients hide and protect the internal tag only after authenticating a snapshot containing this protocol's format marker. They exclude the verified internal tag from the user backup count. A pre-existing user tag with the same name remains visible and editable; automatic publication returns a conflict instead of overwriting it. Internal recovery updates do not consume the quota for creating user backups. An older client may display this ordinary tag and count it as one backup slot; note synchronization remains available.

Event history retains complete shared package versions, so storage grows with package updates. Cloud repositories may reuse unchanged chunks, but local archives still contain complete packages. There is no automatic event-history compaction. Ordinary history cleanup must retain events reachable from the recovery reference. Deliberately removing the recovery tag and all related history removes that recovery material and prevents recovery of otherwise deleted events.

Publishing the recovery reference before the latest reference depends on the existing cloud lock serializing synchronization. Lock acquisition uses a read followed by a write, so extreme simultaneous acquisition or lock loss remains a limitation. The feature does not extend the server lock protocol or guarantee preservation of every reference after arbitrary lock loss followed by cleanup.

## Verification

### Regression coverage

Regression coverage must include local installation and migration, manual edits, unknown-format preservation, unchanged scans without state rewrites, explicit reinstall, same-second edits and preserved modification times, concurrent updates and deletions, complete conflict history, whole and partial ignore rules, ignored damaged payloads and private-event protection, retained public deletion records, full and on-demand downloads, one-way synchronization, LAN authentication and traffic accounting, interrupted application, snapshot rollback, single-file restoration restrictions, symbolic links, resource reload without a declared version change, and built-in fallback.

Run the appearance-related tests in the kernel's `bazaar`, `util`, `model`, and `server` packages. In DejaVu, run appearance, asset, snapshot, backup, authentication, cloud-lock, and `lansync` regression tests. Cache validation must include closed-file rewrites that preserve modification time, corrupted ciphertext, incorrect keys, bounded memory use, and concurrent use of shared chunks. Run applicable frontend unit tests and `pnpm run lint` from `app/`.

The history benchmark is available from the DejaVu root:

```text
go test . -run ^$ -bench ^BenchmarkAppearanceHistory$ -benchtime=1x -count=1
```

The benchmark uses ten complete historical versions with a 20 MiB payload each. Large history fixtures belong to the benchmark rather than routine regression tests. Compare unchanged scans and snapshots separately from initial reads, which must fully authenticate content. Performance depends on filesystem support, cache state, history size, and package contents.

End-to-end tests in `siyuan-testing` use an already running dedicated instance with a kernel that includes the feature. Do not build frontend artifacts or compile and restart a running kernel to perform these checks. Official cloud, S3, WebDAV, and desktop and mobile upgrades, cold starts, script unloading, and cross-device refresh require verification in their actual environments. Local automated results do not replace those acceptance checks.

### Mixed-version verification

Run `python scripts/test-appearance-compat.py` from the DejaVu root. The independent legacy driver pins the released module `v0.0.0-20260914113714-464364dd8fad`, rejects local dependency replacements, and verifies dependencies with `go mod verify`. The script freezes the current source into a temporary directory and records versions, source digests, requests, and responses in its report.

The matrix combines full and on-demand downloads with bidirectional and manual upload/download synchronization. Each combination verifies an old client continuing to edit notes, receiving installation and deletion events, restoring an early snapshot without appearance events, resuming synchronization, and purging local and cloud history. A fresh new client must then recover deletion records while retaining the latest notes. In on-demand mode, ordinary attachments may remain deferred while appearance archives download completely.

The test retains evidence of the unmodified legacy `cloud.Local` failure when cloud cleanup encounters tag directories. Only the cleanup compatibility segment uses a test adapter that recursively enumerates every file under `refs/`, satisfying the backend's reference-listing contract. It does not modify the pinned legacy synchronization, cleanup, or authentication source. This verifies that the old engine can retain recovery material through ordinary tags; it does not establish end-to-end acceptance for the official cloud service or mobile devices.

### Dependency release

The kernel depends on the DejaVu package synchronization and recovery interfaces. Publish a DejaVu version containing these interfaces before updating `kernel/go.mod` for release. Local development may use a temporary `replace` pointing to the DejaVu checkout; it must not be committed. Updating only the main repository while retaining a legacy DejaVu dependency omits the complete-package synchronization guarantees. Coordinate release of the main repository, dependency, theme and icon sample documentation, and end-to-end tests.
