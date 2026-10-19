# 性能测量

[English](PERFORMANCE.md)

## 范围

性能测量区分内核同步工作、组件异步初始化和浏览器布局。阶段记录是本地诊断信息，不改变 API 响应、事务完成、搜索计数、笔记本访问检查或持久化格式，也不会上传测量数据。

## 阶段记录

在启动开发内核前设置环境变量 `SIYUAN_PERFORMANCE=1`，即可在现有内核日志中输出记录。下次启动前移除变量即可停止采样。构建和重启内核由开发者控制。关闭采样时，内核记录器不产生分配。

在渲染进程开发者工具中执行 `performance.mark("siyuan-performance")` 开启控制台记录，执行 `performance.clearMarks("siyuan-performance")` 关闭。标记是临时状态，不会保存为用户偏好。记录器不会不断积累每次操作的浏览器标记或测量条目。

记录以 `siyuan-performance ` 开头，后接 JSON。`duration_us` 和 `stages_us` 是经过时间，单位为微秒；`counts` 是操作规模，或 `oldest_wait_us` 等明确命名的耗时。名称在代码中固定。记录不包含查询字符串、笔记正文、文档标识、路径、凭证或密钥。记录之外的现有日志可能包含其他诊断信息，分享采样文件前应检查其内容。

| 操作 | 阶段边界和计数 |
|---|---|
| `transaction` | 开始、自动化、应用操作、整理、提交；操作数 |
| `document.load` | 事务屏障、加载/解析树、定位块、渲染响应；块数 |
| `document.save` | 准备/序列化、加密、比对、写入、通知；待保存字节数和实际写入字节数 |
| `index.flush` | 等锁、提取队列、开始/执行/提交、通知、持久化队列完成状态；批次大小和最老入队任务的等待时间 |
| `index.update` | 主块及完整附属投影、块比较、附属索引比较、写入；`blocks_total` 为已有索引块数，`blocks_projected` 为生成的主块数，`changeset = 1` 表示采用事务提示；变化块数、计划删除及插入的附属记录数 |
| `database.view`、`database.fields`、`database.rows` | 加载和同步等待、字段计算、筛选、排序、汇总、分页、条件色；筛选前、筛选后及分页后的条目数 |
| `database.templates` | 模板求值；求值次数，包括产生模板错误的尝试；使用计算计划时，`database.fields` 还记录必需和延迟计算的模板字段数 |
| `search`、`search.fts`、`search.path`、`search.regexp`、`search.document` | 查询、结果加工、精确计数、分组/引用；方法、返回结果数、命中数和取消状态 |
| `search.snapshot` | 普通 FTS 快照准备、结果行和精确计数；`count_cache_hit = 1` 表示复用计数 |
| `editor.content` | 解析/规范化、DOM 插入、同步渲染调度、全局状态；渲染根节点数和已加载的顶层块数 |
| `editor.databases` | 串行数据库初始化完成前的经过时间；候选根节点数 |

初始阶段名为 `prepare`，同名阶段累计耗时。被取消的搜索包含 `counts.canceled = 1`，应与成功请求分开分析。多词文档搜索在查询内部计数，因此阶段为 `query_count`；正则匹配和高亮共用一个阶段。被现有相等性检查跳过的保存没有实际写入字节计数。索引等待时间取已提取批次中已知的最早入队时间，恢复的操作可能缺少该时间戳；它不是编辑事务排队时间。

嵌套操作耗时有重叠，不能将父操作与子操作相加。`editor.content` 测量同步工作和调度，不含后续公式/图表脚本加载、嵌入查询及浏览器布局。`editor.databases` 包含数据库异步等待，不代表所有组件已经可见。全局标题编号、折叠状态、只读状态、焦点和插件事件保持原有范围。

附属索引更新在原有事务内比较完整业务字段快照。各块记录的多重集相等时保留原有记录 ID；有变化时只替换该块在对应表中的记录。引用和附件元数据可能独立于块哈希变化，因此仍保留完整投影。计数表示计划写入行数，包含之后失败的事务中的操作，不能视为已提交行数。

普通表格、列表和画廊视图可在分页前计算筛选、排序、汇总及条件着色所需的模板和传递依赖，其余模板只计算当前页。两次计算共享原始值快照，并保留必需字段已生成的显示结果。搜索、分组布局、无法解析或循环的依赖、不透明模板表达式，以及会改变原有求值顺序的依赖继续完整计算。原本可以延迟全部模板的视图保持已有行为。通过复用顺序重新生成页面时，`database.fields` 记录 `order_cache_hit = 1`。普通 FTS 使用 `search.snapshot` 时，计数耗时包含在上层查询阶段，上层单独的计数阶段只剩调度开销。

## 投影与复用边界

主块投影在每次投影内按物理兄弟列表统一解析标题父级。全部由已跟踪 `update` 操作构成的事务，可提供变更及删除子树的块 ID 和受影响容器。标题结构、行级 HTML、未跟踪写入、缺失或变化的根元数据，以及其他事务操作继续完整主块投影。队列只在同一笔记本、文档和路径内合并提示，保留删除、移动、重命名及其他索引操作的有序边界。提示只存在于进程内存，恢复时从完整已认证源文件执行幂等的完整更新。完整附属投影和整篇 `.sy` 的保存方式保持不变。

视图顺序复用只用于实时普通源、至少 512 个游离条目、静态字段，以及分页前必须计算的封闭纯模板。覆盖表格、列表和无封面的画廊；查询、分组、上下文筛选、目标定位、汇总、日期/时间、关联、汇总字段、资源及外部或动态依赖继续原路径。普通视图及模板全部仅用于显示的视图不计算顺序指纹。键包含源版本和缓存代次、实际数据和视图定义、载体、语言及写入范围，临时数据或排序变化产生不同键。指纹分块编码属性值，仍校验并哈希完整输入，源数据解析也仍随源大小增长。

顺序缓存只保留独立的不可变 ID 字符串，最多 16 个条目，逻辑字节预算为 4 MiB，包含元数据。命中后重新生成当前页的值，不共享渲染对象。既有源替换/删除及全局清理使顺序失效，并拒绝旧版本在途请求写回。加密源、历史路径和内存快照不进入该缓存。命中可减少重复的字段求值、筛选和排序，但不能让整个请求只与页大小相关。应分别对照首次开销、后续翻页和高频修改工作负载。

精确计数复用只用于没有自定义忽略 SQL 的固定普通 FTS 查询。计数 SQL 和绑定字符串参数标识查询及范围；数据库、原生连接身份和 SQLite 的 `data_version`、`total_changes()`、`schema_version` 标识索引状态，版本只在同一连接上比较。自身写入及其他连接提交使复用失效，回滚可能造成无害的未命中。结果行和计数使用同一读取快照，建立快照前后的版本采样会在边界变化时停用复用，不按 TTL 推断正确性。计数缓存固定 512 个槽位，占用低于 128 KiB，不保留查询正文。关闭/重建数据库和 SQL 缓存清理拒绝旧请求准入。加密查询、自定义 SQL 和动态忽略条件保持原路径。取消释放快照及预留连接。参见 SQLite 的[版本语义](https://sqlite.org/pragma.html#pragma_data_version)和[快照隔离](https://sqlite.org/isolation.html)。

将内核与浏览器采样分别导出为 UTF-8 文件。在 `app/` 下汇总每次运行：

```text
node scripts/performance.mjs before.log after.log
```

汇总器按每份采样的操作分类，输出样本数、中位数和最大值。P95 至少需要 20 个样本，P99 至少需要 100 个样本。各阶段和计数保留各自的样本数。同一采样中应保持工作负载、结果状态和规模一致。没有测量记录或记录损坏时明确报错。原始文件与汇总结果一起保留。

## 可复现微基准

在 `kernel/` 下使用相同 Go 工具链、机器、电源设置及尽量空闲的环境运行：

```text
go test ./filesys -run '^$' -bench '^BenchmarkDocumentJSON$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkDatabaseDisplayPage$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkDocumentSearch$' -benchmem -benchtime=200ms -count=3
go test -tags fts5 ./sql -run '^$' -bench '^BenchmarkUpsertTreeAuxiliaryIndexes$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkDatabaseTemplateDependencies$' -benchmem -benchtime=200ms -count=3
go test -tags fts5 ./sql -run '^$' -bench '^BenchmarkIndexProjection$' -benchmem -benchtime=200ms -count=3
go test ./model -run '^$' -bench '^BenchmarkDatabaseViewOrderReuse$' -benchmem -benchtime=200ms -count=3
go test -tags fts5 ./sql -run '^$' -bench '^BenchmarkFTSExactCountReuse$' -benchmem -benchtime=200ms -count=3
```

| 基准 | 固定工作负载 | 包含的工作 |
|---|---|---|
| `BenchmarkDocumentJSON` | 1 千 / 5 千 / 2 万个段落块，每块 112 字节 ASCII 正文，无引用/资源，扁平结构 | 文档准备/JSON 序列化，或 JSON 解析/校验；准备过程使用临时目录，不替换产品内核或工作区 |
| `BenchmarkDatabaseDisplayPage` | 1 千 / 1 万 / 5 万个游离条目，块/文本/显示模板字段，每页 50 条，无筛选/分组/排序 | 通过已有显示模板延迟计算生成字段、分页并求值当前页模板 |
| `BenchmarkDocumentSearch` | 1 万 / 10 万 / 100 万个索引块，每篇 100 块，两个词分别位于不同段落，每篇均命中，取前 50 篇 | 热内存 SQLite 文档查询、精确计数及结果行解码；不含 FTS、磁盘 I/O、完整 API 加工或前端 |
| `BenchmarkUpsertTreeAuxiliaryIndexes` | 1 千 / 5 千 / 2 万个段落，每块一个标签和自定义属性，文档另有一个标签；交替修改一个段落的普通正文 | 完整替换附属记录、完整主块投影加增量写入，以及根/段落变更集三条路径；均批量解析标题父级，包含完整附属投影、块/FTS 更新和事务提交；`sqlite_changes/op` 包含 FTS 内部写入及整理 |
| `BenchmarkDatabaseTemplateDependencies` | 1 千 / 1 万 / 5 万个游离条目，筛选/排序需要两个有依赖关系的模板，另有五个显示模板，每页 50 条 | 完整计算与按依赖计算对照，包含计划构建、字段渲染、筛选/排序和分页；每次迭代清除已渲染集合缓存 |
| `BenchmarkIndexProjection` | 1 千 / 5 千 / 2 万个段落，一处普通正文变化 | 独立标题父级查找、请求内统一解析，以及两个主块投影对照；均包含完整附属投影，不含 SQL 写入 |
| `BenchmarkDatabaseViewOrderReuse` | 100 / 1 千 / 1 万 / 5 万个游离条目，使用同一模板依赖夹具，每页 50 条 | 源解析及完整处理、顺序未命中或顺序复用；内容相同的对照快照共用原始/规范化缓存，但不参与跨请求复用；冷模式改变临时视图名称，包含指纹及准入成本 |
| `BenchmarkFTSExactCountReuse` | 1 千 / 1 万 / 10 万 / 100 万个块，每篇 100 块；全部、0.1% 或无块命中，取前 50 块 | 热内存 FTS 行解码及精确块/文档计数；无缓存的分开读取与冷/热快照计数对照，冷模式包含缓存清理 |

可通过子基准筛选缩小规模，例如 `-bench '^BenchmarkDocumentSearch$/^10000$'`。数据库建立和夹具生成不在计时循环内。显示/模板基准在迭代间复用属性视图，顺序复用基准每次解析新视图；原始/规范化源缓存均已预热，不代表冷启动打开。`-benchmem` 测量 Go 分配，不是 SQLite 原生分配或总 RSS。基准结果是对应路径的基线，不是应用延迟或整体提速结论。FTS 必须包括低命中及无命中查询，因为版本/快照校验可能比它们的少量计数更贵。

## 产品采样

每组对照记录提交、工具链与 Electron 版本、操作系统、硬件、构建方式、实际数据规模、查询命中率、样本数、缓存状态和并发后台工作。固定正文长度、嵌套、引用/资源数量、数据库字段和模板。冷打开、热重开、后续翻页、连续输入及同步/索引期间交互分别采样，同时覆盖小工作区、低命中率查询、加密笔记本和桌面/浏览器/移动端路径。

使用浏览器 Performance 面板采集长任务、样式/布局及内容可见时间；通过操作系统分别采集内核与渲染进程 RSS。Go 分析数据测量 Go 堆和 CPU，不包含全部 SQLite 或 Electron 原生内存。内核分析端点需要显式设置 `--enable-pprof` 并沿用管理员鉴权。分析器采样与低开销计时分开运行。记录器不会启用任何分析端点。

不能从阶段耗时推断 SQL 改动行数、查询次数、缓存命中率或峰值 RSS；评估对应优化时应另行采集。微基准吞吐也不能证明 UI、加密数据恢复或并发行为正确。

## 回归检查

前端测试由 `app/scripts/test.mjs` 发现，Go 测试与基准由对应包命令发现。在 `app/` 下执行的定向检查：

```text
node --import tsx --test --test-concurrency=1 src/search/request.test.ts src/protyle/util/renderContent.test.ts src/protyle/util/performance.test.ts src/protyle/util/onGetPositioning.test.ts
node --test scripts/performance.test.js
pnpm run lint
```

测试启动器在并行浏览器测试前初始化 Electron。安装依赖后直接运行浏览器测试时，应先单独加载一次 `require("electron")` 完成安装，不能并发启动多个首次 Electron 安装。

在 `kernel/` 下执行的定向检查：

```text
go test -tags fts5 ./model -run 'TestFullTextSearchRejectsCanceledRequest|TestSearchContextPreservesResultsCountsAndPagination' -count=1
go test ./sql -run 'TestParameterizedSearchQueriesCancelAndReleaseConnection|TestSearchQueriesRejectCanceledContextBeforeReading|TestBlockQueriesBeyondVariableLimit' -count=1
go test ./util -run Performance -count=1
go test -tags fts5 ./sql -run 'TestAuxiliary|TestUpsertTree|TestStaticTemplateKeyDependencies' -count=1
go test ./model -run 'TestAttributeViewTemplatePlan|TestRenderAttributeViewUsesTemplateDependencyPlan|TestShouldDeferAttributeViewTemplateValues|TestRenderAttributeViewDefersDisplayOnlyTemplatesUntilAfterPagination' -count=1
go test -tags 'fts5 sqlcipher' ./sql -run '^TestAuxiliaryIndexEncryptedUpdateAndReopen$' -count=1
go test -tags 'fts5 sqlcipher' ./sql ./model -run 'TestTreeIndexChanges|TestIndexHeading|TestIndexProjection|TestTransactionIndexChanges|TestFTSCount|TestReusableTemplateKey|TestAttributeViewOrderReuse' -count=1
go test -race ./cache -run TestAVOrderedIDs -count=1
```

取消测试覆盖全局及笔记本路由数据库中运行的 SQLite 工作和连接复用。使用独立内存库的夹具验证路由，不验证 SQLCipher 格式兼容性。渲染测试使用真实浏览器 DOM，覆盖插入范围、全量替换、选区节点身份、前插滚动补偿以及过期/已移除节点；组件渲染器以调用记录器替代。组件行为及真机输入法/触摸交互还需各自的回归检查。语义搜索继续保持串行调度，其内核取消另行实施。

附属索引测试将五类表与完整替换结果对照，覆盖重复记录、删除、元数据变化、重放、失败回滚、NULL 区分和分批删除。两万块回归在普通正文编辑时禁止任何附属表写入。SQLCipher 测试使用真实加密库，验证索引迁移/重开、错误密钥拒绝和全局库隔离。模板计划测试对表格、列表和画廊的分页值、顺序、总数、条件着色及汇总结果做完整计算对照，同时覆盖原始值和过期显示状态。这些内核改动由桌面端和移动端共用，不改变前端交互。

变更集测试对照完整 SQL/FTS 快照，覆盖合并事务、删除/替换子块、根元数据回退、有序边界、写入失败及不带提示的恢复。顺序复用测试对照表格/列表/画廊的完整响应，覆盖已保存和临时编辑、排序/写入范围、空结果、排除依赖、字节上限、ID 不可变性和并发失效。FTS 测试分别在建立快照前、版本确认前及读取行期间安排真实 WAL 提交，验证本次快照计数及后续失效，并覆盖回滚、SQL/参数隔离、取消及旧请求准入。还应按影响运行周边 SQL、AV、事务和 API 权限回归；这些定向测试不能替代真实工作区 RSS 或设备交互测量。
