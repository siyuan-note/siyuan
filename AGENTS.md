# AGENTS.md

SiYuan repository guide. Module path `github.com/siyuan-note/siyuan`, license AGPL-3.0.

**Architecture:** Go kernel (`kernel/`) + TypeScript frontend (`app/`), plus a separate `export` bundle (global `Protyle`, entry `src/protyle/method.ts`) for rendering rich content in exported HTML / PDF preview. Read versions from `kernel/go.mod`, `app/package.json`, `kernel/util/working.go`.

---

## 1. Required toolchain

| Tool | Version | Source of truth |
|---|---|---|
| Go | see `go` directive | `kernel/go.mod` |
| Node (+ pnpm) | see CI matrix | `.github/workflows/cd.yml`, `app/package.json` (`packageManager` field) |

---

## 2. Related repositories (navigation)

SiYuan spans several repos. This repo (`siyuan`) holds the kernel + Electron/web frontend; the others are separate projects with their own tooling.

| Repo | Role / what to know |
|---|---|
| `siyuan` | **This repo** — kernel + Electron/web/tablet UI |
| `siyuan-android` / `siyuan-ios` / `siyuan-harmony` | Native apps wrapping the gomobile kernel; build steps differ per platform — see each project's README |
| `siyuan-chrome` | Browser extension (web clipper); talks to the running kernel over HTTP only |
| `siyuan-testing` | Playwright end-to-end tests for a running SiYuan instance; test data belongs in the `SiYuan Testing` notebook — see that repository's `AGENTS.md` |
| `petal` | SiYuan Plugin API declaration (the plugin system is named "petal"); consumed by plugins, not a kernel Go dependency |
| `lute` | Markdown/Kramdown AST engine — the editor + `.sy` format; also the source of the bundled `lute.min.js` (a GopherJS build served to the frontend). **Lives under `$GOPATH/src/github.com/88250/lute`, not as a sibling repo** |
| `dejavu` | Data repo / sync engine (encrypted snapshots) |
| `riff` | Spaced-repetition (SRS) flashcard scheduler |
| `gulu` | General Go utility library (`gulu.Ret`, `gulu.JSON`, …) |
| `eventbus` | In-process event bus |
| `filelock` | Cross-platform file locking (`.sy` read/write) |
| `httpclient` | HTTP client wrapper (cloud / sync / bazaar calls) |
| `logging` | Leveled logging used throughout the kernel |
| `go-sqlite3` / `pdfcpu` | Maintainer's forks, pulled in via permanent `replace` in `kernel/go.mod` (keep those) |
| `epub` / `clipboard` / `go-humanize` / `vitess-sqlparser` / `dataparser` / `encryption` | Smaller Go libraries (export / clipboard / formatting / SQL parse / data parse / crypto) |

All Go libraries above are dependencies in `kernel/go.mod`. GitHub org: `siyuan-note/*` for the `siyuan-` apps and most libs; `88250/*` for lute, gulu, and the forks (go-sqlite3 / pdfcpu).

### Cross-repo notes

- **Editing any Go dependency (Lute / dejavu / gulu / eventbus / riff / filelock / httpclient / logging / go-sqlite3 / pdfcpu / epub / …):** these are imported by the kernel as Go modules (`kernel/go.mod`). To test a local change, add a temporary `replace` in `kernel/go.mod` pointing at your local checkout — but **never commit that `replace`**; it breaks builds for everyone else.
- **Rebuilding `lute.min.js`:** it's the JS build of the Go `lute` project — generated upstream and checked into `app/stage/protyle/js/lute/`. Don't edit it here; change `lute`, rebuild, and copy the artifact in.
- **Mobile apps (`siyuan-android` / `siyuan-ios` / `siyuan-harmony`):** each is a separate native app that wraps the kernel built from this repo. For how to build, vendor the kernel binding, and wire everything up, **read each project's own README** — the toolchains and steps differ per platform and aren't documented here.
- **`siyuan-chrome`:** independent TypeScript project; it only interacts with a running SiYuan instance through the public HTTP API documented in `docs/API.md`.

---

## 3. Repository layout

Top level (repo root):

| Path | Contents |
|---|---|
| `kernel/` | Go backend — server, data engine, API, all domain logic |
| `app/` | TypeScript frontend (Electron/web), built by webpack into `app/stage/build/` |
| `app/appearance/` | Themes, icons, **i18n** (`appearance/langs/*.json`) |
| `app/stage/` | Build output served by the kernel |
| `app/changelogs/` | Per-version changelog markdown |
| `.github/` | `CONTRIBUTING.md` (+zh-CN), `SECURITY.md`, `CODE_OF_CONDUCT.md`, `PULL_REQUEST_TEMPLATE.md`, issue templates, `workflows/` |
| `scripts/` | Release packaging: `win-build.bat`, `darwin-build.sh`, `linux-build.sh`, `parse-changelog.py`, `check-lang-keys.py` |

### Major `kernel/` packages (under `kernel/`)

| Package | Responsibility |
|---|---|
| `main.go` (`//go:build !mobile`) | Desktop entry point → `cli/cmd` |
| `cli/cmd/` | Cobra CLI subcommands (`serve`, `notebook`, `block`, `search`, `sql`, `export`, `repo`, `sync`, …) |
| `model/` | **Core domain** (~70 files): blocks/trees, transactions, indexing, search, attribute views, export, history, sync, flashcards, AI, CalDAV/CardDAV, auth |
| `treenode/` | In-memory tree over the Lute AST + `blocktree.db` (`BlockTree{ID,RootID,ParentID,BoxID,Path,HPath,Type,...}`) |
| `av/` | **Attribute View** (database) engine: values, filters, sorts, layouts (table/kanban/gallery) |
| `sql/` | **Embedded SQLite** (`siyuan.db`, `history.db`, `asset_content.db`) + FTS5; async index queues |
| `search/` | FTS tokenizer helpers, CJK conversion (`hanconv.go`) |
| `bazaar/` | Marketplace: plugins/widgets/themes/icons/templates |
| `filesys/` | Read/write `.sy` files on disk (via `filelock`) |
| `server/` | Gin server bootstrap (`serve.go`): middleware, TLS/cmux, WebDAV/CalDAV/CardDAV, WebSocket, MCP |
| `api/` | HTTP route registration (`router.go::ServeAPI`, ~400 endpoints) + per-area handlers |
| `conf/` | Configuration structs |
| `util/` | Cross-cutting: `working.go` (workspace, `Boot()`), `lute.go`, `i18n.go`, `websocket.go` (melody push), `result.go` (API envelope) |
| `plugin/` | Plugin subsystem (kernel side) |
| `mcp/` | MCP (Model Context Protocol) server |
| `agent/` | AI agent runtime |
| `mobile/`, `harmony/` | `//go:build mobile` gomobile bindings for Android/iOS/HarmonyOS |

### Frontend (`app/src/`) highlights

| Dir | Purpose |
|---|---|
| `index.ts` | Main `App` class — boots SPA, opens main WebSocket, handles WS push events |
| `window/` | Detached Electron window variant |
| `protyle/` | **The block editor** — `wysiwyg/`, `toolbar/`, `gutter/`, `breadcrumb/`, `hint/`, `scroll/`, `undo/`, `preview/`, `render/` (incl. `render/av/`) |
| `editor/`, `layout/`, `menus/`, `dialog/`, `config/`, `mobile/`, `ai/`, `sync/`, `history/`, `search/`, `card/` | Feature modules |
| `util/fetch.ts` | `fetchGet`/`fetchPost` — all kernel calls |
| `layout/Model.ts` | WebSocket client all UI binds to |
| `constants.ts` | Global constants (version, IDs, storage keys) |

Four webpack configs each emit a separate bundle to `app/stage/build/{app,desktop,mobile,export}/`. The kernel's `serveAppearance` picks which bundle to serve based on User-Agent. The `export` bundle is different from the other three: it is not an app UI — it is a client-side library (global `Protyle`, entry `src/protyle/method.ts`) exposing renderers for code highlighting, math (KaTeX), and diagrams (Mermaid/flowchart/graphviz/…). It is loaded by the HTML pages assembled during export (`app/src/protyle/export/index.ts`) — the desktop PDF preview window and standalone exported HTML files — so rich content renders outside the editor.

---


## 4. Do not hand-edit

- `app/stage/protyle/js/lute/lute.min.js` (built from upstream `88250/lute`)
- `app/stage/build/**`, `app/src/types/dist/**`
- `app/changelogs/**` (generated by separate tooling)
- `app/kernel/SiYuan-Kernel*`, `*.syso`, `kernel/kernel.aar`
- `app/pandoc/*`

---

## 5. Project-specific rules

1. **i18n:**
   - New keys go at the **top** of each `langs/*.json` object; add to every language file (reference `en.json`)
   - Exception: inside the `_kernel` object, append new entries at the **end** using the next incremental numeric key
   - Each language must be properly translated — do NOT copy the same text across all language files
   - Use three ASCII periods (`...`) for ellipses in all localized strings; do not use Unicode ellipsis characters (`…` or `……`)
   - Domains: `ld246.com` only in `zh-CN.json`; use `liuyun.io` in all other languages
   - After modifying i18n files, run `python scripts/check-lang-keys.py` to verify key completeness across all language files
2. **Windows scripting:** Prefer Node.js / Python; avoid PowerShell unless necessary
3. **Frontend verification:** Do not use `npx webpack` or `pnpm dev` to verify changes; after changes, run `cd app && pnpm run lint` to check code style
4. **Frontend build:** Do NOT run `pnpm build` — the developer runs `pnpm dev` manually, and `pnpm build` will conflict with it, producing broken bundles
5. **Kernel development:** After modifying Go code, do not compile the kernel binary or restart a running kernel; the developer handles both manually
6. **Icons:** Do not hand-write SVG; use existing icons from `app/appearance/icons/litheness/icon.js` when possible
7. **User guide:** When editing the user guide, follow `docs/SY-FORMAT.md`
8. **Git:**
   - **NEVER** run `git commit` / `git push` unless explicitly asked — no exceptions
   - When you do commit, follow the style of recent commits (gitmoji prefix + subject, in English)
   - Append the full issue/PR URL to the end of the commit title (e.g. `https://github.com/siyuan-note/siyuan/issues/<NNN>`, not the `#NNN` short form — it is clickable) only when a related issue exists; never put the URL in the commit body, and do not fabricate one
9. **GitHub:** Prefer the GitHub CLI (`gh`) for all GitHub operations, including reading issues, comments, pull requests, commits, statuses, and metadata. If `gh` is unavailable or does not support the operation, fall back to the GitHub API or web interface
10. **Issue titles:** Whenever the user asks to generate an issue title, provide it in English regardless of the wording of the request; do not start it with `Fix`, and describe the observed behavior directly instead
11. **LD246:** When accessing `ld246.com`, set the HTTP `User-Agent` header to `SiYuan-Coding-Agent`

---

## 6. Coding conventions

1. **Comments:** Wrap code comments at 120 characters
2. **Comments:** Describe what the code does, not what it replaced — don't reference the old implementation in comments
3. **Comments:** Write comments in Chinese
4. **Punctuation:** Use language-appropriate punctuation (e.g. Chinese punctuation ，。：；！？「」 for Chinese, not ASCII); do not hard-code it in code — put it in the i18n language files so each locale renders its own. Applies to comments, user guide, `.md` docs, etc.
5. **Markdown:** Do not hand-wrap; keep each line (paragraphs, table rows, list items, etc.) on a single line
6. **TypeScript/JavaScript:** Semicolons required, use double quotes, indent with spaces
7. **Go:** Format with `gofmt` after editing

---

## 7. Response style

1. **Language:** Match the user's language; do not mix languages mid-sentence (keep proper nouns / identifiers in their original form)
