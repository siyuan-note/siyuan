# SiYuan `.sy` 文件 JSON 结构规范 —— AI 读写指南

> 版本基准：Spec `2`（当前所有文件）。
> 核验样本：`20200825162036-4dx365o.sy`（排版元素）、`20200905090211-2vixtlf.sy`（内容块类型）。
> 本文档所有结论均基于真实样本与 Lute / 思源内核代码核验；标注 `【推断】` 的字段表示未在样本中直接出现，建议生成前再用真实样本核验。
> 配套文档：[`WORKSPACE.zh-CN.md`](./WORKSPACE.zh-CN.md) 讲工作区在磁盘上的整体布局（笔记本、父子文档、资源文件的组织方式）；本文档专注 `.sy` 文件**内部**的 JSON 结构。

## 0. 一句话本质

`.sy` = 一个 Lute AST 树序列化成的 JSON。根节点恒为 `NodeDocument`，正文是其 `Children` 数组递归嵌套的节点树。没有外部 schema,全部状态在树里。

---

## 0.5 何时直接读写 `.sy`（优先级）

思源提供了 **HTTP API、MCP、CLI** 三条官方路径来修改数据。**默认应优先使用它们**,因为内核会负责 AST 序列化、块 ID 分配，以及两套索引的同步——块树索引（`blocktree.db`，块 ID → 文件路径映射，块引用/面包屑依赖它）和全文搜索索引（`siyuan.db` + FTS5）。直接改盘绕过了这些逻辑，容易导致索引不一致。

**仅当官方路径不便时，才直接以 JSON 读写 `.sy`**。适用场景：
- 批量离线迁移（冷初始化工作区、外部数据导入；工作区的磁盘布局见 [`WORKSPACE.zh-CN.md`](./WORKSPACE.zh-CN.md)）
- 只读的内容统计、分析、自定义导出/格式转换
- 修复底层结构问题（遗留文件、非法节点）
- 程序化生成模板/脚手架

四条路径的分工：

| 路径 | 定位 | 修改能力 |
|---|---|---|
| **HTTP API** | 运行时在线操作 | 最全，文档/块的增删改查（`filetree/*`、`block/*`、`transactions`） |
| **MCP** | LLM 工具集 | AI agent 在线操作文档的子集 |
| **CLI** | 批处理 / 运维 | 导入、导出、同步、SQL 等命令行任务 |
| **直接读写 `.sy`** | 本规范覆盖范围 | 离线、批量、底层结构操作 |

> ⚠️ 直接改盘后，通常需要触发一次「重建索引」才能让搜索/块引用生效。若思源正在运行，更稳妥的是走 HTTP API,由内核负责序列化与索引同步。

---

## 1. 整体结构

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

| 顶层键 | 必有 | 说明 |
|---|---|---|
| `ID` | ✅ | 文档块 ID,**等于文件名去掉 `.sy`**（不是随机生成） |
| `Spec` | ✅ | 恒 `"2"` |
| `Type` | ✅ | 恒 `"NodeDocument"` |
| `Properties` | ✅ | 文档级 IAL,见 §8 |
| `Children` | ✅ | 正文子块数组，至少含一个块 |

> ⚠️ 文件路径与根 ID 严格对应：`data/<box>/<...>/<根ID>.sy`。改根 ID 等于改文件名，AI 不要随意改根 ID。文件系统的完整布局见 [`WORKSPACE.zh-CN.md`](./WORKSPACE.zh-CN.md)。

---

## 2. 通用字段语义（每个节点都适用）

| 字段 | 类型 | 出现条件 | 语义 |
|---|---|---|---|
| `Type` | string | **所有节点必有** | 类型判别字段，如 `"NodeParagraph"` |
| `ID` | string | 仅 block 节点 | 22 字符块 ID；内联/标记节点**不带** |
| `Data` | string | 部分 | 文本/HTML/markdown 原文；**可省略**（不能假设必有） |
| `Properties` | object | 多数 block | IAL,`map[string]string` |
| `Children` | array | 容器/可嵌套节点 | 子节点数组 |
| 类型专属字段 | - | 按类型 | 如 `HeadingLevel`、`ListData`、`TextMarkType`、`AttributeViewID` |

**核心判别规则**：是否有 `ID` 决定是否是 block。有 `ID` ⇒ block（其 `Properties.id` 必须等于 `ID`）；无 `ID` ⇒ 内联/标记节点。

---

## 3. ID 与时间戳规则

- **ID 格式**:`YYYYMMDDHHMMSS-xxxxxxx` = 14 位时间戳 + `-` + 7 位随机 `[a-z0-9]`。例：`20210104091228-ttcj9nm`。
- **根 ID** 来自文件名,**不**重新生成。
- **子块 ID** 用上述算法生成。
- `Properties.updated` 用 14 位时间戳，语义「最后更新时间」。
- 改任何 block 的 `ID`，必须**同步** `Properties.id`。`Properties.updated` 建议同步刷新为当前时间。

---

## 4. 节点类型目录

### Block 节点（有 ID）

**叶子 block**:`NodeParagraph`、`NodeHeading`、`NodeThematicBreak`、`NodeHTMLBlock`、`NodeCodeBlock`、`NodeMathBlock`、`NodeTable`、`NodeBlockQueryEmbed`、`NodeAttributeView`、`NodeIFrame`、`NodeVideo`、`NodeAudio`、`NodeWidget`、`NodeCustomBlock`、`NodeGitConflict`

**容器 block**:`NodeList`、`NodeListItem`、`NodeBlockquote`、`NodeCallout`、`NodeSuperBlock`

### 内联/标记节点（无 ID）

`NodeText`、`NodeTextMark`、`NodeImage`、`NodeKramdownSpanIAL`、`NodeHeadingC8hMarker`、`NodeBlockquoteMarker`、`NodeTaskListItemMarker`、`NodeBang`、`NodeOpenBracket`、`NodeCloseBracket`、`NodeOpenParen`、`NodeCloseParen`、`NodeLinkText`、`NodeLinkDest`、`NodeCodeBlockCode`、`NodeCodeBlockFenceOpenMarker`、`NodeCodeBlockFenceInfoMarker`、`NodeCodeBlockFenceCloseMarker`、`NodeMathBlockContent`、`NodeMathBlockOpenMarker`、`NodeMathBlockCloseMarker`、`NodeSuperBlockOpenMarker`、`NodeSuperBlockLayoutMarker`、`NodeSuperBlockCloseMarker`、`NodeOpenBrace`、`NodeCloseBrace`、`NodeBlockQueryEmbedScript`、`NodeTableHead`、`NodeTableRow`、`NodeTableCell`

> 思源禁用的类型（脚注 / ToC / YAML / LinkRef / HeadingID 等）见 §11,不应出现在 `.sy` 中，故未列入目录。

---

## 5. 各 Block 类型详解 + 可复制样例

### 5.1 段落

```json
{ "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
  "Children": [ { "Type": "NodeText", "Data": "这里是一个示例段落。" } ] }
```

### 5.2 标题

```json
{ "Type": "NodeHeading", "ID": "...", "HeadingLevel": 2,
  "Properties": { "id": "...", "updated": "..." },
  "Children": [ { "Type": "NodeText", "Data": "标题块" } ] }
```

- `HeadingLevel` 取值 `1`–`6`。
- `NodeHeadingC8hMarker`（`Data` 如 `"## "`）**可选**,有无都合法。建议生成时**省略**它，更简洁。
- SiYuan 建议**正文顶层用二级标题**,不要用一级。

### 5.3 列表（关键：用 `ListData.Typ` 区分类型）

> **★ 列表的硬性结构约束**:`NodeList` 的直接子节点**只能**是 `NodeListItem`（Lute 在 `CanContain` 中强制校验，`ast/node.go:993` `return NodeListItem == nodeType`）。段落、代码块、子列表等任何其他块都**不能**直接挂在 `NodeList` 下，必须先包一层 `NodeListItem`。

```
✅ 正确                          ❌ 错误
NodeList                        NodeList
└─ NodeListItem                  ├─ NodeParagraph        ← 非法
   └─ NodeParagraph              └─ NodeCodeBlock         ← 非法
```

**嵌套列表**的正确写法是再套一层 `NodeList`（`NodeListItem` 走默认 `CanContain` 分支，不能直接含另一个 `NodeListItem`）:

```
✅ 正确                          ❌ 错误
NodeList                        NodeList
└─ NodeListItem                  └─ NodeListItem
   ├─ NodeParagraph                 ├─ NodeParagraph
   └─ NodeList  ← 子列表            └─ NodeListItem  ← 非法
      └─ NodeListItem
         └─ NodeParagraph
```

**无序列表**（`Typ` 缺省）:

```json
{ "Type": "NodeList", "ID": "...", "ListData": {},
  "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeListItem", "ID": "...",
      "ListData": { "BulletChar": 42, "Marker": "Kg==" },
      "Properties": { "id": "..." },
      "Children": [
        { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "..." },
          "Children": [ { "Type": "NodeText", "Data": "列表项一" } ] }
      ] }
  ] }
```

**有序列表**(`Typ: 1`):

```json
{ "Type": "NodeListItem", "ID": "...", "Data": "1",
  "ListData": { "Typ": 1, "Tight": true, "Start": 1, "Delimiter": 46, "Padding": 3, "Marker": "MQ==", "Num": 1 },
  "Properties": { "id": "..." }, "Children": [ ... ] }
```

**任务列表**(`Typ: 3`),子节点首项是 `NodeTaskListItemMarker`：

```json
{ "Type": "NodeListItem", "ID": "...",
  "ListData": { "Typ": 3, "Tight": true, "BulletChar": 45, "Padding": 2, "Checked": true, "Marker": "LQ==", "Num": -1 },
  "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeTaskListItemMarker", "TaskListItemChecked": true },
    { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "..." },
      "Children": [ { "Type": "NodeText", "Data": "待办一" } ] }
  ] }
```

### 5.4 `ListData` 字段全解（★ 最易踩坑）

| 字段 | 类型（代码） | JSON 表现 | 说明 |
|---|---|---|---|
| `Typ` | int | 数字 | **列表类型判别**：缺省=无序，`1`=有序，`3`=任务 |
| `Tight` | bool | 布尔 | 紧凑态（无空行）；可选 |
| `BulletChar` | byte | 数字 | 无序/任务列表的项目符号 **ASCII 码点**（`42`=`*`，`45`=`-`） |
| `Delimiter` | byte | 数字 | 有序列表分隔符 ASCII 码点（`46`=`.`） |
| `Start` | int | 数字 | 有序列表起始编号 |
| `Num` | int | 数字 | 该项序号；无序/任务列表通常缺省或为 `-1` |
| `Padding` | int | 数字 | 缩进填充数；可选 |
| `Checked` | bool | 布尔 | 任务列表项是否勾选（列表级聚合） |
| `Marker` | []byte | **base64 字符串** | 标记符原文的 **base64**；可能含分隔符（`"MS4="`=`1.`）也可能不含（`"MQ=="`=`1`） |

> 关键区分：**`BulletChar`/`Delimiter` 在代码里是 `byte`,JSON 中表现为数字 ASCII 码点**;**`Marker` 在代码里是 `[]byte`,JSON 中表现为 base64 字符串**。`Marker`/`BulletChar`/`Delimiter` 都带 `omitempty`，可缺省。

### 5.5 任务标记

```json
// 已勾选
{ "Type": "NodeTaskListItemMarker", "TaskListItemChecked": true }
// 未勾选
{ "Type": "NodeTaskListItemMarker" }
```

> 真实 `.sy` 里 `NodeTaskListItemMarker` **通常没有 `Data` 字段**（思源走 DOM `data-task` 属性重建标记，不保留 `[X]`/`[ ]` 原文）,勾选时仅有 `Type`+`TaskListItemChecked`，未勾选仅有 `Type`。规范上若手动写入 `Data`，勾选态应为大写 `[X]`（非 `[x]`）,仅用于导出 Markdown 时的归一化输出。

### 5.6 引述块

```json
{ "Type": "NodeBlockquote", "ID": "...", "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeBlockquoteMarker", "Data": "> " },
    { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "..." },
      "Children": [ { "Type": "NodeText", "Data": "引述内容" } ] }
  ] }
```

> `NodeBlockquoteMarker.Data` 可以是 `">"` 或 `"> "`，都合法。

### 5.7 提示块（Callout / GFM Alert）

```json
{ "Type": "NodeCallout", "ID": "...",
  "CalloutType": "NOTE", "CalloutTitle": "Note", "CalloutIcon": "✏️",
  "Properties": { "id": "...", "updated": "..." },
  "Children": [ { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "..." },
    "Children": [ { "Type": "NodeText", "Data": "提示内容" } ] } ] }
```

| `CalloutType` | `CalloutTitle` | `CalloutIcon` |
|---|---|---|
| `NOTE` | `Note` | `✏️` |
| `TIP` | `Tip` | `💡` |
| `IMPORTANT` | `Important` | `❗` |
| `WARNING` | `Warning` | `⚠️` |
| `CAUTION` | `Caution` | `🚨` |

> `CalloutIcon` 是**直接 emoji 字符**,不是 base64、不是码点。

### 5.8 超级块（可嵌套，三段结构）

```json
{ "Type": "NodeSuperBlock", "ID": "...", "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeSuperBlockOpenMarker" },
    { "Type": "NodeSuperBlockLayoutMarker", "Data": "col" },
    { "Type": "NodeSuperBlock", "ID": "...", "Properties": { "id": "..." }, "Children": [ ... 内嵌超级块,Data 为 "row" ... ] },
    { "Type": "NodeSuperBlockCloseMarker" }
  ] }
```

> `NodeSuperBlockLayoutMarker.Data` 只能是 `"row"`（横向）或 `"col"`（纵向）。超级块可嵌套，且是唯一能容纳任意块（含嵌套自身）的容器。

### 5.9 嵌入块（五段结构 `{{ ... }}`）

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

### 5.10 代码块（四段结构，仅围栏式）

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

要点：
- `NodeCodeBlockCode` 承载代码内容（放 `Data`，原始文本，`\n` 转义），是 `NodeCodeBlock` 的内联子节点。
- 外围 fence marker（Open/Info/Close）同样是内联子节点。
- `CodeBlockInfo` 是**语言名的 base64**（`"Z28="`=`go`）。父节点上的 7 个字段（`IsFencedCodeBlock`/`CodeBlockFenceChar`/`CodeBlockFenceLen`/`CodeBlockOpenFence`/`CodeBlockInfo`/`CodeBlockCloseFence`）全部带 `omitempty`，可按需省略——新版 `.sy` 常仅写 `"IsFencedCodeBlock": true`。
- 思源**不支持缩进式代码块**(`SetIndentCodeBlock(false)`),所有代码块都是围栏式。

### 5.11 数学块（三段结构）

```json
{ "Type": "NodeMathBlock", "ID": "...", "Properties": { "id": "..." },
  "Children": [
    { "Type": "NodeMathBlockOpenMarker" },
    { "Type": "NodeMathBlockContent", "Data": "a^2 + b^2 = c^2" },
    { "Type": "NodeMathBlockCloseMarker" }
  ] }
```

### 5.12 HTML / IFrame / Video / Audio 块（叶子，内容在顶层 `Data`）

```json
{ "Type": "NodeHTMLBlock", "ID": "...", "Data": "<div>\n<ruby>你<rt>nǐ</rt>...</div>", "Properties": { "id": "..." } }
{ "Type": "NodeIFrame", "ID": "...", "Data": "<iframe src=\"...\"></iframe>", "Properties": { "id": "..." } }
{ "Type": "NodeVideo", "ID": "...", "Data": "<video controls src=\"assets/x.mp4\"></video>", "Properties": { "id": "..." } }
{ "Type": "NodeAudio", "ID": "...", "Data": "<audio controls src=\"assets/x.wav\"></audio>", "Properties": { "id": "..." } }
```

> 这四种**没有 Children**,HTML 内容（JSON 转义后）直接放顶层 `Data`。

### 5.13 表格

```json
{ "Type": "NodeTable", "ID": "...", "TableAligns": [0, 0, 0],
  "Properties": { "id": "...", "colgroup": "||" },
  "Children": [
    { "Type": "NodeTableHead", "Data": "thead", "Children": [
      { "Type": "NodeTableRow", "Data": "tr", "Children": [
        { "Type": "NodeTableCell", "Data": "th", "Children": [ { "Type": "NodeText", "Data": "表头" } ] }
      ] }
    ] },
    { "Type": "NodeTableRow", "Data": "tr", "Children": [
      { "Type": "NodeTableCell", "Data": "td", "Children": [ { "Type": "NodeText", "Data": "单元格" } ] }
    ] }
  ] }
```

- 嵌套层级固定：`NodeTable > NodeTableHead/NodeTableRow > NodeTableCell > 内联`。
- `TableAligns`：每列对齐值的 int 数组，`0`=默认/左。
- `Data`（`thead`/`tr`/`th`/`td`）在紧凑文件里**可省略**。
- 列宽用 `Properties.colgroup`（`|` 分隔）记录。

### 5.14 数据库块（AttributeView,叶子）

```json
{ "Type": "NodeAttributeView", "ID": "...",
  "Properties": { "custom-sy-av-view": "20251230141609-lcme2fh", "id": "...", "updated": "..." },
  "AttributeViewID": "20251230141609-2kvghrg",
  "AttributeViewType": "table" }
```

- **没有 Children**。
- `AttributeViewID` 指向 AV 表数据（存在单独的 `.json`,**不要**由 AI 凭空构造 ID）。
- `AttributeViewType`：`table` / `kanban` / `gallery` 等。
- `custom-sy-av-view` 记录当前视图 ID。

> 建议 AI **不要创建新的 AttributeView 块**,因为表数据不在 `.sy` 里，需配套文件。

### 5.15 分隔线

```json
{ "Type": "NodeThematicBreak", "ID": "...", "Properties": { "id": "..." } }
```

---

## 6. 内联节点详解

### 6.1 `NodeText`（纯文本）

```json
{ "Type": "NodeText", "Data": "普通文本" }
```

`Data` **可省略**（用作占位零宽空格时常见 `{ "Type": "NodeText" }`）。

### 6.2 `NodeTextMark`（现代内联格式的统一载体）

`.sy` 里加粗/斜体/链接/行内代码/块引用等**几乎全部**用 `NodeTextMark`，而**不是** `NodeStrong`/`NodeEmphasis`/`NodeLink`。`TextMarkType` 决定类型。

| `TextMarkType` | 含义 | 必带字段 |
|---|---|---|
| `text` | 纯文本 | `TextMarkTextContent` |
| `strong` | 加粗 | `TextMarkTextContent` |
| `em` | 倾斜 | `TextMarkTextContent` |
| `u` | 下划线 | `TextMarkTextContent` |
| `s` | 删除线（双波浪 `~~`） | `TextMarkTextContent` |
| `mark` | 高亮 | `TextMarkTextContent` |
| `sup` / `sub` | 上/下标 | `TextMarkTextContent` |
| `kbd` | 键盘键 | `TextMarkTextContent` |
| `code` | 行内代码 | `TextMarkTextContent` |
| `tag` | 标签 `#tag#` | `TextMarkTextContent` |
| `a` | 超链接 | `TextMarkAHref`、`TextMarkTextContent`（可选 `TextMarkATitle`） |
| `block-ref` | 块引用 | `TextMarkBlockRefID`、`TextMarkBlockRefSubtype`、`TextMarkTextContent` |
| `inline-math` | 行内公式 | `TextMarkInlineMathContent`（**无** `TextMarkTextContent`） |
| `inline-memo` | 行级备注 | `TextMarkInlineMemoContent`、`TextMarkTextContent` |
| `file-annotation-ref` | 文件注释引用 | `TextMarkFileAnnotationRefID`、`TextMarkTextContent` |

样例：

```json
{ "Type": "NodeTextMark", "TextMarkType": "a", "TextMarkAHref": "https://ld246.com", "TextMarkTextContent": "超链接" }
{ "Type": "NodeTextMark", "TextMarkType": "block-ref", "TextMarkBlockRefID": "20200812220555-lj3enxa", "TextMarkBlockRefSubtype": "s", "TextMarkTextContent": "块引用" }
{ "Type": "NodeTextMark", "TextMarkType": "inline-math", "TextMarkInlineMathContent": "a^2 + b^2 = c^2" }
{ "Type": "NodeTextMark", "TextMarkType": "inline-memo", "TextMarkInlineMemoContent": "这是一个行级备注", "TextMarkTextContent": "备注" }
```

- `TextMarkBlockRefSubtype`：`"s"`=静态锚文本，`"d"`=动态锚文本（锚文本跟随目标块内容变化；注意「嵌入块」是另一种节点 `NodeBlockQueryEmbed`，与此无关）。
- `TextMarkType` 可空格叠加多标记，如 `"strong em"`。
- `TextMarkTextContent` 不是所有类型都有（`inline-math` 就没有）。
- 删除线**仅支持双波浪 `~~x~~`**,不支持单波浪 `~x~`(`SetGFMStrikethrough1(false)`)。
- 反斜杠转义不是 `NodeTextMark` 子类型：它对应独立的 `NodeBackslash` 节点，不会出现在 `TextMarkType` 取值中。

### 6.3 带样式的内联文本（★ 必须成对）

带颜色/特效的 `NodeTextMark`（带 `Properties.style`）**后面必须紧跟一个** `NodeKramdownSpanIAL`，且二者 style 文本一致：

```json
{ "Type": "NodeTextMark", "Properties": { "style": "color: var(--b3-font-color1); background-color: var(--b3-font-background1);" },
  "TextMarkType": "strong", "TextMarkTextContent": "颜色 1" },
{ "Type": "NodeKramdownSpanIAL", "Data": "{: style=\"color: var(--b3-font-color1); background-color: var(--b3-font-background1);\"}" }
```

> AI 生成带样式的内联文本时，这两节点必须成对出现，否则 kramdown 往返会丢样式。

### 6.4 `NodeImage`（七段子结构）

```json
{ "Type": "NodeImage", "Data": "span", "Children": [
  { "Type": "NodeBang" },
  { "Type": "NodeOpenBracket" },
  { "Type": "NodeLinkText", "Data": "alt 文本" },
  { "Type": "NodeCloseBracket" },
  { "Type": "NodeOpenParen" },
  { "Type": "NodeLinkDest", "Data": "assets/image-2021.png" },
  { "Type": "NodeCloseParen" }
] }
```

- 图片节点本身 `Data` 是 `"span"`。
- `NodeBang`/`NodeOpenBracket`/`NodeCloseBracket`/`NodeOpenParen`/`NodeCloseParen` 这些 marker 的 `Data` **可省略**。
- 只有 `NodeLinkText`、`NodeLinkDest` 带 `Data`。

---

## 7. base64 编码约定（★ 必读）

| 字段 | 编码 | 例 |
|---|---|---|
| `ListData.Marker` | base64 | `Kg==`=`*`,`MS4=`=`1.`,`MQ==`=`1` |
| `CodeBlockInfo` | base64 | `Z28=`=`go`,`amF2YQ==`=`java` |
| `CodeBlockOpenFence`/`CloseFence` | base64 | `YGBg`=` ``` ` |
| `ListData.BulletChar`/`Delimiter` | **int ASCII 码点**（**不是** base64） | `42`=`*`，`46`=`.` |
| `Data`（段落文本、代码内容、链接、SQL 等） | **原文**（不编码） | `"package main\n..."` |

> 判别规则：`Marker`/`Fence`/`Info` 这类**标记符字段**是 base64;`Data`、`TextMarkTextContent`、`TextMarkInlineMathContent` 等内容字段是原文；`BulletChar`/`Delimiter` 是 int 码点。

---

## 8. Properties（IAL）全解

扁平 `map[string]string`。

**文档级必有**:`id`、`title`、`type`（恒 `"doc"`）、`updated`。可选：`icon`（emoji 码点十六进制，如 `"1f4f0"`）、`title-img`(CSS)。

**Block 级必有**:`id`（= 节点 `ID`）、`updated`。可选：`style`（行内 CSS）、`fold: "1"`（折叠态）、`colgroup`（表格列宽）、任意 `custom-*` 自定义属性。

> 权威键是**小写** `id`。某些旧导入文件里同时有遗留的大写 `ID`，以小写为准。

---

## 9. 容器容纳规则速查

| 容器 | 可含 | 不可含 |
|---|---|---|
| `NodeList` | **仅** `NodeListItem` | 任何其他块（段落/代码块/子列表都必须先套 `NodeListItem`） |
| `NodeListItem` | 任意非 `NodeListItem` 块（段落/代码块/子 `NodeList`/超级块…） | `NodeListItem`（嵌套要再套 `NodeList`） |
| `NodeBlockquote` | 任意非 `NodeListItem` 块 + 一个 `NodeBlockquoteMarker` | `NodeListItem` |
| `NodeCallout` | 任意非 `NodeListItem` 块 | `NodeListItem` |
| `NodeSuperBlock` | **任意块**（含嵌套超级块）,三段 marker 包裹 | 无（最宽松） |
| `NodeDocument` | 任意非 `NodeListItem` 块 | `NodeListItem` |

> 这些规则由 Lute 的 `CanContain` 强制校验，违反会导致解析/渲染异常，AI 生成时必须遵守。

---

## 10. 零宽空格约定

`.sy` 大量使用 `​`（U+200B）作分隔占位。图片、行内代码、标签、kbd 等内联元素**两侧通常各有一个** `Data` 为 `​` 的 `NodeText`，保证渲染与光标行为。AI 生成这类内容时建议遵循该约定。

---

## 11. 思源禁用的 Markdown 语法（不应出现在 `.sy` 中）

思源在 `kernel/util/lute.go` 的 `NewLute()` 中通过 `SetXxx(false)` 禁用了以下语法，对应节点类型**永远不会**出现在 `.sy` 文件里,AI 不要生成：

| 禁用项 | 对应节点类型 | 说明 |
|---|---|---|
| `SetFootnotes(false)` | `NodeFootnotesDefBlock`/`NodeFootnotesDef`/`NodeFootnotesRef` | 脚注，全禁 |
| `SetToC(false)` | `NodeToC` | `[toc]` 目录 |
| `SetIndentCodeBlock(false)` | 缩进式代码块 | 仅支持围栏代码块 |
| `SetHeadingID(false)` | `NodeHeadingID` | 自定义标题 ID `{#id}` |
| `SetSetext(false)` | Setext 标题（`===`/`---` 下划线式） | 仅支持 ATX 风格 `#` |
| `SetYamlFrontMatter(false)` | `NodeYamlFrontMatter` | YAML 前置元数据 |
| `SetLinkRef(false)` | `NodeLinkRefDef`/`NodeLinkRefDefBlock` | 链接引用定义 |
| `SetGFMStrikethrough1(false)` | 单波浪线删除线 `~x~` | 仅支持双波浪 `~~x~~` |

> 注：`NewLute()` 另有 `SetAutoSpace(false)`、`SetCodeSyntaxHighlight(false)`、`SetExportNormalizeTaskListMarker(false)` 等非语法类开关，只影响渲染/导出行为，不会让任何节点类型消失，故未列入上表。

---

## 12. AI 写入检查清单

生成一份能被 SiYuan 正常加载的 `.sy`，逐条核对：

1. ☐ 根 `Type`=`"NodeDocument"`、`Spec`=`"2"`，根 `ID`=文件名（去 `.sy`）且 = `Properties.id`
2. ☐ 根 `Properties` 含 `id`/`title`/`type:"doc"`/`updated`
3. ☐ 每个 block 有 22 字符 `ID`，且 `Properties.id` = `ID`，`Properties.updated` 为合法 14 位时间戳
4. ☐ 内联/标记节点**不带** `ID`
5. ☐ 列表用 `ListData.Typ` 区分（缺省=无序/`1`=有序/`3`=任务）
6. ☐ `NodeList` 直接子节点**只能是** `NodeListItem`；嵌套列表要再套一层 `NodeList`
7. ☐ `BulletChar`/`Delimiter` 是 byte（JSON 表现为 int 码点）;`Marker` 是 base64
8. ☐ 任务标记通常不带 `Data`（勾选时 `TaskListItemChecked:true`，未勾选仅有 `Type`）
9. ☐ 代码块四段、数学块三段、嵌入块五段、超级块三段——结构完整
10. ☐ `NodeCodeBlockCode`/`NodeMathBlockContent` 是内联子节点，通常只有 `Type`+`Data`
11. ☐ base64 字段已编码；内容字段保持原文
12. ☐ 内联格式优先用 `NodeTextMark`，不用 `NodeStrong`/`NodeEmphasis`/`NodeLink`
13. ☐ 带样式的 TextMark 后必须跟配对的 `NodeKramdownSpanIAL`
14. ☐ HTML/IFrame/Video/Audio/AttributeView 是叶子，无 Children（内容在 `Data` 或专属字段）
15. ☐ 不要凭空构造 `AttributeViewID`/`block-ref` 的目标 ID（须指向真实存在的块/AV）
16. ☐ 不要生成思源禁用的类型（脚注/ToC/YAML/LinkRef/HeadingID 等，见 §11）

---

## 13. 禁忌与常见错误

| ❌ 错误 | ✅ 正确 |
|---|---|
| 假设所有节点都有 `Data` | `Data` 可省略,marker 节点常无 `Data` |
| 内联节点带 `ID` | 内联/标记节点不带 `ID` |
| 用 `NodeStrong`/`NodeLink` 等旧式节点 | 用 `NodeTextMark` + `TextMarkType` |
| `ListData.Typ` 只认 `1` | `Typ` 缺省=无序，`1`=有序，`3`=任务 |
| 把 `BulletChar` 当 base64 | 它是 byte,JSON 中表现为 int 码点（`42`=`*`） |
| 任务标记里强写 `"Data":"[X]"` | 真实 `.sy` 通常无 `Data`，勾选仅写 `TaskListItemChecked:true` |
| 带样式 TextMark 不配 IAL | 必须配 `NodeKramdownSpanIAL` |
| 给 `NodeAttributeView` 加 Children | 它是叶子，用 `AttributeViewID`/`AttributeViewType` |
| 改 `ID` 不同步 `Properties.id` | 二者必须一致 |
| `inline-math` 带 `TextMarkTextContent` | 它只有 `TextMarkInlineMathContent` |
| 凭空造 block-ref / AV 的目标 ID | 目标必须真实存在 |
| 把段落直接挂到 `NodeList` 下 | `NodeList` 只能含 `NodeListItem`，必须先包一层 |
| 生成脚注/ToC/YAML 等节点 | 思源禁用这些语法，不会出现在 `.sy` 中 |

---

## 14. 最小可写文档模板

```json
{
  "ID": "20260628120000-abc1234",
  "Spec": "2",
  "Type": "NodeDocument",
  "Properties": {
    "id": "20260628120000-abc1234",
    "title": "新文档",
    "type": "doc",
    "updated": "20260628120000"
  },
  "Children": [
    {
      "Type": "NodeHeading", "ID": "20260628120001-def5678", "HeadingLevel": 2,
      "Properties": { "id": "20260628120001-def5678", "updated": "20260628120001" },
      "Children": [ { "Type": "NodeText", "Data": "标题" } ]
    },
    {
      "Type": "NodeParagraph", "ID": "20260628120002-ghi9012",
      "Properties": { "id": "20260628120002-ghi9012", "updated": "20260628120002" },
      "Children": [
        { "Type": "NodeText", "Data": "正文含" },
        { "Type": "NodeTextMark", "TextMarkType": "strong", "TextMarkTextContent": "加粗" },
        { "Type": "NodeText", "Data": "。" }
      ]
    }
  ]
}
```

---

## 附：核验来源

- 样本 1:`app/guide/.../20200825162036-4dx365o.sy`（排版元素，覆盖几乎所有块类型）
- 样本 2:`app/guide/.../20200905090211-2vixtlf.sy`（内容块类型，含紧凑列表、AttributeView）
- 节点类型常量与序列化逻辑：`lute/ast/node.go`、`lute/render/json_renderer.go`、`dataparser/sy.go`
- 列表容纳校验：`lute/ast/node.go:988`(`CanContain`)
- 思源禁用语法配置：`kernel/util/lute.go:51`(`NewLute`)
- 标注 `【推断】` 的字段（如 `file-annotation-ref` 的子字段）建议在生成前用真实样本再核验一次。
