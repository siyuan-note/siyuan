# SiYuan `.sy` 文件 JSON 结构规范 —— AI 读写指南

> 规范写入基准：Spec `2`（当前写入器的输出；兼容读取器可能遇到旧版或缺少 `Spec` 的数据，并将其升级）。
> 核验样本：`20200825162036-4dx365o.sy`（排版元素）、`20200905090211-2vixtlf.sy`（内容块类型）。
> 本文档所有结论均基于真实样本及当前 Lute / 思源内核源码核验。上述样本包含少量已知的历史遗留数据；样本与当前源码不一致时，规范写入规则以当前源码为准。
> 本指南描述普通笔记本中的明文 `.sy` JSON，或已解锁加密笔记本的解密后 AST。加密笔记本磁盘上的 `.sy` 文件是密文，不能当作 JSON 直接编辑。
> 配套文档：[`WORKSPACE.zh-CN.md`](./WORKSPACE.zh-CN.md) 讲工作区在磁盘上的整体布局（笔记本、父子文档、资源文件的组织方式）；本文档专注 `.sy` 文件**内部**的 JSON 结构。

## 0. 一句话本质

明文 `.sy` 文件是序列化为 JSON 的 Lute AST 树。根节点为 `NodeDocument`，正文是递归嵌套的 `Children` 数组。不存在单独维护的 JSON Schema；Lute 的 `ast.Node` 和 `ListData` Go 结构体是序列化格式的事实来源。树中保存文档 AST 及其 IAL，资源文件、属性视图定义和可重建索引则位于树外。

## 0.1 规范写入与兼容读取

本指南区分新写入器应生成的格式，以及内核可以容忍并规范化的历史数据：

| 术语 | 含义 |
|---|---|
| **必需** | 新生成的规范 Spec 2 数据中必须存在 |
| **可选** | 字段为空或带有 `omitempty` 时可以省略 |
| **兼容输入** | 读取器可按明确兼容规则接收并保留、修复或升级的历史或外部数据 |

除非某节另有说明，本文的“必需”均指新数据的规范写入要求。`dataparser.ParseJSON` 是兼容读取器，而不是严格的 Schema 校验器；例如，它可以补入缺失的空段落、为缺少 ID 的块分配 ID，并升级旧版 `Spec`。

---

## 0.5 何时直接读写 `.sy`（优先级）

思源提供了 **HTTP API、MCP、CLI** 三条官方路径来修改数据。**默认应优先使用它们**，因为内核会负责 AST 序列化、块 ID 分配，以及两套索引的同步——块树索引（`blocktree.db`，块 ID 到文件路径的映射，块引用和面包屑依赖它）和全文搜索索引（`siyuan.db` + FTS5）。直接改盘绕过了这些逻辑，容易导致索引不一致。

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

> ⚠️ 直接改盘后，通常需要触发一次“重建索引”才能让搜索和块引用生效。若思源正在运行，应优先使用 HTTP API，由内核负责序列化与索引同步。
> ⚠️ 不要直接修改加密笔记本的持久化文件。请在解锁笔记本后使用专用 API，以保持加密、认证和隔离索引的一致性。

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
| `ID` | ✅ | 文档块 ID，**等于去掉 `.sy` 后的文件名** |
| `Spec` | ✅ | 当前规范文件为 `"2"`；旧值或缺失值属于兼容输入，可以升级 |
| `Type` | ✅ | `"NodeDocument"` |
| `Properties` | ✅ | 文档级 IAL，见 §8 |
| `Children` | ✅ | 正文子块数组；规范文件至少包含一个块 |

> ⚠️ 文件路径与根 ID 严格对应：`data/<box>/<...>/<根ID>.sy`。改根 ID 等于改文件名，AI 不要随意改根 ID。文件系统的完整布局见 [`WORKSPACE.zh-CN.md`](./WORKSPACE.zh-CN.md)。
> 兼容读取器会在 `Children` 缺失或为空时插入空段落，但新写入器应自行写出该段落。

---

## 2. 通用字段语义（每个节点都适用）

| 字段 | 类型 | 出现条件 | 语义 |
|---|---|---|---|
| `Type` | string | **所有节点必有** | 类型判别字段，如 `"NodeParagraph"` |
| `ID` | string | 规范块节点必需；兼容输入的非块节点也可能存在 | 块使用的 22 字符 ID；规范写入器不为内联或标记节点新增该字段 |
| `Data` | string | 部分 | 文本/HTML/markdown 原文；**可省略**（不能假设必有） |
| `Properties` | object | 块及部分内联节点 | IAL，`map[string]string`；内联用途包括带样式文本、图片和表格单元格 |
| `Children` | array | 容器和结构复合节点 | 子节点数组 |
| 类型专属字段 | - | 按类型 | 如 `HeadingLevel`、`ListData`、`TextMarkType`、`AttributeViewID` |

**核心判别规则**：`Type` 决定节点是否为块，`ast.Node.IsBlock()` 是权威判断；不能根据是否存在 `ID` 判断。规范 Spec 2 数据中的每个块都有 `ID` 及与之匹配的 `Properties.id`，新建的内联或标记节点则没有这些字段。旧版缺陷生成的历史文件可能在 `NodeCodeBlockCode`、`NodeMathBlockContent` 等非块节点上带有 ID。兼容读取器和编辑器可在规范化过程中清理这些遗留的 `ID` / `Properties.id` 字段，但必须按 `Type` 判断节点类型，不能仅因 `ID` 不符合规范而删除节点本身。

---

## 3. ID 与时间戳规则

- **ID 格式**：`YYYYMMDDHHMMSS-xxxxxxx` = 14 位时间戳 + `-` + 7 位随机 `[a-z0-9]`。例：`20210104091228-ttcj9nm`。
- **唯一性**：每个新生成的文档和块 ID 必须在整个工作区中保持唯一，而不只是在单个文件中唯一。
- **根 ID** 来自文件名，**不**重新生成。
- **子块 ID** 按上述格式重新生成；绝不能复制示例或模板中的字面 ID。
- `Properties.updated` 使用同样的 14 位时间戳，语义为“最后更新时间”。
- 修改块内容或结构时，应刷新被修改块、其块级祖先、适用的前置标题以及文档根节点的 `Properties.updated`。
- 修改任何块的 `ID` 时，必须**同步** `Properties.id`。其 `Properties.updated` 不得早于新 ID 中编码的创建时间。
- 兼容的历史输入可能缺少 `updated`；规范写入的新数据应为所有块节点提供该字段。

---

## 4. 节点类型目录

### 块节点（规范数据中有 ID）

**叶子块**：`NodeParagraph`、`NodeHeading`、`NodeThematicBreak`、`NodeHTMLBlock`、`NodeCodeBlock`、`NodeMathBlock`、`NodeTable`、`NodeBlockQueryEmbed`、`NodeAttributeView`、`NodeIFrame`、`NodeVideo`、`NodeAudio`、`NodeWidget`、`NodeCustomBlock`

**容器块**：`NodeList`、`NodeListItem`、`NodeBlockquote`、`NodeCallout`、`NodeSuperBlock`

### 内联或标记节点（规范数据中无 ID）

`NodeText`、`NodeTextMark`、`NodeImage`、`NodeKramdownSpanIAL`、`NodeSoftBreak`、`NodeBr`、`NodeBackslash`、`NodeBackslashContent`、`NodeHeadingC8hMarker`、`NodeBlockquoteMarker`、`NodeTaskListItemMarker`、`NodeBang`、`NodeOpenBracket`、`NodeCloseBracket`、`NodeOpenParen`、`NodeCloseParen`、`NodeLinkText`、`NodeLinkDest`、`NodeLinkSpace`、`NodeLinkTitle`、`NodeCodeBlockCode`、`NodeCodeBlockFenceOpenMarker`、`NodeCodeBlockFenceInfoMarker`、`NodeCodeBlockFenceCloseMarker`、`NodeMathBlockContent`、`NodeMathBlockOpenMarker`、`NodeMathBlockCloseMarker`、`NodeSuperBlockOpenMarker`、`NodeSuperBlockLayoutMarker`、`NodeSuperBlockCloseMarker`、`NodeOpenBrace`、`NodeCloseBrace`、`NodeBlockQueryEmbedScript`、`NodeTableHead`、`NodeTableRow`、`NodeTableCell`

> “叶子块”表示该节点不能包含其他**块节点**；它仍可拥有结构性内联子节点，例如代码块、数学块和表格。
> 上述“规范数据中无 ID”是规范写入规则。显式规范化过程可以清理兼容历史非块节点已有的 `ID`，但不能用该字段判断节点是否为块，也不能据此删除节点本身。
> 规范写入禁用的类型，包括解析器禁用的语法及仅用于检测的 `NodeGitConflict` 节点族，列于 §11，因此未纳入此目录。

---

## 5. 各块类型详解与可复制示例

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
- `NodeHeadingC8hMarker`（`Data` 如 `"## "`）**可选**，有无都合法。建议生成时**省略**它，更简洁。
- 思源建议**正文顶层用二级标题**，不要用一级。

### 5.3 列表（关键：用 `ListData.Typ` 区分类型）

> **★ 列表的规范结构约束**：`NodeList` 的直接子节点**只能**是 `NodeListItem`，即 `CanContain` 返回 `NodeListItem == nodeType`。段落、代码块、子列表等任何其他块都**不能**直接挂在 `NodeList` 下，必须先包一层 `NodeListItem`。`dataparser.ParseJSON` 不会将其作为严格校验步骤，因此直接写入器必须自行验证结构。

```
✅ 正确                          ❌ 错误
NodeList                        NodeList
└─ NodeListItem                  ├─ NodeParagraph        ← 非法
   └─ NodeParagraph              └─ NodeCodeBlock         ← 非法
```

**嵌套列表**的正确写法是再套一层 `NodeList`（`NodeListItem` 走默认 `CanContain` 分支，不能直接含另一个 `NodeListItem`）：

```
✅ 正确                          ❌ 错误
NodeList                        NodeList
└─ NodeListItem                  └─ NodeListItem
   ├─ NodeParagraph                 ├─ NodeParagraph
   └─ NodeList  ← 子列表            └─ NodeListItem  ← 非法
      └─ NodeListItem
         └─ NodeParagraph
```

**无序列表**（省略 `Typ`）：

```json
{ "Type": "NodeList", "ID": "...", "ListData": {},
  "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeListItem", "ID": "...",
      "ListData": { "BulletChar": 42, "Marker": "Kg==" },
      "Properties": { "id": "...", "updated": "..." },
      "Children": [
        { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
          "Children": [ { "Type": "NodeText", "Data": "列表项一" } ] }
      ] }
  ] }
```

**有序列表**（`Typ: 1`）：

```json
{ "Type": "NodeList", "ID": "...", "ListData": { "Typ": 1 },
  "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeListItem", "ID": "...",
      "ListData": { "Typ": 1, "Tight": true, "Start": 1, "Delimiter": 46, "Padding": 3, "Marker": "MS4=", "Num": 1 },
      "Properties": { "id": "...", "updated": "..." },
      "Children": [
        { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
          "Children": [ { "Type": "NodeText", "Data": "列表项一" } ] }
      ] }
  ] }
```

**任务列表**（`Typ: 3`）；每个 `NodeListItem` 都以 `NodeTaskListItemMarker` 开头：

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
          "Children": [ { "Type": "NodeText", "Data": "待办一" } ] }
      ] }
  ] }
```

### 5.4 `ListData` 字段全解（★ 最易踩坑）

| 字段 | 类型（代码） | JSON 表现 | 说明 |
|---|---|---|---|
| `Typ` | int | 数字 | **列表类型判别**：省略表示无序，`1` 表示有序，`3` 表示任务 |
| `Tight` | bool | 布尔 | 紧凑态（无空行）；可选 |
| `BulletChar` | byte | 数字 | 无序/任务列表的项目符号 **ASCII 码点**（`42`=`*`，`45`=`-`） |
| `Delimiter` | byte | 数字 | 有序列表分隔符 ASCII 码点（`46`=`.`） |
| `Start` | int | 数字 | 有序列表起始编号 |
| `Num` | int | 数字 | 该项序号；无序/任务列表通常缺省或为 `-1` |
| `Padding` | int | 数字 | 缩进填充数；可选 |
| `MarkerOffset` | int | 数字 | 标记符缩进偏移；可选 |
| `Checked` | bool | 布尔 | 解析任务标记时派生的兼容元数据；不是整个列表的聚合值，可以省略 |
| `Marker` | []byte | **base64 字符串** | 标记符原文的 **base64**；可能含分隔符（`"MS4="`=`1.`）也可能不含（`"MQ=="`=`1`） |

> 关键区别：`BulletChar` / `Delimiter` 在代码中是 `byte`，在 JSON 中表现为 ASCII 码点数字；`Marker` 在代码中是 `[]byte`，在 JSON 中表现为 base64 字符串。`Marker` / `BulletChar` / `Delimiter` 都带 `omitempty`，可以省略。

### 5.5 任务标记

使用 `X` 勾选：

```json
{ "Type": "NodeTaskListItemMarker", "TaskListItemChecked": true, "TaskListItemMarker": 88 }
```

使用空格表示未勾选：

```json
{ "Type": "NodeTaskListItemMarker", "TaskListItemMarker": 32 }
```

`!` 等任意非空格标记也表示已勾选，并保留其原始字节：

```json
{ "Type": "NodeTaskListItemMarker", "TaskListItemChecked": true, "TaskListItemMarker": 33 }
```

`TaskListItemMarker` 是 Go `byte`，因此 JSON 使用数字保存其 ASCII 码点。当前渲染优先读取该字段，并在兼容旧数据时回退到 `TaskListItemChecked`。AST 直接由 Markdown 解析而来时，`Data` 可能存在，例如 `"[X]"`；编辑器生成的 `.sy` 数据通常省略它，不能将 `Data` 当作任务状态的权威来源。

### 5.6 引述块

```json
{ "Type": "NodeBlockquote", "ID": "...", "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeBlockquoteMarker", "Data": "> " },
    { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
      "Children": [ { "Type": "NodeText", "Data": "引述内容" } ] }
  ] }
```

> `NodeBlockquoteMarker.Data` 可以是 `">"` 或 `"> "`，都合法。

### 5.7 提示块（Callout / GFM Alert）

```json
{ "Type": "NodeCallout", "ID": "...",
  "CalloutType": "NOTE", "CalloutTitle": "Note", "CalloutIcon": "✏️",
  "Properties": { "id": "...", "updated": "..." },
  "Children": [ { "Type": "NodeParagraph", "ID": "...", "Properties": { "id": "...", "updated": "..." },
    "Children": [ { "Type": "NodeText", "Data": "提示内容" } ] } ] }
```

| `CalloutType` | `CalloutTitle` | `CalloutIcon` |
|---|---|---|
| `NOTE` | `Note` | `✏️` |
| `TIP` | `Tip` | `💡` |
| `IMPORTANT` | `Important` | `❗` |
| `WARNING` | `Warning` | `⚠️` |
| `CAUTION` | `Caution` | `🚨` |

上表列出五种内置类型及其默认值，同时也支持自定义 `CalloutType`、标题和图标。`CalloutIconType: 0` 表示 `CalloutIcon` 是直接的 emoji 字符；这是默认值，会因 `omitempty` 省略。`CalloutIconType: 1` 表示 `CalloutIcon` 是自定义图标路径。

### 5.8 超级块（可嵌套，三标记包络）

```json
{ "Type": "NodeSuperBlock", "ID": "...", "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeSuperBlockOpenMarker" },
    { "Type": "NodeSuperBlockLayoutMarker", "Data": "col" },
    { "Type": "NodeSuperBlock", "ID": "...", "Properties": { "id": "...", "updated": "..." }, "Children": [ ... 内嵌超级块，Data 为 "row" ... ] },
    { "Type": "NodeSuperBlockCloseMarker" }
  ] }
```

> `NodeSuperBlockLayoutMarker.Data` 只能是 `"row"`（纵向）或 `"col"`（横向）。规范超级块包含开始标记、布局标记、至少一个内容块和结束标记，因此至少有四个子节点。它可以包含多个内容块并可嵌套，也是唯一能容纳任意块（包括自身）的容器。

### 5.9 嵌入块（五段结构 `{{ ... }}`）

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

### 5.10 代码块（四段结构，仅围栏式）

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

要点：

- `NodeCodeBlockCode` 承载代码内容（放 `Data`，原始文本，`\n` 转义），是 `NodeCodeBlock` 的内联子节点。
- 外围 fence marker（Open/Info/Close）同样是内联子节点。
- `CodeBlockInfo` 是**语言名的 base64**（`"Z28="` = `go`）。父节点上的六个字段（`IsFencedCodeBlock` / `CodeBlockFenceChar` / `CodeBlockFenceLen` / `CodeBlockOpenFence` / `CodeBlockInfo` / `CodeBlockCloseFence`）均带 `omitempty`，可按需省略；较新的 `.sy` 文件通常只写 `"IsFencedCodeBlock": true`。
- 当前思源 Markdown 配置禁用缩进式代码块（`SetIndentCodeBlock(false)`）；规范新代码块采用围栏式结构。

### 5.11 数学块（三段结构）

```json
{ "Type": "NodeMathBlock", "ID": "...", "Properties": { "id": "...", "updated": "..." },
  "Children": [
    { "Type": "NodeMathBlockOpenMarker" },
    { "Type": "NodeMathBlockContent", "Data": "a^2 + b^2 = c^2" },
    { "Type": "NodeMathBlockCloseMarker" }
  ] }
```

### 5.12 HTML / IFrame / Widget / Video / Audio 块（叶子，内容在顶层 `Data`）

```json
{ "Type": "NodeHTMLBlock", "ID": "...", "Data": "<div>\n<ruby>你<rt>nǐ</rt>...</div>", "Properties": { "id": "...", "updated": "..." } }
{ "Type": "NodeIFrame", "ID": "...", "Data": "<iframe src=\"...\"></iframe>", "Properties": { "id": "...", "updated": "..." } }
{ "Type": "NodeWidget", "ID": "...", "Data": "<iframe src=\"/widgets/example\" data-subtype=\"widget\"></iframe>", "Properties": { "id": "...", "updated": "..." } }
{ "Type": "NodeVideo", "ID": "...", "Data": "<video controls src=\"assets/x.mp4\"></video>", "Properties": { "id": "...", "updated": "..." } }
{ "Type": "NodeAudio", "ID": "...", "Data": "<audio controls src=\"assets/x.wav\"></audio>", "Properties": { "id": "...", "updated": "..." } }
```

> 这五种节点**没有 `Children`**；HTML 内容经 JSON 转义后直接放在顶层 `Data` 中。

### 5.13 表格

```json
{ "Type": "NodeTable", "ID": "...", "TableAligns": [0, 0, 0],
  "Properties": { "id": "...", "updated": "...", "colgroup": "||" },
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
- `TableAligns`：每列对齐方式组成的 int 数组，`0` 表示默认，`1` 表示左对齐，`2` 表示居中，`3` 表示右对齐。
- `Data`（`thead`/`tr`/`th`/`td`）在紧凑文件里**可省略**。
- `Properties.colgroup` 使用 `|` 分隔各列的 CSS 样式字符串；空段表示该列没有显式样式。
- 表格可选的 `Properties.caption` 保存标题 HTML。
- `NodeTableCell` 可使用 `Properties.colspan`、`Properties.rowspan` 和 `Properties.style` 保存合并单元格及单元格样式状态。

### 5.14 数据库块（AttributeView，叶子）

```json
{ "Type": "NodeAttributeView", "ID": "...",
  "Properties": { "custom-sy-av-view": "20251230141609-lcme2fh", "id": "...", "updated": "..." },
  "AttributeViewID": "20251230141609-2kvghrg",
  "AttributeViewType": "table" }
```

- **没有 Children**。
- `AttributeViewID` 指向 AV 表数据，该数据存放在单独的 `.json` 中；**不要**凭空构造此 ID。
- `AttributeViewType`：`table` / `kanban` / `gallery` 等。该值由载体绑定视图的布局派生，不是独立的视图选择器。
- 可选的 `custom-sy-av-view` 记录当前视图 ID。缺失或未指向所引用 AttributeView 中的视图时，回退到 AttributeView 的当前视图或首个可用视图。

> 建议 AI **不要创建新的 AttributeView 块**，因为表数据不在 `.sy` 中，还需要配套文件。

### 5.15 分隔线

```json
{ "Type": "NodeThematicBreak", "ID": "...", "Properties": { "id": "...", "updated": "..." } }
```

### 5.16 自定义块

```json
{ "Type": "NodeCustomBlock", "ID": "...", "Data": "自定义原始内容",
  "CustomBlockInfo": "info", "Properties": { "id": "...", "updated": "..." } }
```

`NodeCustomBlock` 是没有 `Children` 的叶子节点。`Data` 保存原始内容，`CustomBlockInfo` 保存围栏信息字符串。

---

## 6. 内联节点详解

### 6.1 `NodeText`（纯文本）

```json
{ "Type": "NodeText", "Data": "普通文本" }
```

`Data` 为空字符串时会因 `omitempty` **省略**；因此 `{ "Type": "NodeText" }` 表示空文本，而不是 U+200B。实际零宽空格必须明确写入 `Data`，例如使用 JSON 转义 `"\u200b"`。

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
- 删除线**仅支持双波浪 `~~x~~`**，不支持单波浪 `~x~`（`SetGFMStrikethrough1(false)`）。
- 反斜杠转义不是 `NodeTextMark` 子类型：它对应独立的 `NodeBackslash` 节点，不会出现在 `TextMarkType` 取值中。

### 6.3 带样式的内联文本（★ 必须成对）

带颜色/特效的 `NodeTextMark`（带 `Properties.style`）**后面必须紧跟一个** `NodeKramdownSpanIAL`，且二者 style 文本一致：

```json
{ "Type": "NodeTextMark", "Properties": { "style": "color: var(--b3-font-color1); background-color: var(--b3-font-background1);" },
  "TextMarkType": "strong", "TextMarkTextContent": "颜色 1" },
{ "Type": "NodeKramdownSpanIAL", "Data": "{: style=\"color: var(--b3-font-color1); background-color: var(--b3-font-background1);\"}" }
```

> AI 生成带样式的内联文本时，这两节点必须成对出现，否则 kramdown 往返会丢样式。

### 6.4 `NodeImage`（七段核心结构；可选标题增加两个节点）

```json
{ "Type": "NodeImage", "Data": "span", "Children": [
  { "Type": "NodeBang" },
  { "Type": "NodeOpenBracket" },
  { "Type": "NodeLinkText", "Data": "alt 文本" },
  { "Type": "NodeCloseBracket" },
  { "Type": "NodeOpenParen" },
  { "Type": "NodeLinkDest", "Data": "assets/image-2021.png" },
  { "Type": "NodeLinkSpace" },
  { "Type": "NodeLinkTitle", "Data": "图片标题" },
  { "Type": "NodeCloseParen" }
] }
```

- 编辑器生成的图片节点通常带有 `Data: "span"`；兼容的紧凑数据可以省略空 `Data`。
- `NodeBang` / `NodeOpenBracket` / `NodeCloseBracket` / `NodeOpenParen` / `NodeCloseParen` 等标记节点的 `Data` **可以省略**。
- `NodeLinkText` 和 `NodeLinkDest` 分别保存替代文本和目标地址。存在标题时，在 `NodeCloseParen` 前依次插入 `NodeLinkSpace` 和 `NodeLinkTitle`；不含这两个节点的七节点形式同样有效。

### 6.5 换行与反斜杠转义

```json
{ "Type": "NodeSoftBreak", "Data": "\n" }
{ "Type": "NodeBr" }
{ "Type": "NodeBackslash",
  "Children": [ { "Type": "NodeBackslashContent", "Data": "|" } ] }
```

- `NodeSoftBreak` 表示软换行。
- `NodeBr` 表示显式 `<br>`。
- `NodeBackslash` 使用内联子节点包装被转义字符；它不是 `NodeTextMark` 子类型。

---

## 7. base64 编码约定（★ 必读）

| 字段 | 编码 | 例 |
|---|---|---|
| `ListData.Marker` | base64 | `Kg==` = `*`，`MS4=` = `1.`，`MQ==` = `1` |
| `CodeBlockInfo` | base64 | `Z28=` = `go`，`amF2YQ==` = `java` |
| `CodeBlockOpenFence`/`CloseFence` | base64 | `YGBg` = ` ``` ` |
| `ListData.BulletChar`/`Delimiter` | **int ASCII 码点**（**不是** base64） | `42` = `*`，`46` = `.` |
| `TaskListItemMarker` | **int ASCII 码点**（**不是** base64） | `32` = 空格，`88` = `X`，`33` = `!` |
| `Data`（段落文本、代码内容、链接、SQL 等） | **原文**（不编码） | `"package main\n..."` |

> 判断规则：Go `[]byte` 字段（如 `Marker` / `Fence` / `Info`）会成为 base64 字符串；Go `byte` 字段（如 `BulletChar` / `Delimiter` / `TaskListItemMarker`）会成为 JSON 数字；`Data`、`TextMarkTextContent`、`TextMarkInlineMathContent` 等内容字符串保持原文。

---

## 8. Properties（IAL）

扁平 `map[string]string`。

**文档级（规范写入时必需）**：`id`、`title`、`type`（恒为 `"doc"`）、`updated`。可选：`icon`（emoji 码点十六进制，如 `"1f4f0"`；自定义图标文件名；或 HTTP(S) 图片 URL）、`title-img`（题头图样式，CSS 声明字符串，如 `background-image:url("assets/example.jpg")`）。

**块级（规范写入时必需）**：`id`（等于节点 `ID`）、`updated`。兼容的历史数据可能缺少 `updated`，但新写入器应提供它。常见可选属性包括 `style`、`fold: "1"`、`name`、`alias`、`memo`、`bookmark`、表格的 `colgroup` / `caption`、属性视图的 `custom-sy-av-view`，以及任意 `custom-*` 属性。

**内联级（可选）**：部分内联或结构节点也使用 `Properties`，包括带样式的 `NodeTextMark`、定位或缩放后的 `NodeImage`，以及合并或带样式的 `NodeTableCell`。内联节点存在 `Properties` 并不会使其成为块。

> 规范权威键是**小写** `id`。某些旧导入文件还带有遗留的大写 `ID`；显式规范化过程可以清理该兼容遗留字段。

---

## 9. 容器容纳规则速查

| 容器 | 可含 | 不可含 |
|---|---|---|
| `NodeList` | **仅** `NodeListItem` | 任何其他块（段落/代码块/子列表都必须先套 `NodeListItem`） |
| `NodeListItem` | 任意非 `NodeListItem` 块（段落/代码块/子 `NodeList`/超级块…） | `NodeListItem`（嵌套要再套 `NodeList`） |
| `NodeBlockquote` | 任意非 `NodeListItem` 块 + 一个 `NodeBlockquoteMarker` | `NodeListItem` |
| `NodeCallout` | 任意非 `NodeListItem` 块 | `NodeListItem` |
| `NodeSuperBlock` | **任意块**（含嵌套超级块），位于开始、布局和结束标记组成的包络内 | 无（最宽松） |
| `NodeDocument` | 任意非 `NodeListItem` 块 | `NodeListItem` |

> 这些是从 Lute `CanContain` 派生的规范写入约束。Markdown 解析器在构造树时会应用它们，但 `dataparser.ParseJSON` 不是严格的容纳关系校验器，不会拒绝所有违规结构。直接写入器必须自行验证这些关系；无效树可能导致解析或渲染异常。

---

## 10. 零宽空格处理

兼容 AST 数据可能在 `NodeText` 中包含 `​`（U+200B），用于内联元素附近的光标边界。编辑时应保留已有的 U+200B，但不要在每个图片、行内代码、标签、kbd 或类似节点两侧都合成含 U+200B 的 `NodeText`；Protyle 会在渲染编辑器 DOM 时按上下文注入这些光标占位符。省略 `Data` 表示空字符串，而不是 U+200B。

---

## 11. 规范写入禁用的类型（不要生成）

规范写入器不得生成以下语法或节点族。其中大多数通过 `kernel/util/lute.go` 的 `NewLute()` 中的 `SetXxx(false)` 禁用，因此当前配置的 Markdown 解析器不会生成相应节点。`NodeGitConflict` 是特殊情况：`NewLute()` 启用 `SetGitConflict(true)` 仅用于识别输入中已有的原始 Git 冲突标记，该节点族仍属于规范 `.sy` 写入禁用类型。兼容读取器可能在历史或外部生成的 JSON 中遇到下列任意类型。

| 规则 | 对应节点类型 | 说明 |
|---|---|---|
| 规范写入禁用；`SetGitConflict(true)` 用于识别已有输入 | `NodeGitConflict`/`NodeGitConflictOpenMarker`/`NodeGitConflictContent`/`NodeGitConflictCloseMarker` | 原始 Git 冲突标记块；不得生成 |
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

生成或兼容编辑一份能被思源正常加载的 `.sy` 时，应逐条核对：

1. ☐ 根 `Type` = `"NodeDocument"`、`Spec` = `"2"`；根 `ID` 等于去掉 `.sy` 后的文件名，并等于 `Properties.id`
2. ☐ 根 `Properties` 包含 `id` / `title` / `type:"doc"` / `updated`
3. ☐ 每个新生成的 ID 都是新值且在整个工作区中唯一；每个规范块都有 22 字符 `ID`、与之匹配的 `Properties.id`，以及合法的 14 位 `Properties.updated`
4. ☐ 根据 `Type` 而不是 `ID` 判断块；不要为新内联或标记节点添加 ID，只能将历史非块 ID 作为字段规范化清理，不能删除节点本身
5. ☐ 修改内容或结构时，刷新被修改块、其块级祖先、适用的前置标题以及文档根节点的 `updated`
6. ☐ 列表通过 `ListData.Typ` 区分（`0` 或省略表示无序，`1` 表示有序，`3` 表示任务），`NodeList` 和每个 `NodeListItem` 都使用对应的 `Typ`
7. ☐ `NodeList` 的直接子节点**只能**是 `NodeListItem`；嵌套列表应在列表项中再放一个 `NodeList`
8. ☐ Go `byte` 字段（`BulletChar`、`Delimiter`、`TaskListItemMarker`）是 JSON 数字；Go `[]byte` 字段（`Marker`、围栏、信息）是 base64 字符串
9. ☐ 任务标记使用 `TaskListItemMarker` 保存原始标记字节（`32` 表示空格，`88` 表示 `X`，其他非空格字节表示已勾选）；`TaskListItemChecked` 是兼容回退，`Data` 不是权威状态
10. ☐ 代码块有四个结构子节点，数学块有三个，查询嵌入块有五个，超级块使用开始、布局、结束标记包裹至少一个内容块
11. ☐ `NodeCodeBlockCode` 和 `NodeMathBlockContent` 是结构性内联子节点；其历史 ID 可以清理，但不能删除节点
12. ☐ 内容字符串保持原文；只有 `[]byte` 字段使用 base64
13. ☐ 现代内联格式优先使用 `NodeTextMark`，而不是旧式 `NodeStrong` / `NodeEmphasis` / `NodeLink`
14. ☐ 带样式的 `NodeTextMark` 后紧跟配对的 `NodeKramdownSpanIAL`
15. ☐ HTML / IFrame / Widget / Video / Audio / AttributeView / CustomBlock 节点是没有 `Children` 的叶子；内容放在 `Data` 或类型专属字段中
16. ☐ 不要凭空构造 `AttributeViewID` 或块引用目标 ID；它们必须指向真实的属性视图或块
17. ☐ 不要生成 `NodeGitConflict`、脚注、ToC、YAML、LinkRef、HeadingID 等禁用类型；兼容读取历史或外部数据时应容忍它们
18. ☐ 编辑时保留已有的 U+200B 文本，但不要在内联元素周围统一合成零宽空格节点
19. ☐ 将加密笔记本磁盘文件视为密文而不是 JSON；只能通过已解锁笔记本的 API 修改

---

## 13. 禁忌与常见错误

| ❌ 错误 | ✅ 正确 |
|---|---|
| 假设所有节点都有 `Data` | `Data` 可以省略，标记节点通常没有 `Data` |
| 因节点带有 `ID` 就认定它是块，或将整个节点作为异常数据删除 | `Type` 决定块类型；兼容编辑器可以清理历史非块节点的 `ID` 字段，但不能删除节点本身 |
| 用 `NodeStrong`/`NodeLink` 等旧式节点 | 用 `NodeTextMark` + `TextMarkType` |
| `ListData.Typ` 只接受 `1` | `0` 或省略表示无序，`1` 表示有序，`3` 表示任务 |
| 把 `BulletChar` 当作 base64 | 它是 `byte`，在 JSON 中表现为 int 码点（`42` = `*`） |
| 把 `"Data":"[X]"` 当作权威任务状态 | 使用数字 `TaskListItemMarker` 保存原始标记字节；`TaskListItemChecked` 是兼容回退 |
| 带样式 TextMark 不配 IAL | 必须配 `NodeKramdownSpanIAL` |
| 给 AttributeView、Widget 或 CustomBlock 节点添加 `Children` | 它们是叶子，应使用 `Data` 或类型专属字段 |
| 改 `ID` 不同步 `Properties.id` | 二者必须一致 |
| 只更新时间戳被直接编辑的块 | 还要刷新其块级祖先、适用的前置标题以及文档根节点 |
| `inline-math` 带 `TextMarkTextContent` | 它只有 `TextMarkInlineMathContent` |
| 凭空构造块引用或属性视图的目标 ID | 目标必须真实存在 |
| 把段落直接挂到 `NodeList` 下 | `NodeList` 只能含 `NodeListItem`，必须先包一层 |
| 在每个内联元素两侧都添加 U+200B 文本节点 | 保留已有 U+200B；由 Protyle 按上下文添加编辑器 DOM 光标占位符 |
| 生成 `NodeGitConflict`、脚注、ToC、YAML 等节点 | 它们属于规范写入禁用类型；兼容读取器仍可能遇到历史或外部节点 |

---

## 14. 最小可写文档模板

> ⚠️ 下列 ID 和时间戳仅用于示意。实际写入时必须生成在整个工作区中唯一的新 ID 和当前时间戳，绝不能复制这些字面值。

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

- 样本 1：`app/guide/20210808180117-czj9bvb/20200812220555-lj3enxa/20210808180320-abz7w6k/20200825162036-4dx365o.sy`（排版元素，覆盖几乎所有块类型）
- 样本 2：`app/guide/20210808180117-czj9bvb/20200812220555-lj3enxa/20210808180320-fqgskfj/20200905090211-2vixtlf.sy`（内容块类型，包含紧凑列表和 AttributeView）
- 这些样本包含旧版缺陷产生的历史遗留数据，应将其视为兼容性样本；规范化过程可以清理遗留的非块 ID，而规范新写入遵循当前节点语义。
- 节点类型常量及任务、列表字段：`lute/ast/node.go`
- 序列化与兼容解析：`lute/render/json_renderer.go`、`dataparser/sy.go`
- 容纳规则：Lute `ast.Node.CanContain`
- 规范写入禁用项与语法配置：`kernel/util/lute.go`（`NewLute`），包括 Git 冲突输入识别
- Lute 依赖版本：`kernel/go.mod`
