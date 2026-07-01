# SiYuan Workspace File-System Layout — Reference

> This document describes how a SiYuan workspace is organized on disk.
> It complements [`SY-FORMAT.md`](./SY-FORMAT.md): the latter covers the **internal** JSON structure of a `.sy` file, while this one covers the **overall** file-system layout of the workspace.
> All conclusions are verified against a real workspace and the kernel source.

## 0. In one sentence

A SiYuan workspace is a **self-describing** directory tree: notebooks, documents, and assets all live on disk as readable files and directories. **The filename is the ID; the directory structure is the document hierarchy.** There is no binary database recording "where documents are" — the file system itself is the single source of truth. The kernel reconstructs all notebooks and documents simply by walking the directories.

---

## 1. Cheat-sheet tree (overview)

```
<workspace root>/   e.g. F:\SiYuan\
├── conf/
│   ├── conf.json              # ★Workspace-level config (appearance/system/sync/editor...)
│   ├── ca.crt / cert.pem / key.pem   # TLS certificates
│   └── windowState.json
├── data/                       # DataDir — root of all notebook data
│   ├── .siyuan/                # Workspace-level hidden config (*ignore rules, etc.)
│   ├── assets/                 # ★Global assets (images/audio/video/files)
│   ├── templates/              # Global templates (.md)
│   ├── widgets/                # Widgets
│   ├── plugins/                # Plugins
│   ├── emojis/                 # Custom emoji
│   ├── snippets/               # Code snippets (CSS/JS)
│   ├── public/                 # Static resources
│   ├── storage/                # Runtime indexes / cache / databases
│   └── <boxID>/                # ★Notebook (dir name = notebook ID)
│       ├── .siyuan/
│       │   ├── conf.json       # ★Notebook config (BoxConf: name/icon/closed...)
│       │   └── sort.json       # Custom sort mapping {docID: order}
│       ├── <docID>.sy          # Document (JSON tree; filename = doc rootID)
│       └── <docID>/            # ★Children of that document (same-named pair)
│           ├── <childID>.sy
│           └── <childID>/ ...  # Nesting of arbitrary depth
├── repo/                       # Data repo (snapshots/sync)
├── history/                    # Edit-history archive
└── temp/                       # Temp/export files
```

---

## 2. Workspace root

The workspace root is chosen by the user (e.g. `F:\SiYuan\`). Whether a directory is a valid workspace is decided by: `conf/conf.json` exists and contains a `kernelVersion` field.

Fixed sub-directories under the root:

| Sub-dir | Purpose |
|---|---|
| `conf/` | Workspace-level config + TLS certificates |
| `data/` | **All notebook data** (the core of this document) |
| `repo/` | Data-snapshot repo (used for sync/history) |
| `history/` | Edit-history archive |
| `temp/` | Temp/export files |
| `corrupted/` | Quarantine for corrupted data (auto-moved by the kernel) |

---

## 3. Top-level layout of `data/`

The first level of `data/` mixes two kinds of entries:

1. **Reserved resource directories:** `.siyuan/`, `assets/`, `templates/`, `widgets/`, `plugins/`, `emojis/`, `snippets/`, `public/`, `storage/`.
2. **Notebook directories:** each is a folder named with the notebook ID.

### Reserved-filename list (★ avoid when writing files)

`IsReservedFilename`:

```go
func IsReservedFilename(baseName string) bool {
    return "assets" == baseName || "templates" == baseName || "widgets" == baseName ||
        "emojis" == baseName || ".siyuan" == baseName || strings.HasPrefix(baseName, ".")
}
```

That is, `assets` / `templates` / `widgets` / `emojis` / `.siyuan`, as well as anything starting with `.`, **cannot** be used as a notebook or document name.

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

---

## 5. Notebook metadata: `<boxID>/.siyuan/conf.json`

Each notebook directory contains a `.siyuan/` hidden folder with:

| File | Purpose |
|---|---|
| `conf.json` | Notebook config (BoxConf) |
| `sort.json` | Custom sort mapping `{docID: order}` |

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

> ⚠️ **The notebook ID is NOT in `conf.json`** — the ID is the notebook directory name itself (see §3).

Read/write sites: `GetConf` / `SaveConf`. The path is hard-coded as `<DataDir>/<boxID>/.siyuan/conf.json`.

---

## 6. Workspace-wide config: `<workspace>/conf/conf.json`

Be careful to distinguish the two `conf.json` files:

| File | Location | Scope |
|---|---|---|
| `conf/conf.json` | **Workspace root** | Workspace-level global config (appearance / langs / system / editor / sync / repo, etc.) |
| `<boxID>/.siyuan/conf.json` | **Inside a notebook** | That notebook only (BoxConf) |

In practice `conf/conf.json` is ~42 KB and holds UI appearance, account, sync, AI, flashcard, and all other workspace-level settings.

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

> There is **no** `conf.json` here — the workspace config lives at the workspace root's `conf/conf.json` (see §6).

---

## 8. Assets

Two coexisting locations:

1. **Global `data/assets/`** — the main one. Naming convention looks like `<orig-name>-<docID-suffix>.<ext>` (e.g. `640-20240927104411-0jh7x96.webp`). Referenced inside documents as the relative path `assets/xxx`.
2. **Per-notebook `<notebook>/assets/`** — mostly used by the built-in guide notebook; ordinary user notebooks generally don't have one.

Asset-link prefix recognition: only `assets/`, `emojis/`, `plugins/`, `public/`, and `widgets/` are accepted as legal asset-link prefixes.

---

## 9. ID and path relationships

### ID format

- **Notebook ID:** `YYYYMMDDHHMMSS-xxxxxx` (14-digit timestamp + `-` + 6 random chars).
- **Document ID:** `YYYYMMDDHHMMSS-xxxxxxx` (14-digit timestamp + `-` + 7 random chars).
- The first 14 digits encode the creation time (extracted by `TimeFromID`).
- Random alphabet is `[a-z0-9]`.

### Filename = ID (hard constraint)

- A document's `.sy` filename (without `.sy`) = the document rootID.
- A notebook's directory name = the notebook ID.
- The kernel enforces `filename ID == root.ID` and auto-corrects mismatches.

### Document absolute path

A document's absolute path on disk = `data/<boxID>/<relative-path>`, where `<relative-path>` looks like `/20221126104620-m06prws/20230928134805-z11t56h.sy` (POSIX style, leading `/`).

Extracting the doc ID from a path (`GetTreeID`): simply `filepath.Base(path)` with the `.sy` suffix removed.

---

## 10. How HPath (human-readable path) is derived

HPath is **not stored** — it is computed on the fly when loading a document (`LoadTreeByData`):

1. Split the document's own relative path by `/`, drop the leading empty segment and the trailing self segment, yielding the **ID segments of each ancestor document**.
2. For each ancestor ID, build `<ancestorID>.sy` and read its `title` via `DocIAL()` (a **streaming read of `Properties` only**, without parsing the whole tree).
3. Join the titles with `/` and append the current document's title → an HPath like `/Parent/Child/Current`.
4. If some ancestor `.sy` is missing, the kernel **auto-creates** an `Untitled` parent (issue #7376).

> This is the fundamental reason "directory structure is data": **moving or renaming a file/directory directly changes the document's HPath and breadcrumbs** — because HPath is entirely derived from the directory chain.

---

## 11. Notes on operating the file system directly

> Consistent with [SY-FORMAT.md §0.5](./SY-FORMAT.md): **prefer HTTP API / MCP / CLI** for mutating data, so the kernel handles index synchronization. Direct file-system operations are only for bulk offline migration, cold init, and similar scenarios.

When writing files directly:

1. ☐ Notebook/document names must match the NodeID format and **avoid reserved names** (§3).
2. ☐ A document's `.sy` filename equals its rootID (§9).
3. ☐ A document with children must have the **paired same-named directory**; moving the parent means moving that directory too (§4).
4. ☐ A notebook's name/icon/closed state lives in `<boxID>/.siyuan/conf.json`, not in `.sy` (§5).
5. ☐ After changes you usually need to **rebuild the index**, or search/block-refs/breadcrumbs will be stale.

---

## 12. Relationship with SY-FORMAT

| Document | Layer | Question answered |
|---|---|---|
| **This one (WORKSPACE)** | File-system layer | "What does a workspace look like on disk? How are notebooks/documents/assets organized?" |
| **SY-FORMAT** | AST layer | "What does the JSON tree inside a `.sy` file look like? What node types/fields exist?" |

The two are complementary: this document tells you where a `.sy` file **lives, what it's named, and who shares its directory**; SY-FORMAT tells you **what's inside** it.

