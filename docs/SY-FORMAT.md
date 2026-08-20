# SiYuan `.sy` File JSON Structure — AI Read/Write Guide

> Canonical Spec baseline: `2` (the current writer output; compatible readers may encounter an older or missing `Spec` and upgrade it).
> Verified against samples: `20200825162036-4dx365o.sy` (formatting elements), `20200905090211-2vixtlf.sy` (block types).
> All conclusions are based on real samples and the current Lute / SiYuan kernel source. The cited samples contain a few known legacy artifacts; canonical write rules follow the current source when a sample differs.
> This guide describes plaintext `.sy` JSON in an ordinary notebook, or the decrypted AST of an unlocked encrypted notebook. An encrypted notebook's on-disk `.sy` file is ciphertext and must not be edited as JSON.
> Companion document: [`WORKSPACE.md`](./WORKSPACE.md) covers the overall on-disk layout of the workspace (how notebooks, parent/child documents, and assets are organized); this document focuses on the **internal** JSON structure of a `.sy` file.

## 0. In one sentence

A plaintext `.sy` file is a Lute AST tree serialized to JSON. The root node is `NodeDocument`; the body is the recursively nested `Children` array. There is no separately maintained JSON Schema — the Lute `ast.Node` and `ListData` Go structs are the serialization source of truth. The tree contains the document AST and its IAL, while assets, AttributeView definitions, and rebuildable indexes live outside the tree.

## 0.1 Canonical writes vs. compatible reads

This guide distinguishes the format that new writers should emit from historical data that the kernel can tolerate and normalize:

| Term | Meaning |
|---|---|
| **Required** | Required in newly generated canonical Spec 2 data |
| **Optional** | May be omitted because the field is empty or carries `omitempty` |
| **Compatible input** | Historical or external data that the reader may accept and preserve, repair, or upgrade according to explicit compatibility rules |

Unless a section explicitly says otherwise, "required" refers to canonical new writes. `dataparser.ParseJSON` is a compatibility reader rather than a strict schema validator: for example, it can add a missing empty paragraph, assign a missing block ID, and upgrade an old `Spec`.

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
> ⚠️ Do not directly mutate encrypted-notebook persistent files. Use the dedicated APIs after unlocking the notebook so encryption, authentication, and isolated indexes remain consistent.

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
| `ID` | ✅ | Document block ID. **Equals the filename without `.sy`** |
| `Spec` | ✅ | `"2"` in canonical current files; older or missing values are compatible input and may be upgraded |
| `Type` | ✅ | `"NodeDocument"` |
| `Properties` | ✅ | Document-level IAL — see §8 |
| `Children` | ✅ | Array of body child blocks; canonical files contain at least one block |

> ⚠️ The file path strictly corresponds to the root ID: `data/<box>/<...>/<rootID>.sy`. Changing the root ID means renaming the file — don't change it casually. For the full file-system layout see [`WORKSPACE.md`](./WORKSPACE.md).
> A compatible reader inserts an empty paragraph when `Children` is missing or empty, but new writers should emit that paragraph themselves.

---

## 2. Common field semantics (apply to every node)

| Field | Type | Presence | Meaning |
|---|---|---|---|
| `Type` | string | **required on every node** | Type discriminator, e.g. `"NodeParagraph"` |
| `ID` | string | required on canonical block nodes; may occur on compatible non-block input | 22-char block ID for blocks; canonical writers do not add it to inline/marker nodes |
| `Data` | string | some | Text / HTML / markdown raw; **may be omitted** (don't assume it exists) |
| `Properties` | object | blocks and some inline nodes | IAL, `map[string]string`; inline uses include styled text, images, and table cells |
| `Children` | array | containers and structurally composite nodes | Child node array |
| Type-specific fields | - | per type | e.g. `HeadingLevel`, `ListData`, `TextMarkType`, `AttributeViewID` |

**Core discriminator rule:** `Type` determines whether a node is a block (`ast.Node.IsBlock()` is authoritative); the presence of `ID` does not. In canonical Spec 2 data, every block has an `ID` and matching `Properties.id`, while new inline/marker nodes have neither. Historical files produced by old bugs may contain IDs on non-block nodes such as `NodeCodeBlockCode` or `NodeMathBlockContent`. Compatible readers and editors may remove those legacy `ID` / `Properties.id` fields during normalization, but must classify the node by `Type` and must not delete the node merely because its `ID` conflicts with the canonical rule.

---

## 3. ID and timestamp rules

- **ID format:** `YYYYMMDDHHMMSS-xxxxxxx` = 14-digit timestamp + `-` + 7 random `[a-z0-9]` chars. Example: `20210104091228-ttcj9nm`.
- **Uniqueness:** every newly generated document and block ID must be fresh and unique across the workspace, not merely unique within one file.
- The **root ID** comes from the filename and is **not** regenerated.
- **Child block IDs** are newly generated with the above scheme; never copy literal IDs from examples or templates.
- `Properties.updated` is the same 14-digit timestamp; semantics: "last updated time".
- When changing block content or structure, refresh `Properties.updated` on the changed block, its block-level ancestors, applicable preceding headings, and the document root.
- When you change any block's `ID`, you must **sync** `Properties.id`. Its `Properties.updated` must be no earlier than the creation time encoded by the new ID.
- Compatible historical input may lack `updated`; canonical new writes should always include it on block nodes.

---

## 4. Node-type catalog

### Block nodes (have an ID in canonical data)

**Leaf blocks:** `NodeParagraph`, `NodeHeading`, `NodeThematicBreak`, `NodeHTMLBlock`, `NodeCodeBlock`, `NodeMathBlock`, `NodeTable`, `NodeBlockQueryEmbed`, `NodeAttributeView`, `NodeIFrame`, `NodeVideo`, `NodeAudio`, `NodeWidget`, `NodeCustomBlock`

**Container blocks:** `NodeList`, `NodeListItem`, `NodeBlockquote`, `NodeCallout`, `NodeSuperBlock`

### Inline / marker nodes (no ID in canonical data)

`NodeText`, `NodeTextMark`, `NodeImage`, `NodeKramdownSpanIAL`, `NodeSoftBreak`, `NodeBr`, `NodeBackslash`, `NodeBackslashContent`, `NodeHeadingC8hMarker`, `NodeBlockquoteMarker`, `NodeTaskListItemMarker`, `NodeBang`, `NodeOpenBracket`, `NodeCloseBracket`, `NodeOpenParen`, `NodeCloseParen`, `NodeLinkText`, `NodeLinkDest`, `NodeLinkSpace`, `NodeLinkTitle`, `NodeCodeBlockCode`, `NodeCodeBlockFenceOpenMarker`, `NodeCodeBlockFenceInfoMarker`, `NodeCodeBlockFenceCloseMarker`, `NodeMathBlockContent`, `NodeMathBlockOpenMarker`, `NodeMathBlockCloseMarker`, `NodeSuperBlockOpenMarker`, `NodeSuperBlockLayoutMarker`, `NodeSuperBlockCloseMarker`, `NodeOpenBrace`, `NodeCloseBrace`, `NodeBlockQueryEmbedScript`, `NodeTableHead`, `NodeTableRow`, `NodeTableCell`

> "Leaf block" means the node cannot contain other **block nodes**. A leaf may still have structural inline children, as code blocks, math blocks, and tables do.
> The heading above is a canonical-write rule. An explicit normalization pass may remove an `ID` already present on a compatible historical non-block node, but must not use that field to decide whether the node is a block or whether the node itself should be removed.
> Types excluded from canonical writes — including parser-disabled syntax and the detection-only `NodeGitConflict` family — are listed in §11 and intentionally omitted from this catalog.

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

> **★ Canonical structural constraint of lists:** direct children of `NodeList` can **only** be `NodeListItem` (`CanContain` returns `NodeListItem == nodeType`). Paragraphs, code blocks, sub-lists, or any other block **cannot** be attached directly under `NodeList` — they must be wrapped in a `NodeListItem` first. `dataparser.ParseJSON` does not enforce this as a strict validation step, so direct writers must validate the structure themselves.

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
  "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeListItem", "ID": "...",
      "ListData": { "BulletChar": 42, "Marker": "Kg==" },
      "Properties": { "id": "...", "updated": "..." },
      "Children": [
        { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
          "Children": [ { "Type": "NodeText", "Data": "Item one" } ] }
      ] }
  ] }
```

**Ordered list** (`Typ: 1`):

```json
{ "Type": "NodeList", "ID": "...", "ListData": { "Typ": 1 },
  "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeListItem", "ID": "...",
      "ListData": { "Typ": 1, "Tight": true, "Start": 1, "Delimiter": 46, "Padding": 3, "Marker": "MS4=", "Num": 1 },
      "Properties": { "id": "...", "updated": "..." },
      "Children": [
        { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
          "Children": [ { "Type": "NodeText", "Data": "Item one" } ] }
      ] }
  ] }
```

**Task list** (`Typ: 3`); each `NodeListItem` starts with a `NodeTaskListItemMarker`:

```json
{ "Type": "NodeList", "ID": "...", "ListData": { "Typ": 3 },
  "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeListItem", "ID": "...",
      "ListData": { "Typ": 3, "Tight": true, "BulletChar": 45, "Padding": 2, "Marker": "LQ==", "Num": -1 },
      "Properties": { "id": "...", "updated": "..." },
      "Children": [
        { "Type": "NodeTaskListItemMarker", "TaskListItemChecked": true, "TaskListItemMarker": 88 },
        { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
          "Children": [ { "Type": "NodeText", "Data": "Task one" } ] }
      ] }
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
| `MarkerOffset` | int | number | Marker indentation offset; optional |
| `Checked` | bool | boolean | Compatibility metadata derived while parsing a task marker; it is not an aggregate for the whole list and may be omitted |
| `Marker` | []byte | **base64 string** | The marker text, **base64-encoded**; may include a delimiter (`"MS4="` = `1.`) or not (`"MQ=="` = `1`) |

> Key distinction: **`BulletChar`/`Delimiter` are `byte` in code and appear as int codepoints in JSON**; **`Marker` is `[]byte` in code and appears as a base64 string in JSON**. `Marker`/`BulletChar`/`Delimiter` all carry `omitempty` and may be omitted.

### 5.5 Task marker

Checked with `X`:

```json
{ "Type": "NodeTaskListItemMarker", "TaskListItemChecked": true, "TaskListItemMarker": 88 }
```

Unchecked with a space:

```json
{ "Type": "NodeTaskListItemMarker", "TaskListItemMarker": 32 }
```

An arbitrary non-space marker such as `!` is also treated as checked and preserves its original byte:

```json
{ "Type": "NodeTaskListItemMarker", "TaskListItemChecked": true, "TaskListItemMarker": 33 }
```

`TaskListItemMarker` is a Go `byte`, so JSON stores its ASCII codepoint as a number. Current rendering prefers this field and falls back to `TaskListItemChecked` for compatible older data. `Data` may appear when the AST comes directly from Markdown parsing (for example `"[X]"`), but editor-generated `.sy` data usually omits it; do not use `Data` as the authoritative task state.

### 5.6 Blockquote

```json
{ "Type": "NodeBlockquote", "ID": "...", "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeBlockquoteMarker", "Data": "> " },
    { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
      "Children": [ { "Type": "NodeText", "Data": "Quoted content" } ] }
  ] }
```

> `NodeBlockquoteMarker.Data` may be `">"` or `"> "` — both are legal.

### 5.7 Callout (GFM Alert)

```json
{ "Type": "NodeCallout", "ID": "...",
  "CalloutType": "NOTE", "CalloutTitle": "Note", "CalloutIcon": "✏️",
  "Properties": { "id": "...", "updated": "..." },
  "Children": [ { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
    "Children": [ { "Type": "NodeText", "Data": "Callout content" } ] } ] }
```

| `CalloutType` | `CalloutTitle` | `CalloutIcon` |
|---|---|---|
| `NOTE` | `Note` | `✏️` |
| `TIP` | `Tip` | `💡` |
| `IMPORTANT` | `Important` | `❗` |
| `WARNING` | `Warning` | `⚠️` |
| `CAUTION` | `Caution` | `🚨` |

The table lists the five built-in types and their defaults. Custom `CalloutType`, title, and icon values are also supported. `CalloutIcon` is a literal emoji for `CalloutIconType: 0` (the default, omitted by `omitempty`); `CalloutIconType: 1` means `CalloutIcon` is a custom icon path.

### 5.8 Super block (nestable; three-marker envelope)

```json
{ "Type": "NodeSuperBlock", "ID": "...", "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeSuperBlockOpenMarker" },
    { "Type": "NodeSuperBlockLayoutMarker", "Data": "col" },
    { "Type": "NodeSuperBlock", "ID": "...", "Properties": { "id": "...", "updated": "..." }, "Children": [ ... nested super block, Data "row" ... ] },
    { "Type": "NodeSuperBlockCloseMarker" }
  ] }
```

> `NodeSuperBlockLayoutMarker.Data` can only be `"row"` (vertical) or `"col"` (horizontal). A canonical super block contains the open marker, layout marker, at least one content block, and close marker — at least four children total. It may contain multiple content blocks, can nest, and is the only container that can hold any block (including itself).

### 5.9 Embed block (five-part structure `{{ ... }}`)

```json
{ "Type": "NodeBlockQueryEmbed", "ID": "...", "Properties": { "id": "...", "updated": "..." },
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
  "Properties": { "id": "...", "updated": "..." },
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
- `CodeBlockInfo` is the **base64-encoded language** (`"Z28="` = `go`). The parent's six fields (`IsFencedCodeBlock`/`CodeBlockFenceChar`/`CodeBlockFenceLen`/`CodeBlockOpenFence`/`CodeBlockInfo`/`CodeBlockCloseFence`) all carry `omitempty` and may be omitted as needed — newer `.sy` files often write only `"IsFencedCodeBlock": true`.
- The current SiYuan Markdown configuration disables indented code blocks (`SetIndentCodeBlock(false)`); canonical new code blocks are fenced.

### 5.11 Math block (three-part structure)

```json
{ "Type": "NodeMathBlock", "ID": "...", "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeMathBlockOpenMarker" },
    { "Type": "NodeMathBlockContent", "Data": "a^2 + b^2 = c^2" },
    { "Type": "NodeMathBlockCloseMarker" }
  ] }
```

### 5.12 HTML / IFrame / Widget / Video / Audio blocks (leaf; content in the top-level `Data`)

```json
{ "Type": "NodeHTMLBlock", "ID": "...", "Data": "<div>\n<ruby>你<rt>nǐ</rt>...</div>", "Properties": { "id": "...", "updated": "..." } }
{ "Type": "NodeIFrame", "ID": "...", "Data": "<iframe src=\"...\"></iframe>", "Properties": { "id": "...", "updated": "..." } }
{ "Type": "NodeWidget", "ID": "...", "Data": "<iframe src=\"/widgets/example\" data-subtype=\"widget\"></iframe>", "Properties": { "id": "...", "updated": "..." } }
{ "Type": "NodeVideo", "ID": "...", "Data": "<video controls src=\"assets/x.mp4\"></video>", "Properties": { "id": "...", "updated": "..." } }
{ "Type": "NodeAudio", "ID": "...", "Data": "<audio controls src=\"assets/x.wav\"></audio>", "Properties": { "id": "...", "updated": "..." } }
```

> These five **have no `Children`**; the HTML content (JSON-escaped) goes directly in the top-level `Data`.

### 5.13 Table

```json
{ "Type": "NodeTable", "ID": "...", "TableAligns": [0, 0, 0],
  "Properties": { "id": "...", "updated": "...", "colgroup": "||" },
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
- `TableAligns`: int array of per-column alignment: `0` = default, `1` = left, `2` = center, `3` = right.
- `Data` (`thead`/`tr`/`th`/`td`) may be **omitted** in compact files.
- `Properties.colgroup` stores a `|`-separated CSS style string for each column; empty segments represent columns without an explicit style.
- A table's optional `Properties.caption` stores its caption HTML.
- A `NodeTableCell` may carry `Properties.colspan`, `Properties.rowspan`, and `Properties.style` for merged-cell and cell-style state.

### 5.14 AttributeView block (database; leaf)

```json
{ "Type": "NodeAttributeView", "ID": "...",
  "Properties": { "custom-sy-av-view": "20251230141609-lcme2fh", "id": "...", "updated": "..." },
  "AttributeViewID": "20251230141609-2kvghrg",
  "AttributeViewType": "table" }
```

- **Has no `Children`.**
- `AttributeViewID` points to the AV table data (stored in a separate `.json` — **don't** fabricate this ID).
- `AttributeViewType`: `table` / `kanban` / `gallery`, etc. This value is a derived cache of the layout selected by `custom-sy-av-view` and is not an independent view selector. Normal document writes may correct a stale value; rendering does not depend on it after the view is resolved.
- Optional `custom-sy-av-view` is the sole persisted selector for this database block. When it is absent or does not identify a view in the referenced AttributeView, the first available view is used as the fallback.

> AI is advised **not to create new AttributeView blocks**, since the table data is not in the `.sy` — it requires accompanying files.

### 5.15 Thematic break

```json
{ "Type": "NodeThematicBreak", "ID": "...", "Properties": { "id": "...", "updated": "..." } }
```

### 5.16 Custom block

```json
{ "Type": "NodeCustomBlock", "ID": "...", "Data": "raw custom content",
  "CustomBlockInfo": "info", "Properties": { "id": "...", "updated": "..." } }
```

`NodeCustomBlock` is a leaf with no `Children`. `Data` stores its raw content and `CustomBlockInfo` stores the fence info string.

---

## 6. Inline nodes in detail

### 6.1 `NodeText` (plain text)

```json
{ "Type": "NodeText", "Data": "plain text" }
```

`Data` **may be omitted** because an empty string carries `omitempty`; `{ "Type": "NodeText" }` therefore represents empty text, not U+200B. An actual zero-width space must be present in `Data` (for example as the JSON escape `"\u200b"`).

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

### 6.4 `NodeImage` (seven-part core; optional title adds two nodes)

```json
{ "Type": "NodeImage", "Data": "span", "Children": [
  { "Type": "NodeBang" },
  { "Type": "NodeOpenBracket" },
  { "Type": "NodeLinkText", "Data": "alt text" },
  { "Type": "NodeCloseBracket" },
  { "Type": "NodeOpenParen" },
  { "Type": "NodeLinkDest", "Data": "assets/image-2021.png" },
  { "Type": "NodeLinkSpace" },
  { "Type": "NodeLinkTitle", "Data": "Image title" },
  { "Type": "NodeCloseParen" }
] }
```

- Editor-generated image nodes normally have `Data` = `"span"`; compatible compact data may omit an empty `Data`.
- `NodeBang`/`NodeOpenBracket`/`NodeCloseBracket`/`NodeOpenParen`/`NodeCloseParen` markers **may omit** `Data`.
- `NodeLinkText` and `NodeLinkDest` carry the alt text and destination. When a title exists, insert `NodeLinkSpace` and `NodeLinkTitle` immediately before `NodeCloseParen`; the seven-node form without them is also valid.

### 6.5 Line breaks and backslash escapes

```json
{ "Type": "NodeSoftBreak", "Data": "\n" }
{ "Type": "NodeBr" }
{ "Type": "NodeBackslash",
  "Children": [ { "Type": "NodeBackslashContent", "Data": "|" } ] }
```

- `NodeSoftBreak` represents a soft line break.
- `NodeBr` represents an explicit `<br>`.
- `NodeBackslash` wraps the escaped character as inline content; it is not a `NodeTextMark` subtype.

---

## 7. base64 encoding convention (★ must-read)

| Field | Encoding | Example |
|---|---|---|
| `ListData.Marker` | base64 | `Kg==` = `*`, `MS4=` = `1.`, `MQ==` = `1` |
| `CodeBlockInfo` | base64 | `Z28=` = `go`, `amF2YQ==` = `java` |
| `CodeBlockOpenFence`/`CloseFence` | base64 | `YGBg` = ` ``` ` |
| `ListData.BulletChar`/`Delimiter` | **int ASCII codepoint** (**not** base64) | `42` = `*`, `46` = `.` |
| `TaskListItemMarker` | **int ASCII codepoint** (**not** base64) | `32` = space, `88` = `X`, `33` = `!` |
| `Data` (paragraph text, code content, link, SQL, etc.) | **raw** (not encoded) | `"package main\n..."` |

> Rule of thumb: Go `[]byte` fields such as `Marker`/`Fence`/`Info` become base64 strings; Go `byte` fields such as `BulletChar`/`Delimiter`/`TaskListItemMarker` become JSON numbers; content strings such as `Data`, `TextMarkTextContent`, and `TextMarkInlineMathContent` remain raw strings.

---

## 8. Properties (IAL)

A flat `map[string]string`.

**Document-level (required in canonical writes):** `id`, `title`, `type` (always `"doc"`), `updated`. Optional: `icon` (emoji codepoint hex, e.g. `"1f4f0"`; custom-icon filename; or HTTP(S) image URL), `title-img` (document title image style as a CSS declaration string, e.g. `background-image:url("assets/example.jpg")`).

**Block-level (required in canonical writes):** `id` (= the node's `ID`), `updated`. Compatible historical data may lack `updated`, but new writers should provide it. Common optional attributes include `style`, `fold: "1"`, `name`, `alias`, `memo`, `bookmark`, table `colgroup` / `caption`, AttributeView `custom-sy-av-view`, and arbitrary `custom-*` attributes.

**Inline-level (optional):** some inline or structural nodes also use `Properties`, including styled `NodeTextMark`, positioned or sized `NodeImage`, and merged/styled `NodeTableCell`. An inline `Properties` object does not make the node a block.

> The authoritative canonical key is **lowercase** `id`. Some legacy imported files also carry a leftover uppercase `ID`; an explicit normalization pass may remove that compatibility artifact.

---

## 9. Container containment cheat sheet

| Container | Can contain | Cannot contain |
|---|---|---|
| `NodeList` | **only** `NodeListItem` | any other block (paragraphs/code blocks/sub-lists must be wrapped in `NodeListItem` first) |
| `NodeListItem` | any non-`NodeListItem` block (paragraph/code block/sub-`NodeList`/super block…) | `NodeListItem` (nesting requires another `NodeList`) |
| `NodeBlockquote` | any non-`NodeListItem` block + one `NodeBlockquoteMarker` | `NodeListItem` |
| `NodeCallout` | any non-`NodeListItem` block | `NodeListItem` |
| `NodeSuperBlock` | **any block** (incl. nested super blocks), inside its open/layout/close marker envelope | none (most permissive) |
| `NodeDocument` | any non-`NodeListItem` block | `NodeListItem` |

> These are canonical writer constraints derived from Lute's `CanContain`. The Markdown parser applies them while building a tree, but `dataparser.ParseJSON` is not a strict containment validator and does not reject every violation. Direct writers must validate these relationships themselves; invalid trees can cause parse or render anomalies.

---

## 10. Zero-width space handling

Compatible AST data may contain `​` (U+200B) in `NodeText` for caret boundaries around inline elements. Preserve an existing U+200B when editing, but do not synthesize a `NodeText` containing U+200B on both sides of every image, inline code, tag, kbd, or similar node: Protyle injects these caret placeholders contextually while rendering the editor DOM. An omitted `Data` field represents an empty string, not U+200B.

---

## 11. Types disabled for canonical writes (do not generate)

Canonical writers must not generate the following syntax or node families. Most are disabled via `SetXxx(false)` in `NewLute()` (`kernel/util/lute.go`), so the configured Markdown parser does not generate them. `NodeGitConflict` is the special case: `NewLute()` enables `SetGitConflict(true)` only so existing raw Git conflict markers can be recognized; that node family is still disabled for canonical `.sy` writes. A compatibility reader may encounter any of these types in historical or externally produced JSON.

| Rule | Corresponding node types | Note |
|---|---|---|
| Canonical-write prohibition; `SetGitConflict(true)` recognizes existing input | `NodeGitConflict`/`NodeGitConflictOpenMarker`/`NodeGitConflictContent`/`NodeGitConflictCloseMarker` | raw Git conflict marker block; never generate |
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

When generating or compatibly editing a `.sy` that SiYuan can load cleanly, verify item by item:

1. ☐ Root `Type` = `"NodeDocument"`, `Spec` = `"2"`; root `ID` = filename (without `.sy`) and equals `Properties.id`
2. ☐ Root `Properties` contains `id`/`title`/`type:"doc"`/`updated`
3. ☐ Every newly generated ID is fresh and workspace-wide unique; every canonical block has a 22-char `ID`, matching `Properties.id`, and a valid 14-digit `Properties.updated`
4. ☐ Determine block status from `Type`, not from `ID`; do not add IDs to new inline/marker nodes, and only remove historical non-block IDs as field normalization without deleting the node
5. ☐ Content or structure changes refresh `updated` on the changed block, its block ancestors, applicable preceding headings, and the document root
6. ☐ Lists are distinguished via `ListData.Typ` (`0` or omitted = unordered / `1` = ordered / `3` = task), and both `NodeList` and each `NodeListItem` carry the appropriate `Typ`
7. ☐ `NodeList` direct children are **only** `NodeListItem`; nested lists use another `NodeList` inside an item
8. ☐ Go `byte` fields (`BulletChar`, `Delimiter`, `TaskListItemMarker`) are JSON numbers; Go `[]byte` fields (`Marker`, fences, info) are base64 strings
9. ☐ A task marker records its original marker byte in `TaskListItemMarker` (`32` = space, `88` = `X`, other non-space bytes are checked); `TaskListItemChecked` is a compatibility fallback and `Data` is not authoritative
10. ☐ Code blocks have four structural children, math blocks have three, query embeds have five, and super blocks have an open/layout/close envelope around at least one content block
11. ☐ `NodeCodeBlockCode` and `NodeMathBlockContent` are inline structural children; historical IDs on them may be removed without removing the nodes
12. ☐ Content strings stay raw; only `[]byte` fields are base64-encoded
13. ☐ Prefer `NodeTextMark` for modern inline formatting over legacy `NodeStrong`/`NodeEmphasis`/`NodeLink`
14. ☐ A styled `NodeTextMark` is followed by its paired `NodeKramdownSpanIAL`
15. ☐ HTML/IFrame/Widget/Video/Audio/AttributeView/CustomBlock nodes are leaves with no `Children`; their content uses `Data` or type-specific fields
16. ☐ Do not fabricate `AttributeViewID` or block-reference target IDs; they must point to real AVs or blocks
17. ☐ Do not generate disabled types such as `NodeGitConflict`, footnotes, ToC, YAML, LinkRef, or HeadingID; tolerate them when compatibility-reading historical or external data
18. ☐ Preserve existing U+200B text when editing, but do not blanket-synthesize zero-width-space nodes around inline elements
19. ☐ Treat encrypted notebook files on disk as ciphertext, not JSON; mutate them only through the unlocked notebook APIs

---

## 13. Pitfalls and common mistakes

| ❌ Wrong | ✅ Correct |
|---|---|
| Assuming every node has `Data` | `Data` may be omitted; marker nodes often lack it |
| Deciding that a node is a block because it has `ID`, or deleting the whole node as cleanup | `Type` determines block status; compatible editors may remove a historical non-block `ID` field without removing the node |
| Using legacy nodes like `NodeStrong`/`NodeLink` | Use `NodeTextMark` + `TextMarkType` |
| `ListData.Typ` only accepts `1` | `0` or omitted = unordered, `1` = ordered, `3` = task |
| Treating `BulletChar` as base64 | It's `byte`, appearing as an int codepoint in JSON (`42` = `*`) |
| Using `"Data":"[X]"` as the authoritative task state | Preserve the marker byte in numeric `TaskListItemMarker`; `TaskListItemChecked` is a compatibility fallback |
| Styled `TextMark` without the IAL | Must pair with `NodeKramdownSpanIAL` |
| Adding `Children` to AttributeView, Widget, or CustomBlock nodes | They are leaves — use `Data` or their type-specific fields |
| Changing `ID` without syncing `Properties.id` | The two must match |
| Updating only the directly edited block's timestamp | Also refresh its block ancestors, applicable preceding headings, and the document root |
| `inline-math` carrying `TextMarkTextContent` | It only has `TextMarkInlineMathContent` |
| Fabricating block-ref / AV target IDs | Targets must really exist |
| Hanging a paragraph directly under `NodeList` | `NodeList` can only contain `NodeListItem` — wrap first |
| Adding U+200B text nodes on both sides of every inline element | Preserve existing U+200B; let Protyle add editor-DOM caret placeholders contextually |
| Generating `NodeGitConflict`, footnotes, ToC, YAML, etc. | They are disabled for canonical writes; compatibility readers may still encounter historical or external nodes |

---

## 14. Minimal writable document template

> ⚠️ All IDs and timestamps below are illustrative. Generate fresh workspace-wide unique IDs and current timestamps; never copy these literal values into a real `.sy` file.

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

- Sample 1: `app/guide/20210808180117-czj9bvb/20200812220555-lj3enxa/20210808180320-abz7w6k/20200825162036-4dx365o.sy` (formatting elements — covers nearly all block types)
- Sample 2: `app/guide/20210808180117-czj9bvb/20200812220555-lj3enxa/20210808180320-fqgskfj/20200905090211-2vixtlf.sy` (block types — incl. compact lists and AttributeView)
- The samples contain historical artifacts produced by earlier bugs. Treat them as compatibility fixtures; a normalization pass may remove legacy non-block IDs, while canonical new writes follow current node semantics.
- Node-type constants and task/list fields: `lute/ast/node.go`
- Serialization and compatibility parsing: `lute/render/json_renderer.go`, `dataparser/sy.go`
- Containment rules: Lute `ast.Node.CanContain`
- Canonical-write exclusions and syntax configuration: `kernel/util/lute.go` (`NewLute`), including Git-conflict input recognition
- Lute dependency version: `kernel/go.mod`
