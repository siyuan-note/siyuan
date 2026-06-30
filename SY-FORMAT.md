# SiYuan `.sy` File JSON Structure — AI Read/Write Guide

> Spec baseline: `2` (current across all files).
> Verified against samples: `20200825162036-4dx365o.sy` (formatting elements), `20200905090211-2vixtlf.sy` (block types).
> All conclusions are based on real samples and the Lute / SiYuan kernel source. Fields marked `【inferred】` were not directly observed in the samples — re-verify against a real sample before generating them.
> Companion document: [`WORKSPACE.md`](./WORKSPACE.md) covers the overall on-disk layout of the workspace (how notebooks, parent/child documents, and assets are organized); this document focuses on the **internal** JSON structure of a `.sy` file.

## 0. In one sentence

A `.sy` file is a Lute AST tree serialized to JSON. The root node is always `NodeDocument`; the body is the `Children` array, recursively nested. There is no external schema — all state lives in the tree.

---

## 0.5 When to read/write `.sy` directly (priority order)

SiYuan offers three official paths to mutate data: **HTTP API, MCP, and CLI**. **Prefer them by default.** The kernel handles AST serialization, block-ID allocation, and synchronization of two indexes: the block-tree index (`blocktree.db`, the block-ID → file-path map that block refs and breadcrumbs depend on) and the full-text search index (`siyuan.db` + FTS5). Writing the files directly bypasses all of this and easily leaves the indexes out of sync.

**Only read/write `.sy` as JSON when the official paths are inconvenient.** Applicable scenarios:
- Bulk offline migration (cold-init a workspace, import external data; for the workspace's on-disk layout see [`WORKSPACE.md`](./WORKSPACE.md))
- Read-only statistics, analysis, custom export / format conversion
- Repairing low-level structural issues (legacy files, illegal nodes)
- Programmatic scaffolding / template generation

Division of labor among the four paths:

| Path | Role | Mutation capability |
|---|---|---|
| **HTTP API** | Online, at runtime | Richest — full CRUD on docs/blocks (`filetree/*`, `block/*`, `transactions`) |
| **MCP** | LLM tool set | Subset for AI agents operating on docs online |
| **CLI** | Batch / ops | Import, export, sync, SQL, and other command-line tasks |
| **Read/write `.sy` directly** | The scope of this guide | Offline, bulk, low-level structural work |

> ⚠️ After writing files directly you usually need a "rebuild index" pass before search/block-refs become effective. If SiYuan is running, prefer the HTTP API and let the kernel handle serialization and index sync.

---

## 1. Top-level structure

```json
{
  "ID": "20200825162036-4dx365o",
  "Spec": "2",
  "Type": "NodeDocument",
  "Properties": {
    "icon": "1f4f0",
    "id": "20200825162036-4dx365o",
    "title": "排版元素",
    "type": "doc",
    "updated": "20260616224229"
  },
  "Children": [ ... ]
}
```

| Top-level key | Required | Meaning |
|---|---|---|
| `ID` | ✅ | Document block ID. **Equals the filename without `.sy`** (not randomly generated) |
| `Spec` | ✅ | Always `"2"` |
| `Type` | ✅ | Always `"NodeDocument"` |
| `Properties` | ✅ | Document-level IAL — see §8 |
| `Children` | ✅ | Array of body child blocks; must contain at least one block |

> ⚠️ The file path strictly corresponds to the root ID: `data/<box>/<...>/<rootID>.sy`. Changing the root ID means renaming the file — don't change it casually. For the full file-system layout see [`WORKSPACE.md`](./WORKSPACE.md).

---

## 2. Common field semantics (apply to every node)

| Field | Type | Presence | Meaning |
|---|---|---|---|
| `Type` | string | **required on every node** | Type discriminator, e.g. `"NodeParagraph"` |
| `ID` | string | block nodes only | 22-char block ID; inline/marker nodes **do not carry it** |
| `Data` | string | some | Text / HTML / markdown raw; **may be omitted** (don't assume it exists) |
| `Properties` | object | most blocks | IAL, `map[string]string` |
| `Children` | array | container / nestable nodes | Child node array |
| Type-specific fields | - | per type | e.g. `HeadingLevel`, `ListData`, `TextMarkType`, `AttributeViewID` |

**Core discriminator rule:** whether a node has an `ID` determines whether it is a block. Has `ID` ⇒ block (its `Properties.id` must equal its `ID`); no `ID` ⇒ inline/marker node.

---

## 3. ID and timestamp rules

- **ID format:** `YYYYMMDDHHMMSS-xxxxxxx` = 14-digit timestamp + `-` + 7 random `[a-z0-9]` chars. Example: `20210104091228-ttcj9nm`.
- The **root ID** comes from the filename and is **not** regenerated.
- **Child block IDs** are generated with the above scheme.
- `Properties.updated` is the same 14-digit timestamp; semantics: "last updated time".
- When you change any block's `ID`, you must **sync** `Properties.id`. `Properties.updated` should be refreshed to the current time as well.

---

## 4. Node-type catalog

### Block nodes (have an ID)

**Leaf blocks:** `NodeParagraph`, `NodeHeading`, `NodeThematicBreak`, `NodeHTMLBlock`, `NodeCodeBlock`, `NodeMathBlock`, `NodeTable`, `NodeBlockQueryEmbed`, `NodeAttributeView`, `NodeIFrame`, `NodeVideo`, `NodeAudio`, `NodeWidget`, `NodeCustomBlock`, `NodeGitConflict`

**Container blocks:** `NodeList`, `NodeListItem`, `NodeBlockquote`, `NodeCallout`, `NodeSuperBlock`

### Inline / marker nodes (no ID)

`NodeText`, `NodeTextMark`, `NodeImage`, `NodeKramdownSpanIAL`, `NodeHeadingC8hMarker`, `NodeBlockquoteMarker`, `NodeTaskListItemMarker`, `NodeBang`, `NodeOpenBracket`, `NodeCloseBracket`, `NodeOpenParen`, `NodeCloseParen`, `NodeLinkText`, `NodeLinkDest`, `NodeCodeBlockCode`, `NodeCodeBlockFenceOpenMarker`, `NodeCodeBlockFenceInfoMarker`, `NodeCodeBlockFenceCloseMarker`, `NodeMathBlockContent`, `NodeMathBlockOpenMarker`, `NodeMathBlockCloseMarker`, `NodeSuperBlockOpenMarker`, `NodeSuperBlockLayoutMarker`, `NodeSuperBlockCloseMarker`, `NodeOpenBrace`, `NodeCloseBrace`, `NodeBlockQueryEmbedScript`, `NodeTableHead`, `NodeTableRow`, `NodeTableCell`

> Types disabled by SiYuan (footnotes / ToC / YAML / LinkRef / HeadingID, etc.) are listed in §11 and never appear in a `.sy` — they are intentionally excluded from this catalog.

---

## 5. Block types in detail (with copyable samples)

### 5.1 Paragraph

```json
{ "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
  "Children": [ { "Type": "NodeText", "Data": "This is a sample paragraph." } ] }
```

### 5.2 Heading

```json
{ "Type": "NodeHeading", "ID": "...", "HeadingLevel": 2,
  "Properties": { "id": "...", "updated": "..." },
  "Children": [ { "Type": "NodeText", "Data": "Heading" } ] }
```

- `HeadingLevel` ranges `1`–`6`.
- `NodeHeadingC8hMarker` (`Data` such as `"## "`) is **optional** — present or absent, both are legal. Recommend **omitting** it for brevity when generating.
- SiYuan recommends using **level-2 headings at the top of the body**, not level 1.

### 5.3 Lists (key: distinguish type via `ListData.Typ`)

> **★ Hard structural constraint of lists:** direct children of `NodeList` can **only** be `NodeListItem` (enforced by Lute's `CanContain`, `ast/node.go:993` `return NodeListItem == nodeType`). Paragraphs, code blocks, sub-lists, or any other block **cannot** be attached directly under `NodeList` — they must be wrapped in a `NodeListItem` first.

```
✅ Correct                       ❌ Wrong
NodeList                         NodeList
└─ NodeListItem                   ├─ NodeParagraph        ← illegal
   └─ NodeParagraph               └─ NodeCodeBlock         ← illegal
```

**Nested lists** are written by wrapping another `NodeList` (`NodeListItem` falls into the default `CanContain` branch and cannot directly contain another `NodeListItem`):

```
✅ Correct                       ❌ Wrong
NodeList                         NodeList
└─ NodeListItem                   └─ NodeListItem
   ├─ NodeParagraph                  ├─ NodeParagraph
   └─ NodeList  ← sub-list           └─ NodeListItem  ← illegal
      └─ NodeListItem
         └─ NodeParagraph
```

**Unordered list** (`Typ` omitted):

```json
{ "Type": "NodeList", "ID": "...", "ListData": {},
  "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeListItem", "ID": "...",
      "ListData": { "BulletChar": 42, "Marker": "Kg==" },
      "Properties": { "id": "..." },
      "Children": [
        { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "..." },
          "Children": [ { "Type": "NodeText", "Data": "Item one" } ] }
      ] }
  ] }
```

**Ordered list** (`Typ: 1`):

```json
{ "Type": "NodeListItem", "ID": "...", "Data": "1",
  "ListData": { "Typ": 1, "Tight": true, "Start": 1, "Delimiter": 46, "Padding": 3, "Marker": "MQ==", "Num": 1 },
  "Properties": { "id": "..." }, "Children": [ ... ] }
```

**Task list** (`Typ: 3`); the first child is a `NodeTaskListItemMarker`:

```json
{ "Type": "NodeListItem", "ID": "...",
  "ListData": { "Typ": 3, "Tight": true, "BulletChar": 45, "Padding": 2, "Checked": true, "Marker": "LQ==", "Num": -1 },
  "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeTaskListItemMarker", "TaskListItemChecked": true },
    { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "..." },
      "Children": [ { "Type": "NodeText", "Data": "Task one" } ] }
  ] }
```

### 5.4 `ListData` fields in full (★ easiest to get wrong)

| Field | Type (code) | JSON form | Meaning |
|---|---|---|---|
| `Typ` | int | number | **List type discriminator:** omitted = unordered, `1` = ordered, `3` = task |
| `Tight` | bool | boolean | Tight (no blank lines); optional |
| `BulletChar` | byte | number | Bullet **ASCII codepoint** for unordered/task lists (`42` = `*`, `45` = `-`) |
| `Delimiter` | byte | number | Ordered-list delimiter ASCII codepoint (`46` = `.`) |
| `Start` | int | number | Ordered-list start number |
| `Num` | int | number | This item's number; usually omitted or `-1` for unordered/task lists |
| `Padding` | int | number | Indent padding; optional |
| `Checked` | bool | boolean | Whether the task item is checked (aggregated at the list level) |
| `Marker` | []byte | **base64 string** | The marker text, **base64-encoded**; may include a delimiter (`"MS4="` = `1.`) or not (`"MQ=="` = `1`) |

> Key distinction: **`BulletChar`/`Delimiter` are `byte` in code and appear as int codepoints in JSON**; **`Marker` is `[]byte` in code and appears as a base64 string in JSON**. `Marker`/`BulletChar`/`Delimiter` all carry `omitempty` and may be omitted.

### 5.5 Task marker

```json
// Checked
{ "Type": "NodeTaskListItemMarker", "TaskListItemChecked": true }
// Unchecked
{ "Type": "NodeTaskListItemMarker" }
```

> In real `.sy` files, `NodeTaskListItemMarker` **usually has no `Data` field** (SiYuan rebuilds the marker from the DOM `data-task` attribute and doesn't keep the `[X]`/`[ ]` source): checked items carry only `Type`+`TaskListItemChecked`, unchecked only `Type`. If you do write `Data` by hand, the checked form should be uppercase `[X]` (not `[x]`) — but that's only used for normalized Markdown export.

### 5.6 Blockquote

```json
{ "Type": "NodeBlockquote", "ID": "...", "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeBlockquoteMarker", "Data": "> " },
    { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "..." },
      "Children": [ { "Type": "NodeText", "Data": "Quoted content" } ] }
  ] }
```

> `NodeBlockquoteMarker.Data` may be `">"` or `"> "` — both are legal.

### 5.7 Callout (GFM Alert)

```json
{ "Type": "NodeCallout", "ID": "...",
  "CalloutType": "NOTE", "CalloutTitle": "Note", "CalloutIcon": "✏️",
  "Properties": { "id": "...", "updated": "..." },
  "Children": [ { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "..." },
    "Children": [ { "Type": "NodeText", "Data": "Callout content" } ] } ] }
```

| `CalloutType` | `CalloutTitle` | `CalloutIcon` |
|---|---|---|
| `NOTE` | `Note` | `✏️` |
| `TIP` | `Tip` | `💡` |
| `IMPORTANT` | `Important` | `❗` |
| `WARNING` | `Warning` | `⚠️` |
| `CAUTION` | `Caution` | `🚨` |

> `CalloutIcon` is a **literal emoji character**, not base64, not a codepoint.

### 5.8 Super block (nestable; three-part structure)

```json
{ "Type": "NodeSuperBlock", "ID": "...", "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeSuperBlockOpenMarker" },
    { "Type": "NodeSuperBlockLayoutMarker", "Data": "col" },
    { "Type": "NodeSuperBlock", "ID": "...", "Properties": { "id": "..." }, "Children": [ ... nested super block, Data "row" ... ] },
    { "Type": "NodeSuperBlockCloseMarker" }
  ] }
```

> `NodeSuperBlockLayoutMarker.Data` can only be `"row"` (horizontal) or `"col"` (vertical). Super blocks can nest, and it is the only container that can hold any block (including itself).

### 5.9 Embed block (five-part structure `{{ ... }}`)

```json
{ "Type": "NodeBlockQueryEmbed", "ID": "...", "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeOpenBrace" },
    { "Type": "NodeOpenBrace" },
    { "Type": "NodeBlockQueryEmbedScript", "Data": "select * from blocks where id='20210428212840-8rqwn5o'" },
    { "Type": "NodeCloseBrace" },
    { "Type": "NodeCloseBrace" }
  ] }
```

### 5.10 Code block (four-part structure; fenced only)

```json
{ "Type": "NodeCodeBlock", "ID": "...", "IsFencedCodeBlock": true,
  "CodeBlockFenceChar": 96, "CodeBlockFenceLen": 3,
  "CodeBlockOpenFence": "YGBg", "CodeBlockInfo": "Z28=", "CodeBlockCloseFence": "YGBg",
  "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeCodeBlockFenceOpenMarker", "Data": "```", "CodeBlockFenceLen": 3 },
    { "Type": "NodeCodeBlockFenceInfoMarker", "CodeBlockInfo": "Z28=" },
    { "Type": "NodeCodeBlockCode", "Data": "package main\n...\n" },
    { "Type": "NodeCodeBlockFenceCloseMarker", "Data": "```", "CodeBlockFenceLen": 3 }
  ] }
```

Notes:
- `NodeCodeBlockCode` carries the code content (in `Data`, raw text with `\n` escaped); it's an inline child of `NodeCodeBlock`.
- The surrounding fence markers (Open/Info/Close) are likewise inline children.
- `CodeBlockInfo` is the **base64-encoded language** (`"Z28="` = `go`). The parent's seven fields (`IsFencedCodeBlock`/`CodeBlockFenceChar`/`CodeBlockFenceLen`/`CodeBlockOpenFence`/`CodeBlockInfo`/`CodeBlockCloseFence`) all carry `omitempty` and may be omitted as needed — newer `.sy` files often write only `"IsFencedCodeBlock": true`.
- SiYuan **does not support indented code blocks** (`SetIndentCodeBlock(false)`); all code blocks are fenced.

### 5.11 Math block (three-part structure)

```json
{ "Type": "NodeMathBlock", "ID": "...", "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeMathBlockOpenMarker" },
    { "Type": "NodeMathBlockContent", "Data": "a^2 + b^2 = c^2" },
    { "Type": "NodeMathBlockCloseMarker" }
  ] }
```

### 5.12 HTML / IFrame / Video / Audio blocks (leaf; content in the top-level `Data`)

```json
{ "Type": "NodeHTMLBlock", "ID": "...", "Data": "<div>\n<ruby>你<rt>nǐ</rt>...</div>", "Properties": { "id": "..." } }
{ "Type": "NodeIFrame", "ID": "...", "Data": "<iframe src=\"...\"></iframe>", "Properties": { "id": "..." } }
{ "Type": "NodeVideo", "ID": "...", "Data": "<video controls src=\"assets/x.mp4\"></video>", "Properties": { "id": "..." } }
{ "Type": "NodeAudio", "ID": "...", "Data": "<audio controls src=\"assets/x.wav\"></audio>", "Properties": { "id": "..." } }
```

> These four **have no `Children`**; the HTML content (JSON-escaped) goes directly in the top-level `Data`.

### 5.13 Table

```json
{ "Type": "NodeTable", "ID": "...", "TableAligns": [0, 0, 0],
  "Properties": { "id": "...", "colgroup": "||" },
  "Children": [
    { "Type": "NodeTableHead", "Data": "thead", "Children": [
      { "Type": "NodeTableRow", "Data": "tr", "Children": [
        { "Type": "NodeTableCell", "Data": "th", "Children": [ { "Type": "NodeText", "Data": "Header" } ] }
      ] }
    ] },
    { "Type": "NodeTableRow", "Data": "tr", "Children": [
      { "Type": "NodeTableCell", "Data": "td", "Children": [ { "Type": "NodeText", "Data": "Cell" } ] }
    ] }
  ] }
```

- Nesting is fixed: `NodeTable > NodeTableHead/NodeTableRow > NodeTableCell > inline`.
- `TableAligns`: int array of per-column alignment, `0` = default/left.
- `Data` (`thead`/`tr`/`th`/`td`) may be **omitted** in compact files.
- Column widths are stored in `Properties.colgroup` (`|`-separated).

### 5.14 AttributeView block (database; leaf)

```json
{ "Type": "NodeAttributeView", "ID": "...",
  "Properties": { "custom-sy-av-view": "20251230141609-lcme2fh", "id": "...", "updated": "..." },
  "AttributeViewID": "20251230141609-2kvghrg",
  "AttributeViewType": "table" }
```

- **Has no `Children`.**
- `AttributeViewID` points to the AV table data (stored in a separate `.json` — **don't** fabricate this ID).
- `AttributeViewType`: `table` / `kanban` / `gallery`, etc.
- `custom-sy-av-view` records the current view ID.

> AI is advised **not to create new AttributeView blocks**, since the table data is not in the `.sy` — it requires accompanying files.

### 5.15 Thematic break

```json
{ "Type": "NodeThematicBreak", "ID": "...", "Properties": { "id": "..." } }
```

---

## 6. Inline nodes in detail

### 6.1 `NodeText` (plain text)

```json
{ "Type": "NodeText", "Data": "plain text" }
```

`Data` **may be omitted** (common as a placeholder zero-width space: `{ "Type": "NodeText" }`).

### 6.2 `NodeTextMark` (the unified carrier for modern inline formatting)

In `.sy` files, bold/italic/link/inline-code/block-ref etc. are **almost all** `NodeTextMark`, **not** `NodeStrong`/`NodeEmphasis`/`NodeLink`. `TextMarkType` determines the kind.

| `TextMarkType` | Meaning | Required fields |
|---|---|---|
| `text` | plain text | `TextMarkTextContent` |
| `strong` | bold | `TextMarkTextContent` |
| `em` | italic | `TextMarkTextContent` |
| `u` | underline | `TextMarkTextContent` |
| `s` | strikethrough (double-tilde `~~`) | `TextMarkTextContent` |
| `mark` | highlight | `TextMarkTextContent` |
| `sup` / `sub` | super/subscript | `TextMarkTextContent` |
| `kbd` | keyboard key | `TextMarkTextContent` |
| `code` | inline code | `TextMarkTextContent` |
| `tag` | tag `#tag#` | `TextMarkTextContent` |
| `a` | hyperlink | `TextMarkAHref`, `TextMarkTextContent` (optional `TextMarkATitle`) |
| `block-ref` | block reference | `TextMarkBlockRefID`, `TextMarkBlockRefSubtype`, `TextMarkTextContent` |
| `inline-math` | inline math | `TextMarkInlineMathContent` (**no** `TextMarkTextContent`) |
| `inline-memo` | inline note | `TextMarkInlineMemoContent`, `TextMarkTextContent` |
| `file-annotation-ref` | file-annotation ref | `TextMarkFileAnnotationRefID`, `TextMarkTextContent` |

Samples:

```json
{ "Type": "NodeTextMark", "TextMarkType": "a", "TextMarkAHref": "https://ld246.com", "TextMarkTextContent": "hyperlink" }
{ "Type": "NodeTextMark", "TextMarkType": "block-ref", "TextMarkBlockRefID": "20200812220555-lj3enxa", "TextMarkBlockRefSubtype": "s", "TextMarkTextContent": "block ref" }
{ "Type": "NodeTextMark", "TextMarkType": "inline-math", "TextMarkInlineMathContent": "a^2 + b^2 = c^2" }
{ "Type": "NodeTextMark", "TextMarkType": "inline-memo", "TextMarkInlineMemoContent": "an inline note", "TextMarkTextContent": "note" }
```

- `TextMarkBlockRefSubtype`: `"s"` = static anchor text, `"d"` = dynamic anchor text (the anchor text follows the target block's content; note that "embed block" is a separate node `NodeBlockQueryEmbed`, unrelated to this).
- `TextMarkType` may stack multiple marks separated by spaces, e.g. `"strong em"`.
- `TextMarkTextContent` is not present on every type (`inline-math` lacks it).
- Strikethrough **supports only double-tilde `~~x~~`**, not single-tilde `~x~` (`SetGFMStrikethrough1(false)`).
- Backslash escape is **not** a `NodeTextMark` subtype: it maps to the separate `NodeBackslash` node and never appears as a `TextMarkType` value.

### 6.3 Styled inline text (★ must be paired)

A `NodeTextMark` carrying color/effects (with `Properties.style`) **must be immediately followed by a** `NodeKramdownSpanIAL`, and the two must share the exact same style text:

```json
{ "Type": "NodeTextMark", "Properties": { "style": "color: var(--b3-font-color1); background-color: var(--b3-font-background1);" },
  "TextMarkType": "strong", "TextMarkTextContent": "color 1" },
{ "Type": "NodeKramdownSpanIAL", "Data": "{: style=\"color: var(--b3-font-color1); background-color: var(--b3-font-background1);\"}" }
```

> When generating styled inline text, these two nodes must appear as a pair, otherwise the kramdown round-trip will drop the style.

### 6.4 `NodeImage` (seven-part structure)

```json
{ "Type": "NodeImage", "Data": "span", "Children": [
  { "Type": "NodeBang" },
  { "Type": "NodeOpenBracket" },
  { "Type": "NodeLinkText", "Data": "alt text" },
  { "Type": "NodeCloseBracket" },
  { "Type": "NodeOpenParen" },
  { "Type": "NodeLinkDest", "Data": "assets/image-2021.png" },
  { "Type": "NodeCloseParen" }
] }
```

- The image node itself has `Data` = `"span"`.
- `NodeBang`/`NodeOpenBracket`/`NodeCloseBracket`/`NodeOpenParen`/`NodeCloseParen` markers **may omit** `Data`.
- Only `NodeLinkText` and `NodeLinkDest` carry `Data`.

---

## 7. base64 encoding convention (★ must-read)

| Field | Encoding | Example |
|---|---|---|
| `ListData.Marker` | base64 | `Kg==` = `*`, `MS4=` = `1.`, `MQ==` = `1` |
| `CodeBlockInfo` | base64 | `Z28=` = `go`, `amF2YQ==` = `java` |
| `CodeBlockOpenFence`/`CloseFence` | base64 | `YGBg` = ` ``` ` |
| `ListData.BulletChar`/`Delimiter` | **int ASCII codepoint** (**not** base64) | `42` = `*`, `46` = `.` |
| `Data` (paragraph text, code content, link, SQL, etc.) | **raw** (not encoded) | `"package main\n..."` |

> Rule of thumb: **marker fields** like `Marker`/`Fence`/`Info` are base64; **content fields** like `Data`, `TextMarkTextContent`, `TextMarkInlineMathContent` are raw; `BulletChar`/`Delimiter` are int codepoints.

---

## 8. Properties (IAL) in full

A flat `map[string]string`.

**Document-level (required):** `id`, `title`, `type` (always `"doc"`), `updated`. Optional: `icon` (emoji codepoint hex, e.g. `"1f4f0"`), `title-img` (CSS).

**Block-level (required):** `id` (= the node's `ID`), `updated`. Optional: `style` (inline CSS), `fold: "1"` (collapsed), `colgroup` (table column widths), arbitrary `custom-*` custom attributes.

> The authoritative key is **lowercase** `id`. Some legacy imported files also carry a leftover uppercase `ID` — prefer lowercase.

---

## 9. Container containment cheat sheet

| Container | Can contain | Cannot contain |
|---|---|---|
| `NodeList` | **only** `NodeListItem` | any other block (paragraphs/code blocks/sub-lists must be wrapped in `NodeListItem` first) |
| `NodeListItem` | any non-`NodeListItem` block (paragraph/code block/sub-`NodeList`/super block…) | `NodeListItem` (nesting requires another `NodeList`) |
| `NodeBlockquote` | any non-`NodeListItem` block + one `NodeBlockquoteMarker` | `NodeListItem` |
| `NodeCallout` | any non-`NodeListItem` block | `NodeListItem` |
| `NodeSuperBlock` | **any block** (incl. nested super blocks), wrapped by the three markers | none (most permissive) |
| `NodeDocument` | any non-`NodeListItem` block | `NodeListItem` |

> These rules are enforced by Lute's `CanContain` (`ast/node.go:988`). Violations cause parse/render anomalies — AI must obey them when generating.

---

## 10. Zero-width space convention

`.sy` files make heavy use of `​` (U+200B) as a separator placeholder. Around images, inline code, tags, kbd, etc., there is **usually a** `NodeText` with `Data` = `​` on **each side**, to keep rendering and caret behavior correct. AI should follow this convention when generating such content.

---

## 11. Markdown syntax disabled by SiYuan (must not appear in `.sy`)

SiYuan disables the following syntax via `SetXxx(false)` in `NewLute()` (`kernel/util/lute.go`). The corresponding node types **never** appear in `.sy` files — AI must not generate them:

| Disabled item | Corresponding node types | Note |
|---|---|---|
| `SetFootnotes(false)` | `NodeFootnotesDefBlock`/`NodeFootnotesDef`/`NodeFootnotesRef` | footnotes, fully disabled |
| `SetToC(false)` | `NodeToC` | `[toc]` table of contents |
| `SetIndentCodeBlock(false)` | indented code blocks | only fenced code blocks are supported |
| `SetHeadingID(false)` | `NodeHeadingID` | custom heading ID `{#id}` |
| `SetSetext(false)` | Setext headings (`===`/`---` underline form) | only ATX-style `#` is supported |
| `SetYamlFrontMatter(false)` | `NodeYamlFrontMatter` | YAML front matter |
| `SetLinkRef(false)` | `NodeLinkRefDef`/`NodeLinkRefDefBlock` | link reference definitions |
| `SetGFMStrikethrough1(false)` | single-tilde strikethrough `~x~` | only double-tilde `~~x~~` is supported |

> Note: `NewLute()` also sets `SetAutoSpace(false)`, `SetCodeSyntaxHighlight(false)`, and `SetExportNormalizeTaskListMarker(false)` — these are non-syntax switches that only affect rendering/export and never remove any node type, so they're omitted from the table above.

---

## 12. AI write checklist

When generating a `.sy` that SiYuan can load cleanly, verify item by item:

1. ☐ Root `Type` = `"NodeDocument"`, `Spec` = `"2"`; root `ID` = filename (without `.sy`) and equals `Properties.id`
2. ☐ Root `Properties` contains `id`/`title`/`type:"doc"`/`updated`
3. ☐ Every block has a 22-char `ID`; `Properties.id` = `ID`; `Properties.updated` is a valid 14-digit timestamp
4. ☐ Inline/marker nodes **do not carry** `ID`
5. ☐ Lists are distinguished via `ListData.Typ` (omitted = unordered / `1` = ordered / `3` = task)
6. ☐ `NodeList`'s direct children are **only** `NodeListItem`; nested lists wrap another `NodeList`
7. ☐ `BulletChar`/`Delimiter` are byte (appear as int codepoints in JSON); `Marker` is base64
8. ☐ Task markers usually carry no `Data` (checked items use `TaskListItemChecked:true`, unchecked only `Type`)
9. ☐ Code block four parts, math block three parts, embed five parts, super block three parts — structure intact
10. ☐ `NodeCodeBlockCode`/`NodeMathBlockContent` are inline children, usually only `Type`+`Data`
11. ☐ base64 fields are encoded; content fields stay raw
12. ☐ Prefer `NodeTextMark` for inline formatting over legacy `NodeStrong`/`NodeEmphasis`/`NodeLink`
13. ☐ A styled `TextMark` must be followed by a paired `NodeKramdownSpanIAL`
14. ☐ HTML/IFrame/Video/Audio/AttributeView are leaves with no `Children` (content in `Data` or type-specific fields)
15. ☐ Do not fabricate `AttributeViewID`/`block-ref` target IDs (they must point to real blocks/AVs)
16. ☐ Do not generate disabled types (footnotes/ToC/YAML/LinkRef/HeadingID, etc. — see §11)

---

## 13. Pitfalls and common mistakes

| ❌ Wrong | ✅ Correct |
|---|---|
| Assuming every node has `Data` | `Data` may be omitted; marker nodes often lack it |
| Inline node carries `ID` | Inline/marker nodes have no `ID` |
| Using legacy nodes like `NodeStrong`/`NodeLink` | Use `NodeTextMark` + `TextMarkType` |
| `ListData.Typ` only accepts `1` | omitted = unordered, `1` = ordered, `3` = task |
| Treating `BulletChar` as base64 | It's `byte`, appearing as an int codepoint in JSON (`42` = `*`) |
| Forcing `"Data":"[X]"` into a task marker | Real `.sy` usually has no `Data`; checked items only carry `TaskListItemChecked:true` |
| Styled `TextMark` without the IAL | Must pair with `NodeKramdownSpanIAL` |
| Adding `Children` to `NodeAttributeView` | It's a leaf — use `AttributeViewID`/`AttributeViewType` |
| Changing `ID` without syncing `Properties.id` | The two must match |
| `inline-math` carrying `TextMarkTextContent` | It only has `TextMarkInlineMathContent` |
| Fabricating block-ref / AV target IDs | Targets must really exist |
| Hanging a paragraph directly under `NodeList` | `NodeList` can only contain `NodeListItem` — wrap first |
| Generating footnotes/ToC/YAML, etc. | SiYuan disables these; they never appear in `.sy` |

---

## 14. Minimal writable document template

```json
{
  "ID": "20260628120000-abc1234",
  "Spec": "2",
  "Type": "NodeDocument",
  "Properties": {
    "id": "20260628120000-abc1234",
    "title": "New doc",
    "type": "doc",
    "updated": "20260628120000"
  },
  "Children": [
    {
      "Type": "NodeHeading", "ID": "20260628120001-def5678", "HeadingLevel": 2,
      "Properties": { "id": "20260628120001-def5678", "updated": "20260628120001" },
      "Children": [ { "Type": "NodeText", "Data": "Heading" } ]
    },
    {
      "Type": "NodeParagraph", "ID": "20260628120002-ghi9012",
      "Properties": { "id": "20260628120002-ghi9012", "updated": "20260628120002" },
      "Children": [
        { "Type": "NodeText", "Data": "Body with " },
        { "Type": "NodeTextMark", "TextMarkType": "strong", "TextMarkTextContent": "bold" },
        { "Type": "NodeText", "Data": "." }
      ]
    }
  ]
}
```

---

## Appendix: verification sources

- Sample 1: `app/guide/.../20200825162036-4dx365o.sy` (formatting elements — covers nearly all block types)
- Sample 2: `app/guide/.../20200905090211-2vixtlf.sy` (block types — incl. compact lists, AttributeView)
- Node-type constants and serialization logic: `lute/ast/node.go`, `lute/render/json_renderer.go`, `dataparser/sy.go`
- List containment check: `lute/ast/node.go:988` (`CanContain`)
- Disabled-syntax config: `kernel/util/lute.go:51` (`NewLute`)
- Fields marked `【inferred】` (e.g. the sub-fields of `file-annotation-ref`) should be re-verified against a real sample before generation.
