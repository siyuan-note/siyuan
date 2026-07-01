# SiYuan 工作区文件系统布局 —— 参考文档

> 本文档描述 SiYuan 工作区在磁盘上的目录与文件组织。
> 它与 [`SY-FORMAT.zh-CN.md`](./SY-FORMAT.zh-CN.md) 互补：后者讲 `.sy` 文件**内部**的 JSON 结构，本文档讲工作区**整体**在文件系统中的布局。
> 所有结论基于真实工作区与内核代码核验。

## 0. 一句话本质

SiYuan 工作区是一棵**自描述**的目录树：笔记本、文档、附件都以可读的文件/目录形式存在磁盘上。**文件名即 ID,目录结构即文档层级**。没有用二进制数据库来记录「文档在哪」——文件系统本身就是真相来源（single source of truth）,内核通过遍历目录即可还原全部笔记本与文档结构。

---

## 1. 速查树（总览）

```
<工作区根>/   例 F:\SiYuan\
├── conf/
│   ├── conf.json              # ★工作区总配置(appearance/system/sync/editor...)
│   ├── ca.crt / cert.pem / key.pem   # TLS 证书
│   └── windowState.json
├── data/                       # DataDir — 所有笔记本数据的根
│   ├── .siyuan/                # 工作区级隐藏配置(*ignore 规则等)
│   ├── assets/                 # ★全局附件(图片/音视频/文件)
│   ├── templates/              # 全局模板(.md)
│   ├── widgets/                # 挂件
│   ├── plugins/                # 插件
│   ├── emojis/                 # 自定义 emoji
│   ├── snippets/               # 代码片段(CSS/JS)
│   ├── public/                 # 静态资源
│   ├── storage/                # 运行时索引/缓存/数据库
│   └── <boxID>/                # ★笔记本(目录名 = 笔记本 ID)
│       ├── .siyuan/
│       │   ├── conf.json       # ★笔记本配置(BoxConf:name/icon/closed...)
│       │   └── sort.json       # 自定义排序映射 {docID: order}
│       ├── <docID>.sy          # 文档(JSON 树;文件名 = 文档 rootID)
│       └── <docID>/            # ★该文档的子文档目录(同名配对)
│           ├── <childID>.sy
│           └── <childID>/ ...  # 任意深度嵌套
├── repo/                       # 数据仓库(快照/同步)
├── history/                    # 编辑历史归档
└── temp/                       # 临时/导出文件
```

---

## 2. 工作区根

工作区根由用户选定（如 `F:\SiYuan\`）。判定一个目录是否为合法工作区：`conf/conf.json` 存在且含 `kernelVersion` 字段。

根目录下固定子目录：

| 子目录 | 用途 |
|---|---|
| `conf/` | 工作区级配置 + TLS 证书 |
| `data/` | **所有笔记本数据**（本文档核心） |
| `repo/` | 数据快照仓库（用于同步/历史） |
| `history/` | 编辑历史归档 |
| `temp/` | 临时/导出文件 |
| `corrupted/` | 损坏数据隔离区（内核自动迁入） |

---

## 3. `data/` 顶层布局

`data/` 第一层是两类东西混排：

1. **保留资源目录**:`.siyuan/`、`assets/`、`templates/`、`widgets/`、`plugins/`、`emojis/`、`snippets/`、`public/`、`storage/`。
2. **笔记本目录**：每个是一个以笔记本 ID 命名的文件夹。

### 保留文件名清单（★ AI 落盘时务必避开）

`IsReservedFilename`:

```go
func IsReservedFilename(baseName string) bool {
    return "assets" == baseName || "templates" == baseName || "widgets" == baseName ||
        "emojis" == baseName || ".siyuan" == baseName || strings.HasPrefix(baseName, ".")
}
```

即 `assets` / `templates` / `widgets` / `emojis` / `.siyuan` 以及任意 `.` 开头的名字**都不能**用作笔记本名或文档名。

### 笔记本的判定规则

`ListNotebooks` 枚举 `data/` 时，逐个目录判定：

1. 跳过保留名；
2. 必须是目录（非文件）;
3. 目录名必须符合 NodeID 格式（`ast.IsNodeIDPattern`）;
4. 满足以上三条 → 该目录名就是 `box.ID`（笔记本 ID）。

---

## 4. 笔记本内部布局（★ 核心：父子文档配对）

这是整个布局最关键的约定：

> **文档 `A` 的磁盘表示 = `A.sy` 文件 + `A/` 目录（后者仅在 A 有子文档时存在）。A 的子文档全部放在 `A/` 目录里；子文档若有自己的子文档，则再嵌套 `A/B/` 目录，任意深度。**

真实示例（来自 `find` 输出）:

```
20221126104620-m06prws/                         # 父文档 A 的目录
20221126104620-m06prws.sy                       # 父文档 A 本体
20221126104620-m06prws/20230928134805-z11t56h.sy   # A 的子文档 B
20221126104620-m06prws/20230928134805-z11t56h/    # B 的子目录(孙子层)
20221126104620-m06prws/20230928134805-z11t56h/20240304105333-v7g5j1s.sy
```

代码佐证：

- 展开子文档（`Ls`）：传入 `.sy` 路径，去掉 `.sy` 后缀，检查同名目录是否存在，存在则列出其子项。
- 子文档深度（`GetChildDocDepth`）：同理 walk 同名目录。

> ⚠️ 这意味着：**移动 / 改名一个有子文档的文档，必须同步移动它的同名目录**,否则子文档会失联。

---

## 5. 笔记本元数据：`<boxID>/.siyuan/conf.json`

每个笔记本目录下有一个 `.siyuan/` 隐藏目录，内含：

| 文件 | 用途 |
|---|---|
| `conf.json` | 笔记本配置（BoxConf） |
| `sort.json` | 文档自定义排序映射 `{docID: order}` |

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

> ⚠️ **笔记本 ID 不在 `conf.json` 里**——ID 就是笔记本目录名本身（见 §3 的判定规则）。

读写位置：`GetConf` / `SaveConf`。路径硬编码为 `<DataDir>/<boxID>/.siyuan/conf.json`。

---

## 6. 工作区总配置：`<workspace>/conf/conf.json`

注意区分两个 `conf.json`：

| 文件 | 位置 | 作用域 |
|---|---|---|
| `conf/conf.json` | **工作区根** | 工作区级总配置（appearance / langs / system / editor / sync / repo 等全局段） |
| `<boxID>/.siyuan/conf.json` | **笔记本内** | 仅该笔记本（BoxConf） |

实测 `conf/conf.json` 约 42KB,包含 UI 外观、账号、同步、AI、闪卡等全部工作区级设置。

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

> 这里**没有** `conf.json`——工作区总配置在工作区根的 `conf/conf.json`（见 §6）。

---

## 8. 附件（assets）

两套并存：

1. **工作区级全局 `data/assets/`**——主用。命名规则形如 `<原名>-<docID后缀>.<ext>`（如 `640-20240927104411-0jh7x96.webp`）。文档内以 `assets/xxx` 相对路径引用。
2. **笔记本级 `<notebook>/assets/`**——主要是内置 guide 笔记本用，普通用户笔记本一般没有。

附件链接前缀识别：仅认 `assets/`、`emojis/`、`plugins/`、`public/`、`widgets/` 这几个前缀为合法附件链接。

---

## 9. ID 与路径的关系

### ID 格式

- **笔记本 ID**:`YYYYMMDDHHMMSS-xxxxxx`（14 位时间戳 + `-` + 6 位随机）。
- **文档 ID**:`YYYYMMDDHHMMSS-xxxxxxx`（14 位时间戳 + `-` + 7 位随机）。
- 前 14 位即创建时间（`TimeFromID` 提取）。
- 随机字符集 `[a-z0-9]`。

### 文件名 = ID（硬约束）

- 文档的 `.sy` 文件名（去 `.sy` 后缀）= 文档 rootID。
- 笔记本的目录名 = 笔记本 ID。
- 内核强制 `文件名 ID == root.ID`，不一致会自动订正。

### 文档绝对路径

文档在磁盘上的绝对路径 = `data/<boxID>/<相对路径>`，其中 `<相对路径>` 形如 `/20221126104620-m06prws/20230928134805-z11t56h.sy`（以 `/` 开头,POSIX 风格）。

从路径取文档 ID（`GetTreeID`）：即 `filepath.Base(路径)` 去掉 `.sy` 后缀。

---

## 10. HPath（人类可读路径）如何派生

HPath **不存储**,加载文档时现场计算（`LoadTreeByData`）:

1. 文档自身的相对路径按 `/` 拆分，去掉开头空段和结尾自身段，得到**各级父文档的 ID 段**。
2. 对每个父 ID,拼出 `<父ID>.sy`，用 `DocIAL()`（**流式只读 `Properties`**,不解析整棵树）读出该父文档的 `title`。
3. 把各级 title 用 `/` 串起来，末尾接当前文档 title → 得到形如 `/父标题/子标题/当前标题` 的 HPath。
4. 若某父 `.sy` 缺失，内核会**自动补建**一个 `Untitled` 父文档（对应 issue #7376）。

> 这是「目录结构即数据」的根本原因：**移动或重命名文件/目录，会直接改变文档的 HPath 与面包屑**——因为 HPath 完全派生自目录链。

---

## 11. 直接操作文件系统的注意事项

> 与 [SY-FORMAT.zh-CN.md §0.5](./SY-FORMAT.zh-CN.md) 一致：**修改数据优先走 HTTP API / MCP / CLI**,由内核负责索引同步。直接操作文件系统仅用于批量离线迁移、冷初始化等场景。

直接落盘时务必：

1. ☐ 笔记本/文档命名符合 NodeID 格式，且**避开保留名**(§3)。
2. ☐ 文档 `.sy` 文件名 == 文档 rootID(§9)。
3. ☐ 有子文档的文档，必须**配套同名目录**；移动父文档时连带移动同名目录（§4）。
4. ☐ 笔记本的名称/图标/关闭状态写在 `<boxID>/.siyuan/conf.json`，不在 `.sy` 里（§5）。
5. ☐ 改动后通常需要**重建索引**,否则搜索/块引用/面包屑会失效。

---

## 12. 与 SY-FORMAT 的关系

| 文档 | 范畴 | 回答的问题 |
|---|---|---|
| **本文档（WORKSPACE）** | 文件系统层 | 「一个工作区在磁盘上长什么样？笔记本/文档/附件怎么组织？」 |
| **SY-FORMAT** | AST 层 | 「一个 `.sy` 文件内部的 JSON 树长什么样？有哪些节点类型/字段？」 |

两者互补：本文档告诉你 `.sy` 文件**放在哪、叫什么名、与谁同目录**；SY-FORMAT 告诉你 `.sy` 文件**里面写什么**。

