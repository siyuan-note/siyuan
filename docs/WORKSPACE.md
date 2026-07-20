# SiYuan Workspace File-System Layout — Reference

> This document describes how a SiYuan workspace is organized on disk.
> It complements [`SY-FORMAT.md`](./SY-FORMAT.md): the latter covers the **internal** JSON structure of a `.sy` file, while this one covers the **overall** file-system layout of the workspace.
> All conclusions are verified against a real workspace and the kernel source.

## 0. In one sentence

A SiYuan workspace is a **self-describing** directory tree: notebooks, documents, and assets live on disk as files and directories. **The filename is the ID; the directory structure is the document hierarchy.** The file system contains the authoritative source content, while SQLite databases under `temp/` are rebuildable indexes and caches. Normal-notebook content is readable directly; encrypted-notebook content is ciphertext and must be accessed through the unlocked kernel.

---

## 1. Cheat-sheet tree (overview)

```
<workspace root>/   e.g. F:\SiYuan\
├── .lock                       # Runtime workspace lock
├── conf/
│   ├── conf.json              # ★Workspace-level config (appearance/system/sync/editor...)
│   ├── appearance/             # Installed themes, icons, and language resources
│   ├── ca.crt / ca.key / cert.pem / key.pem   # TLS certificates and keys
│   └── windowState.json        # Desktop window state
├── data/                       # DataDir — root of all notebook data
│   ├── .siyuan/                # Workspace-level hidden config
│   │   ├── syncignore / searchignore / embeddingignore / indexignore / refsearchignore
│   │   └── notebook-crypto-backup.json # Optional encrypted-notebook global recovery metadata
│   ├── assets/                 # ★Global assets (images/audio/video/files)
│   ├── templates/              # Global templates (.md)
│   ├── widgets/                # Widgets
│   ├── plugins/                # Plugins
│   ├── emojis/                 # Custom emoji
│   ├── snippets/               # Code snippets (CSS/JS)
│   ├── public/                 # Static resources
│   ├── storage/                # Persistent structured data (attribute views, plugins, etc.)
│   └── <boxID>/                # ★Notebook (dir name = notebook ID)
│       ├── .siyuan/
│       │   ├── conf.json       # ★Notebook config (BoxConf: name/icon/closed...)
│       │   ├── sort.json       # Optional custom sort mapping {docID: order}
│       │   ├── boxDoc.json     # Optional top-level notebook document marker for .sy.zip import/export
│       │   └── notebook-crypt-backup.json # Optional encrypted-notebook key-envelope backup
│       ├── <boxID>.sy          # Optional top-level notebook document (rootID = notebook ID)
│       ├── <docID>.sy          # Document (JSON tree; filename = doc rootID)
│       ├── <docID>/            # ★Children of that document (same-named pair)
│       │   ├── <childID>.sy
│       │   └── <childID>/ ...  # Nesting of arbitrary depth
│       ├── assets/             # Notebook-local assets (mandatory for encrypted notebooks)
│       └── storage/av/         # Encrypted-notebook attribute-view definitions
├── repo/                       # Data repo (snapshots/sync)
├── history/                    # Edit-history archive
├── corrupted/                  # Optional quarantine for corrupted data
└── temp/                       # Rebuildable indexes, queues, caches, logs, and exports
    ├── siyuan.db / blocktree.db / asset_content.db / history.db
    ├── siyuan-encrypted-<boxID>.db / siyuan-encrypted-<boxID>-blocktree.db
    └── queue/ / export/ / os/ / siyuan.log
```

---

## 2. Workspace root

The workspace root is chosen by the user (e.g. `F:\SiYuan\`). Whether a directory is a valid workspace is decided by: `conf/conf.json` exists and contains a `kernelVersion` field.

Workspace-root entries:

| Entry | Purpose |
|---|---|
| `.lock` | Runtime lock preventing two kernels from opening the same workspace |
| `conf/` | Workspace-level config, appearance resources, and TLS material |
| `data/` | **All notebook data** (the core of this document) |
| `repo/` | Data-snapshot repo (used for sync/history) |
| `history/` | Edit-history archive |
| `temp/` | Rebuildable indexes, queues, caches, logs, and exports |
| `corrupted/` | Optional quarantine for corrupted data (auto-created when needed) |

---

## 3. Top-level layout of `data/`

The first level of `data/` mixes two kinds of entries:

1. **Fixed data directories:** `.siyuan/`, `assets/`, `templates/`, `widgets/`, `plugins/`, `emojis/`, `snippets/`, `public/`, `storage/`.
2. **Notebook directories:** each is a folder named with the notebook ID.

### Reserved-filename list (★ avoid when writing files)

`IsReservedFilename`:

```go
func IsReservedFilename(baseName string) bool {
    return "assets" == baseName || "templates" == baseName || "widgets" == baseName ||
        "emojis" == baseName || ".siyuan" == baseName || strings.HasPrefix(baseName, ".")
}
```

That is, the physical path segments `assets` / `templates` / `widgets` / `emojis` / `.siyuan`, as well as anything starting with `.`, are reserved. This restriction applies to on-disk IDs and path segments, not to the notebook names or document titles displayed to users.

### Persistent data vs rebuildable indexes

`data/storage/` contains persistent structured data such as attribute-view definitions and plugin state. The SQLite files in `temp/` are derived indexes and caches: normal notebooks use the global `siyuan.db` and `blocktree.db`, while each unlocked encrypted notebook uses independent SQLCipher databases. Deleting or rebuilding an index must not be confused with deleting the source `.sy`, asset, or database-definition files.

### How a notebook is recognized

`ListNotebooks` enumerates `data/` and, for each directory:

1. Skip reserved names;
2. Must be a directory (not a file);
3. The directory name must match the NodeID format (`ast.IsNodeIDPattern`);
4. If all the above hold → that directory name is the `box.ID` (notebook ID).

---

## 4. Inside a notebook (★ core: parent-child document pairing)

This is the single most important convention in the whole layout:

> **Document `A`'s on-disk representation = the `A.sy` file + the `A/` directory (the latter exists only if A has children). All of A's child documents live inside `A/`; if a child has its own children, nest an `A/B/` directory — to arbitrary depth.**

Real example (from `find` output):

```
20221126104620-m06prws/                            # parent document A's directory
20221126104620-m06prws.sy                          # parent document A itself
20221126104620-m06prws/20230928134805-z11t56h.sy   # A's child B
20221126104620-m06prws/20230928134805-z11t56h/    # B's child directory (grandchild layer)
20221126104620-m06prws/20230928134805-z11t56h/20240304105333-v7g5j1s.sy
```

Code evidence:

- Expanding children (`Ls`): given a `.sy` path, strip the `.sy` suffix, check whether the same-named directory exists, and list its entries if so.
- Child depth (`GetChildDocDepth`): walks the same-named directory accordingly.

> ⚠️ This means: **moving or renaming a document that has children must also move its same-named directory**, otherwise the children get orphaned.

### Top-level notebook document exception

When the top-level notebook document feature is enabled, the kernel creates `<boxID>.sy` directly inside the notebook directory. Its document rootID is exactly the notebook ID, so the notebook and its top-level document share one ID.

The switch is stored at `fileTree.boxDocEnabled` in `conf/conf.json`. It defaults to enabled for new workspaces; an existing configuration that does not contain the field is initialized as disabled.

The top-level notebook document is a virtual parent for every ordinary document stored directly under `<boxID>/`. Unlike an ordinary parent document, its children remain in the notebook directory and are **not** moved into a `<boxID>/<boxID>/` directory. For example:

```
data/<boxID>/
├── <boxID>.sy       # Top-level notebook document
├── <docA>.sy        # Logical child of <boxID>.sy
├── <docA>/          # Physical children of docA
│   └── <docB>.sy
└── <docC>.sy        # Another logical child of <boxID>.sy
```

The kernel maps virtual paths beginning with `/<boxID>/` back to the notebook's physical root. The top-level notebook document cannot be moved or deleted. After it has been created, disabling the feature hides it from normal UI and search results but does not remove its `.sy` file.

---

## 5. Notebook metadata: `<boxID>/.siyuan/`

Each notebook directory contains a `.siyuan/` hidden folder, which can contain:

| File | Purpose |
|---|---|
| `conf.json` | Notebook config (BoxConf) |
| `sort.json` | Optional custom sort mapping `{docID: order}` |
| `boxDoc.json` | Optional; identifies the top-level notebook document in `.sy.zip` notebook exports/imports |
| `notebook-crypt-backup.json` | Optional; encrypted-notebook backup of the wrapped notebook data-encryption key |

The `BoxConf` struct:

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Notebook display name |
| `sort` | int | Sort weight |
| `icon` | string | Icon (emoji hex code, e.g. `"1f3af"`; or a custom-icon filename) |
| `closed` | bool | Whether the notebook is closed |
| `refCreateSaveBox` | string | Target notebook for docs created via block-ref |
| `refCreateSavePath` | string | Target path for docs created via block-ref |
| `docCreateSaveBox` | string | Target notebook for new docs |
| `docCreateSavePath` | string | Target path for new docs |
| `dailyNoteSavePath` | string | Storage path for new daily notes (supports templates) |
| `dailyNoteTemplatePath` | string | Template path for new daily notes |
| `sortMode` | int | Sort mode |
| `encrypted` | bool | Whether this is an encrypted notebook |
| `boxCrypt` | object or null | Wrapped notebook data-encryption key and envelope metadata; non-null for encrypted notebooks |

> ⚠️ **The notebook ID is NOT in `conf.json`** — the ID is the notebook directory name itself (see §3).

Read/write sites: `GetConf` / `SaveConf`. The path is hard-coded as `<DataDir>/<boxID>/.siyuan/conf.json`.

`boxDoc.json` contains a metadata spec version and the top-level document ID. At runtime the kernel derives that document ID directly from `box.ID`; the metadata file is retained so `.sy.zip` import can identify the source notebook's top-level document and remap it to the destination notebook ID.

Encrypted notebooks retain recovery metadata in `conf.json` and `notebook-crypt-backup.json`, but their `.sy`, notebook-local assets, and attribute-view definitions are ciphertext. See [ENCRYPTED-NOTEBOOK.md](./ENCRYPTED-NOTEBOOK.md) for the encryption boundary, database isolation, and recovery design.

---

## 6. Workspace-wide config: `<workspace>/conf/conf.json`

Be careful to distinguish the two `conf.json` files:

| File | Location | Scope |
|---|---|---|
| `conf/conf.json` | **Workspace root** | Workspace-level global config (appearance / langs / system / editor / sync / repo, etc.) |
| `<boxID>/.siyuan/conf.json` | **Inside a notebook** | That notebook only (BoxConf) |

`conf/conf.json` holds UI appearance, account, sync, AI, flashcard, and other workspace-level settings.

---

## 7. Workspace-level hidden config: `data/.siyuan/`

`data/.siyuan/` is different from the per-notebook `.siyuan/` — the former holds **workspace-level** rules and state:

| File | Purpose |
|---|---|
| `syncignore` | Sync-ignore rules (gitignore style) |
| `searchignore` | Search-ignore rules |
| `embeddingignore` | AI-embedding ignore rules |
| `indexignore` | Indexing-ignore rules |
| `refsearchignore` | Ref-search ignore rules |
| `publishAccess.json` | Publishing access control |
| `filesys_status_check/` | File-system consistency-check state |
| `notebook-crypto-backup.json` | Global encrypted-notebook KDF and verifier backup used for sync/recovery |
| `master-password-migration.json` | Temporary crash-recovery state during master-password migration |

Most entries are optional and are created only when the corresponding feature is used.

> There is **no** `conf.json` here — the workspace config lives at the workspace root's `conf/conf.json` (see §6).

---

## 8. Assets

Two coexisting locations:

1. **Global `data/assets/`** — the main one. Naming convention looks like `<original-base>-<NodeID>.<ext>` (e.g. `640-20240927104411-0jh7x96.webp`). Referenced inside documents as the relative path `assets/xxx`.
2. **Per-notebook `<notebook>/assets/`** — used by the built-in guide and required for encrypted notebooks; ordinary unencrypted user notebooks generally don't have one.

Asset-link prefix recognition: only `assets/`, `emojis/`, `plugins/`, `public/`, and `widgets/` are accepted as legal asset-link prefixes.

Encrypted notebooks must use notebook-local assets. Their contents and `.names.json` original-name mapping are encrypted, and their physical filenames use a desensitized `<16-random-characters>-<blockID>.<ext>` form; direct inspection does not recover the original asset name. See [ENCRYPTED-NOTEBOOK.md §7](./ENCRYPTED-NOTEBOOK.md#7-sy--assets--database-file-encryption).

---

## 9. ID and path relationships

### ID format

- **NodeID:** `YYYYMMDDHHMMSS-xxxxxxx` (14-digit timestamp + `-` + 7 random characters).
- Notebook and document IDs use the same NodeID format. A top-level notebook document uses its notebook's NodeID directly.
- The first 14 digits encode the creation time (extracted by `TimeFromID`).
- Random alphabet is `[a-z0-9]`.

### Filename = ID (hard constraint)

- A document's `.sy` filename (without `.sy`) = the document rootID.
- A notebook's directory name = the notebook ID.
- A top-level notebook document's filename and rootID both equal the notebook ID: `<boxID>.sy`.
- The kernel enforces `filename ID == root.ID`; unencrypted documents are auto-corrected on mismatch, while encrypted documents reject the mismatch.

These are physical identifiers. A notebook's display name comes from `BoxConf.name`, and a document's displayed title comes from its root attributes; neither display value has to match the NodeID format.

### Document absolute path

A document's absolute path on disk = `data/<boxID>/<relative-path>`, where `<relative-path>` looks like `/20221126104620-m06prws/20230928134805-z11t56h.sy` (POSIX style, leading `/`).

Extracting the doc ID from a path (`GetTreeID`): simply `filepath.Base(path)` with the `.sy` suffix removed.

---

## 10. How HPath (human-readable path) is derived

HPath is **not authoritative data stored in the `.sy` source file** — it is derived when loading a document (`LoadTreeByData`) and may be cached in rebuildable indexes such as `blocktree.db`:

1. Split the document's own relative path by `/`, drop the leading empty segment and the trailing self segment, yielding the **ID segments of each ancestor document**.
2. For each ancestor ID, build `<ancestorID>.sy` and read its `title` via `DocIAL()` (a **streaming read of `Properties` only**, without parsing the whole tree). Encrypted `.sy` files must first be read and decrypted in full before the properties can be parsed.
3. Join the titles with `/` and append the current document's title → an HPath like `/Parent/Child/Current`.
4. If some ancestor `.sy` is missing, the kernel **auto-creates** an `Untitled` parent (issue #7376).

> This is the fundamental reason "directory structure is data": **moving or renaming a file/directory directly changes the document's HPath and breadcrumbs** — because HPath is entirely derived from the directory chain.

The top-level notebook document is handled specially: its API HPath is `/`, its full human-readable path is the notebook name, and root-level ordinary documents appear beneath it logically even though their files remain directly under the notebook directory.

---

## 11. Notes on operating the file system directly

> Consistent with [SY-FORMAT.md §0.5](./SY-FORMAT.md#05-when-to-readwrite-sy-directly-priority-order): **prefer HTTP API / MCP / CLI** for mutating data, so the kernel handles index synchronization. Direct file-system operations are only for bulk offline migration, cold init, and similar scenarios.

Do not directly mutate encrypted-notebook persistent files. Raw file APIs reject reading, enumerating, or modifying encrypted-notebook directories. Offline inspection of protected content exposes ciphertext, although non-content metadata such as `conf.json` remains readable. Use the dedicated APIs after unlocking the notebook so encryption, authentication, and isolated indexes remain consistent.

When writing files directly:

1. ☐ Notebook and document physical IDs must match the NodeID format and **avoid reserved names** (§3).
2. ☐ A document's `.sy` filename equals its rootID (§9).
3. ☐ A document with children must have the **paired same-named directory**; moving the parent means moving that directory too (§4).
4. ☐ Do not move root-level documents into `<boxID>/<boxID>/`; the top-level notebook document uses a virtual parent-child mapping (§4).
5. ☐ A notebook's name/icon/closed state lives in `<boxID>/.siyuan/conf.json`; the name and icon are synchronized with `<boxID>.sy` when that document exists (§5).
6. ☐ Treat `data/storage/` as persistent source data and `temp/*.db` as rebuildable indexes; do not interchange their lifecycle (§3).
7. ☐ After changes you usually need to **rebuild the index**, or search/block-refs/breadcrumbs will be stale.

---

## 12. Relationship with SY-FORMAT

| Document | Layer | Question answered |
|---|---|---|
| **This one (WORKSPACE)** | File-system layer | "What does a workspace look like on disk? How are notebooks/documents/assets organized?" |
| **SY-FORMAT** | AST layer | "What does the JSON tree inside a `.sy` file look like? What node types/fields exist?" |

The two are complementary: this document tells you where a `.sy` file **lives, what it's named, and who shares its directory**; SY-FORMAT tells you **what's inside** it.
