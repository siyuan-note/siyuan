# Pinned documents in the document tree

[中文](PINNED-DOCUMENTS.zh-CN.md)

Related issue: https://github.com/siyuan-note/siyuan/issues/19401

## Feature scope

The pinned section appears at the top of the document tree panel and uses pinned documents as roots for their actual child documents. Root entry order is independent of document hierarchy and source-document sorting. Expanded children use source-document data directly. Desktop and mobile clients share the implementation. The section can collapse, has a maximum height, and scrolls independently.

## User interaction

The section is hidden by default. Enable it through Document panel - More - Pinned or the document-panel group in entry visibility settings, including on mobile. Successfully pinning a document explicitly enables the section and saves that setting. A failed pin, unpin, or incoming synchronized pin data does not change visibility. Hiding the section removes its layout space without unpinning documents or resetting order or expansion state. Showing it again refreshes source-document data. Visibility uses the independent configuration identifier `documentPanel.pinnedDocs`, separate from dock-icon and menu-item visibility, and preserves the user's saved choice.

| Operation | Behavior |
|---|---|
| Pin from a menu | Insert the entry at the top; the same menu item becomes Unpin for an already pinned document |
| Drop on a root insertion line | Create or reorder a pinned entry without moving the source document |
| Drop between child documents | Reorder actual documents, using the existing sort-conflict confirmation |
| Drop in the middle of a document row | Move into the actual document, using existing move validation |
| Unpin a parent document | Remove only that root entry; independently pinned children remain |
| Rename or move | Reload the source document for every entry; cross-notebook moves maintain the notebook identifier |
| Close an ordinary notebook | Retain unavailable entries and allow unpinning; keep titles already read in the current session, or show the document ID when the title is unavailable |
| Delete a document or notebook | Remove related entries; list reads also filter missing source documents |
| Encrypted notebook | Hide the pin operation; the server rejects additions and filters any existing invalid entries |

Root drops show an insertion line, while row-center drops highlight the document, distinguishing entry creation from source-document moves. Existing document-move APIs validate moves into the source itself or its descendants. Child lists use the source document's effective sort mode. Pinning does not write `sort.json` or change sort inheritance.

## Data and storage

`data/storage/pinned-docs.json` uses version 1: `{"version":1,"docs":[{"id":"document ID","notebook":"notebook ID"}]}`. Array order determines root order. Only identifiers are stored; document content is not cached. The file participates in existing data sync and snapshots and follows workspace sync ignore rules. A sync change to this file alone also refreshes the document tree panel. Concurrent edits across devices use existing file-sync conflict handling.

A mutex serializes updates within one kernel. APIs accept relative-position operations so a stale full list from one window cannot overwrite entries added in another.

Section collapse and subtree expansion are stored in this device's browser storage rather than the synchronized file. The same child document under different pinned roots has independent expansion state.

## Implementation and interfaces

Both endpoints use POST and require authentication and the administrator role. The write endpoint also checks read-only state. Success uses `code: 0`; business and parameter errors use `-1`. Type contracts reside in `kernel/apicontract/`, and generated declarations are synchronized to the plugin declaration repository.

| Endpoint | Request | Success data |
|---|---|---|
| `/api/filetree/getPinnedDocs` | No request body required | Array of entries with `id`, `notebook`, `name`, `path`, `icon`, `subFileCount`, `unavailable`, and `childrenSortMode` |
| `/api/filetree/updatePinnedDocs` | `ids: string[]`, `action: "pin" or "unpin"`; optional `targetID: string` and `after: boolean` | `null` |

Without a target, pinning inserts at the top. With a target, it inserts before that entry, or after it when `after: true`. Unpinning ignores position parameters. Batch requests validate every source document before writing and produce no partial result on failure. Pinned subtrees continue to use existing document-list, move, and sort APIs without creating document copies.

## Compatibility and recovery

Unknown versions, invalid structures, and damaged files return errors and preserve the original file. Existing document, encryption, history, and backup formats remain unchanged.

## Verification

Regression coverage includes deduplication and ordering, unchanged source sorting, invalid batches without partial updates, preservation of unknown or damaged data, closed-notebook entries, rejection and filtering of encrypted notebooks, reference maintenance, sync-path inclusion, root versus subtree drop classification, menu catalogs, and order migration for existing configuration. API tests exercise actual handlers against response contracts and run existing API compatibility and route-coverage tests.
