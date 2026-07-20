# SiYuan 工作区文件系统布局 —— 参考文档

> 本文档描述 SiYuan 工作区在磁盘上的目录与文件组织。
> 它与 [`SY-FORMAT.zh-CN.md`](./SY-FORMAT.zh-CN.md) 互补：后者讲 `.sy` 文件**内部**的 JSON 结构，本文档讲工作区**整体**在文件系统中的布局。
> 所有结论基于真实工作区与内核代码核验。

## 0. 一句话本质

SiYuan 工作区是一棵**自描述**的目录树：笔记本、文档和资源文件以文件或目录形式存在磁盘上。**文件名即 ID，目录结构即文档层级**。文件系统保存权威的原始内容，`temp/` 下的 SQLite 数据库则是可重建的索引和缓存。普通笔记本内容可以直接读取；加密笔记本内容以密文落盘，必须通过已解锁的内核访问。

---

## 1. 速查树（总览）

```
<工作区根>/   例 F:\SiYuan\
├── .lock                       # 运行时工作区锁
├── conf/
│   ├── conf.json              # ★工作区总配置（appearance/system/sync/editor...）
│   ├── appearance/             # 已安装的主题、图标和语言资源
│   ├── ca.crt / ca.key / cert.pem / key.pem   # TLS 证书和密钥
│   └── windowState.json        # 桌面端窗口状态
├── data/                       # DataDir — 所有笔记本数据的根
│   ├── .siyuan/                # 工作区级隐藏配置
│   │   ├── syncignore / searchignore / embeddingignore / indexignore / refsearchignore
│   │   └── notebook-crypto-backup.json # 可选的加密笔记本全局恢复元数据
│   ├── assets/                 # ★全局资源文件（图片/音视频/文件）
│   ├── templates/              # 全局模板（.md）
│   ├── widgets/                # 挂件
│   ├── plugins/                # 插件
│   ├── emojis/                 # 自定义 emoji
│   ├── snippets/               # 代码片段（CSS/JS）
│   ├── public/                 # 静态资源
│   ├── storage/                # 持久化结构化数据（属性视图、插件状态等）
│   └── <boxID>/                # ★笔记本（目录名 = 笔记本 ID）
│       ├── .siyuan/
│       │   ├── conf.json       # ★笔记本配置（BoxConf：name/icon/closed...）
│       │   ├── sort.json       # 可选的自定义排序映射 {docID: order}
│       │   ├── boxDoc.json     # 可选的顶层笔记本文档标记，用于 .sy.zip 导入导出
│       │   └── notebook-crypt-backup.json # 可选的加密笔记本密钥包络备份
│       ├── <boxID>.sy          # 可选的顶层笔记本文档（rootID = 笔记本 ID）
│       ├── <docID>.sy          # 文档（JSON 树；文件名 = 文档 rootID）
│       ├── <docID>/            # ★该文档的子文档目录（同名配对）
│       │   ├── <childID>.sy
│       │   └── <childID>/ ...  # 任意深度嵌套
│       ├── assets/             # 笔记本本地资源文件（加密笔记本必须使用）
│       └── storage/av/         # 加密笔记本属性视图定义
├── repo/                       # 数据仓库（快照/同步）
├── history/                    # 编辑历史归档
├── corrupted/                  # 可选的损坏数据隔离目录
└── temp/                       # 可重建索引、队列、缓存、日志和导出文件
    ├── siyuan.db / blocktree.db / asset_content.db / history.db
    ├── siyuan-encrypted-<boxID>.db / siyuan-encrypted-<boxID>-blocktree.db
    └── queue/ / export/ / os/ / siyuan.log
```

---

## 2. 工作区根

工作区根由用户选定（如 `F:\SiYuan\`）。判定一个目录是否为合法工作区：`conf/conf.json` 存在且含 `kernelVersion` 字段。

工作区根目录条目：

| 条目 | 用途 |
|---|---|
| `.lock` | 防止两个内核同时打开同一工作区的运行时锁 |
| `conf/` | 工作区级配置、外观资源及 TLS 证书和密钥 |
| `data/` | **所有笔记本数据**（本文档核心） |
| `repo/` | 数据快照仓库（用于同步/历史） |
| `history/` | 编辑历史归档 |
| `temp/` | 可重建索引、队列、缓存、日志和导出文件 |
| `corrupted/` | 可选的损坏数据隔离区（需要时由内核自动创建） |

---

## 3. `data/` 顶层布局

`data/` 第一层是两类东西混排：

1. **固定数据目录**：`.siyuan/`、`assets/`、`templates/`、`widgets/`、`plugins/`、`emojis/`、`snippets/`、`public/`、`storage/`。
2. **笔记本目录**：每个是一个以笔记本 ID 命名的文件夹。

### 保留文件名清单（★ AI 落盘时务必避开）

`IsReservedFilename`：

```go
func IsReservedFilename(baseName string) bool {
    return "assets" == baseName || "templates" == baseName || "widgets" == baseName ||
        "emojis" == baseName || ".siyuan" == baseName || strings.HasPrefix(baseName, ".")
}
```

即物理路径段 `assets` / `templates` / `widgets` / `emojis` / `.siyuan` 以及任意以 `.` 开头的名称均为保留名称。该限制针对磁盘上的 ID 和路径段，不限制用户界面中显示的笔记本名称或文档标题。

### 持久化数据与可重建索引

`data/storage/` 保存属性视图定义和插件状态等持久化结构化数据。`temp/` 中的 SQLite 文件是派生索引和缓存：普通笔记本使用全局 `siyuan.db` 和 `blocktree.db`，每个已解锁的加密笔记本则使用独立的 SQLCipher 数据库。删除或重建索引不能与删除源 `.sy`、资源文件或数据库定义文件混为一谈。

### 笔记本的判定规则

`ListNotebooks` 枚举 `data/` 时，逐个目录判定：

1. 跳过保留名；
2. 必须是目录（非文件）；
3. 目录名必须符合 NodeID 格式（`ast.IsNodeIDPattern`）；
4. 满足以上三条 → 该目录名就是 `box.ID`（笔记本 ID）。

---

## 4. 笔记本内部布局（★ 核心：父子文档配对）

这是整个布局最关键的约定：

> **文档 `A` 的磁盘表示 = `A.sy` 文件 + `A/` 目录（后者仅在 A 有子文档时存在）。A 的子文档全部放在 `A/` 目录里；子文档若有自己的子文档，则再嵌套 `A/B/` 目录，任意深度。**

真实示例（来自 `find` 输出）：

```
20221126104620-m06prws/                         # 父文档 A 的目录
20221126104620-m06prws.sy                       # 父文档 A 本体
20221126104620-m06prws/20230928134805-z11t56h.sy   # A 的子文档 B
20221126104620-m06prws/20230928134805-z11t56h/    # B 的子目录（孙子层）
20221126104620-m06prws/20230928134805-z11t56h/20240304105333-v7g5j1s.sy
```

代码佐证：

- 展开子文档（`Ls`）：传入 `.sy` 路径，去掉 `.sy` 后缀，检查同名目录是否存在，存在则列出其子项。
- 子文档深度（`GetChildDocDepth`）：同理 walk 同名目录。

> ⚠️ 这意味着：**移动或改名一个有子文档的文档，必须同步移动它的同名目录**，否则子文档会失联。

### 顶层笔记本文档例外

启用顶层笔记本文档功能后，内核会在笔记本目录中直接创建 `<boxID>.sy`。该文档的 rootID 就是笔记本 ID，因此笔记本与其顶层文档共用同一个 ID。

开关保存在 `conf/conf.json` 的 `fileTree.boxDocEnabled` 中。新工作区默认启用；已有配置中缺少该字段时初始化为关闭。

顶层笔记本文档是笔记本根层所有普通文档的虚拟父文档。与普通父文档不同，它的子文档仍然位于笔记本目录中，**不会**移动到 `<boxID>/<boxID>/` 目录。例如：

```
data/<boxID>/
├── <boxID>.sy       # 顶层笔记本文档
├── <docA>.sy        # <boxID>.sy 的逻辑子文档
├── <docA>/          # docA 的物理子文档目录
│   └── <docB>.sy
└── <docC>.sy        # <boxID>.sy 的另一个逻辑子文档
```

内核会将以 `/<boxID>/` 开头的虚拟路径映射回笔记本物理根路径。顶层笔记本文档不能移动或删除。该文档创建后，关闭功能只会在常规界面和搜索结果中隐藏它，不会删除对应的 `.sy` 文件。

---

## 5. 笔记本元数据：`<boxID>/.siyuan/`

每个笔记本目录下都有一个 `.siyuan/` 隐藏目录，其中可以包含：

| 文件 | 用途 |
|---|---|
| `conf.json` | 笔记本配置（BoxConf） |
| `sort.json` | 可选的文档自定义排序映射 `{docID: order}` |
| `boxDoc.json` | 可选；在笔记本 `.sy.zip` 导入导出中标识顶层笔记本文档 |
| `notebook-crypt-backup.json` | 可选；加密笔记本中已封装数据加密密钥的备份 |

`BoxConf` 结构：

| 字段 | 类型 | 含义 |
|---|---|---|
| `name` | string | 笔记本显示名称 |
| `sort` | int | 排序权重 |
| `icon` | string | 图标（emoji hex 码，如 `"1f3af"`；或自定义图标文件名） |
| `closed` | bool | 是否处于关闭状态 |
| `refCreateSaveBox` | string | 块引用时新建文档的目标笔记本 |
| `refCreateSavePath` | string | 块引用时新建文档的目标路径 |
| `docCreateSaveBox` | string | 新建文档的目标笔记本 |
| `docCreateSavePath` | string | 新建文档的目标路径 |
| `dailyNoteSavePath` | string | 新建日记的存储路径（支持模板） |
| `dailyNoteTemplatePath` | string | 新建日记的模板路径 |
| `sortMode` | int | 排序方式 |
| `encrypted` | bool | 是否为加密笔记本 |
| `boxCrypt` | object 或 null | 已封装的笔记本数据加密密钥及包络元数据，在加密笔记本中为非空 |

> ⚠️ **笔记本 ID 不在 `conf.json` 里**——ID 就是笔记本目录名本身（见 §3 的判定规则）。

读写位置：`GetConf` / `SaveConf`。路径硬编码为 `<DataDir>/<boxID>/.siyuan/conf.json`。

`boxDoc.json` 包含元数据规范版本和顶层文档 ID。运行时内核直接从 `box.ID` 推导该文档 ID；保留此元数据文件是为了让 `.sy.zip` 导入过程能够识别源笔记本的顶层文档，并将其重新映射为目标笔记本 ID。

加密笔记本在 `conf.json` 和 `notebook-crypt-backup.json` 中保留恢复元数据，但其 `.sy`、笔记本本地资源文件和属性视图定义均以密文落盘。加密边界、数据库隔离和恢复设计详见 [ENCRYPTED-NOTEBOOK.zh-CN.md](./ENCRYPTED-NOTEBOOK.zh-CN.md)。

---

## 6. 工作区总配置：`<workspace>/conf/conf.json`

注意区分两个 `conf.json`：

| 文件 | 位置 | 作用域 |
|---|---|---|
| `conf/conf.json` | **工作区根** | 工作区级总配置（appearance / langs / system / editor / sync / repo 等全局段） |
| `<boxID>/.siyuan/conf.json` | **笔记本内** | 仅该笔记本（BoxConf） |

`conf/conf.json` 包含 UI 外观、账号、同步、AI、闪卡等工作区级设置。

---

## 7. 工作区级隐藏配置：`data/.siyuan/`

`data/.siyuan/` 与笔记本内的 `.siyuan/` 不同，前者是**工作区级**的规则与状态：

| 文件 | 用途 |
|---|---|
| `syncignore` | 同步忽略规则（gitignore 风格） |
| `searchignore` | 搜索忽略 |
| `embeddingignore` | AI embedding 忽略 |
| `indexignore` | 建立索引忽略 |
| `refsearchignore` | 反链搜索忽略 |
| `publishAccess.json` | 发布访问控制 |
| `filesys_status_check/` | 文件系统一致性检查状态 |
| `notebook-crypto-backup.json` | 用于同步和恢复的全局加密笔记本 KDF 及校验器备份 |
| `master-password-migration.json` | 修改主密码期间临时使用的崩溃恢复状态 |

其中大多数条目都是可选的，仅在使用相应功能时创建。

> 这里**没有** `conf.json`——工作区总配置在工作区根的 `conf/conf.json`（见 §6）。

---

## 8. 资源文件（assets）

两套并存：

1. **工作区级全局 `data/assets/`**——主用。命名规则形如 `<原始名称>-<NodeID>.<ext>`（如 `640-20240927104411-0jh7x96.webp`）。文档内以 `assets/xxx` 相对路径引用。
2. **笔记本级 `<notebook>/assets/`**——内置用户指南使用，加密笔记本也必须使用；普通未加密用户笔记本一般没有。

资源文件链接前缀识别：仅认 `assets/`、`emojis/`、`plugins/`、`public/`、`widgets/` 这几个前缀为合法资源文件链接。

加密笔记本必须使用笔记本本地资源文件。资源文件内容和记录原始名称映射的 `.names.json` 均会加密，物理文件名采用脱敏的 `<16 位随机字符>-<blockID>.<ext>` 格式，因此直接检查磁盘无法还原原始资源文件名称。详见 [ENCRYPTED-NOTEBOOK.zh-CN.md §7](./ENCRYPTED-NOTEBOOK.zh-CN.md#7-sy--assets--数据库文件加解密)。

---

## 9. ID 与路径的关系

### ID 格式

- **NodeID**：`YYYYMMDDHHMMSS-xxxxxxx`（14 位时间戳 + `-` + 7 位随机字符）。
- 笔记本 ID 和文档 ID 使用相同的 NodeID 格式，顶层笔记本文档直接使用所属笔记本的 NodeID。
- 前 14 位即创建时间（`TimeFromID` 提取）。
- 随机字符集 `[a-z0-9]`。

### 文件名 = ID（硬约束）

- 文档的 `.sy` 文件名（去 `.sy` 后缀）= 文档 rootID。
- 笔记本的目录名 = 笔记本 ID。
- 顶层笔记本文档的文件名和 rootID 都等于笔记本 ID，即 `<boxID>.sy`。
- 内核强制 `文件名 ID == root.ID`；未加密文档不一致时会自动订正，加密文档则拒绝加载。

以上均为物理标识。笔记本显示名称来自 `BoxConf.name`，文档显示标题来自根块属性，两者都不需要符合 NodeID 格式。

### 文档绝对路径

文档在磁盘上的绝对路径 = `data/<boxID>/<相对路径>`，其中 `<相对路径>` 形如 `/20221126104620-m06prws/20230928134805-z11t56h.sy`（以 `/` 开头，POSIX 风格）。

从路径取文档 ID（`GetTreeID`）：即 `filepath.Base(路径)` 去掉 `.sy` 后缀。

---

## 10. HPath（人类可读路径）如何派生

HPath **不是存储在 `.sy` 原始文件中的权威数据**，而是在加载文档时通过 `LoadTreeByData` 派生，并可能缓存到 `blocktree.db` 等可重建索引中：

1. 文档自身的相对路径按 `/` 拆分，去掉开头空段和结尾自身段，得到**各级父文档的 ID 段**。
2. 对每个父 ID，拼出 `<父ID>.sy`，用 `DocIAL()`（**流式只读 `Properties`**，不解析整棵树）读出该父文档的 `title`。加密 `.sy` 文件必须先完整读取并解密，然后才能解析属性。
3. 把各级 title 用 `/` 串起来，末尾接当前文档 title → 得到形如 `/父标题/子标题/当前标题` 的 HPath。
4. 若某父 `.sy` 缺失，内核会**自动补建**一个 `Untitled` 父文档（对应 issue #7376）。

> 这是「目录结构即数据」的根本原因：**移动或重命名文件/目录，会直接改变文档的 HPath 与面包屑**——因为 HPath 完全派生自目录链。

顶层笔记本文档会进行特殊处理：其 API HPath 为 `/`，完整的人类可读路径为笔记本名称；根层普通文档在逻辑上显示为它的下级文档，但文件仍然直接存放在笔记本目录中。

---

## 11. 直接操作文件系统的注意事项

> 与 [SY-FORMAT.zh-CN.md §0.5](./SY-FORMAT.zh-CN.md#05-何时直接读写-sy优先级) 一致：**修改数据优先走 HTTP API / MCP / CLI**，由内核负责索引同步。直接操作文件系统仅用于批量离线迁移、冷初始化等场景。

不要直接修改加密笔记本的持久化文件。原始文件 API 会拒绝读取、枚举或修改加密笔记本目录。离线检查受保护内容时只能看到密文，但 `conf.json` 等非内容元数据仍可读取。应在解锁笔记本后使用专用 API，以保持加密、认证和隔离索引的一致性。

直接落盘时务必：

1. ☐ 笔记本和文档的物理 ID 符合 NodeID 格式，且**避开保留名**（§3）。
2. ☐ 文档 `.sy` 文件名 == 文档 rootID（§9）。
3. ☐ 有子文档的文档，必须**配套同名目录**；移动父文档时连带移动同名目录（§4）。
4. ☐ 不要将根层文档移动到 `<boxID>/<boxID>/` 中；顶层笔记本文档使用虚拟父子路径映射（§4）。
5. ☐ 笔记本的名称、图标和关闭状态写在 `<boxID>/.siyuan/conf.json` 中；当 `<boxID>.sy` 存在时，名称和图标会与它同步（§5）。
6. ☐ 将 `data/storage/` 视为持久化源数据，将 `temp/*.db` 视为可重建索引，不要混淆二者的生命周期（§3）。
7. ☐ 改动后通常需要**重建索引**，否则搜索、块引用和面包屑会失效。

---

## 12. 与 SY-FORMAT 的关系

| 文档 | 范畴 | 回答的问题 |
|---|---|---|
| **本文档（WORKSPACE）** | 文件系统层 | 「一个工作区在磁盘上长什么样？笔记本、文档和资源文件怎么组织？」 |
| **SY-FORMAT** | AST 层 | 「一个 `.sy` 文件内部的 JSON 树长什么样？有哪些节点类型和字段？」 |

两者互补：本文档告诉你 `.sy` 文件**放在哪、叫什么名、与谁同目录**；SY-FORMAT 告诉你 `.sy` 文件**里面写什么**。
