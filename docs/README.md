# Documentation index and writing conventions

[中文](README.zh-CN.md)

## Documentation index

| Document | English | 中文 |
|---|---|---|
| Kernel API type contracts | [API-CONTRACTS.md](API-CONTRACTS.md) | [API-CONTRACTS.zh-CN.md](API-CONTRACTS.zh-CN.md) |
| Theme and icon synchronization | [APPEARANCE-SYNC.md](APPEARANCE-SYNC.md) | [APPEARANCE-SYNC.zh-CN.md](APPEARANCE-SYNC.zh-CN.md) |
| On-demand asset downloads | [ASSET-DOWNLOAD.md](ASSET-DOWNLOAD.md) | [ASSET-DOWNLOAD.zh-CN.md](ASSET-DOWNLOAD.zh-CN.md) |
| Encrypted notebooks | [ENCRYPTED-NOTEBOOK.md](ENCRYPTED-NOTEBOOK.md) | [ENCRYPTED-NOTEBOOK.zh-CN.md](ENCRYPTED-NOTEBOOK.zh-CN.md) |
| Pinned documents | [PINNED-DOCUMENTS.md](PINNED-DOCUMENTS.md) | [PINNED-DOCUMENTS.zh-CN.md](PINNED-DOCUMENTS.zh-CN.md) |
| Tab blocks | [TAB-BLOCK.md](TAB-BLOCK.md) | [TAB-BLOCK.zh-CN.md](TAB-BLOCK.zh-CN.md) |
| Template manager | [TEMPLATE-MANAGER.md](TEMPLATE-MANAGER.md) | [TEMPLATE-MANAGER.zh-CN.md](TEMPLATE-MANAGER.zh-CN.md) |
| `.sy` file structure | [SY-FORMAT.md](SY-FORMAT.md) | [SY-FORMAT.zh-CN.md](SY-FORMAT.zh-CN.md) |
| Workspace file layout | [WORKSPACE.md](WORKSPACE.md) | [WORKSPACE.zh-CN.md](WORKSPACE.zh-CN.md) |

Public API documentation retains its existing language editions: [English](API.md), [中文](API.zh-CN.md), and [日本語](API.ja.md).

## Bilingual conventions

Except for public API documentation, maintain paired English `NAME.md` and Simplified Chinese `NAME.zh-CN.md` files, with a relative link to the other language below the title. Both editions use corresponding section order and matching interfaces, paths, fields, compatibility requirements, and verification scope. Update both when behavior changes; a short summary does not replace a full translation.

## Feature design structure

Theme and icon synchronization, on-demand assets, encrypted notebooks, pinned documents, tab blocks, and template management use these second-level sections. Place topic-specific details under third-level headings within the appropriate section.

| Section | Content |
|---|---|
| Feature scope | Purpose, supported platforms, prerequisites, and unsupported use cases |
| User interaction | Entry points, operation results, state changes, and user-visible failures |
| Data and storage | Data model, persistence paths, identifiers, sync scope, and local state |
| Implementation and interfaces | Implementation rules, key entry points, permissions, concurrency, and API behavior |
| Compatibility and recovery | Existing-data support, version rules, failure preservation, interruption recovery, and security boundaries |
| Verification | Required checks for normal, error, concurrent, cross-platform, and existing-data scenarios |

API contract maintenance, file formats, and workspace layout are maintenance specifications or reference manuals. Therefore, organize them by topic rather than imposing the feature design structure.

## Style and formatting

Describe existing behavior objectively. Use “must” and “must not” for requirements, distinguishing supported behavior, limitations, and verification requirements. Avoid review history, staged progress reports, promotional conclusions, and repeated emphasis. State the scope of counts, versions, and performance values; refer to source code for API coverage that it determines directly.

Use code formatting for identifiers, fields, paths, and commands; tables for operation comparisons; and numbered lists for ordered steps. Separate UI navigation levels with ` - `. Use punctuation appropriate to each language. Keep each paragraph or list item on a single line without manual wrapping.

Editorial changes must not reduce authenticated-read or recovery guarantees for existing data. For encryption formats, keys, history, and backups, both editions must preserve the compatibility baseline, failure handling, and recovery-material requirements.
