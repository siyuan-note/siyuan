# On-demand asset downloads

[中文](ASSET-DOWNLOAD.zh-CN.md)

Related issue: https://github.com/siyuan-note/siyuan/issues/19149

## Feature scope

`sync.assetDownloadMode` is a device setting: `0` downloads everything and `1` downloads on demand; the default is `0`. Desktop and mobile clients share the setting and kernel implementation. It applies to official cloud, S3, WebDAV, and local filesystem sync.

On-demand mode always synchronizes complete file metadata and non-asset content, including documents, databases, configuration, and keys. Asset-directory `ocr-texts.json`, PDF annotation `.sya` files, and hidden helper files also remain fully synchronized. Downloaded assets are not automatically evicted. Therefore, enabling on-demand mode on a device that already has all content does not immediately reduce disk usage.

## User interaction

The first access to an undownloaded asset reuses chunks already in the local repository and downloads only the missing chunks. Once downloaded, the asset continues to receive updates during subsequent syncs. Existing local content does not require a network connection, account login, or enabled sync. Cloud access, however, uses the account and service permissions of data sync.

## Data and storage

`dejavu` stores device state in the workspace's `conf/asset-downloads.json`, authenticated and encrypted with the repository key. It contains an explicit version, a source identity, complete file versions for undownloaded assets, and a recovery journal for unfinished apply operations. This state is not synchronized. The repository's `asset-downloads-v1` marker detects missing configuration or lost state in the current implementation. Missing state, unknown versions, and authentication failures return errors and preserve the original material.

Undownloaded assets remain part of the logical file inventory of current data and snapshots. Indexing must not interpret their absence from local disk as deletion, and sync must not upload chunks from an undownloaded old version. Ordinary indexing continues to track materialized files. Asset deletion, rename, and move operations fetch the relevant content before performing the existing file operation.

Changing sync ignore rules first fetches newly ignored undownloaded assets, then stops tracking them while retaining local content and historical chunks. If content cannot be obtained, then the previous state is retained and an error is returned. Upload-only mode fetches only chunks required by actual upload candidates and does not materialize unvisited assets in the workspace.

Sync merge uses a recoverable apply journal that records the target asset inventory, previous versions, and cloud baseline. Before applying changes, it verifies that local files still match expectations and preserves additional local edits made during downloading. Only sync explicitly initiates recovery; creating a repository instance or reading an asset does not rewrite documents as a side effect. After files and references are updated, pending change records remain until the kernel finishes cache, index, and UI updates. Partial failures use the actual disk state to account for changes already written, so retries do not omit them. Pending records are an optional field in device-state version 1. Existing authenticated state and journals without that field remain readable and recoverable without changing the encryption format. Source switching and asset materialization are serialized. Repository operations share the existing mutex and reload authenticated device state so an old instance cannot overwrite newer state.

On-demand reads and historical chunk retrieval report actual cloud download traffic and request counts, aggregating batch retrieval. However, local chunk reuse and LAN downloads do not count as cloud traffic, and repeated reads do not report the same traffic again.

## Implementation and interfaces

### Reads and exports

Internal logical-path resolution, asset search, missing-asset checks, and file-size queries use logical metadata without downloading content. Displaying images, playing audio or video, opening PDFs, following asset links, copying assets, and exporting fetch content when needed. `/api/asset/resolveAssetPath`, which prepares a physical path for external opening, also fetches the asset first. HTTP and raw file APIs validate paths, symbolic links, publish permissions, and encrypted-notebook permissions before downloading.

Exports prefetch referenced assets before holding notebook read locks and creating output artifacts. Reads use each document's actual notebook and complete path. The scope includes child and related documents, footnotes, query embeds, title images, databases, and related-database assets. Footnote assets in single-file exports are included independently of whether related documents are exported separately. Directory assets are downloaded from the logical inventory rather than disk traversal alone. Download and copy failures propagate to the caller; an output with missing assets is not reported as successful.

Downloaded encrypted assets retain their original ciphertext. Existing authenticated decryption handles reads and exports, preserving compatibility with released asset formats. Key envelopes, MasterSalt, AAD, and key derivation do not change, and authentication errors never fall back to plaintext. Notebook admission is checked before reading or plaintext export, and network waits do not occur while holding a notebook read lock. Reading an asset in a locked notebook or merely enumerating filenames does not download content. However, full sync, ciphertext backups, and history preservation before deletion may fetch original ciphertext.

## Compatibility and recovery

Local snapshots on on-demand devices may contain only part of the asset content; the UI indicates this separately through `requiresDownload`. Historical asset reads retrieve chunks for that snapshot's exact file version without overwriting current workspace assets. Downloading a complete cloud snapshot checks every target file's chunks even when its metadata already exists. Failure does not create a success tag.

Before restoring a snapshot, fetch the assets required by both the current workspace and the target snapshot. Switching back to full download fetches current assets and missing historical content in all retained snapshots; failure preserves the previous setting. Source switching, cloud cleanup, deletion of the current cloud directory, and repository or key resets check these dependencies and retain the previous source while they are incomplete. Repository rebuilding may clear device state and its marker only after authenticating the old state and making its dependencies complete.

Signing out of the official cloud can retain the original source identity so local indexing and downloaded snapshots remain usable, followed by reauthentication with the original account. While dependencies remain incomplete, changing regions, changing accounts, and deleting the account are protected by integrity checks.

Incomplete historical snapshots still depend on retention of the corresponding cloud content. Cloud cleanup by another device or external deletion of cloud objects may make old versions unavailable. A partial local snapshot is therefore not a complete offline backup. Complete all downloads before making an offline backup or changing sources. Older clients do not understand the device-state marker, so full download is also required before downgrading; the marker cannot prevent an old client from treating undownloaded files as local deletions.

## Verification

Implementation spans `siyuan`, `dejavu`, and `petal`. The kernel uses `dejavu` asset-download and snapshot-completeness APIs. Therefore, publish the dependency and update the module version before release. Local development may use a temporary `replace` pointing to the `dejavu` checkout; do not commit it.

Regression coverage includes sync between full and on-demand devices, one-way sync, repeated indexing, remote version updates, concurrent materialization, local-edit protection, interrupted apply recovery, state authentication failures, source changes, historical snapshot population, directory-asset exports, and existing encrypted asset formats. Run `pnpm run lint` for the frontend and `python scripts/check-lang-keys.py` for translations. Do not verify by building frontend artifacts or compiling and running the kernel.
