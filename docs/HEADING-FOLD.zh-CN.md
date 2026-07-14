# 标题折叠设计（去 `heading-fold`，保留子级折叠态）

折叠状态只存在标题自身的 `fold`；子块不再写入 `heading-fold`；展开父标题时保留子标题自身的 `fold`。下文先记设计动机与取舍，再写当前实现，便于后续改动时对照「为什么这样」。

## 1. 背景：旧模型在解决什么、又制造了什么

思源里标题与「下方内容」在 AST 中是**兄弟关系**，不是父子嵌套。标题管辖范围由层级扫描得到（`HeadingChildren`）：从标题往后走到同级/更高级标题为止。

旧实现因此做了**反规范化**：

| 属性 | 写在谁身上 | 含义 |
|---|---|---|
| `fold=1` | 折叠的标题 | 该标题处于折叠态（权威来源之一） |
| `fold=1` + `heading-fold=1` | 标题下方所有块级节点 | 「因上级标题折叠而隐藏」的物化标记 |

折叠/展开时 Walk 整段子树批量 Set/Remove 属性。表面上读路径可 O(1) 看子块属性；代价是：

1. **写扩散**：每次折叠/展开改大量 IAL，易残留（标题已展开、子块仍带 `heading-fold`——仓库里曾有专门清理逻辑）。
2. **抹掉子级折叠**：展开（甚至折叠）父标题时无差别清/写子树 `fold`，无法「展开 H1、保留 H2 折叠」（`#16749` 等诉求被拒，维护者称编辑一致性有技术债）。
3. **前端本就不读 `heading-fold`**：标题折叠靠标题 `fold` + `removeFoldHeading` 物理删 DOM；属性双写并未真正服务前端。

## 2. 核心判断：`heading-fold` 不是新信息

理论上，只要知道某 `NodeHeading` 的 `fold=1` 与文档顺序，就能用 `HeadingChildren` / 祖先回溯推出「后面哪些块该藏」。`heading-fold` 只是缓存，不是第二套真相。

因此可以去掉该属性：**唯一真相放在标题的 `fold` 上，隐藏一律现算**。这与「保留子级折叠」是同一套模型——若展开父级仍 Walk 清子树 `fold`，去掉属性也换不来嵌套折叠态。

注意：只改「展开时不清子 fold」不够；旧 `doFoldHeading` 给子块（含了标题）写 `fold=1` 也会覆盖子标题自己的折叠态，**折叠父级时也绝不能改写子标题 `fold`**。

## 3. 性能：不能「加载时对每个块调 `IsInFoldedHeading`」

`IsInFoldedHeading` → `HeadingParent` 每次沿 `Previous` 回溯。对 N 个块近似 O(N²)，长文档不可接受。旧 `GetDocInBox` 曾在 Walk 里逐块调用，本身就有隐患；去掉 `heading-fold` 后更不能把它当成批量策略。

正确做法是**一次正向扫描 + 折叠层级栈**：

- 遇同级/更高级标题 → 出栈到合适深度
- 遇 `fold=1` 标题 → 入栈
- 栈非空且当前节点不是「刚入栈的那颗折叠标题自身」→ 隐藏

整篇 O(N)。`IsInFoldedHeading` 只留给块引浮窗、按 id 判断等**单点**查询。

## 4. 约定（实现必须遵守）

| 项 | 规则 |
|---|---|
| 标题是否折叠 | 仅该 `NodeHeading` 的 `fold=1` |
| 块是否隐藏 | 上方存在更高级且 `fold=1` 的标题盖住它；折叠标题自身仍可见 |
| 折叠标题带走的块 | `HeadingChildren`（结构，不靠属性） |
| 列表等容器折叠 | 仍用自身 `fold`，与标题折叠无关 |

隐藏（被祖先盖住）与「自己是否折叠标题」正交。

## 5. 当前实现

### 5.1 基础设施（`kernel/treenode/heading.go`）

| API | 用途 |
|---|---|
| `FoldHeadingStack` | 正向扫描同级子块时维护层级栈；`Enter` / `Hidden` |
| `VisibleHeadingChildren` | 标题下方按栈可见的子块（**顶层标题不入栈**）；展开 RetData / 嵌入 / 复制共用 |
| `CollectRenderFoldHidden` | 渲染时收集应跳过的块（同级栈 + 容器内 `CollectFoldHiddenNodes`），不 Unlink |
| `CollectFoldHiddenNodes` | 按容器递归用栈收集应剔除的被盖住块（导出 / 模板 / 加载渲染） |
| `StripLegacyHeadingFoldAttrs` | 清 `heading-fold`；曾带该属性的非标题节点一并清 `fold`；未带该属性的容器自身 `fold` 保留 |
| `IsInFoldedHeading` | 仅单点查询；禁止在批量热路径对每个块反复调用 |
| `HeadingChildren` / `GetParentFoldedHeading` / `MoveFoldHeading` | 结构范围与折叠标题搬迁（只认标题 `fold`） |

`GetHeadingFold`（按子块 `heading-fold` 过滤）已删除；移动边界（`#8321`）改为直接 `HeadingChildren`。

### 5.2 写路径

- `doFoldHeading`：只设该标题 `fold=1`；`RetData` 仍为全量子块 ID（前端远端折叠按 ID 删 DOM）
- `doUnfoldHeading`：只清目标（及必要祖先）标题自身 `fold`；`RetData` = `VisibleHeadingChildren` 经 `renderBlockDOMByNodes`（含容器内嵌套折叠跳过）渲染 HTML（保留 `fold=1` 子标题节点）
- `unfoldHeading` / `doUpdate` / `Heading2Doc` / `doMove`：禁止再给子块批量写/清 `fold`
- 全仓无 `SetIALAttr("heading-fold")`，仅有清除与迁移清洗

### 5.3 读路径

| 场景 | 实现 |
|---|---|
| 加载 `loadNodes*` | `FoldHeadingStack` / `foldedHiddenSiblings`；聚焦标题（`mode=0` + `isHeading`）会先把当前标题入栈，自身 `fold=1` 时不摊开下方内容 |
| `GetDocInBox` 渲染 | 顶层块单点 `IsInFoldedHeading`（`#9582`）；子树 `CollectFoldHiddenNodes`；Walk 内不再逐块回溯 |
| 导出 `keepFold`（`#5941`） | `CollectFoldHiddenNodes` |
| 模板（`#4488`） | 同上，对被盖住块打 `status=temp` |
| 嵌入 / `resolveEmbedR` 等（`#4765`） | 未折叠标题用 `VisibleHeadingChildren`；`fold=1` 不追加子块；HTML 渲染走 `CollectRenderFoldHidden`（**不 Unlink** 共享树） |
| `GetHeadingChildrenDOM` | 标题 + `VisibleHeadingChildren`（顶层不入栈，复制/剪切带走整节） |

`sql` IAL 白名单仍保留 `heading-fold` 键，便于读旧文件再清洗。

### 5.4 前端

标题折叠 = 标题 `fold` + `removeFoldHeading` 物理删兄弟 DOM；展开靠内核 `retData` 插回。

| 位置 | 行为 |
|---|---|
| `insertUnfoldHeadingDOM` | 仅插入内核已省略嵌套折叠的 HTML |
| `processFold` / `onTransaction` / `turnsOneInto` | 展开插入走上述 helper |
| `setFold` / `foldHeading`（无 retData ID 列表时） | 本地 `removeFoldHeading` |
| 复制折叠标题 | `getHeadingChildrenDOM({ removeFoldAttr: false })`；子块可带 `parent-heading`，本地 `ignoreProcess` 不插可见 DOM |

嵌套折叠省略在内核完成：`VisibleHeadingChildren`（同级）+ `renderBlockDOMByNodes` 内 `CollectRenderFoldHidden`（含容器内部），不 Unlink 共享树。加载路径用 `CollectFoldHiddenNodes`，前端不再二次兜底。

自动展开（删除、拖拽、粘贴等）仍可对必要祖先 `setFold(..., true)`，依赖「内核不清子 fold」。取消列表/引述/标注拍平时必须循环展开容器内全部折叠标题，否则拍平丢内容。前端不读写 `heading-fold`。

### 5.5 迁移

可见块渲染时 `StripLegacyHeadingFoldAttrs`。历史/快照浏览仍可整体清 fold 以固定展开。

### 5.6 有意保留的 `IsInFoldedHeading`

| 位置 | 原因 |
|---|---|
| `file.go` `GetDocInBox` | 每个**顶层**加载块单点判断（`#9582`） |
| `block.go` `IsBlockFolded` | 按 id 单点查询 |

## 6. 演进中确认过的陷阱（勿回退）

1. **`GetHeadingChildrenDOM` 若把顶层折叠标题入栈**，会只复制标题行、丢掉整节——复制/剪切必须顶层不入栈，仅省略更深嵌套折叠盖住的块。
2. **嵌入路径勿对 `trees` 缓存里的共享 AST 做 Unlink**；用 `VisibleHeadingChildren` + 渲染层 `CollectRenderFoldHidden` 省略。
3. **`StripLegacy`：曾带 `heading-fold` 的容器上的 `fold` 视为残留一并清**，否则展开后列表等仍「假折叠」；未带该属性的容器真实 `fold` 保留。
4. **存在祖先折叠标题时 `doUnfoldHeading` 可能 `ReloadProtyle`**：保守但正确；增量 RetData 路径须 `VisibleHeadingChildren` + `CollectRenderFoldHidden` 省略嵌套内容。
5. 编辑路径上的「自动展开」清单很大（改层级、拖拽、粘贴等）；产品上允许展开必要祖先，但不得借机清子标题 `fold`。
6. **仅靠 `VisibleHeadingChildren` 不够**：它只过滤标题同级兄弟；列表等容器内部的嵌套折叠必须在渲染层用 `CollectRenderFoldHidden` 跳过，不能再依赖前端 `removeFoldHeading` 兜底。
7. **聚焦折叠标题勿空栈扫描下方块**：`loadNodesByMode` 的 `isHeading` 分支须先 `Enter` 当前标题，否则自身 `fold=1` 会被绕过而摊开整节；这与 `GetHeadingChildrenDOM`（顶层不入栈、复制须带走整节）相反，勿混用。

## 7. 相关 issue

`#3643`（空 RetData）、`#8321`（移动边界）、`#4765`（嵌入）、`#5941`/`#4064`（导出）、`#4488`（模板）、`#9582`/`#4920`/`#4997`（浮窗/大纲）、`#15943`（移动+列表）、`#13618`（展开后块引计数）、`#16749`（保留子级折叠）。
