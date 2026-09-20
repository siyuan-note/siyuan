# 内核接口类型契约

[English](API-CONTRACTS.md)

## 适用范围

本文规定内核 HTTP 接口的类型定义、兼容要求、生成产物和验证流程。传输类型与端点定义位于 `kernel/apicontract/` 下的各模块文件，`contracts.go` 汇总端点注册表；迁移已完成，`kernel/apicontract/legacy_routes.json` 清单为空。新增接口必须定义类型契约，不得加入该清单。

## 接口维护流程

1. 在契约包中定义或更新传输类型与端点，明确请求体、错误码、空值、默认值和历史输入兼容规则
2. 用 `contractHandler` 绑定业务入口，保持路由中间件顺序、授权和租约范围
3. 保持 `legacy_routes.json` 为空；删除接口时同步移除路由注册和契约定义
4. 更新实际响应、兼容输入和严格类型测试，运行生成器，再修正编译器指出的调用问题
5. 同步 `petal` 的生成声明和相关公共声明；公开接口同步更新接口文档

生成检查读取实际路由与处理函数声明，验证方法、路径、处理函数和契约适配器的对应关系。CI 对照变更前的清单阻止增加存量记录。不得通过 `any`、类型断言或修改存量清单规避契约检查。

## 契约与实现

`kernel/apicontract/` 下的各模块文件定义请求、响应和端点，`contracts.go` 将其汇总到端点注册表。契约包独立于内核启动、数据库和持久化模型，因此生成器可以单独运行。API 入口通过 `contractHandler` 绑定端点，请求参数和成功返回值受到 Go 泛型签名约束；响应载荷通过构造函数设置，不能直接给通用 `ret.Data` 赋值。业务校验继续使用现有辅助函数，`contractFailure` 保留其错误码、消息和已支持的错误载荷。

生成器从同一组 Go 类型生成 `app/src/types/api/index.d.ts` 和 `kernel/apicontract/schema.json`。后者包含共享的 `$defs` 和每个端点的请求、响应 schema，测试使用同一套 schema 检查实际 HTTP 响应。类型声明不会在运行时验证 JSON，CI 中的处理函数测试负责验证序列化结果。

输入和输出分别处理。`json` tag 控制线协议字段名；请求字段默认必填，`api:"optional"` 表示可缺省，`nullable` 表示接受 `null`，指针保留可空语义。输出字段的 `omitempty` 只控制输出省略，不推导请求必填性。嵌入结构体展平，递归类型通过引用表示；接口联合、常量字段和自定义编解码需要显式建模。未支持的类型、字段冲突和未知 JSON tag 会使生成失败，不会降级为 `any`。

数组、字典和嵌套结构体递归检查请求约束，字符串数组中的 `null` 不会被转换为空字符串，批量属性中的 `null` 值仍表示删除属性。标签树单独定义递归传输结构；前端共享树节点中的笔记本和文档路径字段为可选，反映标签节点不返回这些字段的实际行为。

`Notebook` 是接口载荷，业务模型通过显式转换映射到该载荷，回归测试比较完整 JSON，包括各个加密状态。修改契约不会改变 `.sy`、数据库、历史、同步或加密格式。

笔记本创建、重命名、删除、关闭、图标更新和排序已纳入类型契约。重命名、删除和图标更新会去除笔记本 ID 两端空白；关闭保留空白并由 ID 校验处理。空名称和空图标仍由业务层处理，重命名失败保留提示显示时长。

加密笔记本生命周期接口使用类型化请求与响应，保留密码去除两端空白、分钟数截断与负值归零、管理员权限、租约获取和挂载失败回滚。密钥派生、密文格式及恢复材料仍由模型层维护。

## 兼容要求

`POST /api/ai/testDecisionModel` 使用固定的 TypeSafe System One 样例测试已保存的可选 `ai.decision` 配置。接口要求管理员权限，遵循全局人工智能禁用标记和请求取消，返回具有类型声明的 `{matched, msg?}` 数据；配置错误和供应商错误不会被转换为判断结果。省略决策配置时补齐默认关闭的配置，关闭后保留密钥，并沿用现有配置加密存储机制。`TestAPIContractAI*`、`TestAPIContractSetting*`、`TestAIDecisionConfiguration` 和 `TestDecision*` 覆盖契约、配置、顺序批量调用的部分结果、区块读取、锁定笔记本拒绝访问、能力可用性、确认、取消及供应商响应校验，均纳入完整内核持续集成测试。可运行 `go test -tags "fts5 sqlcipher" ./api ./conf ./util ./mcp/tools ./agent -run 'Test(APIContractAI|APIContractSetting|AIDecision|Decision)' -count=1` 和 `go test ./apicontract/...` 进行针对性验证。

加密笔记本系统锁屏接口保留管理员鉴权和只读检查。布尔开关保存在系统配置中，不进入密钥备份的认证数据。`TestAPIContractNotebookSystemLock` 覆盖配置持久化、关闭开关、独立于闲置时间、多笔记本（包括仅解锁未挂载的笔记本）、重复锁定、锁定后拒绝读取，以及重新解锁后认证读取未改变的密文。该测试已包含在下文的内核全量命令中，也可单独运行 `go test -tags "fts5 sqlcipher" ./api -run 'TestAPIContractNotebook(SystemLock|CryptoAuthorization)$' -count=1`。`TestNotebookSystemLockContract` 覆盖严格布尔输入，`TestRouteCoverage` 检查路由注册和处理器绑定。

2026 年 9 月 14 日迁移完成时，`kernel/api/router.go` 中的 629 条方法和路径注册均已纳入契约，旧路由清单为空。该基线中的 4 条 `ANY` 注册在生成声明中展开为 661 条具体方法和路径。后续新增接口时，以生成器和路由覆盖检查的统计为准。由 `kernel/server/serve.go` 注册的静态资源、应用主 WebSocket 和其他传输服务不属于这份 API 路由清单。

系统契约保留完整配置、工作空间管理、上传、认证、OIDC 响应分支、启动事件流以及空响应和二进制响应。前端在读取持久化布局和快捷键的位置缩小类型，保留原有默认值修复、废弃键清理和绑定过滤逻辑。配置导入、导出和退出保持原有生命周期及加密行为。

事务契约按动作区分全部 98 个已知操作，并在显式未知操作兼容分支中排除这些名称。前端使用同一组有限操作联合。私有原始输入保留历史字段、被忽略的值、模型异步错误和回传载荷，类型声明不把模型校验提前到 HTTP 准入阶段。撤销、重做、标题操作、响应租约及事务持久化格式保持原有行为。

编辑器通过独立的 `swapBlockRef` 事务转换块引用：`id` 指定引用块，`blockID` 指定定义块，`data` 包含布尔选项 `includeChildren` 和 `originalToEmbed`。内核在 `retData` 中返回受影响的文档 ID，并以受影响顶层块的私有内存快照生成逆向操作。快照不传给客户端，也不接受客户端提交。重放保留块 ID 和数据库绑定；内容或位置已改变时拒绝覆盖；提交失败时补偿已写入的文档。`TestBlockSwapTransaction` 覆盖落盘后的撤销和重做、跨文档历史、冲突拒绝及写入失败恢复，包含在下方完整内核测试命令中，也可在 `kernel/` 下运行 `go test -tags "fts5 sqlcipher" ./model -run 'Test(SwapBlockRefNodes|BlockSwapTransaction)' -count=1` 单独验证

块交换的撤销和重做为所有受影响文档持有笔记本租约，直到响应序列化完成。`TestContractBlockSwapReplayNotebookResponseLease` 验证锁定操作会等待响应结束，包含在完整内核测试命令中。

扩展剪藏保留多段表单首值处理、动态名称上传文件、部分结果、原有消息及加密笔记本准入。动态图标保留 SVG 字节、安全和缓存响应头以及空错误响应。广播流声明原始 SSE 字节、动态事件名、ID 和重试值，以及原始 WebSocket 帧和升级错误；载荷不转换为 JSON 或 Base64，频道清理保持原有作用范围。

插件私有服务声明现有序列化模式、原始文件、重定向、代理响应、SSE 事件和 WebSocket 帧。插件自行定义的载荷保留为协议扩展数据，并按实际分支分别校验序列化格式与任意字节。请求体、显式响应头、准入错误和取消处理保持插件服务原有生命周期。

网络契约保留请求字节、表单字段、请求头、URL 和 TLS 诊断信息，包括完整证书公钥结构与大整数。转发代理选项保留校验顺序、数字截断、响应编码及协议定义的 JSON 载荷。HTTP、EventSource 和 WebSocket 代理保留上游状态与字节、重复请求头行为、安全响应头、流取消和连接清理。回显通配路径绑定独立适配器，并共用相同业务处理。

数据库契约分别声明表格、画廊和看板的结果结构，保留基础字段缺失、单元格局部修改及 null 值。独立的 `list` 布局复用表格的 `columns`/`rows`/`rowCount` 载荷，布局配置保存在 `list` 下，`viewType` 标识为 `list`。已知修改字段保留传入状态，不以零值填充未提供的字段。当前、历史和快照渲染使用对应请求类型，调用端先处理错误载荷再更新视图。行排序、发布准入、加密笔记本租约和快速 JSON 渲染保留既有行为。前端和插件的共享声明按视图及单元格实际提供的字段同步。`TestAVContractListLayout` 覆盖布局切换、默认字段显隐、后续渲染和持久化布局映射；运行 `go test -tags "fts5 sqlcipher" ./api -run 'TestAVContract' -count=1` 和 `go test ./apicontract/...`。这些测试已包含在内核完整 CI 测试中。

AI 契约保留供应商配置、模型发现与匹配、确认结果、会话扩展字段，以及数值和省略语义。编辑器和智能体流声明实际 SSE 事件，断开连接时关闭上游请求，流生命周期仍位于请求内部。OAuth 页面保留媒体类型、HTTP 状态和安全响应头。会话权限通知使用 `WithAfterWrite`，保留先响应再广播的顺序。任意 JSON 仅用于协议扩展字段和工具结果。

`/api/ai/agent/manageSkills` 使用严格字符串字段，并通过管理员和只读检查管理工作空间技能文件。相对路径标识实际目录，与文件头中的技能名称无关，允许普通的点开头名称。读写支持不超过 8 MiB 的 UTF-8 文本，不依赖扩展名并保留原文字节。目录和资源读取保留基于内容的版本；不支持编辑的内容省略 `content`，并增加可选的 `readOnlyReason`（`binary`、`encoding` 或 `tooLarge`）。编辑器以读取结果判断可编辑性，不依赖可能过期的列表项。修改已有文件时重新校验内容并要求当前版本，与旧技能修改接口和安装共享临界区，成功后通知同步。路径穿越、平台别名、链接、过期版本，以及单独修改不支持的内容或重命名、删除根 `SKILL.md` 的请求均被拒绝。`TestAISkillManagementContract`、`TestAPIContractAISkillManagement` 和 `TestSkillManagement` 覆盖请求类型、实际 HTTP 响应、权限、原文、文本判定、隐藏路径、并发保存和文件系统边界。运行 `go test -tags "fts5 sqlcipher" ./apicontract/... ./api ./util -run 'Test(AISkillManagementContract|APIContractAISkillManagement|SkillManagement|RouteCoverage)' -count=1`；下方完整内核 CI 测试包含这些回归用例。

设置契约保留局部配置合并、既有默认值、结构字段大小写兼容、显式 null、JSON 数字归一化及解析错误消息。快捷键与云端认证结果声明固定字段，同时保留协议定义的 JSON 扩展。非管理员查询云用户时仍先执行准入判断再读取请求体；双因素认证保留云端错误码与扩展字段。前端继续在既有边界规范化持久化的显示设置。

文档树契约保留条件参数校验、路径与排序语义、回调省略规则、分页默认值及文档响应变体。发布认证通过显式声明的额外错误状态保留 HTTP 429 和 `Retry-After`。发布及加密笔记本准入仍先于延迟字段校验，文档租约覆盖响应序列化阶段。

`POST /api/filetree/duplicateDocTree` 将单篇文档及全部子文档复制到同一笔记本的原父目录。请求为文档 `id`，返回副本根文档的 `id`、`notebook`、`path` 和 `hPath`；原有单文档复制接口保持不变。副本中的内部块引用、块链接和查询嵌入的显式块 ID 统一重映射，数据库定义与行绑定保持为共享镜像。源快照经过认证读取，不执行修复写回；运行期间检测到失败时清理新建文档并恢复排序。这是运行时补偿，不保证进程崩溃时的事务原子性。`TestDuplicateDocTree*` 覆盖层级、排序、引用、富文本单元格、镜像、无效源及回滚；`TestAPIContractDuplicateDocTree*` 覆盖实际响应、授权、加密源数据保留、认证失败、锁定与解锁及响应租约。测试已纳入内核全量持续集成命令，可使用 `go test -tags "fts5 sqlcipher" ./model ./api -run 'Test(DuplicateDocTree|APIContractDuplicateDocTree)' -count=1` 和 `go test ./apicontract/...` 单独验证。

`TestAPIContractFileTreeMissingDocuments` 通过实际 HTTP 响应覆盖查询路径、删除、重命名、复制和移动不存在的文档，按响应契约检查业务错误及保留的 `closeTimeout`，已包含在下方的内核全量测试命令中。可在 `kernel/` 中执行 `go test -tags "fts5 sqlcipher" ./api -run TestAPIContractFileTreeMissingDocuments -count=1` 单独验证。

附件契约保留结果列表的空值、逐文件上传顺序与重名文件、部分上传成功时的提示及本地插入失败载荷。OCR 列保持字符串值。标注校验、发布文件准入、加密读写、延迟下载和上传目标选择保持既有行为。非 API 上传入口复用同一个有类型的模型操作。

资源引用扫描将定义文件缺失或定义 ID 无效的数据库记录到可选的 `unavailableAttributeViews` 列表，不阻断查询、预演或替换。每项包含笔记本 ID 与名称、文档 ID 与路径及人类可读路径、块 ID、数据库 ID 和原因。已存在但无法读取或内容损坏的定义仍返回错误。保存前重新校验缺失文件快照，避免遗漏扫描期间恢复的定义。当前按需下载规则不包含数据库定义，回归测试会检查这一前提。缺失定义回归覆盖模型和实际 HTTP 契约，包括关闭的笔记本和共享定义。

资源引用查询和替换契约保留单资源请求，同时支持批量参数。批量结果按输入顺序返回每项状态、原因、引用和改动文件数；顶层计数对共享文件去重。空批次、重复源路径、链式和循环映射会被拒绝。独立映射可以在其他项失败时完成，共享文件写入失败归属所有受影响映射。扫描期间允许编辑，保存前校验工作区快照；取消和无变化重试保留源数据。`TestAssetRelink` 回归覆盖单资源兼容、批量校验、共享文档、数据库及 OCR 保存、历史和并发编辑，已包含在下方完整内核测试命令中。

导出契约保留 Markdown 选项默认值与数字截断、笔记本列表过滤、标题选项类型忽略规则、可省略的 HTML 目录字段及上传字段选择规则。错误响应保留消息显示时长与资源错误中的空字符串载荷。发布过滤、加密笔记本准入、覆盖响应阶段的租约及临时导出清理保持既有生命周期。

仓库契约保留密钥编码、快照元数据、数值截断与保留期限默认值、云端分页及文件访问租约。仓库文件读取保留媒体类型和原始字节，空文件保留成功信封。文件成功与 JSON 失败均返回 HTTP 200。对于显式声明的共用状态，`ValidateHTTPResponse` 接受文件原始字节，`ValidateErrorResponse` 单独验证已知错误载荷。密钥材料、加密文件格式及快照恢复行为保持不变。

闪卡契约保留数值截断、分页默认值、可选的已复习卡片列表、块结果的空值以及非空牌组列表。笔记本和文档准入仍先于延迟的分页错误。卡片与牌组修改保留模型层校验及持久化行为，加密笔记本限制保持不变。

同步契约保留数值截断、手动模式下的条件方向校验、配置字段匹配与 JSON 数字归一化，以及消息显示时长。同步配置导入要求恰好一个文件，并保留加密包内容与恢复路径。鉴权及只读检查仍先于请求体解码，同步和笔记本加密继续由模型层处理。

`/api/sync/setSyncProvider` 接受可选、可空的 `completeAssets`。只有 `true` 授权在切换来源前，从原提供商下载缺失的当前资源和历史快照内容；省略、`null` 和 `false` 保留只检查完整性的行为。补齐过程保留下载模式和恢复密钥，失败时保留原提供商。确认后的操作通过现有全局进度遮罩显示检查和补齐阶段，成功或失败均关闭遮罩。运行 `go test ./apicontract/...` 和 `go test -tags "fts5 sqlcipher" ./api ./model -run 'Test(APIContractSync|SyncProviderCompletion|AssetDownloadModePreservesHistoricalRecovery|AssetDownloadStateCorruption)' -count=1`；这些测试已包含在完整内核 CI 测试中。前端确认、取消和遮罩清理由现有前端测试范围内的 `src/config/tabs/syncRuntime.test.ts` 覆盖。

集市契约保留必填字段的校验顺序、空白处理、主题模式联动、评分可用性和限流载荷，以及本地包上传错误。包和外观响应声明完整嵌套结构，包括固定五项的评分分布。上传请求保留首文件选择及覆盖参数解析。安装、卸载、鉴权和发布限制仍由既有业务处理函数及中间件执行。

插件信息查询保留路径参数、查询参数和 JSON 请求体中名称的优先级，包括空白及业务错误码 1 至 4。命中 URL 参数时不解析请求体，列表查询忽略请求体。插件列表与 RPC 方法列表保留数组及数组元素的空值语义。HTTP JSON-RPC 使用独立契约描述单次与批量请求、成功与错误回复，以及纯通知请求的 HTTP 204 响应。插件准入先于请求体读取，批量错误保留原有顺序，任意 JSON 仅用于 RPC 参数、返回值和错误详情。RPC WebSocket 路由声明 HTTP 101 升级、HTTP 404 插件准入错误、HTTP 400 文本拒绝，以及独立的入站调用和出站回复或通知。Origin 授权与连接清理保留在既有升级生命周期中。

插件发布契约将仅管理员可用的授权、快照写入与已认证访问者的公开读取分离。公开数据仅包含声明的标量字段，授权和快照使用独立于同步插件私有存储的本地版本化文件。静态路由与文件接口共用插件状态和安全文件打开规则，发布加载响应排除内核代码。`TestAPIContractPluginPublish`、`TestPluginPublishContracts`、`TestPluginPublish*` 和 `TestPublishFile*` 覆盖实际响应、准入、范围变化、撤销、重装、损坏及路径边界，均包含在完整内核测试中。可运行 `go test -tags "fts5 sqlcipher" ./api ./model ./server ./util ./apicontract -run 'Test(APIContractPluginPublish|PluginPublish|PublishFile|RouteCoverage)' -count=1` 单独验证。路径测试的 CI 筛选也包含模型、静态路由与文件边界回归。接口说明和迁移示例见[插件发布](PLUGIN-PUBLISH.zh-CN.md)。

搜索契约保留分页默认值与小数截断、路径校验与去重、历史子类型筛选的忽略规则，以及空值与空数组的区别。引用搜索区分仅回传请求标识和完整块结果，保留笔记本准入先于延迟参数校验的顺序。SQL 搜索权限、发布过滤、加密笔记本租约、取消请求的响应和只读嵌入块更新的空操作保持原有顺序。桌面端与移动端调用使用生成的请求类型。

自定义块搜索使用可选的 `customBlock` 类型筛选字段。API 显式传入类型映射时仅搜索其中启用的类型；省略类型映射时使用搜索设置，默认启用自定义块。保存的搜索条件区分字段缺失与 `false`，使旧版前端搜索配置能够继承设置。`TestCustomBlockSearch` 回归覆盖配置兼容、搜索条件保存、类型筛选和全文索引更新；`TestAPIContractSettingConfigCompatibility` 与 `TestAPIContractSettingCompletePayloads` 覆盖设置契约，均包含在下方完整内核测试命令中。

历史契约保留路径去空白、可选高亮默认值、历史类型的小数截断，以及空值与空数组的区别。版本对比先检查两个引用对象，再检查对象字段，并按排序后的笔记本 ID 获取租约。内容读取及文档、资源和数据库回滚保留历史路径租约检查，笔记本回滚沿用模型层的恢复行为。

导入契约保留压缩包清理、首个上传文件选择、Markdown 路径空白，以及暂存令牌去空白和有效期。思源自动导入声明文档、令牌、笔记本和笔记本集合结果，挂载失败时保留文档载荷。Obsidian 任务取消失败时保留任务快照。笔记本挂载、加密导入处理和创建通知仍由既有业务操作负责。

反链契约保留查询字段的空白、可选开关默认值、来源过滤归一化和版本哈希。列表查询缺少 ID 时仍返回空值；版本未变化时保留既有字段和空值数组。候选定义查询失败时保留空的 `refDefs` 数组。发布过滤、加密笔记本准入和请求期间的租约仍由处理器维护，上下文载荷保留递归块路径和数据库引用位置。

`/api/ref/getBacklinkDoc` 接受可选整数 `blockSort`：`0`（默认）保持正文顺序，`1` 按匹配引用的锚文本自然升序排列，`2` 按自然降序排列，未知整数值保持正文顺序。每个展示条目取正文中首个匹配引用的锚文本并去除首尾空白，合并到父块的条目也遵循此规则。排序键相同时保持正文顺序，无锚文本的条目在两个方向中均置后。排序保留来源文档分组、过滤和提及顺序。在来源文档内部，由首段引用传递形成的整篇文档条目会展开为可独立排序的引用，并保留列表项和标题等局部上下文；恢复正文顺序时重新使用整篇文档条目。排序模式参与上下文版本哈希。编辑器设置 `backlinkBlockSort` 保存面板偏好，接口未提供 `blockSort` 时仍使用正文顺序。`TestBacklinkAnchorSort*`、`TestBacklinkDocumentBlockSort` 及已有设置和发布加密上下文契约测试覆盖排序、兼容性、版本变化以及普通和加密笔记本读取。这些回归包含在下方完整内核 CI 测试中，可单独运行 `go test -tags "fts5 sqlcipher" ./model ./api ./apicontract/... -run 'Test(Backlink|APIContractBack|APIContractSetting|PublishReaderBack|PublishReaderSearchAndBacklink|RouteCoverage)' -count=1`。

图谱契约保留局部配置的默认值、配置字段不区分大小写和数值归一化行为。查询响应区分完整图数据和仅含请求标识的结果，后者包括错误及未提供 ID 的局部查询；节点和连线数组保留原有的空值语义。配置持久化仍要求管理员权限且不处于只读模式。发布过滤、加密笔记本拒绝访问与配置解码之间的执行顺序保持不变。

模板契约保留路径先于模式和源内容校验、显式模式优先于旧预览开关、数据库模式默认值，以及代码 `1` 的覆盖提示。文件管理保留 Go 结构体 JSON 绑定及其固定解析错误消息，分别声明列表、源内容、版本号和空载荷。版本校验、符号链接限制和同步失效处理仍由现有模型操作执行。

SQL 查询契约保留成功信封顶层的 `limit` 和 `truncated`。`SuccessSQL` 附加这些信息，失败响应不包含它们。结果列名由查询决定，每个值为 JSON 标量，保留整数位数和二进制值的 Base64 序列化。语句去除首尾空白、可选模式、单语句与只读检查，以及查询错误码 `1` 均保持不变。

契约维护必须保留接口已有的可观察行为，不能仅因类型定义或处理函数重构而改变调用语义：

- 请求语义：保持请求体是否必需、字段是否可缺省，以及空请求体、缺失字段、`null`、空字符串、空对象和空数组的区别
- 参数处理：保持默认值、空白处理、数字转换和已支持的历史输入规则；不得隐式扩大或缩小接受范围
- 响应结构：保持字段名称、类型、可空性和省略规则，区分 `{}`、`[]` 与 `null`，完整声明成功、提示和失败等响应分支
- 错误行为：保持 HTTP 状态、业务错误码、消息、附加错误载荷和提示显示时长，不将已有业务失败重新解释为成功
- 权限与生命周期：保持认证、角色、只读和发布权限校验，以及加密笔记本的操作准入、租约范围与释放时机；兼容处理不得规避授权或认证解密

具体接口的特殊行为由契约定义、兼容解码和回归测试共同记录。测试应覆盖实际 HTTP 序列化结果、边界输入和权限场景，不能只验证类型能否编译。

`ignoretype` 和 `filterstrings` 仅用于声明过的旧参数兼容行为。生成的请求类型描述规范调用形式；兼容解码可能接受并忽略更宽的旧输入，兼容测试明确覆盖这些例外。不存在全局「绑定失败后回退旧解析」的开关。

只读中间件仍可返回带 `closeTimeout` 的提示对象。`fetchPost` 的普通回调只接收消息处理后保留的非负错误码，块信息接口的 `3` 仍须处理；`fetchSyncPost` 和 `fetchGet` 保留完整响应。动态 URL 保留存量签名；静态 POST 路径必须来自契约，错误参数不能通过重载回退。拼接出开放范围的模板 URL 时使用显式 `string` 变量。

业务错误需要保留提示显示时长时使用 `FailureWithTimeout`。使用契约的块查询通过 `holdContractBlockRequest` 保留显式笔记本及附带 ID 的租约检查；状态查询允许已删除 ID 的行为仍由对应入口明确指定。

`StructJSONBody` 用于已经采用 Go JSON 结构体绑定的接口，保留字段名大小写兼容、空值处理和解析错误，业务必填字段继续由处理函数校验。不得用它放宽现有接口的请求规则。失败时仍返回业务结果的端点显式设置 `DataOnError`，并调用端点自身的类型化 `FailureWithData` 方法。

笔记本配置更新使用类型化的部分对象。字段选项 `legacyobject` 保留既有 JSON 往返转换中的数字归一化和结构体字段名大小写兼容；可缺省指针字段在缺失或为 null 时保留原值。加密字段仅为输入兼容而解码，配置补丁不会应用这些字段。`Base64Bytes` 显式描述字节切片的 Base64 字符串或字节数组输入。

`JSONValue` 仅用于线协议明确接受任意 JSON 的字段，例如原样返回的请求标识。其 schema 是 null、布尔、数字、字符串、数组和对象的递归联合，不可代替应有明确结构的请求或响应。字数统计结果的固定字段与请求标识分别建模。

标题事务查询使用 `BlockTransaction` 返回有类型的操作，保留空数组、空值和撤销操作载荷。`BlockOperationResult` 明确声明文本、块 ID 数组和空值的有限联合类型。业务模型中的多态字段转换时拒绝不支持的类型，属性视图操作载荷使用各动作对应的契约。编辑器操作类型同时接受非属性视图操作返回的空列类型字段。

全部 `/api/block/` 路由已使用契约。标题级别查询保留批量 ID 优先、去重、小数级别截断、文档结构体绑定和消息展示时长。文档转换结果包含六级标题计数和有类型的事务。引用检查仅校验所选范围使用的字段，保留忽略字段及笔记本参数去空白规则，并保留布尔错误载荷、发布过滤和持续到响应序列化完成的笔记本租约。这些特殊输入规则使用私有的入口专用类型解码函数，而普通接口继续通过字段声明解码。最近更新结果使用递归的 `SearchBlock` 载荷，包含可为空的引用、子块和卡片元数据。

HTML 剪贴板转换保留字面反斜杠和标记字符，并在关闭 Markdown 语法时保留 HTML 格式。`TestHTML2BlockDOMContractEscapedText` 覆盖两种源格式模式、实际响应模式校验、编辑往返、HTML 实体以及样式和链接边界。可使用 `go test -tags "fts5 sqlcipher" ./api ./model -run 'Test(.*HTML.*|.*Clipboard.*|.*IFrame.*|SpinBlockDOM.*|WPSPresentation.*|NormalizeMSWord.*|NormalizeWPS.*)' -count=1` 运行相关转换回归。下方内核全量命令已包含这些测试，`app/tests/luteHtmlEscapes.test.js` 通过前端全量测试检查生成的 Lute JavaScript。修改 Lute 源码后，还需在 Lute 仓库运行 `go test ./...` 并重新生成内置 JavaScript。

存储契约仅在存储值中允许任意 JSON，键、最近文档、搜索条件、行内样式和属性视图调色板均使用结构化类型。最近文档写入接口保留只读角色在解析请求体前直接返回成功的行为。`contractHandler` 可选的类型化 `beforeDecode` 回调用于保留这一执行顺序，允许在解码前返回响应；路由检查仍要求显式绑定端点。行内样式版本 1 的更新保留已有内置配置，版本 2 和调色板请求保留结构体解码的兼容行为。

`DirectJSONOutput` 保留直接返回 JSON 对象或数组的独立协议，不添加内核信封，此类载荷使用 `SuccessDirectJSON` 返回。支持通知空响应的端点显式声明 `NoContent` 并返回 `SuccessNoContent`；HTTP 校验要求状态码为 204 且响应体为空。鉴权和只读错误仍保留内核错误信封。生成声明记录直接输出模式及可选的空响应支持。

全局反链接口使用独立的平铺列表。`/api/ref/getGlobalBacklinks` 要求提供 `id`、`sort`（`1` 自然升序、`2` 自然降序）和 `containChildren`，支持可选的 `notebook`、`keyword` 和 `sourceFilter`。每个实际引用块只出现一次，取其首个匹配行内引用的锚文本并去除首尾空白；空锚文本在两个方向中均置后，相同锚文本按来源文档 ID、正文位置和块 ID 排列。首次请求返回不透明的快照令牌及最多 50 条元数据，后续请求复用 `snapshot` 和 `offset`，偏移量限制在已有页的边界。可选的 `anchorID` 用于定位原阅读位置所在页。正文变化期间快照顺序保持不变，不带令牌刷新时才纳入编辑结果。令牌过期、查询不匹配、来源文档消失或当前页条目删除、移动时返回 `expired: true`。缓存最多保留 16 份快照，期限为 5 分钟，总元数据预算为 64 MiB，不缓存正文；笔记本锁定时清除对应快照。

`/api/ref/getGlobalBacklinkContexts` 使用相同查询、必需的 `snapshot` 和最多 20 个属于该快照的块 `ids`，返回可独立编辑的块正文，并保留面包屑和数据库引用信息。两个接口在返回元数据或正文前重新检查来源权限，保留加密笔记本请求租约；发布阅读者不能读取加密笔记本。前端每页加载 50 条，保留视口附近 5 页及正在编辑的页，最多按需创建 16 个编辑器。回收等待未完成事务，保留输入法组合、焦点、拖动和数据库编辑会话。自动刷新等待编辑结束并恢复可见块的位置。配置 `backlinkGlobalSort` 的 `0`（默认）表示文档分组，`1`、`2` 表示全局锚文本升降序。`/api/ref/getBacklink2` 新增可选的 `includeBacklinks`（默认 `true`）；设为 `false` 时返回空反链列表及零反链计数，保留提及行为，避免重复加载文档分组。已有调用方和文档内 `blockSort` 的默认行为保持不变。

`TestGlobalBacklink*`、`TestAPIContractGlobalBacklink`、`TestBacklinkAnchorSortContext` 和 `TestBacklink2OptionalMentions` 覆盖跨文档分页、首个引用取值、编辑后的快照稳定性、阅读定位、普通和加密读取、来源权限、过期、缓存上限、实际 HTTP 响应契约及提及兼容性。它们包含在下方内核全量 CI 命令中，可单独运行 `go test -tags "fts5 sqlcipher" ./model ./api ./apicontract/... -run 'Test(GlobalBacklink|Backlink|APIContractGlobalBacklink|APIContractBack|APIContractSetting|PublishReaderBack|PublishReaderSearchAndBacklink|RouteCoverage)' -count=1`。前端的 `globalBacklinkPaging.test.ts`、`globalBacklinkList.test.js` 和 `backlinkSort.test.js` 已由现有全量 CI 自动发现，覆盖页窗口上限、迟到响应、待提交编辑和模式切换。

`TestGlobalBacklinkLargeDataset` 在隔离数据库中创建并索引 100 篇真实文档、共 10,000 条引用，逐一检查全部 200 页的自然顺序及条目无重复、无遗漏，再加载 16 个可编辑上下文。测试报告首次排序、缓存分页、正文加载的耗时及快照大小，不设置依赖机器性能的时间阈值。可运行 `go test -tags "fts5 sqlcipher" ./model -run TestGlobalBacklinkLargeDataset -count=1 -v`；现有 `TestGlobalBacklink*` 筛选和内核全量 CI 均包含该测试。前端回归还覆盖底部面板请求失败后的重试入口、重试成功后的空状态恢复，以及编辑器回收与重建时整行高度保持稳定。

## 文件与流式协议

`RawSSEOptions` 和 `RawWebSocketOptions` 声明以字节为载荷的广播协议，通过 `ValidateRawSSEEvent` 和 `ValidateRawWebSocketFrame` 单独校验事件及帧元数据；JSON 事件与 RPC 消息保留各自既有校验。原始 WebSocket 的错误由升级器写出，不使用 `RejectWebSocket`。

JSON SSE 接口通过 `SSEOptions` 和 `SSEEvent` 声明各事件名称及载荷。`StreamSSE` 在请求上下文内执行原有流生命周期，取消与清理仍在该生命周期内完成。HTTP 校验区分 `text/event-stream` 与声明过的流建立前 JSON 错误，`ValidateSSEEvent` 单独校验各事件的 JSON 载荷。生成声明包含事件类型。`fetchPost` 和 `fetchGet` 将完整流缓冲为文本，`fetchSyncPost` 仍解析 JSON，因此不用于读取事件流。

允许空 HTTP 响应的端点通过 `EmptyResponseStatuses` 列出允许状态，并返回 `EmptyHTTPResponse`；其他响应继续使用各自声明的结构。`RedirectHTTPContent` 保留标准重定向状态、Location 响应头和转义后的 HTML 正文。`RawBody` 将未读取的原始请求流留给协议处理函数。`ProxyOptions` 区分 HTTP 字节、EventSource 字节和 WebSocket 帧，保留上游状态，不将其解释为内核业务错误码。代理准入错误与中间件信封分别校验。`ANY` 注册仍按一条记录检查覆盖率，生成元数据时展开为路由器的九种 HTTP 方法。响应校验保留 JSON 数字精度，包括超过浮点范围的证书整数，不改变请求侧的数字转换。

页面响应通过 `HTTPContentOptions` 声明允许的 HTTP 状态与媒体类型组合，通过 `SuccessHTTPContent` 保留原始字节，复用既有二进制传输并单独处理 JSON 中间件错误。`FastJSON` 为指定的大体量响应保留快速 JSON 编码，不改变有类型载荷及响应信封；编码失败时仍回退到标准编码器。

`WebSocketOutput` 通过 `WebSocketOptions` 声明入站和出站消息类型及插件准入失败状态。`UpgradeWebSocket` 在 `contractHandler` 的响应阶段将写入器传递给连接生命周期；`RejectWebSocket` 序列化声明的拒绝载荷。生成的路由元数据包含双向消息模式，`ValidateWebSocketMessage` 单独校验连接内消息，避免与握手响应或中间件信封混淆。握手校验检查 HTTP 状态和响应体，网络回归验证升级头、Origin 拒绝、消息交互和取消后的连接关闭。

可选的 `*string` 表单字段区分未传字段与显式空字符串，并使用 `nonnullable`，因为表单文本不能包含 JSON 空值。导入处理器据此保留默认值和延后校验的行为。上传进度在解析表单前启动，解析失败时先清理进度再返回；类型绑定复用 Gin 缓存的表单。

`BinaryOutput` 通过 `BinaryContent` 和 `SuccessBinary` 声明原始文件响应。适配器保留字节和媒体类型，`ErrorStatus` 声明 JSON 失败响应使用的独立 HTTP 状态（`getFile` 使用 202）。schema 记录二进制成功响应和类型化 JSON 错误；`ValidateHTTPResponse` 先检查状态和媒体类型，再验证错误信封。生成的路由响应使用 `Blob`，现有 fetch 函数则使用 `JSONValue`，因为它们保留将文件内容解析为文本或 JSON 的行为。JSON 文件内容可以是任意 JSON，但结构化错误契约不因此放宽。

`FormBody` 用于 `putFile` 等同时接受 URL 编码表单和多部分表单的接口。它保留 Gin `PostForm` 的解析行为，包括重复字段取首值，以及解析失败后已经取得的字段。条件必填和延迟校验仍由处理函数负责：创建目录不要求上传文件，修改时间在写入后校验。生成的调用类型与多部分上传使用相同的类型化表单接口。

文件上传使用 `MultipartBody`。请求结构体以线协议字段名声明字符串和 `*multipart.FileHeader` 字段；文件 schema 使用 `type: string` 与 `format: binary`，生成 `Blob` 类型。适配器保留 Gin 的表单解析方式，重复字段取首值；文件内容继续通过 `Open` 读取，处理函数保留读取及恢复逻辑。未支持的字段类型和绑定选项会使生成失败。

声明为 `[]*multipart.FileHeader` 的固定字段按原顺序接收全部文件，生成 `Array<Blob>`。可选文件列表缺省时保留 nil；文本与单文件字段仍取首值。`SuccessWithMessage` 保留成功响应中的非空提示，包括批量上传部分成功。

前端从类型化字段构造 `ContractFormData`，再传递给现有请求函数。生成签名检查端点所需字段并区分文件与字符串，普通 `FormData` 不能满足上传接口的契约。可缺省字段不写入表单，字符串不裁剪空白。插件调用方构造表单时可实现生成的 `APIFormData<Request>` 接口。

动态上传接口使用 `MultipartFields` 保留每个字段名对应的全部文本值和文件。请求模式将字段名映射为文本或二进制值的数组，`ContractFormData` 将数组中的每一项追加为同名表单字段。固定字段上传仍绑定首个值。广播发布保留先处理文本、再处理文件的顺序及逐条消息的错误结果。端点专用的 `DecodeFailure` 处理保留原有解析错误码和载荷。

## 生成与验证

`/api/block/migrateLegacyMindmaps` 是要求管理员身份的写入端点，保留只读保护及加密笔记本请求租约。请求必须提供文档 `id` 和 `notebook`；保存历史后，在一次可撤销事务中转换能够完整解析的旧 `mindmap` 列表，返回 `converted` 数量和文档脑图的权威 `blocks`（`id`、`dom`）。重复请求返回当前块内容，不重复转换；不完整的原文保持不变。回归命令为 `go test -tags "fts5 sqlcipher" ./model ./api ./apicontract/... -run 'Test(LegacyMindmap|MigrateLegacyMindmaps|APIContractHeadingTransactions|APIContractRouterCoverage|RouteCoverage)' -count=1`，前端覆盖位于 `listMindmap/migrate.test.ts` 和 `listMindmap/model.test.ts`，均由现有持续集成规则发现。

在 `app/` 下运行：

```text
pnpm run api:generate --petal ../../petal
pnpm run api:check --petal ../../petal
pnpm run lint
pnpm test
```

上述生成命令同时更新本仓库与 `petal`，无须再单独执行不带 `--petal` 的生成命令。`--petal` 路径相对于生成器的工作目录 `kernel/`，示例对应同级仓库。CI 只检查本仓库产物，而本地跨仓库同步须使用该参数核对插件声明。

在 `kernel/` 下运行：

```text
go test -tags "fts5 sqlcipher" ./... -count=1
```

`tsconfig.api.json` 单独启用严格检查并检查声明文件，覆盖参数错误、字段拼写、必填请求体、成功与失败分支、可空值和方法不匹配。主应用继续沿用现有配置，不假定全部调用都启用了严格空值检查。处理函数测试使用临时工作区和独立测试进程，不启动或重启运行中的内核。

导入和静态文件测试数据使用 `internal/testutil.PublicDataDir` 创建并清理经过显式验证的非敏感目录，不依赖 `TMPDIR` 和 `GOTMPDIR`。该辅助函数依次尝试用户主目录、当前目录和文件系统根目录；若没有安全且可写的位置，则报告测试数据准备失败。CI 还会将 `TMPDIR` 设为 `/tmp`，并使用独立的 `GOTMPDIR` 重新运行受影响的路径测试，以覆盖环境变量覆盖的情况。

CI 在 Linux 上运行所有内核包的测试，在 Windows 上运行所有前端、Electron 和打包脚本测试。前端测试发现范围限定为 `src/**/*.test.ts`、`tests/**/*.test.js`、`electron/**/*.test.js` 和 `scripts/**/*.test.js`，因此排除 `app/build` 下的打包副本。测试文件串行执行，以避免 Electron 进程启动争用。这些位置新增的回归测试会自动纳入；新增测试位置或文件命名约定时，须同步更新测试命令和本文档。Go 契约回归测试的名称应保留 `Contract`，以便单独运行。
