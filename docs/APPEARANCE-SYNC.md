# Theme and icon synchronization

[中文](APPEARANCE-SYNC.zh-CN.md)

Related issues: [#18883](https://github.com/siyuan-note/siyuan/issues/18883), [#19634](https://github.com/siyuan-note/siyuan/issues/19634), [#19635](https://github.com/siyuan-note/siyuan/issues/19635)

## File synchronization

Third-party themes in `data/themes/<name>/` and icons in `data/icons/<name>/` use the same file-level synchronization, deletion, conflict handling, and snapshots as plugins, widgets, and templates. Removing a package directory deletes its synchronized files. Changes to different files in the same package can merge; conflicting versions of an individual file follow the ordinary synchronization rules and data history behavior.

Built-in `daylight`, `midnight`, and `litheness` resources remain application resources. Each device keeps its appearance selection in `conf/conf.json`. Receiving a package does not automatically select it. Synchronization and snapshot restoration refresh the package list and the resources used by the current selection. Missing, incompatible, or incomplete packages fall back to built-in resources. Theme frontend compatibility and `minAppVersion` checks remain in effect.

Snapshots restore the complete data directory. A snapshot without a theme or icon package removes that package, including snapshots created before these directories participated in synchronization.

## Assets and ignore rules

On-demand downloading applies only to `/assets/`, `/<boxID>/assets/`, and `/<boxID>/<documentID>/.../assets/`. Notebook and document directory names must have the normal block ID format. Package assets under themes, icons, plugins, widgets, and templates are downloaded with their ordinary files. OCR metadata and annotation files retain their existing full-download behavior.

Previously deferred package assets remain readable through the authenticated download-state format. Indexing and synchronization download those files before removing their deferred entries. Download failures retain the entries for retry; existing local edits are preserved.

The ordinary `.siyuan/syncignore` rules apply to individual files and directories. For example, `/themes/example/` excludes a theme and `/themes/example/assets/draft.png` excludes one file. Symbolic links used for local development remain local and are excluded by the ordinary synchronization path policy.

## Migration

Startup moves third-party packages from the previous appearance directory into `data/themes/` and `data/icons/`. An existing destination takes precedence. Successfully migrated source directories are removed, so deleting a package or restoring an older snapshot cannot recreate it from the original directory. Built-in resources remain in the application appearance directory.

The upgrade removes complete generated `siyuan-appearance-isolation:v1` blocks from `.siyuan/syncignore`. Loading changed ignore rules also removes blocks brought back by synchronization or snapshot restoration. User-written rules outside those blocks retain their contents and order. No isolation block is created or maintained afterward.

The released implementation does not create per-package digest or deletion records, immutable package archives, recovery tags, or an appearance-specific transaction protocol. Installation metadata uses the shared `storage/bazaar.json` mechanism. Alpha leftovers in `data/storage/appearance-v1/`, `data/storage/bazaar/themes/`, `data/storage/bazaar/icons/`, and `conf/appearance-migration.json`, and existing `.siyuan-appearance-v1` tags are not automatically cleaned up or used to restore packages. Existing tags follow ordinary tag behavior.

## Verification

Run the following with the matching local DejaVu dependency:

```text
# dejavu/
go test ./... -run "TestAsset|TestPackageFiles|TestIndexReused|TestSyncReused|TestSnapshot|TestDownload|TestUploadTag" -count=1

# siyuan/kernel/
go test -tags "fts5 sqlcipher" ./model ./bazaar ./util ./server -run "Test.*Appearance|Test.*ThemesWatch|Test.*SyncIgnore" -count=1
```
