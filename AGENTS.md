# AGENTS.md

Guidance for AI coding agents working in the **SiYuan** repository (思源笔记).
Read this before modifying anything. Source of truth for facts cited here is in
parenthesized file paths — verify before relying on them.

SiYuan is a privacy-first, block-based note-taking application: a Go HTTP/WebSocket
**kernel** (`kernel/`) plus a TypeScript **frontend** (`app/`) that ships as Electron
desktop, browser-desktop, browser-mobile, and an export-render library
(the `Protyle` global that renders code blocks / math / diagrams inside exported
HTML and the PDF preview window). Module path
`github.com/siyuan-note/siyuan`. License: **AGPL-3.0** (every source file carries the
header — preserve it on edits). Versions (Go, Node, Electron, app version) change
frequently — always read them from source instead of relying on a pinned value:
`kernel/go.mod`, `app/package.json`, `kernel/util/working.go`.

---

## 1. Required toolchain

| Tool | Version | Source of truth |
|---|---|---|
| Go | see `go` directive | `kernel/go.mod` |
| Node (+ pnpm) | see CI matrix | `.github/workflows/cd.yml`, `app/package.json` (`packageManager` field) |

Two build-time requirements that aren't separate installs (see §5 #1–2): the Go
build needs a C compiler with `CGO_ENABLED=1` (sqlite3 is cgo), and every
`go build` / `go test` must pass `-tags fts5`. Re-read the sources above before
pinning a version in commands or docs.

---

## 2. Related repositories (navigation)

SiYuan spans several repos. This repo (`siyuan`) holds the kernel + Electron/web
frontend; the others are separate projects with their own tooling.

| Repo | Role / what to know |
|---|---|
| `siyuan` | **This repo** — kernel + Electron/web/tablet UI |
| `siyuan-android` / `siyuan-ios` / `siyuan-harmony` | Native apps wrapping the gomobile kernel; build steps differ per platform — see each project's README |
| `siyuan-chrome` | Browser extension (web clipper); talks to the running kernel over HTTP only |
| `lute` | Markdown/Kramdown AST engine — the editor + `.sy` format; also the source of the bundled `lute.min.js`. **Lives under `$GOPATH/src/github.com/88250/lute`, not as a sibling repo** |
| `dejavu` | Data repo / sync engine (encrypted snapshots) |
| `riff` | Spaced-repetition (SRS) flashcard scheduler |
| `gulu` | General Go utility library (`gulu.Ret`, `gulu.JSON`, …) |
| `eventbus` | In-process event bus |
| `filelock` | Cross-platform file locking (`.sy` read/write) |
| `httpclient` | HTTP client wrapper (cloud / sync / bazaar calls) |
| `logging` | Leveled logging used throughout the kernel |
| `go-sqlite3` / `pdfcpu` | Maintainer's forks, pulled in via permanent `replace` in `kernel/go.mod` (keep those) |
| `epub` / `clipboard` / `go-humanize` / `vitess-sqlparser` / `dataparser` / `encryption` | Smaller Go libraries (export / clipboard / formatting / SQL parse / data parse / crypto) |

All Go libraries above are dependencies in `kernel/go.mod`. GitHub org: `siyuan-note/*`
for the `siyuan-` apps and most libs; `88250/*` for lute, gulu, and the forks.

### Cross-repo notes

- **Editing any Go dependency (Lute / dejavu / gulu / eventbus / riff / filelock /
  httpclient / logging / go-sqlite3 / pdfcpu / epub / …):** these are imported by the
  kernel as Go modules (`kernel/go.mod`). To test a local change, add a temporary
  `replace` in `kernel/go.mod` pointing at your local checkout — but **never commit that
  `replace`**; it breaks builds for everyone else. (`go-sqlite3` and `pdfcpu` already have
  permanent `replace` directives pointing at the maintainer's forks — keep those.)
- **Rebuilding `lute.min.js`:** it's the JS build of the Go `lute` project — generated
  upstream and checked into `app/stage/protyle/js/lute/`. Don't edit it here; change
  `lute`, rebuild, and copy the artifact in.
- **Mobile apps (`siyuan-android` / `siyuan-ios` / `siyuan-harmony`):** each is a
  separate native app that wraps the kernel built from this repo. For how to build,
  vendor the kernel binding, and wire everything up, **read each project's own README**
  — the toolchains and steps differ per platform and aren't documented here.
- **`siyuan-chrome`:** independent TypeScript project; it only interacts with a running
  SiYuan instance through the public HTTP API documented in `API.md`.

---

## 3. Repository layout

Top level (repo root):

| Path | Contents |
|---|---|
| `kernel/` | Go backend — server, data engine, API, all domain logic |
| `app/` | TypeScript frontend (Electron/web), built by webpack into `app/stage/build/` |
| `app/electron/` | Electron main process |
| `app/pandoc/` | Bundled pandoc binary (document conversion) |
| `app/appearance/` | Themes, icons, **i18n** (`appearance/langs/*.json`) |
| `app/stage/` | Build output served by the kernel |
| `app/changelogs/` | Per-version changelog markdown |
| `.github/` | `CONTRIBUTING.md` (+zh-CN), `SECURITY.md`, `CODE_OF_CONDUCT.md`, `PULL_REQUEST_TEMPLATE.md`, issue templates, `workflows/` |
| `scripts/` | Release packaging: `win-build.bat`, `darwin-build.sh`, `linux-build.sh`, `parse-changelog.py`, `check-lang-keys.py` |
| `README*.md` | README in EN / zh-CN / ja / tr |
| `API*.md` | HTTP API reference in EN / zh-CN / ja |
| `CHANGELOG.md`, `Dockerfile`, `LICENSE` | — |

### Major `kernel/` packages (under `kernel/`)

| Package | Responsibility |
|---|---|
| `main.go` (`//go:build !mobile`) | Desktop entry point → `cli/cmd` |
| `cli/cmd/` | Cobra CLI subcommands (`serve`, `notebook`, `block`, `search`, `sql`, `export`, `repo`, `sync`, …) |
| `model/` | **Core domain** (~70 files): blocks/trees, transactions, notebooks, indexing, search, attribute views, export, history, sync, SRS flashcards, AI/embedding, CalDAV/CardDAV, auth middleware |
| `treenode/` | In-memory tree over the Lute AST + `blocktree.db` (`BlockTree{ID,RootID,ParentID,BoxID,Path,HPath,Type,...}`) |
| `av/` | **Attribute View** (database) engine: values, filters, sorts, layouts (table/kanban/gallery) |
| `sql/` | **Embedded SQLite** (`siyuan.db`, `history.db`, `asset_content.db`) + FTS5; async index queues |
| `search/` | FTS tokenizer helpers, CJK conversion (`hanconv.go`) |
| `bazaar/` | Marketplace: plugins/widgets/themes/icons/templates |
| `filesys/` | Read/write `.sy` files on disk (via `filelock`) |
| `server/` | Gin server bootstrap (`serve.go`): middleware, TLS/cmux, WebDAV/CalDAV/CardDAV, WebSocket, MCP |
| `api/` | HTTP route registration (`router.go::ServeAPI`, ~400 endpoints) + per-area handlers |
| `conf/` | Configuration structs |
| `util/` | Cross-cutting: `working.go` (workspace, `Boot()`), `lute.go`, `i18n.go`/`lang.go`, `websocket.go` (melody push), `result.go` (API envelope), etc. |
| `plugin/` | Plugin subsystem (kernel side) |
| `mcp/` | MCP (Model Context Protocol) server |
| `agent/` | AI agent runtime |
| `mobile/`, `harmony/` | `//go:build mobile` gomobile bindings for Android/iOS/HarmonyOS |

### Frontend (`app/src/`) highlights

| Dir | Purpose |
|---|---|
| `index.ts` | Main `App` class — boots SPA, opens main WebSocket, handles WS push events |
| `window/` | Detached Electron window variant |
| `protyle/` | **The block editor** — `wysiwyg/`, `toolbar/`, `gutter/`, `breadcrumb/`, `header/`, `hint/`, `scroll/`, `undo/`, `upload/`, `preview/`, `render/` (incl. `render/av/`) |
| `editor/`, `layout/`, `menus/`, `dialog/`, `config/`, `mobile/`, `ai/`, `sync/`, `history/`, `search/`, `card/` | Feature modules |
| `util/fetch.ts` | `fetchGet`/`fetchPost` — all kernel calls |
| `layout/Model.ts` | WebSocket client all UI binds to |
| `constants.ts` | Global constants (version, IDs, storage keys) |

Four webpack configs each emit a separate bundle to `app/stage/build/{app,desktop,mobile,export}/`.
The kernel's `serveAppearance` picks which bundle to serve based on User-Agent. The `export`
bundle is different from the other three: it is not an app UI — it is a client-side library
(global `Protyle`, entry `src/protyle/method.ts`) exposing renderers for code highlighting,
math (KaTeX), and diagrams (Mermaid/flowchart/graphviz/…). It is loaded by the HTML pages
assembled during export (`app/src/protyle/export/index.ts`) — the desktop PDF preview window
and standalone exported HTML files — so rich content renders outside the editor.

---

## 4. Critical "do not edit" artifacts

These are generated or checked-in binaries. **Never hand-edit**:

- `app/stage/protyle/js/lute/lute.min.js` — 3.6 MB **generated** Lute bundle (marked `linguist-vendored` in `.gitattributes:1`). Edit the upstream `github.com/88250/lute` Go project instead and rebuild.
- `app/stage/build/**` — webpack output.
- `app/src/types/dist/**` — generated `.d.ts` (`gen:types`).
- `app/kernel/SiYuan-Kernel*`, `*.syso`, `kernel/kernel.aar` — checked-in build binaries.
- `app/pandoc/*` — bundled third-party binary.

When you change user-visible behavior, also update: `app/appearance/langs/*.json`
(i18n) and the matching `app/changelogs/` entry.

---

## 5. Common pitfalls

1. **Go build fails without `CGO_ENABLED=1`** and a working C compiler (gcc/mingw/musl). This is non-negotiable — sqlite3 is cgo.
2. **The `-tags fts5` flag is required** for every `go build` and `go test`, or the FTS5-dependent code won't compile.
3. **Use `pnpm`, never `npm install` / `yarn`** in `app/` — the lockfile and `packageManager` field are pnpm-specific.
4. **Do not edit `lute.min.js` or anything under `app/stage/`** — they are build outputs (see §4).
5. **Line endings are LF** for `.go`, `.ts`, `.json`, `.scss` (`.gitattributes`); ensure your editor doesn't convert to CRLF on Windows.
6. **i18n: new keys go at the top** of every `app/appearance/langs/*.json` object; add the key to **every** language file (use `en.json` as the reference; report an error when you can't produce a translation rather than silently copying the English).
7. **Windows scripting: prefer not to use PowerShell.** PowerShell isn't forbidden, but it isn't the recommended choice here. When you need to script or automate on Windows, prefer Node.js (`.js`/`.mjs`, runnable via `node`) or Python; reach for PowerShell only if those can't do the job.
8. **Don't run `npx webpack` to "verify" a frontend change.** A successful edit and the existing `pnpm run dev` watch are sufficient; webpack compilation verification is not required.
9. **i18n domain swap: `ld246.com` → `liuyun.io`.** The domain `ld246.com` (the Chinese community) must appear **only in `zh-CN.json`**. In every other language file (`en.json`, `ja.json`, …) use `liuyun.io` instead — do not let `ld246.com` leak into non-Chinese strings. Check this whenever a translated value contains a URL.
