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
| Block refs | Normal refs within the box; cross-boundary refs forbidden (bidirectional: normal↔encrypted, encrypted A↔encrypted B) |
| AI / LLM | No functional-layer isolation — when unlocked, AI/LLM can read/search just like a normal notebook; when locked, physically unreachable without DEK (see §13) |
| Cross-boundary move | Forbidden — would break data consistency and leak |
| Database | Notebook-level storage — encrypted box database files follow the box directory, DEK-encrypted; cross-boundary mirroring forbidden |
| Flashcards / spaced repetition | Not supported (feature limitation) |
| Bookmarks | Not supported (feature limitation) |
| Tags | Not supported (feature limitation) |
| Import | Supported — imported .sy.zip and Markdown are DEK-encrypted before writing to disk, identical to manually created documents |
| Enable / Disable | Enabling requires setting a master password; disabling requires confirming no encrypted notebooks exist |
| Restart behavior | All encrypted notebooks force-closed on startup (DEK is memory-only, lost after restart); user must re-unlock |
| Existing notebooks | Completely untouched, zero migration |

## 3. Encrypted Notebook vs Normal Notebook

| Aspect | Normal Notebook | Encrypted Notebook |
|---|---|---|
| **Create** | Anytime, no restrictions | Must first enable encryption (set master password); creating requires verifying master password |
| **Open (Mount)** | Direct open | Must first enter master password to unlock (~1s Argon2id each time); DEK enters memory |
| **Close (Unmount)** | Closing makes it invisible | Close = lock (DEK cleared + encrypted SQLite database closed + all plaintext caches cleared) |
| **After restart** | Keeps last open state | Force-closed; must re-enter master password to unlock |
| **.sy files** | Plaintext JSON on disk | AES-256-GCM ciphertext on disk, transparently decrypted on read |
| **assets files** | Plaintext binary, original filename | AES-256-GCM ciphertext, filename desensitized, original name encrypted |
| **database files** | Global `storage/av/<avID>.json` (plaintext) | Notebook-level `<boxID>/storage/av/<avID>.json` (DEK-encrypted) |
| **content SQLite database** | Written to global siyuan.db (plaintext) | Written to independent siyuan-encrypted-`<boxID>`.db (SQLCipher) |
| **blocktree SQLite database** | Written to global blocktree.db (plaintext) | Written to independent siyuan-encrypted-`<boxID>`-blocktree.db (SQLCipher) |
| **Global search** | Participates (FTS hits) | Does not participate (data not in global SQLite database) |
| **Graph** | Participates | Does not participate |
| **Block refs** | Referrable by any notebook | Normal refs within box; cross-boundary refs forbidden (bidirectional) |
| **Move doc (cross-notebook)** | Supported | Forbidden across encrypted boundary |
| **Doc to heading (Doc2Heading)** | Supported | Forbidden across encrypted boundary |
| **database mirroring (cross-notebook)** | Supported | Forbidden across encrypted boundary |
| **Asset file rename** | Supported | Not supported (desensitized filename rename breaks the mapping) |
| **Import** | Supported | Supported (.sy.zip and Markdown, auto DEK-encrypted before writing to disk) |
| **In-notebook search** | Via global SQLite database | Via encrypted SQLite database |
| **Backlinks panel** | Via global SQLite database | Via encrypted SQLite database (incl. mention subquery) |
| **Open doc / outline / breadcrumb / block info / float preview** | Via global SQLite database | Via encrypted SQLite database |
| **Database** | Via global storage + global SQLite database | Via notebook-level storage (DEK-encrypted) + encrypted SQLite database |
| **File history** | Supported | Supported (ciphertext .sy copied verbatim to history dir; decrypt by path boxID when viewing/rolling back) |
| **Deleted notebook history** | Supported | Supported (entire directory backed up as ciphertext before deletion; restored verbatim) |
| **Embedding vectorization / semantic search** | Participates | Does not participate (encrypted data never enters the global block_embeddings table; the embedding pipeline reads only the global SQLite database — independent of lock state) |
| **Agents / AI chat / MCP** | Can read content, can search | Same as normal when unlocked (can read blocks, list docs, etc.); unreachable when locked (see §13) |
| **Flashcards / spaced repetition** | Participates | Not supported (feature limitation) |
| **Bookmarks** | Participates (global aggregation) | Not supported (feature limitation) |
| **Tags** | Participates (global aggregation) | Not supported (feature limitation) |
| **List icon** | User-custom emoji | Shows lock icon when closed; restores emoji when opened |
| **Export (.sy.zip)** | Supported | Supported (exports plaintext when unlocked; rejected when locked; see §12 Security Premise) |
| **Data sync** | dejavu syncs plaintext | Unchanged (ciphertext in, ciphertext out, self-consistent) |
| **Delete notebook** | Delete directory | Delete directory + delete encrypted SQLite database files + delete notebook-level database storage |
| **Rebuild index** | Full | Skipped on startup (closed); on open box.Index() fully rebuilds into the encrypted SQLite database |
| **/api/file/getFile + putFile** | Can read/write any file | Refuses .sy reads/writes on encrypted boxes (prevent ciphertext leak or plaintext corruption) |

**Core difference summary**: An encrypted notebook is an "island" — data is physically isolated, operations have dedicated entry points, it never participates in global features (global search/graph), and documents/database files do not cross the boundary. In-box features (editing, block refs, backlinks, search, database, outline, history, etc.) work normally; AI/LLM is also usable when unlocked (same as a normal notebook). Encrypted notebooks are also isolated from each other. Normal notebooks are completely unaffected.

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
- **KEK not cached**: Derived on every unlock; strict per-box isolation

### 4.1 MasterSalt Backup and Cross-Device Recovery

MasterSalt is the global root of KEK derivation — the master password + MasterSalt derive the KEK via Argon2id, and the KEK then unwraps each box's WrappedDEK. **Losing MasterSalt permanently locks the data**: even with the same master password, a changed salt derives a different KEK, so old WrappedDEKs cannot be unwrapped. A backup-and-recovery mechanism is therefore introduced.

**Backup**: `<DataDir>/.siyuan/notebook-crypto-backup.json`, holding the full NotebookCrypto (MasterSalt/KEKVerifier/KDFParams). Located inside DataDir, it **enters the dejavu sync scope**. It is refreshed when enabling encrypted notebooks and when changing the master password, and deleted on disable. Stored as plaintext JSON (salt is not secret, verifier is ciphertext — identical to how they are stored in `conf/conf.json`).

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

**Fool-proof guard**: When encrypted notebooks already exist on disk (boxes with `Encrypted=true`), `EnableEncryptedNotebook` **refuses to regenerate MasterSalt** (which would orphan old WrappedDEKs) and instead recovers from backup first; only if the backup is missing does it error out and guide the user to restore `conf.json` or the backup file. This guard mirrors `DisableEncryptedNotebook`'s "cannot disable while encrypted notebooks exist".

**Prerequisite**: `restoreNotebookCryptoConfigFromBackup` only takes effect when the local `Enabled=false`; it never overwrites an in-use local config.

## 5. Encrypted File Layout

```
<workspace>/
├── conf/conf.json                          ← global encryption config (MasterSalt/KEKVerifier)
├── storage/av/                             ← normal-box database files (plaintext)
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
│   └── <normal-boxID>/                     ← normal notebook (plaintext, untouched)
├── history/                                ← history directory (ciphertext stored verbatim)
│   └── <timestamp>-update/
│       └── <boxID>/                        ← encrypted-box history (ciphertext .sy + ciphertext database files)
└── temp/
    ├── siyuan.db                           ← global SQLite (plaintext, no encrypted-box data)
    ├── blocktree.db                        ← global blocktree (plaintext, no encrypted-box data)
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

**Write path**: Centralized funnel; selects db by box. Index queue, blocktree writers, index corrections are all routed by box.

**Read path**: Three-layer fall-through — the handler layer dispatches by the `notebook` parameter; original functions forward to the InBox variant (normal path passes empty boxID); the low-level wrapper decides routing by whether the encrypted SQLite database is open, with empty boxID always going to the global SQLite database.

**Deep full-routing principle**: Every SQL call on the read path of an encrypted box (including deep helpers: ref counts, block name/alias, child-block recursion, FTS counts, highlighting, mention search, refs definition queries, etc.) is routed to the encrypted SQLite database and never leaks to the global SQLite database.

**Generic-entry fallback**: Core functions like `GetBlockTree` / `ExistBlockTree` / `GetBlockTrees` / `LoadTreeByBlockID` automatically iterate opened encrypted boxes when a global lookup misses.

## 7. .sy / assets / Database File Encryption

**`.sy` transparent encryption** (filesys layer):
- `DEKProvider` callback injected (avoids circular dependency)
- Decrypts after read, encrypts before write; cache holds plaintext
- Reading an encrypted box's title requires a full read + decrypt before parsing

**assets encryption**:
- On upload, fully read into memory + encrypt + write (cannot stream-encrypt)
- Filename desensitization: encrypted-box asset filenames are `<uuid>-<blockID>.<ext>`; the original name is stored in an encrypted mapping file
- On read, decrypt then output; on download, look up the mapping for the original name
- Encrypted boxes disable the global assets fallback; notebook-level is mandatory
- Asset file rename is forbidden (desensitized-filename rename breaks the mapping)

**database file encryption**:
- Path fallback: encrypted-box database files are stored at `<boxID>/storage/av/<avID>.json`; normal boxes still use global `storage/av/`
- Read: first check the global path; on miss, iterate opened encrypted boxes; after finding, DEK-decrypt then JSON-parse
- Save: after JSON serialization, route by path (global plaintext / encrypted-box DEK-encrypted)
- First creation: `RenderAttributeView` looks up the boxID from the blockID and presets ownership
- Mirroring: encrypted boxes are forbidden from cross-boundary mirroring; in-box mirroring stores notebook-level `blocks.msgpack`

## 8. Security Design of History Features

```
File history:
  edit triggers history generation → ciphertext .sy copied verbatim to history dir
  history index → content left empty (ciphertext not indexed for search)
  view history → decrypt by path boxID (notebook must be unlocked)
  roll back → decrypt history → load tree → WriteTree auto-encrypts on write-back

Deleted-notebook history:
  before deletion → entire directory backed up as ciphertext to history dir
  restore → ciphertext directory copied back verbatim

database history:
  generate → encrypted-box database files copied from notebook-level dir to history dir
  view → decrypt by path boxID
  roll back → encrypted-box database file/resources rolled back to notebook-level dir
```

## 9. Block-Ref Cross-Boundary Protection

Block refs of an encrypted notebook: normal within the box, forbidden across the encrypted boundary. Three layers of defense:

1. **Frontend search dispatch**: When typing `((` or `{{` in an encrypted box triggers a search, the request carries a `notebook` parameter; the kernel only searches that box's own encrypted SQLite database, so results exclude other boxes' blocks.
2. **Handler dispatch**: Encrypted boxes call a dedicated search variant.
3. **Write-time fallback check**: Before a transaction commits, the tree is walked and each block-ref node is checked for crossing the boundary; if so, it is downgraded to plain text (ref attributes cleared, anchor text kept). Defends against hand-entered block IDs, drag-and-drop, paste, direct API calls.

## 10. Cross-Boundary Move: Why Forbidden

Encrypted notebooks forbid moving documents across the encrypted boundary (normal ↔ encrypted, bidirectional).

**Data-corruption risk**: Cross-box moves use a filesystem Rename to directly move `.sy` bytes, with no encrypt/decrypt conversion. Ciphertext moved to a normal directory is unreadable; plaintext moved to an encrypted directory is unreadable. Indexes also cannot be migrated across dbs.

**Security-leak risk** (more critical): When moving from an encrypted box to a normal box — the document body escapes encryption protection; associated resources must be moved out and decrypted together; the reference network binding blocks to subdocuments is split or leaked along with it; index-metadata cross-db migration breaks isolation.

**Design stance**: Consistent with disabling export — an encrypted notebook is an island; content does not enter or leave.

## 11. Interaction Design

| Scenario | Interaction |
|---|---|
| Enable | Settings → Access authorization → Encrypted-notebook section → toggle → set master password (double input + risk confirmation) |
| Disable | Supported when no encrypted notebooks exist; clears global encryption config |
| Create | File panel "more" menu → "New encrypted notebook" → enter name + master password → auto-unlock and open |
| Icon | Shows lock icon when closed (locked); restores user emoji when opened (unlocked) |
| Unlock | Click a closed encrypted notebook → master-password prompt (🔓 Unlock xxx) → wait ~1s → opens |
| Lock | Equals close (DEK cleared + encrypted SQLite database closed + all plaintext caches cleared) |
| Change password | Settings → Access authorization → "Change master password" |
| Move document | Normal within an encrypted box or between normal boxes; cross-boundary (normal↔encrypted) rejected with a prompt |
| Doc to heading | Cross-boundary rejected with a prompt |
| Block ref | Normal refs within an encrypted box (searching `((` only searches this box; backlinks panel displays normally); cross-boundary (normal↔encrypted, encrypted A↔encrypted B) blocked |
| database mirroring | Normal mirroring within an encrypted box; cross-boundary forbidden |
| Asset file rename | Not supported (desensitized-filename rename breaks the mapping) |
| Import | Supported: imported .sy.zip or Markdown files are auto DEK-encrypted before writing to disk |
| File history | Supported (must unlock the corresponding encrypted notebook before viewing; the history index stores no plaintext content) |
| Deleted notebook | Supported (ciphertext backup; restored verbatim) |
| Export | Supported (identical to normal notebooks; must unlock first, exports plaintext. Rejected when locked) |
| Sync | Unchanged (ciphertext in, ciphertext out, self-consistent) |

## 12. Security Boundary

**Security premise**: An encrypted notebook is **only secure when it is closed (locked)**. When closed, the DEK is not in memory, the encrypted SQLite database has been deleted, all plaintext caches have been cleared, and only ciphertext remains on disk — no path (including authenticated APIs, plugins, AI/LLM, MCP) can read plaintext. **When open (unlocked), the DEK is in memory**, and at that point every authenticated caller — APIs, third-party plugins, AI/LLM (including MCP, agents, semantic search) — can read plaintext content just like a normal notebook. Encryption protects "data at rest" and "unreachability when locked"; it **does not protect "visibility to authenticated callers while unlocked"**. Therefore: while unlocked, treat it as "a normal notebook in use"; the only protection is **locking after use**.

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
- DEK / plaintext caches in memory (cleared on lock)
- The content field of history indexes (left empty; neither plaintext nor ciphertext)

**API protection**:
- `/api/file/getFile`: refuses to read encrypted-box .sy (ciphertext is meaningless; prevents plugin mis-parsing)
- `/api/file/putFile`: refuses to write encrypted-box .sy (plaintext writes corrupt the ciphertext format)

## 13. AI / LLM Reachability

The visibility of encrypted notebooks to AI/LLM is determined entirely by the **lock state**; there is no functional-layer isolation.

**When locked**: the DEK is not in memory, so AI/LLM (including MCP, agents, semantic search, embedding vectorization) cannot read any encrypted content — the data lives in an independent encrypted SQLite database and is ciphertext on disk, unreadable without the key.

**When unlocked**: the DEK is in memory, so AI/LLM can read and search just like a normal notebook — MCP tools can list encrypted notebooks and their documents, read block content, run semantic search, etc., with no difference from a normal notebook.

Design stance: there is no "hide from AI" isolation at the functional layer, because such isolation is neither thorough nor easy to reason about. **The only reliable protection is locking** — once locked, the data is physically unreachable to any caller. Users only need to understand one rule: **lock sensitive content after use**.

## 14. Feature Limitations

An encrypted notebook is an island; some features are unimplemented because of their cross-notebook nature or dependence on global aggregation. These are feature boundaries, not performance or security trade-offs.

- **Flashcards / spaced repetition**: Decks and scheduling are cross-notebook and depend on the global SQLite database; not implemented.
- **Bookmarks**: Global aggregation view (scans the global siyuan.db); encrypted notebooks not integrated.
- **Tags**: Global aggregation view (scans the global spans table); encrypted notebooks not integrated.
- **Asset file rename**: Encrypted-box asset filenames are already desensitized to `uuid-blockID.ext`; renaming breaks the original-name mapping.

## 15. Performance Differences

| Operation | Normal Notebook | Encrypted Notebook | Reason |
|---|---|---|---|
| **Unlock (Mount)** | Instant | **~1 second delay** | Argon2id key derivation (intentionally slow for brute-force resistance) |
| **Open document** | Read disk + parse JSON | Read disk + AES-GCM decrypt + parse + encrypted-db query | Extra decrypt + encrypted-db query |
| **Save document** | Render JSON + write disk | Render JSON + AES-GCM encrypt + write disk | Extra encrypt |
| **Upload assets** | Stream to disk | Fully read into memory + encrypt + write | Cannot stream-encrypt; large files cause memory pressure |
| **Browse assets** | Direct ServeFile | Read disk + decrypt + output | Decrypts on every request, no browser cache |
| **database render** | Global blocktree + plaintext JSON | Encrypted blocktree + DEK-decrypt JSON | Extra JSON decrypt; batch IAL load routed by box |
| **database save** | Plaintext JSON to disk | DEK-encrypt + write | Extra encrypt |
| **In-notebook search** | FTS query on global SQLite database | FTS query on independent encrypted SQLite database | SQLCipher page-level decrypt ~5-10% overhead |
| **DB connections** | 1 global | 1 global + 2 per unlocked encrypted box | Each encrypted-db connection pool ~20 connections |
| **When locked** | No extra overhead | All caches cleared | Cold-start latency on next operation |

**Performance summary**:
- **Daily editing experience**: Nearly imperceptible. AES-GCM encryption/decryption is microsecond-level; document read/write is bottlenecked by disk IO.
- **Noticeable latency**: Unlock ~1s, large-asset browsing (full decrypt per request with no cache), first access after lock (cold start).
- **Zero impact on normal notebooks**: Encryption and routing logic short-circuits for non-encrypted boxes.

## 16. Usage Guide

### First-time enablement
1. Go to **Settings → Access authorization → Encrypted notebooks** and toggle it on
2. Set a master password (double input + risk confirmation). The master password is the unified key for all encrypted notebooks — **you must remember it; there is no recovery backdoor**
3. Once enabled, you can **create a new encrypted notebook** from the file-panel "more" menu (enter a name + master password → auto-unlocks and opens)

> Strength recommendation: 12+ characters, mixed case + digits + symbols. The stronger the master password, the higher the brute-force resistance (password strength is the only line of defense; there is no backdoor).

### Daily use: unlock and lock
- **Unlock**: Click a closed encrypted notebook → enter the master password → wait ~1 second (Argon2id derivation) → opens. Unlocking only affects that notebook; other encrypted notebooks stay locked
- **Lock**: Closing the notebook equals locking (DEK cleared + encrypted SQLite database deleted + plaintext caches cleared). **Locking after use** is the most important security habit — it minimizes the key's exposure time in memory
- **After restart**: All encrypted notebooks are force-closed; you must re-enter the master password to unlock (the DEK lives only in memory and is lost on restart)

> Important: An encrypted notebook is **only fully secure when locked**. While unlocked, every authenticated caller (APIs, plugins, AI/LLM including MCP) can read plaintext just like a normal notebook (see §12 Security premise).

### Changing the master password
Go to **Settings → Access authorization → Change master password**. Changing the password only re-wraps each box's WrappedDEK — **document data is not re-encrypted**, so it completes instantly. The key backup is auto-refreshed and synced after a password change.

### Multi-device sync
Encrypted-notebook ciphertext `.sy`/assets/database files sync along with the data (ciphertext in, ciphertext out, self-consistent); the global key material (MasterSalt etc.) is also automatically backed up to the sync directory. **No manual "enable" is needed on a new device after sync**:

1. Configure the same sync account on the new device and complete a sync
2. Sync pulls the key backup to the local machine; the kernel auto-restores the "enabled" state
3. Just click the encrypted notebook and enter the master password to unlock and use it

If the notebook still shows as locked on the new device after sync, that is normal — click it and enter the master password.

### Import and export
- **Import**: Supports importing `.sy.zip` and Markdown; content is automatically DEK-encrypted before writing to disk, identical to manually created documents
- **Export**: Identical to normal notebooks (must unlock first; exports plaintext). `.sy.zip`, HTML, Word, PDF, Markdown, etc. are all supported; export is rejected while locked

### What if I forget the password
**It cannot be recovered** — by design (no backdoor). Even if the ciphertext has been synced to the cloud, it cannot be decrypted without the master password. **You must remember the master password; using a password manager is recommended.**

### Recovering from a lost key backup
If both `conf/conf.json` and the key backup in the sync directory are lost (an extreme case), re-enabling the encrypted-notebook feature will be rejected with a prompt to restore the backup file. As long as you can recover `notebook-crypto-backup.json` from another synced device or a previously exported key file, you can import it via the "Import key" button (shown when not enabled), or manually put it back at `<workspace>/data/.siyuan/` and re-enable, then unlock with the master password matching that key.

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
5. **Backup**: Syncing ciphertext to the cloud is safe, but if the password is lost the backup is useless too
