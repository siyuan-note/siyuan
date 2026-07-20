# SiYuan Encrypted Notebook

## 1. Design Goals

Implement an "encrypted notebook" in SiYuan — a special notebook whose `.sy` documents, assets (including filenames), attribute-view definitions, and SQLite index databases (content + blocktree) are all stored encrypted on disk, requiring a master password to unlock and view the content. Existing normal notebooks are completely unaffected.

## 2. Core Constraints

| Aspect | Design Decision |
|---|---|
| Encryption scope | `.sy` + assets (incl. filenames) + database files + SQLite database (content + blocktree) all encrypted |
| Notebook identity | Dynamic boxID + `BoxConf.Encrypted: true` flag |
| Quantity | Multiple encrypted notebooks supported |
| Password | Shared master password (KEK envelope, per-notebook independent DEK) |
| Unlock granularity | Strictly per-notebook unlock (KEK used and discarded, ~1s Argon2id per unlock) |
| SQLite database scheme | Each encrypted notebook has its own physical SQLCipher SQLite database, isolated from the global siyuan.db |
| **Isolation principle** | **Each encrypted notebook is an independent island — isolated from normal notebooks, and encrypted notebooks are also isolated from each other. Data, block refs, database mirroring, and moves never cross the encrypted-notebook boundary. Unlocking one encrypted notebook does not affect the locked state of other encrypted notebooks.** |
| Global features | Encrypted notebooks never participate (global search / graph / block refs cannot see them) |
| Block refs | Normal refs within the notebook; cross-boundary refs forbidden (bidirectional: normal↔encrypted, encrypted A↔encrypted B) |
| AI / LLM | No functional-layer isolation — when unlocked, AI/LLM can read/search just like a normal notebook; when locked, no usable DEK handle exists and dedicated entry points deny access (see §13) |
| Cross-boundary move | Forbidden — would break data consistency and leak |
| Database | Notebook-level storage — encrypted notebook database files follow the notebook directory, DEK-encrypted; cross-boundary mirroring forbidden |
| Flashcards / spaced repetition | Not supported (feature limitation) |
| Bookmarks | Not supported (feature limitation) |
| Tags | Not supported (feature limitation) |
| Import | Supported — imported .sy.zip and Markdown are DEK-encrypted before writing to disk, identical to manually created documents |
| Enable / Disable | Enabling requires setting a master password; disabling requires no live encrypted notebook and no kernel-enumerable history or recovery snapshot that depends on the current key backup, unless those recovery artifacts are explicitly purged permanently |
| Restart behavior | All encrypted notebooks force-closed on startup (managed DEK handles exist only in process memory and must be derived again after restart); user must re-unlock |
| Existing notebooks | Completely untouched, zero migration |

## 3. Encrypted Notebook vs Normal Notebook

| Aspect | Normal Notebook | Encrypted Notebook |
|---|---|---|
| **Create** | Anytime, no restrictions | Must first enable encryption (set master password); creating requires verifying master password |
| **Open (Mount)** | Direct open | Must first enter master password to unlock (~1s Argon2id each time); the application obtains a managed DEK handle |
| **Close (Unmount)** | Closing makes it invisible | Close = lock (stop new access + wait for or cancel in-flight work + remove DEK from the managed key cache + delete encrypted SQLite databases + best-effort cleanup of kernel-managed plaintext caches and temporary files) |
| **After restart** | Keeps last open state | Force-closed; must re-enter master password to unlock |
| **.sy files** | Plaintext JSON on disk | AES-256-GCM ciphertext on disk, transparently decrypted on read |
| **assets files** | Plaintext binary, original filename | AES-256-GCM ciphertext, filename desensitized, original name encrypted |
| **database files** | Global `storage/av/<avID>.json` (plaintext) | Notebook-level `<boxID>/storage/av/<avID>.json` (DEK-encrypted) |
| **content SQLite database** | Written to global siyuan.db (plaintext) | Written to independent siyuan-encrypted-`<boxID>`.db (SQLCipher) |
| **blocktree SQLite database** | Written to global blocktree.db (plaintext) | Written to independent siyuan-encrypted-`<boxID>`-blocktree.db (SQLCipher) |
| **Global search** | Participates (FTS hits) | Does not participate (data not in global SQLite database) |
| **Graph** | Participates | Does not participate |
| **Block refs** | Referrable by any notebook | Normal refs within notebook; cross-boundary refs forbidden (bidirectional) |
| **Move doc (cross-notebook)** | Supported | Forbidden across encrypted boundary |
| **Doc to heading (Doc2Heading)** | Supported | Forbidden across encrypted boundary |
| **database mirroring (cross-notebook)** | Supported | Forbidden across encrypted boundary |
| **Asset file rename** | Supported | Not supported (desensitized filename rename breaks the mapping) |
| **Import** | Supported | Supported (.sy.zip and Markdown, auto DEK-encrypted before writing to disk) |
| **In-notebook search** | Via global SQLite database | Via encrypted SQLite database |
| **Backlinks panel** | Via global SQLite database | Via encrypted SQLite database (incl. mention subquery) |
| **Open doc / outline / breadcrumb / block info / float preview** | Via global SQLite database | Via encrypted SQLite database |
| **Database** | Via global storage + global SQLite database | Via notebook-level storage (DEK-encrypted) + encrypted SQLite database |
| **File history** | Supported | Supported (ciphertext .sy copied verbatim to history dir; each history entry retains the boxID, object type, and stable file basename at snapshot creation, and viewing or rollback uses all three as the AAD context) |
| **Deleted notebook history** | Supported | Supported (entire directory backed up as ciphertext before deletion and restored verbatim; recovery also requires the matching global key backup and master password) |
| **Embedding vectorization / semantic search** | Participates | Does not participate (encrypted data never enters the global block_embeddings table; the embedding pipeline reads only the global SQLite database — independent of lock state) |
| **Agents / AI chat / MCP** | Can read content, can search | Available when unlocked (can read blocks, list docs, search within notebook); unreachable when locked (see §13). Global search / semantic search not included |
| **Kernel CLI** | Can operate on workspace data | Does not support encrypted notebooks or their files, whether locked or unlocked |
| **Flashcards / spaced repetition** | Participates | Not supported (feature limitation) |
| **Bookmarks** | Participates (global aggregation) | Not supported (feature limitation) |
| **Tags** | Participates (global aggregation) | Not supported (feature limitation) |
| **List icon** | User-custom emoji | Shows lock icon when closed; restores emoji when opened |
| **Export (.sy.zip)** | Supported | Supported (exports plaintext when unlocked; rejected when locked; see §12 Security Premise) |
| **Data sync** | dejavu syncs plaintext | Unchanged (ciphertext in, ciphertext out, self-consistent) |
| **Delete notebook** | Delete directory | Delete directory + delete encrypted SQLite database files + delete notebook-level database storage |
| **Rebuild index** | Full | Skipped on startup (closed); opening performs a full rebuild into the encrypted SQLite database |
| **/api/file/\*** | Can read, write, copy, rename, delete, or enumerate workspace files | Refuses access to any file in encrypted-notebook persistent directories (not just .sy) to prevent ciphertext disclosure or writes that bypass the encryption layer; `temp/` remains accessible to administrator file APIs and trusted plugins |

**Core difference summary**: An encrypted notebook is an "island" — data is physically isolated, operations have dedicated entry points, it never participates in global features (global search/graph), and documents/database files do not cross the boundary. In-notebook features (editing, block refs, backlinks, search, database, outline, history, etc.) work normally; AI/LLM is also usable when unlocked (same as a normal notebook). Encrypted notebooks are also isolated from each other. Normal notebooks are completely unaffected.

## 4. Key Architecture

```
User master password
    │ Argon2id(global MasterSalt, 64MB/3 passes/4 threads)
    ▼
   KEK (key-encryption key, memory-only, used and discarded)
    │ AES-256-GCM envelope
    ├─→ unwrap BoxConf.WrappedDEK → DEK₁ → encrypts notebook 1's .sy/assets/database file/SQLite database
    ├─→ unwrap BoxConf.WrappedDEK → DEK₂ → encrypts notebook 2
    └─→ unwrap BoxConf.WrappedDEK → DEK₃ → encrypts notebook 3
```

- **Argon2id**: OWASP 2023 recommended parameters, brute-force resistant (memory-hard)
- **DEK**: Per-notebook independent 32-byte random key; the key that actually encrypts data
- **KEK envelope**: Changing the password only re-wraps the DEK; data is not re-encrypted
- **KEK not cached**: Derived on every unlock; strict per-notebook isolation

### 4.1 MasterSalt Backup and Cross-Device Recovery

MasterSalt is the global root of KEK derivation — the master password + MasterSalt derive the KEK via Argon2id, and the KEK then unwraps each notebook's WrappedDEK. **Losing MasterSalt permanently locks the data**: even with the same master password, a changed salt derives a different KEK, so old WrappedDEKs cannot be unwrapped. A backup-and-recovery mechanism is therefore introduced.

**Backup**: `<DataDir>/.siyuan/notebook-crypto-backup.json`, holding the full NotebookCrypto (MasterSalt/KEKVerifier/KDFParams). Located inside DataDir, it **enters the dejavu sync scope**. It is refreshed when enabling encrypted notebooks and when changing the master password. It may be deleted on disable only after confirming that no live encrypted notebook and no kernel-enumerable history or recovery snapshot depends on it, or after the user explicitly chooses to purge those recovery artifacts permanently. Stored as plaintext JSON (salt is not secret, verifier is ciphertext — identical to how they are stored in `conf/conf.json`).

**Recovery triggers** (covering scenarios such as conf.json loss, sync to a new device, importing Data.zip):

| Trigger scenario | Function | Password required? | Notes |
|---|---|---|---|
| After sync completes (backup file pulled down) | `restoreNotebookCryptoConfigFromBackup` | No | Loads the config back into the local conf.json and sets `Enabled=true`; UI shows "enabled, locked" |
| After importing Data.zip | `restoreNotebookCryptoConfigFromBackup` | No | Same; covers "backup arrived with Data.zip but the local machine is not enabled" |
| User enters master password to unlock (fallback) | `tryRestoreNotebookCryptoFromBackup` | Yes | `deriveKEK` attempts recovery when the local `Enabled=false`; returns the KEK after verifying the password |
| User manually enables (fool-proof guard) | `tryRestoreNotebookCryptoFromBackup` | Yes | When encrypted notebooks already exist, refuses to regenerate salt and instead recovers from backup, verifying the password |

**Config recovery vs key recovery, separated**: Config recovery only needs to read the backup file and load back the salt/verifier (no password required, since salt is not secret and data remains undecryptable without the password); key recovery requires the password to derive the KEK and verify against the verifier. This allows the "enabled" state to be reached automatically after sync/import, so the user can unlock by entering the master password.

**Manual key export/import**: Beyond auto-sync, users can manually export/import the key backup under **Settings → Access authorization → Encrypted notebooks**, as an independent recovery channel outside sync (e.g. when sync is unavailable, for cross-account migration, or offline physical transfer).

| Operation | Entry | Notes |
|---|---|---|
| Export key | Shown when enabled | Copies `notebook-crypto-backup.json` to the export directory for download; the user keeps it (API: `/api/notebook/exportNotebookCryptoBackup`) |
| Import key | Shown when not enabled | Uploads a local backup file; after validation it is written back to `<DataDir>/.siyuan/` and the local config is restored (`Enabled=true`). Use the master password matching that key to unlock afterwards (API: `/api/notebook/importNotebookCryptoBackup`) |

Import guard: when the local machine is already enabled, import is rejected (to avoid overwriting the existing salt and orphaning WrappedDEKs); the import entry is shown only when not enabled. The backup file itself does not contain the master password (salt is not secret, verifier is ciphertext), so export/import does not leak plaintext data; unlocking still requires the master password.

**Fool-proof guard**: When encrypted notebooks already exist on disk (notebooks with `Encrypted=true`) or kernel-enumerable encrypted recovery artifacts exist, `EnableEncryptedNotebook` **refuses to regenerate MasterSalt** (which would orphan old WrappedDEKs) and instead recovers from backup first; only if the backup is missing does it error out and guide the user to restore `conf.json` or the backup file. Symmetrically, `DisableEncryptedNotebook` scans live notebooks, deleted-notebook history, and local recovery snapshots; it refuses to disable while a dependency exists unless the user explicitly chooses to purge those recovery artifacts permanently. Sync endpoints, offline media, and external snapshots cannot be enumerated reliably, so users who may need those copies later must retain an independently exported matching key backup before disabling.

**Prerequisite**: `restoreNotebookCryptoConfigFromBackup` only takes effect when the local `Enabled=false`; it never overwrites an in-use local config.

## 5. Encrypted File Layout

```
<workspace>/
├── conf/conf.json                          ← global encryption config (MasterSalt/KEKVerifier)
├── storage/av/                             ← normal-notebook database files (plaintext)
├── data/
│   ├── .siyuan/
│   │   └── notebook-crypto-backup.json     ← NotebookCrypto backup (MasterSalt/KEKVerifier, synced; see §4.1)
│   ├── <boxID>/                            ← encrypted notebook directory
│   │   ├── .siyuan/conf.json               ← BoxConf (Encrypted=true + WrappedDEK)
│   │   ├── *.sy                            ← AES-256-GCM ciphertext
│   │   ├── assets/
│   │   │   ├── <uuid>-<blockID>.ext        ← AES-256-GCM ciphertext, filename desensitized
│   │   │   └── .names.json                 ← original filename mapping (DEK-encrypted)
│   │   └── storage/av/
│   │       └── <avID>.json                 ← database file (DEK-encrypted)
│   └── <normal-notebookID>/                     ← normal notebook (plaintext, untouched)
├── history/                                ← history directory (ciphertext stored verbatim)
│   └── <timestamp>-update/
│       └── <boxID>/                        ← encrypted-notebook history (ciphertext .sy + ciphertext database files)
└── temp/
    ├── siyuan.db                           ← global SQLite (plaintext, no encrypted-notebook data)
    ├── blocktree.db                        ← global blocktree (plaintext, no encrypted-notebook data)
    ├── siyuan-encrypted-<boxID>.db         ← encrypted-notebook content SQLite database (SQLCipher)
    └── siyuan-encrypted-<boxID>-blocktree.db ← encrypted-notebook blocktree SQLite database (SQLCipher)
```

## 6. SQLite Database Isolation Design

```
Normal-notebook operations:
  frontend → API → original function → global blocktree.db → global siyuan.db

Encrypted-notebook operations (dedicated read path, with boxID):
  frontend(with notebook) → API handler dispatch → InBox function
    → encrypted blocktree SQLite database → encrypted content SQLite database
```

**Write path**: Centralized funnel; selects db by notebook. Index queue, blocktree writers, index corrections are all routed by notebook.

**Read path**: Three-layer fall-through — the handler layer dispatches by the `notebook` parameter; original functions forward to the InBox variant (normal path passes empty boxID); the low-level wrapper decides routing by whether the encrypted SQLite database is open, with empty boxID always going to the global SQLite database.

**Deep full-routing principle**: Every SQL call on the read path of an encrypted notebook (including deep helpers: ref counts, block name/alias, child-block recursion, FTS counts, highlighting, mention search, refs definition queries, etc.) is routed to the encrypted SQLite database and never leaks to the global SQLite database.

**Generic-entry fallback**: Core functions like `GetBlockTree` / `ExistBlockTree` / `GetBlockTrees` / `LoadTreeByBlockID` automatically iterate opened encrypted notebooks when a global lookup misses.

## 7. .sy / assets / Database File Encryption

**`.sy` transparent encryption** (filesys layer):
- `DEKProvider` callback injected (avoids circular dependency)
- Decrypts after read, encrypts before write; cache holds plaintext
- Reading an encrypted notebook's title requires a full read + decrypt before parsing
- `.sy` AAD binds the boxID, object type, and stable file basename `<rootID>.sy`, excluding every parent-directory component. The basename matches the decrypted root-block ID and is globally unique within the notebook
- Parent directories are outside AAD, and the application continues to build document topology from the existing directory structure. Loading verifies that the basename matches the decrypted root-block ID and rejects duplicate object IDs within one notebook, invalid paths, and hierarchy cycles, but does not provide cryptographic integrity for parent-directory relations

**assets encryption**:
- On upload, fully read into memory + encrypt + write (cannot stream-encrypt)
- Filename desensitization: encrypted-notebook asset filenames are `<uuid>-<blockID>.<ext>`; the original name is stored in an encrypted mapping file
- On read, decrypt then output; on download, look up the mapping for the original name
- Encrypted notebooks disable the global assets fallback; notebook-level is mandatory
- Asset file rename is forbidden (desensitized-filename rename breaks the mapping)
- The asset ciphertext and encrypted name mapping commit as one journaled recoverable transaction: write and sync same-directory temporary files, write a transaction journal containing no plaintext name, replace both targets and sync their directories, then clear the journal. Crash recovery rolls forward or back before opening access; any failure is returned to the caller and leaves no externally visible orphaned asset or missing mapping

**database file encryption**:
- Path fallback: encrypted-notebook database files are stored at `<boxID>/storage/av/<avID>.json`; normal notebooks still use global `storage/av/`
- Read: first check the global path; on miss, iterate opened encrypted notebooks; after finding, DEK-decrypt then JSON-parse
- Save: after JSON serialization, route by path (global plaintext / encrypted-notebook DEK-encrypted)
- First creation: `RenderAttributeView` looks up the boxID from the blockID and presets ownership
- Mirroring: encrypted notebooks are forbidden from cross-boundary mirroring; within-notebook mirroring stores notebook-level `blocks.msgpack`

## 8. Security Design of History Features

```
File history:
  edit triggers history generation → ciphertext .sy copied verbatim to history dir
  auto-generated before close/exit → ensures history is captured even after locking
  history index → content left empty (ciphertext not indexed for search)
  view history → read the snapshot boxID, object type, and stable file basename, then reconstruct the original AAD for decryption (notebook must be unlocked)
  roll back → decrypt with the snapshot AAD → verify that the root-block ID matches the basename → load tree → restore ciphertext verbatim when the basename is unchanged, or let WriteTree re-envelope it when the basename changes

Deleted-notebook history:
  before deletion → entire directory backed up as ciphertext to history dir
  restore → verify WrappedDEK with the matching global key backup and master password, then copy the ciphertext directory back verbatim
  key retention → while kernel-managed history remains recoverable, deletion of the global key backup it depends on is forbidden; permanently purging the history removes the dependency

database history:
  generate → encrypted-notebook database files copied from notebook-level dir to history dir
  view → decrypt with the boxID and object purpose/identifier recorded by the snapshot, never with the absolute history-directory path as AAD
  roll back → encrypted-notebook database file/resources rolled back to notebook-level dir
```

Parent directories below the history root are not part of AAD. Every history entry retains, in an unambiguous canonical form, the `boxID`, object type, and stable file basename or object identifier at snapshot creation; these values may be encoded by a fixed history layout or stored as metadata committed with the snapshot. Changing only a live document's parent directory leaves its AAD context unchanged; if its basename changes, existing history continues to authenticate with the old basename. Rollback first verifies the ciphertext and that the basename matches the decrypted object ID, then restores under the target parent directory. Re-enveloping is required only when the target basename changes. Missing, malformed, or mismatched snapshot context rejects viewing and rollback; the implementation must not parse ciphertext as plaintext or replace the snapshot basename with the current basename.

## 9. Block-Ref Cross-Boundary Protection

Block refs of an encrypted notebook: normal within the notebook, forbidden across the encrypted boundary. Three layers of defense:

1. **Frontend search dispatch**: When typing `((` or `{{` in an encrypted notebook triggers a search, the request carries a `notebook` parameter; the kernel only searches that notebook's own encrypted SQLite database, so results exclude other notebooks' blocks.
2. **Handler dispatch**: Encrypted notebooks call a dedicated search variant.
3. **Write-time fallback check**: Before a transaction commits, the tree is walked and each block-ref node is checked for crossing the boundary; if so, it is downgraded to plain text (ref attributes cleared, anchor text kept). Defends against hand-entered block IDs, drag-and-drop, paste, direct API calls.

## 10. Cross-Boundary Move: Why Forbidden

Encrypted notebooks forbid moving documents across the encrypted boundary (normal ↔ encrypted, bidirectional).

**Data-corruption risk**: Cross-notebook moves use a filesystem Rename to directly move `.sy` bytes, with no encrypt/decrypt conversion. Ciphertext moved to a normal directory is unreadable; plaintext moved to an encrypted directory is unreadable. Indexes also cannot be migrated across dbs.

**Move within the same encrypted notebook**: A `.sy` ciphertext object's AAD binds only its stable basename, not its parent directory. A move that preserves the basename follows normal within-notebook move semantics and may Rename ciphertext verbatim without re-enveloping the root or descendants. Only a basename change verifies and decrypts with the old basename and re-envelopes with the new one. Indexes are updated after the move, and failure handling remains the same as for a normal notebook; no additional encrypted hierarchy metadata is introduced.

**Security-leak risk** (more critical): When moving from an encrypted notebook to a normal notebook — the document body escapes encryption protection; associated resources must be moved out and decrypted together; the reference network binding blocks to subdocuments is split or leaked along with it; index-metadata cross-db migration breaks isolation.

**Design stance**: An encrypted notebook is an island; content does not enter or leave (moving out of an encrypted notebook to a normal one would leak plaintext; the reverse would corrupt the ciphertext).

## 11. Interaction Design

| Scenario | Interaction |
|---|---|
| Enable | Settings → Access authorization → Encrypted-notebook section → toggle → set master password (double input + risk confirmation) |
| Disable | Supported only when no live encrypted notebook and no kernel-enumerable history or recovery snapshot depends on the current key backup; otherwise reject, or require explicit permanent purge of those recovery artifacts before deleting global config and backup |
| Create | File panel "more" menu → "New encrypted notebook" → enter name + master password → auto-unlock and open |
| Icon | Shows lock icon when closed (locked); restores user emoji when opened (unlocked) |
| Unlock | Click a closed encrypted notebook → master-password prompt (🔓 Unlock xxx) → wait ~1s → opens |
| Lock | Equals close: first block new operations, wait for or cancel in-flight work, then remove managed DEK handles, delete encrypted SQLite databases, and best-effort clean kernel-managed plaintext caches, temporary files, and access tokens. Unsaved edits and file history are automatically saved before locking |
| Auto-lock | Each unlocked notebook stores its own last-activity time. Real UI interaction by an authenticated user in the current workspace refreshes all currently unlocked encrypted notebooks together. A headless client can perform the same refresh through an explicit keepalive endpoint that requires authentication and the administrator role; background reads, sync, indexing, and other non-user activity do not keep notebooks alive automatically |
| Change password | Settings → Access authorization → "Change master password" |
| Move document | A parent-only move within an encrypted notebook moves ciphertext verbatim and updates indexes; a basename change re-envelopes content. Moves between normal notebooks remain normal; cross-boundary (normal↔encrypted) moves are rejected with a prompt |
| Doc to heading | Cross-boundary rejected with a prompt |
| Block ref | Normal refs within an encrypted notebook (searching `((` only searches this notebook; backlinks panel displays normally); cross-boundary (normal↔encrypted, encrypted A↔encrypted B) blocked |
| database mirroring | Normal mirroring within an encrypted notebook; cross-boundary forbidden |
| Asset file rename | Not supported (desensitized-filename rename breaks the mapping) |
| Import | Supported: imported .sy.zip or Markdown files are auto DEK-encrypted before writing to disk |
| File history | Supported (must unlock the corresponding encrypted notebook before viewing; the history index stores no plaintext content) |
| Deleted notebook | Supported (ciphertext backup; recovery requires the matching global key backup and master password; retaining this history prevents direct deletion of its key backup) |
| Export | Supported (identical to normal notebooks; must unlock first, exports plaintext. Rejected when locked) |
| Sync | Unchanged (ciphertext in, ciphertext out, self-consistent) |

## 12. Security Boundary

**Security premise**: An encrypted notebook provides its strongest application-level protection while closed (locked). After locking completes, new operations are denied, managed DEK handles and database connections are removed, and kernel-managed plaintext caches, temporary files, and tokens are cleaned on a best-effort basis; this does not promise erasure of every transient copy in the Go runtime, OS swap, crash dumps, or storage media. **When open (unlocked), the application holds a usable DEK handle**, and authenticated application callers — APIs, third-party plugins, AI/LLM (including MCP, agents, semantic search) — can read plaintext content just like a normal notebook. The kernel CLI is an explicit exception: it rejects encrypted notebooks and their raw files regardless of lock state. Encryption protects data at rest and unreachability through supported entry points after locking; it **does not protect visibility to authenticated callers while unlocked**. Treat an unlocked encrypted notebook as a normal notebook in active use and lock it immediately afterwards.

**Protected (ciphertext on disk)**:
- `.sy` document body (encrypted)
- assets binary files (encrypted)
- assets filenames (desensitized, original name encrypted)
- database files (columns/rows/cell values/view config/content snapshots, encrypted)
- content SQLite database (blocks/FTS/attributes/refs, SQLCipher-encrypted)
- blocktree SQLite database (block-tree metadata: ID/path/title, SQLCipher-encrypted)
- .sy and database files in the history directory (ciphertext stored verbatim)

**Not protected**:
- MasterSalt/KEKVerifier in `conf.json` (designed to be plaintext: salt is not secret, verifier is ciphertext)
- BoxConf.WrappedDEK (ciphertext, requires KEK to unwrap)
- DEK-derived values and transient plaintext copies that may be created by the process or operating system, including swap, hibernation images, and crash dumps; locking revokes managed key handles and best-effort clears application-controlled caches only
- Plaintext exports under `temp/` that have not yet been cleaned up; administrator file APIs, archive APIs, trusted plugins, and local processes can access them
- The content field of history indexes (left empty; neither plaintext nor ciphertext)
- **Metadata leakage** (encryption does not conceal): file count, directory structure, file sizes, modification times (mtime), asset file extensions, blockID timestamps. Encrypted-notebook asset filenames are desensitized to `uuid-blockID.ext` but the extension is visible; old ciphertext retained in sync endpoints or historical snapshots is held by those storage providers, and the encrypted notebook cannot revoke their copies.

**API protection**:
- `/api/file/*`: refuses access to any file in encrypted-notebook persistent directories (not just .sy), preventing ciphertext disclosure or writes that bypass the encryption layer; workspace `temp/` remains accessible.
- Kernel CLI: rejects encrypted notebook/block targets and direct paths below `<workspace>/data/<encrypted-notebookID>/`; it cannot be used to unlock, read, write, export, or manipulate encrypted notebook data.

## 13. AI / LLM Reachability

The visibility of encrypted notebooks to AI/LLM is determined entirely by the **lock state**; there is no functional-layer isolation.

**When locked**: AI/LLM (including MCP, agents, semantic search, embedding vectorization) cannot obtain a usable DEK handle, and every encrypted-notebook entry point denies access. Dedicated databases are closed and disk content is ciphertext, so these callers cannot read encrypted content.

**When unlocked**: the DEK is in memory, so AI/LLM can read encrypted-notebook content and search within a notebook — MCP tools can list encrypted notebooks and their documents, read block content, run in-notebook FTS search, etc. However, global search, semantic search, and embedding vectorization still do not include encrypted content (encrypted data never enters the global `block_embeddings`/`blocks` tables; physically unreachable), see §3 comparison table.

Design stance: there is no "hide from AI" isolation at the functional layer, because such isolation is neither thorough nor easy to reason about. Supported entry points cannot access content after locking, but locking does not replace process- and OS-level protection. Users only need to understand one rule: **lock sensitive content after use**.

## 14. Feature Limitations

An encrypted notebook is an island; some features are unimplemented because of their cross-notebook nature or dependence on global aggregation. These are feature boundaries, not performance or security trade-offs.

- **Flashcards / spaced repetition**: Decks and scheduling are cross-notebook and depend on the global SQLite database; not implemented.
- **Bookmarks**: Global aggregation view (scans the global siyuan.db); encrypted notebooks not integrated.
- **Tags**: Global aggregation view (scans the global spans table); encrypted notebooks not integrated.
- **Asset file rename**: Encrypted-notebook asset filenames are already desensitized to `uuid-blockID.ext`; renaming breaks the original-name mapping.
- **Unused asset cleanup**: Encrypted-notebook assets are excluded from global unused-asset cleanup (island, assets do not cross boundaries), preventing false deletion when locked and document references cannot be scanned.
- **Unused database cleanup**: Encrypted-notebook database definitions are excluded from global unused-database cleanup, preventing false deletion when locked and reference relationships cannot be confirmed.

## 15. Performance Differences

| Operation | Normal Notebook | Encrypted Notebook | Reason |
|---|---|---|---|
| **Unlock (Mount)** | Instant | **~1 second delay** | Argon2id key derivation (intentionally slow for brute-force resistance) |
| **Open document** | Read disk + parse JSON | Read disk + AES-GCM decrypt + parse + encrypted-db query | Extra decrypt + encrypted-db query |
| **Save document** | Render JSON + write disk | Render JSON + AES-GCM encrypt + write disk | Extra encrypt |
| **Upload assets** | Stream to disk | Fully read into memory + encrypt + write | Cannot stream-encrypt; large files cause memory pressure |
| **Browse assets** | Direct ServeFile | Read disk + decrypt + output | Decrypts on every request, no browser cache |
| **database render** | Global blocktree + plaintext JSON | Encrypted blocktree + DEK-decrypt JSON | Extra JSON decrypt; batch IAL load routed by notebook |
| **database save** | Plaintext JSON to disk | DEK-encrypt + write | Extra encrypt |
| **In-notebook search** | FTS query on global SQLite database | FTS query on independent encrypted SQLite database | SQLCipher page-level decrypt ~5-10% overhead |
| **DB connections** | 1 global | 1 global + 2 per unlocked encrypted notebook | Each encrypted-db connection pool ~20 connections |
| **When locked** | No extra overhead | Managed key handles revoked; caches and temporary files cleaned on a best-effort basis | Cold-start latency on next operation |

**Performance summary**:
- **Daily editing experience**: Nearly imperceptible. AES-GCM encryption/decryption is microsecond-level; document read/write is bottlenecked by disk IO.
- **Noticeable latency**: Unlock ~1s, large-asset browsing (full decrypt per request with no cache), first access after lock (cold start).
- **Zero impact on normal notebooks**: Encryption and routing logic short-circuits for non-encrypted notebooks.

## 16. Threat Model and Security Scope

This feature protects data-at-rest confidentiality and inaccessibility through supported entry points after a notebook is locked. The design assumes an attacker may obtain current or historical ciphertext from the workspace, sync service, or backup media, but does not know the master password and cannot control the running application or operating system while the user has unlocked a notebook. AES-GCM provides confidentiality, integrity, and origin-context authentication for an individual encrypted object; it does not provide availability, version freshness, rollback protection, or deletion of retained ciphertext copies.

The following are outside this feature's security boundary and must be stated in product UI and user documentation:

- While a notebook is unlocked, authenticated application callers such as APIs, plugins, MCP, and AI/LLM, as well as a local attacker able to read the application process memory, may obtain plaintext.
- Local processes that can read workspace files, administrator file APIs, and trusted plugins can read temporary plaintext exports that have not yet been cleaned up; the temporary directory is not an access-control boundary.
- Files intentionally exported by the user, clipboard contents, screenshots, printouts, content shared with third parties, and plaintext files saved outside the workspace are protected by the user.
- OS swap, hibernation images, crash dumps, filesystem snapshots, and malware are not absolutely protected by clearing application memory; locking performs best-effort cleanup only within the application's control.
- A sync service or backup holder may retain, delete, replace, or roll back ciphertext. Replacement and rollback can cause denial of service or data rollback; they cannot decrypt valid ciphertext without the master password.
- Parent directories are excluded from AAD, so an attacker who can write workspace ciphertext may move valid ciphertext with an unchanged basename within the same notebook, and the application treats the new parent as the current document topology. Content, notebook, object type, and stable object ID remain authenticated, but parent-directory topology has no cryptographic integrity guarantee.

"Only ciphertext remains after locking" means that encrypted-notebook persistent data remains encrypted and that managed temporary files, caches, and key handles have undergone best-effort cleanup. It does not guarantee that workspace `temp/` contains no plaintext left by a crash, file lock, or permission error. It also excludes files deliberately exported to an external location and does not promise erasure of transient or historical copies retained by the process, operating system, or underlying storage medium.

## 17. State Machine and Concurrency Rules

The global state is `Disabled`, `Enabled`, or `RecoveryRequired`. In normal steady state, `Disabled` has no live encrypted notebook or kernel-enumerable key dependency. If startup discovers encrypted notebooks or recovery artifacts while global configuration is missing or disabled, it enters `RecoveryRequired`, never treats them as normal notebooks, and waits for a matching key backup to be restored. Under `Enabled`, each encrypted notebook independently has one of these states: `Locked`, `Unlocking`, `Unlocked`, `Locking`, or `Error`, and starts as `Locked` after application startup.

| Transition | Preconditions | Invariants after success | Failure handling |
|---|---|---|---|
| `Locked → Unlocking → Unlocked` | Master-password verification succeeds and ciphertext configuration matches | A usable DEK handle exists only in managed memory; dedicated databases are open; notebook-specific entry points are allowed | Revoke derived KEK/DEK handles, close opened resources, and return to `Locked` |
| `Unlocked → Locking → Locked` | Atomically close admission to new operations and wait for or cancel in-flight operations | No usable managed DEK handle or database connection remains; kernel-managed plaintext caches, temporary files, and tokens have undergone best-effort cleanup | Enter `Locked` after key and database cleanup; a temporary-file cleanup failure only records diagnostics without plaintext and is retried on exit or next startup |
| `Unlocked → Error` | Ciphertext authentication fails, database opening fails, or an invariant is violated | Immediately deny reads and writes; never fall back to a normal-notebook path | Close resources and retain diagnostics without plaintext; the user can only lock or unlock again |
| Change master password | All encrypted notebooks are `Locked` | All WrappedDEKs, global configuration, and backup update as one recoverable transaction | Keep old configuration and backup usable; no subset of notebooks becomes unlockable only with the new password |

One lifecycle controller per notebook manages state, operation admission, and the active-operation count. Reads, edits, exports, previews, sync, indexing, history view or restore, and AI/MCP access obtain a shared lifecycle lease only while `Unlocked`, and hold it through parsing, cache publication, HTTP response or download completion, and asynchronous-result registration. Lock and delete atomically change the state to `Locking` and close admission, acquire the exclusive lifecycle lease after cancelling or draining active work, then close databases, revoke managed DEK handles, and best-effort clean caches and temporary artifacts while exclusive. They publish `Locked` after key handles and database connections are removed; a temporary-file deletion failure does not block locking, but it is logged and retried on exit or next startup. No new plaintext response, cache refill, or database reconnection may occur after locking completes, but a temporary plaintext copy whose deletion failed may remain on disk.

The global configuration lock is acquired before any notebook lifecycle lock. An operation involving multiple notebooks acquires lifecycle locks in lexicographic boxID order. DEK-cache, database, file, and other subsystem locks are acquired only after lifecycle locks and released before them. Reverse acquisition, reacquiring the global configuration lock while holding a subsystem lock, and acquiring a lower-level lock while holding a higher-level one are forbidden. Auto-lock stores activity time per notebook, but one authenticated user interaction in the current workspace or an explicit keepalive refreshes every unlocked notebook together. A periodic job checks elapsed time using the system clock, so a system-clock adjustment can advance or delay the trigger accordingly; auto-lock is a convenience protection, not a precise security timing boundary.

## 18. Ciphertext, Key, and Database Format

Persistent formats are layered; global KDF configuration, key envelopes, and per-object data envelopes are not conflated:

1. **Data-object envelope**: Every `.sy`, asset, asset-name mapping, and database-definition object contains at least a format version, algorithm identifier, cryptographically random nonce unique for the same purpose key, ciphertext, and authentication tag. The current format constructs AAD deterministically as `format version + boxID + object type + stable object ID`, excluding parent directories and absolute paths. A `.sy` stable object ID is its canonical basename `<rootID>.sy`; an asset uses its desensitized disk basename, a database definition uses its avID, and a fixed singleton file uses a versioned constant ID. After decryption, the internal object ID matches the AAD object ID, and duplicate object IDs within one notebook are rejected. AES-GCM nonces come from the operating system CSPRNG; randomness failure aborts the write, and the standard per-purpose-key invocation bound is enforced. An authentication tag cannot retrospectively identify nonce reuse, so the design never claims such reuse will automatically cause authentication failure.
2. **Global key and envelope metadata**: `NotebookCrypto` stores the KDF algorithm and parameters, MasterSalt, verifier format, KEK-envelope version, and backup-HMAC version; `BoxConf.WrappedDEK` stores each notebook's DEK envelope. They are not duplicated in every data object.
3. **Purpose separation**: Each notebook's DEK derives subkeys with fixed domain separators for file content, assets, database definitions, content SQLCipher, and blocktree SQLCipher. Asset content and asset-name mappings may share the asset subkey because their versioned AAD object types differ; a separate subkey for every object type is not required. The KEK may be used directly for the verifier, DEK wrapping, and backup HMAC, with those uses separated by different algorithms, versioned AAD, or authenticated data formats. WrappedDEK authentication is not incorrectly placed in a DEK domain.
4. **Database compatibility metadata**: SQLCipher version, cipher parameters, and schema version live in a verifiable database header or the corresponding encrypted configuration boundary, not every data object. Content and blocktree indexes are rebuildable; after source ciphertext authenticates, an incompatible index is closed and rebuilt rather than weakening cipher parameters or falling back to plaintext SQLite.
5. **Rename and format stability**: The first released format constructs AAD directly from the stable object ID. It is intentionally incompatible with experimental development ciphertext bound to the full logical relative path and provides neither dual-format reads nor migration; development data is deleted and rebuilt after the format switch. A parent-only move does not re-envelope content. A stable-basename change authenticates and decrypts with the old basename and creates a new envelope with the new basename. After the first released version freezes the format, any future envelope or AAD semantic change increments the format version and requires a separately designed migration.

The SQLCipher main database, WAL, SHM, rollback journal, temporary files, and backup copies are protected objects. They remain in controlled directories and use their corresponding purpose key. Locking, crash recovery, and history snapshots enumerate these companion files; unencrypted SQLite pages, query results, or diagnostics must never be written to a global temporary directory.

## 19. Backup, Recovery, and Metadata Policy

`notebook-crypto-backup.json` is recovery material, not a secret. It contains a format version, backup ID, creation time, content digest, and KEK-based HMAC. After the master password derives the KEK, a missing or mismatched HMAC rejects recovery rather than acting as a compatibility fallback. Recovery must not silently overwrite enabled configuration. A malformed backup or a backup incompatible with existing encrypted notebooks enters an error state instead of generating a new MasterSalt.

Backup persistence follows the project's existing file-write semantics. The global `notebook-crypto-backup.json` is written to a random temporary file in the same directory and then atomically replaced; each notebook's `notebook-crypt-backup.json` uses the ordinary file-lock-protected configuration write. Neither path makes an additional power-loss durability guarantee through file or directory `fsync`. Startup validates the structure and digest that can be checked without a key; recovery validates the HMAC and key-envelope compatibility after the master password is entered. Corruption or mismatch is safely rejected instead of generating replacement key material.

An HMAC proves only that a party without the KEK did not alter the backup; it does not prove that the backup is the latest version. The current scope introduces no trusted external monotonic counter, so an authenticated historical backup or ciphertext may pass validation. `BackupID` and `CreatedAt` are information for diagnostics and manual comparison, not rollback anchors. Sync, history, and recovery flows must not describe successful authentication as proof of freshness or source trust. Strong rollback prevention requires independent trusted state and is outside this design's scope.

Sync endpoints and offline backups are storage that may be lost, copied, or rolled back but cannot read plaintext. Trustworthy KEK-based authentication cannot be established before the master password is entered. Users keep at least one independent, versioned key backup and understand that losing the master password or every matching MasterSalt backup is unrecoverable. While a live encrypted notebook, deleted-notebook history, or kernel-enumerable local recovery snapshot depends on the current NotebookCrypto, disabling must refuse to delete global configuration and backup; only an explicit permanent purge of those recovery artifacts removes the dependency. External and remote copies cannot be enumerated reliably, so retaining their matching key backup is the user's responsibility.

| Category | May be exposed |
|---|---|
| Document body, attribute values, original asset names, database cells, index text | No |
| boxID, directory structure, file count, ciphertext size, modification time, asset extension, block-ID time information | Yes |
| Notebook name | Yes. The notebook list and encrypted-notebook status API retain the name while locked so users can identify the notebook they intend to unlock; the name is therefore outside the confidentiality boundary |
| Icon, sorting, document title/count, relation count, tags, bookmarks, history and snapshot names | Must not be exposed while locked by default; if compatibility requires exposure, list each field here and explain it in the UI |

## 20. Feature Boundaries, Plaintext Temporaries, and Interface Rules

Unsupported flashcards, bookmarks, tags, asset rename, unused-asset cleanup, and unused-database cleanup must be handled uniformly by the frontend, HTTP API, plugin API, MCP, and import paths: return an explicit "unsupported" error for encrypted-notebook targets and create no global index, global attribute, or deferred task. Existing legacy data must not be loaded, aggregated, or written back. Error codes and localized messages remain stable for callers.

Every raw entry point that might bypass dedicated read/write paths is registered, including file APIs, kernel CLI, MCP file tools, WebDAV, plugin file interfaces, export download URLs, preview URLs, and background tasks. Encrypted-notebook persistent directories always reject direct access through raw entry points to avoid ciphertext disclosure or writes that bypass the encryption layer. Workspace `temp/` is general temporary storage accessible to administrator file APIs, archive APIs, and trusted plugins, so it is not part of the encrypted access-control boundary. WebDAV continues to deny the entire `temp/` directory unconditionally to avoid exposing temporary data through a remote file service. Adding an entry point requires separate review of whether it touches encrypted-notebook persistent directories or temporary plaintext.

### Temporary Plaintext Lifecycle

Exports have two classes: a user-selected external destination may contain plaintext after a risk prompt; kernel-managed previews, conversions, downloads, and intermediates use `temp/export/<boxID>/<kind>/<exportID>/`. The first-level boxID identifies cleanup ownership, not access permission. Normal exports and plugin temporary files must not use a valid boxID as their first-level name under `temp/export/`.

The in-memory `managedEncryptedExports` tokens manage download-link expiry and lifecycle; they are not a security boundary against local files, administrator APIs, or trusted plugins. Lock, delete, cancellation, failure, and normal exit revoke related tokens and best-effort remove `temp/export/<boxID>`. At application startup, entries whose first-level name is a valid boxID are at least scanned and removed; generic desktop temporary-directory initialization also clears the entire `temp/export` directory. No caller may rely on files under `temp/` surviving across processes. Deletion failure only records diagnostics without plaintext and does not prevent the notebook from entering `Locked`; exit or the next startup retries cleanup. Logs, error reports, thumbnails, OCR/conversion output, and clipboard handling contain no plaintext by default unless the user explicitly sends content to an external program.

## 21. Security Acceptance Matrix

| Scenario | Expected result |
|---|---|
| Access to encrypted-notebook persistent directories while locked through UI, HTTP, file APIs, CLI, MCP, WebDAV, plugins, and background tasks | Other than the explicitly exposed notebook name, cannot decrypt, write, copy, delete, or enumerate encrypted content; administrator file APIs and trusted plugins may still access an export copy in `temp/` that has not yet been cleaned up |
| Unlock, lock, application restart, and authentication failure | Only `Unlocked` permits a managed DEK handle and database connections; after failure or restart, entry points deny access and application-controlled plaintext caches, temporary files, and handles undergo best-effort cleanup |
| Lock concurrent with response generation, cache publication, export, preview, sync, indexing, or history restore | Lock succeeds only after all in-flight lifecycle leases end; no late plaintext response, cache refill, newly created temporary file, usable token, or database reconnection follows success, except for an existing temporary file whose deletion failed |
| Move a document within one encrypted notebook, then clear caches and restart | When the basename is unchanged, ciphertext remains unchanged and authenticates with the stable object ID; the new parent takes effect under normal-notebook semantics, the old directory location is absent, and failure handling matches a normal notebook |
| Refs, moves, mirrors, assets, and database operations between an encrypted notebook and a normal notebook or another encrypted notebook | Island boundaries hold; rejection creates no partial files, global indexes, or relation data |
| Asset-ciphertext write or name-mapping update fails | The whole logical transaction fails and rolls back; the caller receives an error, with no accessible orphan, missing mapping, or plaintext temporary file |
| Delete an encrypted notebook while retaining history, then disable or restore | A key dependency prevents deletion of global config and backup; the matching backup and master password restore the notebook, and only explicit permanent purge removes the dependency |
| Move a document's parent directory or change its basename after creating history, then view or restore the old entry | Authenticate and decrypt with the snapshot boxID, object type, and stable basename recorded by the history entry; rollback re-envelopes only when the target basename changes, while missing snapshot context rejects the operation |
| Disk inspection of files, assets, databases, WAL/SHM, history, snapshots, and logs | No readable body, asset contents, original asset names, or plaintext SQLite pages exist in encrypted-notebook persistent locations; `temp/` may contain plaintext during export or after cleanup failure |
| Restart after an abnormal exit | Startup removes at least entries under `temp/export/` whose first-level name is a valid boxID; generic temporary-directory initialization may also remove other exports and plugin temporary files |
| Ciphertext tampering, path substitution, and backup corruption | Authentication or format validation fails safely; never fall back to a normal path, generate replacement key material, or silently overwrite configuration |
| Nonce randomness failure, reaching a purpose-key invocation bound, or discovering nonce reuse afterwards | Reject before encryption on randomness failure or bound exhaustion; AES-GCM authentication cannot detect nonce reuse that already occurred, so discovery is handled as a key-compromise incident by rotating the DEK and re-encrypting data |
| Replay an authenticated historical ciphertext object or key backup | It may validate as an authentic old version but is never claimed to be freshest or from a trusted source; rollback risk is explicit, and the current design does not claim rollback prevention |
| Master-password change and KEK rewrapping | WrappedDEKs and backup update atomically; an interrupted update leaves the old configuration recoverably usable; the old-password exposure warning is accurate; data and history are verifiably readable before and after migration |
| Concurrent multi-notebook operations and auto-lock | Lock order has no deadlock; authenticated UI activity or an explicit keepalive refreshes all currently unlocked notebooks, while background work does not refresh them automatically; a locking notebook admits no new lease |

## 22. Usage Guide

### First-time enablement
1. Go to **Settings → Access authorization → Encrypted notebooks** and toggle it on
2. Set a master password (double input + risk confirmation). The master password is the unified key for all encrypted notebooks — **you must remember it; there is no recovery backdoor**
3. Once enabled, you can **create a new encrypted notebook** from the file-panel "more" menu (enter a name + master password → auto-unlocks and opens)

> Strength recommendation: 12+ characters, mixed case + digits + symbols. The stronger the master password, the higher the brute-force resistance (password strength is the only line of defense; there is no backdoor).

### Daily use: unlock and lock
- **Unlock**: Click a closed encrypted notebook → enter the master password → wait ~1 second (Argon2id derivation) → opens. Unlocking only affects that notebook; other encrypted notebooks stay locked
- **Lock**: Closing the notebook equals locking. The kernel stops new access, waits for or cancels in-flight work, revokes managed DEK handles and database connections, and best-effort cleans kernel-managed plaintext caches, temporary files, and tokens. **Locking after use** is the most important security habit because it minimizes key and plaintext exposure
- **After restart**: All encrypted notebooks are force-closed; you must re-enter the master password to unlock (managed DEK handles exist only in process memory and must be derived again after restart)

> Important: An encrypted notebook provides its strongest application-level protection while locked, but locking only best-effort cleans application-controlled memory and temporary data; it does not promise erasure of every transient copy in the operating system or storage media. While unlocked, authenticated application callers (APIs, plugins, AI/LLM including MCP) can read plaintext just like a normal notebook; the kernel CLI always rejects encrypted-notebook operations (see §12 Security premise).

### Changing the master password
Go to **Settings → Access authorization → Change master password**. Changing the password only re-wraps each notebook's WrappedDEK — **document data is not re-encrypted**, so it completes instantly. The key backup is auto-refreshed and synced after a password change.

> Important semantics: password change uses the KEK envelope model — the DEK itself does not change; only a new KEK (derived from the new password) re-wraps the WrappedDEK. This means **changing the password does not revoke the old password's decryption ability**: if the old password and an old WrappedDEK (retained in sync endpoints, backups, or historical snapshots) leak together, the same DEK can still be unwrapped, decrypting current data. If you suspect the old password has leaked, migrate content to a freshly created encrypted notebook (new DEK) rather than just changing the password.

### Multi-device sync
Encrypted-notebook ciphertext `.sy`/assets/database files sync along with the data (ciphertext in, ciphertext out, self-consistent); the global key material (MasterSalt etc.) is also automatically backed up to the sync directory. **No manual "enable" is needed on a new device after sync**:

1. Configure the same sync account on the new device and complete a sync
2. Sync pulls the key backup to the local machine; the kernel auto-restores the "enabled" state
3. Just click the encrypted notebook and enter the master password to unlock and use it

If the notebook still shows as locked on the new device after sync, that is normal — click it and enter the master password.

Sync recovery can validate backup integrity but cannot prove that a backup is the newest version. Keep an independently versioned key backup. When historical copies conflict, the system cannot determine freshness automatically; before recovery, the user confirms a version from trusted source and time information.

### Import and export
- **Import**: Supports importing `.sy.zip` and Markdown; content is automatically DEK-encrypted before writing to disk, identical to manually created documents
- **Export**: Identical to normal notebooks (must unlock first; exports plaintext). `.sy.zip`, HTML, Word, PDF, Markdown, etc. are all supported; export is rejected while locked

### What if I forget the password
**It cannot be recovered** — by design (no backdoor). Even if the ciphertext has been synced to the cloud, it cannot be decrypted without the master password. **You must remember the master password; using a password manager is recommended.**

### Recovering from a lost key backup
If both `conf/conf.json` and the key backup in the sync directory are lost (an extreme case), re-enabling the encrypted-notebook feature will be rejected with a prompt to restore the backup file. As long as you can recover `notebook-crypto-backup.json` from another synced device or a previously exported key file, you can import it via the "Import key" button (shown when not enabled), or manually put it back at `<workspace>/data/.siyuan/` and re-enable, then unlock with the master password matching that key.

Restoring deleted encrypted-notebook history also requires the global key backup matching its WrappedDEK and the master password. While you still need that local recovery path, do not permanently purge either the history or its matching key backup; disabling must refuse to proceed when it discovers such a dependency.

### Suitable scenarios for encrypted notebooks
- Private diary, financial records, medical information
- Work secrets, business plans, contracts
- Concern about device loss or theft — once encrypted, even if the disk data is recovered, it remains ciphertext without the master password

### Unsuitable scenarios for encrypted notebooks
- Daily notes, study notes (the extra encryption overhead is not worth it)
- Content that needs global search (encrypted notebooks do not participate)
- Knowledge networks needing cross-notebook block refs (cross-boundary forbidden)
- Documents needing cross-notebook move/reorganize (cross-boundary forbidden)
- Scenarios needing cross-notebook database mirroring (cross-boundary forbidden)
- Content needing flashcard review (not supported)
- Content needing bookmark/tag management (not supported)
- Content you do not want AI/LLM to touch (AI can read it when unlocked; keep it locked if that matters)
- Large numbers of large files (assets fully decrypt on every browse)

### Daily usage habits
1. **You must remember the master password**: Forgetting it = data permanently unrecoverable (no backdoor)
2. **Lock after use**: Reduce the DEK's exposure time in memory
3. **Don't put all your notes in encrypted notebooks**: Only put what is truly sensitive
4. **Master password strength**: Recommend 12+ characters, mixed case + digits + symbols
5. **Backup**: Keep versioned ciphertext backups and their matching key backups separately; losing the master password or every matching key backup makes the ciphertext unrecoverable
