# AGENTS.md

SiYuan repository guide. Module path `github.com/siyuan-note/siyuan`, license AGPL-3.0.

## 1. Start a task

- **Baseline:** Before each repository task, verify repository, commit, branch, and working tree. For latest-branch work, follow [Git rules](#git) and fetch relevant refs before analysis/editing. Honor requested commits, tags, and PRs: fixed-revision or historical work must not advance/synchronize the branch; fetch only to resolve the revision. If fetch is unavailable, disclose the known commit and freshness limit; read-only analysis may continue, not claim latest-baseline verification
- **Synchronization:** Follow repository branch and authorized-destination rules. Create an explicitly requested or repository-required task branch from the verified baseline; a worktree neither changes the default branch nor authorizes another push destination. Automatically fast-forward a development branch only if clean and merely behind. Divergent development branches may be rebased while preserving work; this grants no force-push authority. Read-only analysis does not authorize synchronization. If blocked, preserve work and report why; never discard, automatically stash, create merge commits, or silently change push destination
- **Follow-ups:** Reuse the verified baseline within a task; recheck after a substantial pause, repository/branch switch, or potentially relevant new commits. Unrelated conversation needs no fetch
- **Evaluate before implementation, proportionate to risk:** For major features, check compliance, licensing, privacy, and cost before design. Inspect relevant implementation, settings, snippets, shortcuts, APIs, or plugins and reproduce behavior where feasible. Check repository rules, encrypted compatibility, `.sy`, and API contracts. Assess proposed implementations against the user's goal/acceptance criteria even if a form such as JS is specified; honor constraints and disclose verification limits
- **Choose the smallest sufficient approach:** Preserve practices and compatibility; existing functionality, documentation, or no code change may suffice. Compare user effort, persistence, reversibility, and maintenance. For style-only workarounds, consider built-in-toggle CSS snippets before JS injection; explain enable/disable/undo where relevant
- **Before editing:** Briefly state the conclusion, evidence, and uncertainty; discuss alternatives only for meaningful tradeoffs. If the premise is false or implementation unwarranted, explain and ask unless existing instructions resolve the next step. Ask before changing goal/scope or deciding unresolved product, priority, or compatibility tradeoffs; never silently narrow/broaden the task. Otherwise proceed without another confirmation; an alternative implementation meeting the agreed goal and criteria needs no separate approval
- **Mechanical edits:** Unambiguous edits without behavioral/compatibility impact need no separate evaluation round, but still require applicable checks; renames, version bumps, and documentation are not automatically exempt

## 2. Operation and compatibility boundaries

- **Authorization:** Never `git commit` or `git push` unless explicitly asked; no exceptions
- **Product/runtime:** Never use `npx webpack` or `pnpm dev` for verification, or run `pnpm build` (it conflicts with the developer's manual `pnpm dev` and breaks bundles). Run `gofmt` after Go edits, but do not compile the kernel binary or restart its running instance; the developer does both. Isolated regression tests and contract generation are allowed, not replacing the product binary or restarting it
- **Generated files:** Edit sources and regenerate; do not hand-edit `app/stage/protyle/js/lute/lute.min.js` (upstream `88250/lute`), `app/stage/build/**`, `app/src/types/dist/**`, `app/kernel/SiYuan-Kernel*`, `*.syso`, `kernel/kernel.aar`, `app/pandoc/*`, or anything marked generated. Generate `app/changelogs/**` issue/PR lists with tooling; hand-written upgrade notices/overview prose follow [Changelogs](#changelogs). API declarations/schemas originate in `kernel/apicontract/`, attribute-view capabilities in `kernel/av/capabilities.go`; before changing either, read the [generation instructions and output inventory](docs/API-CONTRACTS.md#generation-and-verification), including Petal synchronization
- **Encrypted data:** Maintain encrypted notebooks as released functionality. Existing data is the compatibility baseline: preserve access/recovery; never require deletion/recreation or treat it as disposable. Document, asset, attribute-view, key-envelope, backup, history, and sync format changes must retain authenticated reads of supported existing formats or provide recoverable migration before removing a reader
- **Encrypted migrations:** Envelope, AAD-semantic, and key-derivation changes need an explicit format version and compatibility plan. Authenticate migration sources, preserve recovery material, and remain recoverable after failure/interruption; never regenerate MasterSalt or discard keys to bypass incompatibility. Unknown formats, corruption, or authentication failure must preserve data and return errors, never bypass authentication or fall back to plaintext. Rebuild derived indexes only after source ciphertext authenticates
- **Encrypted regressions:** Format changes require supported-previous-format fixtures covering affected read/export/history/backup/recovery paths. Keep compatibility policies in `docs/ENCRYPTED-NOTEBOOK.md` and `docs/ENCRYPTED-NOTEBOOK.zh-CN.md` aligned

## 3. Verification and test maintenance

- **Final frontend checks:** After frontend code changes, run `pnpm run lint` in `app/` (types, auto-fixing ESLint, CSS/menu/startup-language checks, not behavioral tests). Review its diff, keeping fixes in scope and preserving work. Read-only tasks instead use applicable non-mutating checks such as `pnpm run typecheck` and ESLint without `--fix`/`--cache`; never auto-fixing lint
- **Scope:** Cover changed behavior, including non-API Go, frontend interactions, and scripts; select by impact/risk, not automatically full-suite. Lint/formatting alone does not prove behavior. Consult `app/scripts/test.mjs` and maintenance guides for discovery/commands
- **Preview before execution:** In `app/`, use `pnpm run test:changed --explain`; inspect baseline, count, and representative dependency chains. Default `HEAD` compares the working tree; use `--base <revision>` for committed branch changes. `pnpm run test:affected` executes selected tests, tracing imports and source paths tests read/evaluate. Use `pnpm run test:focused <test-file> [...]` for a justified explicit selection; file arguments do not narrow full-suite `pnpm test`
- **Coverage safeguards:** Investigate unexpectedly broad selections before running; never truncate real dependencies to meet a size target. Broaden checks for uncertain coverage from unmapped changes/dynamic dependencies; run the full suite for changes spanning many modules or shared setup
- **Docs and reporting:** For documentation-only changes, check accuracy, links, language alignment, and diff, not auto-fixing code checks. Report scope, passed/failed/unrun checks, limits, and unverified behavior; successful CI/release alone does not prove tests passed
- **Keep tests in sync:** Update tests/fixtures in the same change as code/files. Rename/move/merge/split/delete tests with their source; names must reflect coverage, and stale names or removed-source tests must be repaired/removed. For intentional behavior changes, update assertions, case names, and comments instead of dropping coverage; remove only obsolete cases, preserving adjacent assertions
- **Doubles and failures:** Remove mocks of deleted exports/constants/flags/helpers and assertions kept alive by stale stubs. Unrelated existing failures do not excuse new mismatches: report them separately and check whether the change affected their outcome
- **Merging and rerunning:** Merge test files only for the same subject, eliminating duplication without losing cases/discoverability; otherwise keep them separate. Run affected tests after synchronization and name updated, merged, or deleted files/cases
- **Browser checks:** Open `/stage/build/desktop/`, not `/`. `kernel/server/serve.go` selects bundles by User-Agent; `Electron` UAs (including VSCode's browser) redirect to Electron-only `/stage/build/app/`, causing `require is not defined` in plain browsers. The Electron main window has no remote-debugging port by default

## 4. Code and product conventions

### Scripting and source style
- Confirm the shell before using Bash/zsh/PowerShell syntax such as `&&`, heredocs, or `/dev/null`. For simple sequences, use separate calls with their working directory set, not chained `cd`; for multi-step logic, use a temporary Node.js/Python script. Avoid PowerShell on Windows unless necessary
- Never pass non-ASCII text through shell pipelines, PowerShell here-strings, `python -c`, or `node -e`; create a UTF-8 file with a file-editing tool and read it instead
- **Comments:** Chinese, wrapped at 120 characters, describing current behavior, not history/comparisons (`不再创建`、`保留旧行为`). Remove comments restating statements, function summaries, or sequence/name/condition/order labels already evident in code. Put implementation details at definitions and flow reasons at calls, without repeating facts. Keep issue links only to explain a current rule. Exception: deprecated data fields/migrations must identify the older shape they read
- **TypeScript/JavaScript:** semicolons, double quotes, spaces. After moving/extracting a symbol, update all callers to import its defining module; do not retain forwarding re-exports merely to avoid updating callers

### UI, CSS and icons
- No `:has()` (performance). Expand groups to comma-separated selectors, not `:is()` (extra matching cost) or `:where()`; use `:where()` only to reduce a single selector's specificity
- Before adding/styling controls, reuse components, markup, shared styles/modifiers in `app/src/assets/scss/component/` (`b3-button`, `b3-select`, `b3-text-field`); use `block__icon` for established icon buttons. Inspect/reuse existing menu, dialog, tooltip and drag implementations/APIs before feature-specific replacements
- Menu single-choice enumerations use checked submenu items, not embedded selects: parent right-arrow, desktop hover, mobile tap, existing menu positioning/implementation
- Feature styles express layout (placement, widths, gaps, wrapping), not duplication/overrides of shared-control height, padding, typography, colors, borders, shadows or interaction states. Do not use deeper selectors, inline styles or `!important` merely to restyle controls
- If controls cannot meet a requirement, explain why; prefer reusable shared extensions/modifiers. Scope necessary feature exceptions narrowly, use theme variables, preserve keyboard focus/disabled feedback and useful feature classes as theme hooks. Do not repurpose unrelated components (e.g. menus for forms) and cancel their styles
- Review shared-control consistency, shared-class theme overrides, light/dark themes, narrow layouts and large editor fonts. Preserve required layout/touch targets; do not indiscriminately remove feature styles
- Shared-container `position`/`transform`/`contain`/`overflow` changes require checks of descendant reference frames, overlay coverage and clipping. Prefer a dedicated positioning container for local controls. For settings dialogs, check detail overlays, top drag area and scrollbar placement at different widths
- Do not hand-write SVG. Prefer `app/appearance/icons/litheness/icon.js`; if unsuitable, use official [Lucide](https://lucide.dev/icons/) paths unchanged, adapting only attributes such as stroke width to match the existing style. Add new icons' previews to `app/appearance/icons/index.html` in matching order
- Shared desktop/mobile changes must inspect and update `app/src/mobile/` in the same task, including menus, toolbars, dialogs, interactions and handlers. Verify both implementations/shared dependencies and platform-appropriate interaction; explain any desktop-only change or absent mobile equivalent

### Configurable menus and docks
- Menu `data-id` and stable dock keys are persisted identifiers; renaming/reuse requires same-change visibility/order migration. Resolve docks with `getDockEntryKey` in `app/src/config/entryVisibility/catalog.ts`: prefer `data-entry-id`, map plugin runtime types to plugin-name/dock-ID keys, fall back to built-in `data-type`
- Add/remove/rename/move or mapping changes require same-change catalog updates (type, hierarchy, label, Simple default, default position) and tests. Register each configurable separator with stable `data-id` and type `separator`; catalog order must match declarations to preserve built-in order and custom-profile insertion
- Keep parent/child paths aligned. Use `dockOrder.ts`'s six scopes for dock visibility/order/movement, not ordinary menu siblings. Preserve placement, hidden entries, unavailable plugin slots and profiles lacking dock orders
- Test catalog consistency, separators, order migration and plugin slots; no leading/trailing/consecutive separators. `ignore` controls conditional rendering, not exemption from visibility/order configuration

### Configuration, attributes and storage
- Set defaults in constructors (`NewAppearance`, `NewEditor`, `NewFileTree`, etc.); shared normalization fills missing containers/values. `InitConf` only projects runtime state and performs versioned migrations; no startup function to patch one default
- Old `conf.json` lacks new keys and sections unmarshal to zero values. Plain `bool` is valid only for default-false (except below); default-true requires `*bool`, non-zero enum defaults `*int`: initialize in constructors, retain normalization's `nil` branch and saved `false` (`FileTree.CreateDocAtTop`, `Editor.CheckBlockRef`, `Search.HanSensitive`)
- Exception: default-true plain `bool` is valid when old workspaces must remain false and new ones true (`Appearance.MenuMouseScroll`): zero value serves old workspaces, constructor value new ones
- `POST /api/setting/set<Section>` merges into current settings: omitted fields retain values; `null` restores defaults. Declare `Merge` on `SettingWrite`, not per-field preservation branches; decode from constructor defaults so `null` never becomes a zero value. Keep API request/response `*bool` where wire `null` matters even with persisted plain `bool` (`apicontract.SettingFileTree`)
- Non-zero legacy defaults (`OCR.Auto`) belong in the load path that knows whether `conf.json` existed, not globals read by constructors/normalizers. Treat an existing segment missing the decisive field like a missing segment
- DOM/UI-only attributes use `data-`, without extra `sy` (e.g. `data-ui-density`); built-in persisted notebook/document/block attributes use `custom-sy-`. Preserve existing persisted names/compatibility; DOM renames must not rename them. Define constants in `app/src/constants.ts` beside similar `Constants`, not feature modules
- Never directly use browser `localStorage`, including `window.localStorage`/`globalThis.localStorage`. New user-facing settings/reader/panel preferences default to `conf.json`: corresponding namespace, kernel normalization, writes through `createConfigNamespaceApi().patch`
- Reserve `local.json` for growing document/view/transaction-ID mappings, transient/session state (scroll, dialog geometry, restored tabs), usage/reading history and plugin runtime state. Frequency does not determine storage: `uiLayout` already updates frequently with silent notifications. Neither file syncs; configuration export includes `conf.json`
- Read `window.siyuan.storage`; update memory and persist via `setStorageVal` in `app/src/protyle/util/compatibility.ts` to workspace `data/storage/local.json`. Do not observe this store with browser `storage` events

### Platform identification
- Use `applyPlatformClasses()` from `app/src/protyle/util/compatibility.ts` and its mutually exclusive body classes: `body--mac`, `body--windows`, `body--linux`, `body--ios`, `body--android`, `body--harmony`. Legacy `body--win32`/`body--win32-browser` are only for existing third-party themes: no new code or consumers
- Never infer frontend platform from kernel container or `data-backend` (a remote kernel reports its own host). Root `data-frontend` identifies form (`desktop`, `desktop-window`, `mobile`, `browser-desktop`, `browser-mobile`) for built-in/theme CSS; root `data-backend` is third-party-JavaScript-only, never built-in CSS

### API contracts
- Follow [docs/API-CONTRACTS.md](docs/API-CONTRACTS.md) for kernel HTTP APIs. Define new endpoints in `kernel/apicontract/`, bind with `contractHandler`, and synchronize existing contracts. Every route needs a typed contract; delete registration and contract together. Never bypass checks with `any`/assertions
- Preserve input compatibility, response variants, authorization and encrypted-notebook leases; add affected regressions
- Contract-source comments document behavior, defaults, constraints and compatibility; synchronize plugin-facing declarations in `petal` under its documentation rule below. User instructions belong in bundled guides
- `docs/API-CONTRACTS.md` and translations are maintenance guides, not routine feature/endpoint behavior, summaries, results or focused commands. Update only for contract mechanism, compatibility policy, generation or test-discovery/verification changes, or explicit user request; align translations
- New endpoints enter `docs/API.md`, `docs/API.zh-CN.md`, `docs/API.ja.md` only on explicit request; contracts, generated declarations and regressions remain required. Existing endpoint request/response/documented-behavior changes require checking and updating affected entries in all three; do not assume identical endpoint coverage. These scope rules override broader maintenance-guide documentation instructions
- After contract changes, run `pnpm run api:generate --petal ../../petal` and `pnpm run api:check --petal ../../petal` from `app/`; verify Petal under cross-repo rules first. The example path is relative to the generator's `kernel/` directory and assumes sibling `petal`; substitute the verified path. Synchronize public Petal declarations; never hand-edit generated declarations/schemas
- Run `pnpm run lint` in `app/`, `go test ./apicontract/...` in `kernel/`, and applicable compatibility/route coverage tests from the guide. Verify CI/documented commands discover new regressions; existing automatic/full-suite discovery suffices without doc edits. Change selections/commands only if they would miss tests. Report task commands/results in the response or PR

### Source headers
`kernel/**/*.go` and `app/electron/main.ts` start with these exact lines, then a blank line:
```
// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later
```
- Other-language sources have no header; remove existing ones rather than extend the convention. `//go:build` follows a blank line after the header and needs another before `package` or its constraint silently stops applying
- Exempt `kernel/plugin/encoding/` (`grafana/sobek-webapi-encoding`, Apache-2.0) and `kernel/heif/internal/h265heic/` (`roticv/h265`, MIT): retain their own licenses
- Before committing header changes, run `scripts/check-license-headers.mjs` (both directions; scopes in `scripts/license-header.mjs`); CI's check is non-blocking

## 5. Language and documentation

### i18n
- Add new keys at the top of every `langs/*.json` object (reference `en.json`), except `_kernel`: append at the end with the next numeric key. Indent with one tab/level, no spaces. Translate each language; do not copy identical text across languages
- Ellipses are three ASCII periods (`...`), never `…`/`……`. Setting-description tips and user-facing errors have no terminal period/equivalent (`.`, `。`, `।`); preserve inter-sentence punctuation, including `_kernel` errors
- Use `ld246.com` only in `zh-CN.json`, `liuyun.io` elsewhere
- In `zh-TW` and the Traditional Chinese guide, Block is `區塊` (also `子區塊`, `程式碼區塊`, `區塊 ID`), never `塊`; count with `個區塊`. Block Reference is `區塊引用`, Blockquote `引述區塊`; retain unrelated terms such as `分塊` (chunks) and `覈取方塊` (Checkbox)
- Preserve `_kernel` Go format argument positions/verbs from `en.json`; use explicit indexes (`%[4]s`, `%[3]d`) for reordered translations and retain literal `%%`. After i18n edits run `python scripts/check-lang-keys.py` for key completeness and format compatibility

### Writing and guides
- Use language-appropriate punctuation in UI, comments, guides and docs (Chinese ，。：；！？「」); UI text/punctuation belongs in i18n, not hard-coded. Across all contexts, navigation levels use ` - ` (`设置 - 快捷键 - 通用`), never arrows (`→`). Do not hand-wrap Markdown paragraphs, list items or table rows
- Change wording only when necessary, following nearby style and preserving guidance/warnings. Put instructions by their control or guide section, not feature lists/implementation details in general descriptions
- Follow `docs/SY-FORMAT.md`. User-visible code changes require same-change checks of relevant sections in all four bundled guides, including changed/removed/reverted capabilities; remove/revise obsolete descriptions with the implementation
- Synchronize English `app/guide/20210808180117-6v0mkxr`, Simplified Chinese `app/guide/20210808180117-czj9bvb`, Traditional Chinese `app/guide/20211226090932-5lcq56f`, Japanese `app/guide/20240530133126-axarxgx`. Before finishing, enumerate language directories and verify each counterpart; never omit Japanese or locate counterparts only by Chinese/English title matching
- Translate content, preserve document/block IDs, generate fresh IDs for new blocks and validate changed `.sy` JSON. Developer `docs/` cannot substitute for bundled guides. Shortcut changes require guide updates; ask if the section is unclear
- Guide prose outside lists ends with appropriate punctuation (`.`, `。`, `?`, `！`) or a colon before following content. Do not mechanically punctuate headings, navigation/reference directories, short labels, standalone links, code/formulas/technical syntax. List items have no terminal period/equivalent
- Guide UI paths use one `NodeTextMark` with `TextMarkType: "kbd"` per level, separated by plain `NodeText` ` - `. In every language, use one ASCII space between a kbd path and adjacent prose, except block boundaries, after full-width punctuation or before punctuation; half-width punctuation before it still requires a space. Preserve internal ` - ` spaces
### Changelogs
Align current guides/unreleased prose with code, including removals/reversions; generate issue/PR lists with tooling. Revise released notes only on explicit request, synchronizing translations and published copies

## 6. Git, releases and external communication

### Git
- In `siyuan-note/siyuan`, baseline/default work branch is `dev`; if unavailable, use the verified default branch. No commits/pushes to `master` while `dev` exists; `master` is allowed only if `dev` is unavailable and `master` is verified default
- For direct commits/authorized pushes, use the selected baseline as work/commit/push branch unless a task branch is explicitly requested. For an explicitly requested ordinary development PR, create a task branch from the verified baseline before editing; use it as head even when pushing to a fork. Never use a shared baseline or its fork mirror as PR head except for official releases below. Verify the head before creating a PR (GitHub cannot change it). Branch creation grants no commit/push authority; uncommitted work, remote lag or isolation alone do not justify creating/pushing a task branch
- Other repositories follow their own rules; absent rules, prefer existing local/remote `dev`, otherwise the actual default branch. Do not extend SiYuan's `master` ban or assume defaults are named `master`/`main`
- If user instructions, repository rules and branch information do not determine the branch confidently, ask and wait before editing/committing/pushing. Before editing verify repository/branch; before each authorized commit/push recheck branch and, for pushes, destination remote/branch, not just upstream. Switch to the selected work branch or explicitly requested PR/task branch before edits; preserve work, never reset/discard to switch
- Follow recent commit style: English gitmoji + subject. Only for an existing related issue/PR, append its full URL to the title, never the body or `#NNN`; do not fabricate URLs. PR titles are English descriptions of the final change without gitmoji/emoji or copied commit URL suffixes
- **Official releases:** before release work, read and follow [docs/RELEASE-VERIFICATION.zh-CN.md](docs/RELEASE-VERIFICATION.zh-CN.md) for preparation, build verification, integration and history sync. Keep the verified build `dev` commit fixed until release PR merge; if it advances, stop and reconcile inputs. Authorized release integration alone permits `dev` head/`master` base; use a merge commit, reporting settings that prohibit it rather than substituting squash/rebase. Verify resulting `master` tree against the package-build commit before tagging
- **Release history:** before further development, merge released `master` back to `dev`, preserving both histories and checking unchanged released code when no subsequent changes occurred. This requires merge authorization and explicit push authorization; it grants no direct master commit/push, unrequested PR merge, tag, upload or publication authority

### GitHub
- Prefer `gh` for all operations (issues, comments, PRs, commits, statuses, metadata); use API/web only if unavailable/unsupported
- SiYuan-maintained dependencies used by SiYuan have issues in `siyuan-note/siyuan`: identify dependency, implementation and cross-repo work; implement/test in the dependency repo and link commits/PRs back. Do not duplicate issues there or move existing issues without explicit authorization
- SiYuan issues: English title; Chinese body beginning with its Chinese title; task-specific prose, no repository templates/form fields. Retain relevant problem, reproduction, expected/actual behavior, evidence, approach, constraints, compatibility, alternatives/tradeoffs, acceptance criteria and open questions. Remove repetition/unrelated text, not information needed to understand, evaluate or implement
- Other repositories: first read `.github/ISSUE_TEMPLATE/` forms/Markdown and PR template, use the appropriate one and fill required sections; SiYuan's language/template exceptions do not apply. Separately confirm issue/PR acceptance and destinations (gopls issues use `golang/go`, not `golang/tools`); mirror status or disabled issues does not establish PR acceptance
- Renaming an issue: place its replaced title first in the body, followed by a blank line, leaving the remaining body unchanged
- Replies: explain conclusions/evidence with task-proportionate implementation, behavior, compatibility and unresolved details. Report only performed checks and supported conclusions, not unperformed tests; disclose material verification gaps without implying broader coverage. Omit routine logs/unrelated commands; after implementation invite testing/feedback. Chinese bodies get Chinese replies; others get the body's language plus Chinese
- Published text must stand alone. Relative references ("previous comment", "earlier estimate", "last time", "as above") require confirmed, unambiguous, linked content on the same item. Edit existing text in place to state corrected facts, not narrate corrections; verify remote existence/counts before mentioning prior comments/edits/discussions or their number
- Labels may accompany supported create/update payloads. Verify identity and requested non-label changes (title/body/state/base branch); **only labels** are exempt: do not check their application, send label-only follow-ups or claim verification. GitHub may silently drop them without push access
- For non-ASCII GitHub writes on Windows or with uncertain shell encoding (not ASCII-only requests): create UTF-8 JSON with a file-editing tool, not inline shell; use a unique OS-temp path such as `siyuan-gh-<operation>-<timestamp>.json`, never leave payloads in the repo. Call `gh api --method <method> "<endpoint>" --input "<absolute-json-path>"`; inspect response and read back with `gh api`. Prefer parsed-field comparison to payload, preserving line breaks, non-ASCII, meaningful edge whitespace and blank lines; CRLF may normalize to LF. For `--jq` text reads, one field/call (`.title`, `.body`), removing only the command's final line terminator. Keep payload until comparison passes; then remove payload/read-back files and confirm removal
- Prefer direct `gh` stdout capture via Node/Python and UTF-8 decoding. PowerShell saves must use `Out-File -Encoding utf8`; Windows PowerShell 5.1 `>`/`Out-File` default to UTF-16LE and UTF-8 includes a BOM that readers must handle. If pipeline decoding already corrupted text, use direct capture; output encoding cannot repair it
- Omit `--jq` on writes: it runs locally after the request, so failure can follow a successful write. Verify fields via separate reads, and confirm remote state before retrying any failed write to avoid duplicate side effects
- **Issue titles:** always English when requested, never start `Fix`. Bugs describe symptoms objectively; improvements prefer `Improve ...`, new capabilities `Support ...`; infer unclear type from content. These wording rules do not authorize labels

### LD246 and response language
- Use `User-Agent: SiYuan-Coding-Agent` for `ld246.com`. Details: `GET https://ld246.com/api/v2/article/{articleId}?p=1` (`data.article`; `p` paginates replies). Markdown: `GET https://ld246.com/article/raw/{articleId}`
- Reply: `POST https://ld246.com/api/v2/comment` with JSON `articleId`, `commentContent`, optionally `commentOriginalCommentId` when replying to an existing comment. Update own reply: `PUT https://ld246.com/api/v2/comment/{commentId}` with `commentContent`; use `commentContentType: "markdown"` for Markdown, omit `commentVisible` to preserve visibility. Read back and verify updates
- Authenticate with `Authorization: token <LD_TOKEN>` from environment (Windows: process, user, machine scopes in order); never expose token or rely on UA exemptions. Check HTTP status and JSON `code` (`0` success); report missing credentials/auth errors
- Match the user's language; do not mix languages mid-sentence except proper nouns/identifiers

## 7. Toolchain and repository reference

- Versions: Go directive in `kernel/go.mod`; Node/pnpm from `.github/workflows/cd.yml` and `app/package.json` (`packageManager`). Product versions also appear in `kernel/util/working.go`
- Architecture: Go kernel (`kernel/`) + TypeScript/Electron/web frontend (`app/`). `app/appearance/`: themes/icons/i18n (`appearance/langs/*.json`); `app/stage/`: kernel-served builds; `app/changelogs/`: version Markdown; `.github/`: contribution/security/templates/CI; `scripts/`: release packaging/changelog/language checks

| Kernel path (under `kernel/`) | Role |
|---|---|
| `main.go` (`//go:build !mobile`), `cli/cmd/` | Desktop entry delegates to Cobra CLI |
| `model/` | Blocks, transactions, indexing/search, attribute views, export/history/sync, flashcards, AI, CalDAV/CardDAV, auth |
| `treenode/` | Lute AST tree + `blocktree.db` |
| `av/` | Attribute View values/filters/sorts, table/kanban/gallery |
| `sql/` | SQLite (`siyuan.db`, `history.db`, `asset_content.db`), FTS5, async index queues |
| `search/`, `bazaar/` | FTS/CJK (`hanconv.go`); marketplace plugins/widgets/themes/icons/templates |
| `filesys/` | `.sy` read/write via `filelock` |
| `server/` | Gin `serve.go`: middleware, TLS/cmux, WebDAV/CalDAV/CardDAV, WebSocket, MCP |
| `api/`, `conf/` | HTTP `router.go::ServeAPI` + handlers; config structs |
| `util/` | `working.go` workspace/Boot, `lute.go`, `i18n.go`, `websocket.go` melody, `result.go` API envelope |
| `plugin/`, `mcp/`, `agent/` | Kernel plugins, MCP server, AI agent runtime |
| `mobile/`, `harmony/` | `//go:build mobile` gomobile bindings for Android/iOS/HarmonyOS |

| Frontend path (under `app/src/`) | Role |
|---|---|
| `index.ts`, `window/` | App SPA boot/main WebSocket/push; detached Electron windows |
| `protyle/` | Block editor; rich rendering in `render/`, AV in `render/av/` |
| `editor/`, `layout/`, `menus/`, `dialog/`, `config/`, `mobile/`, `ai/`, `sync/`, `history/`, `search/`, `card/` | Feature modules |
| `util/fetch.ts`, `layout/Model.ts`, `constants.ts` | Kernel `fetchGet`/`fetchPost`; shared UI WebSocket client; version/ID/storage constants |

Four webpack configs emit `app/stage/build/{app,desktop,mobile,export}/`; kernel `serveAppearance` chooses by User-Agent. `export` is the code/math/diagram rendering library (`Protyle`, entry `app/src/protyle/method.ts`); `app/src/protyle/export/index.ts` pages load it for desktop PDF preview and standalone HTML export.

| Related repo | Role/constraint |
|---|---|
| `siyuan-android`, `siyuan-ios`, `siyuan-harmony` | Native gomobile wrappers; read each README for build/bindings/integration |
| `siyuan-chrome` | Independent TypeScript web clipper; kernel access only via HTTP API in `docs/API.md` |
| `siyuan-testing` | Playwright for running SiYuan; data only in `SiYuan Testing` notebook; follow its `AGENTS.md` |
| `petal` | SiYuan Plugin API declarations, not a kernel Go dependency |
| `lute` | Markdown/Kramdown AST + `.sy`, source of `lute.min.js`; verify checkout, normally `$GOPATH/src/github.com/88250/lute`, not a sibling |
| `dejavu`, `riff` | Encrypted snapshots/sync; spaced-repetition flashcards |
| `gulu`, `eventbus`, `filelock`, `httpclient`, `logging` | General utilities, events, locking, HTTP, logging |
| `go-sqlite3`, `pdfcpu` | Maintainer forks; preserve permanent `kernel/go.mod` replacements |
| `epub`, `clipboard`, `go-humanize`, `vitess-sqlparser`, `dataparser`, `encryption` | Smaller format/clipboard/formatting/SQL/parsing/crypto libraries |

All listed Go libraries are `kernel/go.mod` dependencies. GitHub orgs: `siyuan-note/*` for `siyuan-` apps and most libraries; `88250/*` for lute, gulu and forks (`go-sqlite3`, `pdfcpu`).

**Cross-repo rules:**
- Before work, verify each checkout's path, identity, branch, baseline and existing changes under its own rules. If unavailable, finish independent work and report exact sync/verification blockers, not full synchronization. This grants no automatic repo creation/download authority
- Test local Go dependencies with temporary `kernel/go.mod` replacements; **never commit them**. Rebuild `lute.min.js` in `lute` with GopherJS, then copy to `app/stage/protyle/js/lute/`
- Changes to `app/src/types/` or other plugin-public TypeScript declarations/constants require same-task Petal synchronization. Every Petal change also adds a concise `petal/CHANGELOG.md` entry under the current unreleased version before committing
- Keep `petal/README.md` to title and `plugin-sample` link: no feature descriptions, API explanations or examples. Put API behavior/constraints/lifecycle in maintained Petal declaration comments and executable usage examples in actual `plugin-sample` code

