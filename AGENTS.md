# AGENTS.md

SiYuan repository guide. Module path `github.com/siyuan-note/siyuan`, license AGPL-3.0.

**Architecture:** Go kernel (`kernel/`) + TypeScript frontend (`app/`), plus a separate `export` bundle (global `Protyle`, entry `src/protyle/method.ts`) for rendering rich content in exported HTML / PDF preview. Read versions from `kernel/go.mod`, `app/package.json`, `kernel/util/working.go`.

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


## 4. Do not hand-edit

- `app/stage/protyle/js/lute/lute.min.js` (built from upstream `88250/lute`)
- `app/stage/build/**`, `app/src/types/dist/**`
- `app/kernel/SiYuan-Kernel*`, `*.syso`, `kernel/kernel.aar`
- `app/pandoc/*`

---

## 5. Project-specific rules

1. **i18n:** New keys go at the **top** of each `langs/*.json` object; add to every language file (reference `en.json`); sync `app/changelogs/` for user-visible changes
2. **Domains:** `ld246.com` only in `zh-CN.json`; use `liuyun.io` in all other languages
3. **Line endings:** LF for `.go`, `.ts`, `.json`, `.scss` (`.gitattributes`)
4. **Windows scripting:** Prefer Node.js / Python; avoid PowerShell unless necessary
5. **Frontend verification:** Do not use `npx webpack` to verify changes
