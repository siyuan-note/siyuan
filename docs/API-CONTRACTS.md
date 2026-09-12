# 内核接口类型契约

首批覆盖 `/api/system/version`、`/api/attr/getBlockAttrs`、`/api/attr/setBlockAttrs`、`/api/search/searchTag`、`/api/notebook/lsNotebooks`、`/api/history/searchHistory` 和 `/api/block/getBlockInfo`。版本接口同时支持 GET 和 POST，因此共登记 8 个方法与路径组合。

## 契约与实现

`kernel/apicontract/contracts.go` 定义请求、响应和端点。契约包独立于内核启动、数据库和持久化模型，生成器可以单独运行。API 入口通过 `contractHandler` 绑定端点，请求参数和成功返回值受到 Go 泛型签名约束；响应载荷通过构造函数设置，不能直接给通用 `ret.Data` 赋值。业务校验继续使用现有辅助函数，`contractFailure` 保留其错误码、消息和已支持的错误载荷。

生成器从同一组 Go 类型生成 `app/src/types/api/index.d.ts` 和 `kernel/apicontract/schema.json`。后者包含共享的 `$defs` 和每个端点的请求、响应 schema，测试使用同一套 schema 检查实际 HTTP 响应。类型声明不会在运行时验证 JSON，CI 中的处理函数测试负责验证序列化结果。

输入和输出分别处理。`json` tag 控制线协议字段名；请求字段默认必填，`api:"optional"` 表示可缺省，`nullable` 表示接受 `null`，指针保留可空语义。输出字段的 `omitempty` 只控制输出省略，不推导请求必填性。嵌入结构体展平，递归类型通过引用表示；接口联合、常量字段和自定义编解码需要显式建模。未支持的类型、字段冲突和未知 JSON tag 会使生成失败，不会降级为 `any`。

`Notebook` 是接口载荷，业务模型通过显式转换映射到该载荷，回归测试比较完整 JSON，包括各个加密状态。修改契约不会改变 `.sy`、数据库、历史、同步或加密格式。

## 保留的兼容行为

| 接口 | 兼容边界 |
|---|---|
| `version` | 不要求请求体，响应数据是字符串 |
| `getBlockAttrs` | 必须有 ID，成功时始终返回属性字典，没有属性时保持 `{}` |
| `setBlockAttrs` | 属性值为字符串或 `null`；`null` 删除属性，成功时数据为 `null` |
| `searchTag` | 允许空关键词，空结果保持 `[]` |
| `lsNotebooks` | 保留空请求体、`null` 和旧解析失败时的默认分支；合法对象中的错误布尔类型返回错误；保留业务失败时原有的成功码与空数据 |
| `searchHistory` | 数字先按 JSON 浮点值解码，再沿用原有整数转换；缺省或 `null` 保留默认值，数字字符串不作为数字接受 |
| `getBlockInfo` | 保留 ID 去空白、可选笔记本参数和附带 ID 的租约检查；分别声明完整信息、发布密码提示和错误响应 |

`ignoretype` 和 `filterstrings` 仅用于声明过的旧参数兼容行为。生成的请求类型描述规范调用形式；兼容解码可能接受并忽略更宽的旧输入，兼容测试明确覆盖这些例外。不存在全局“绑定失败后回退旧解析”的开关。

只读中间件仍可返回带 `closeTimeout` 的提示对象。`fetchPost` 的普通回调只接收消息处理后保留的非负错误码，块信息接口的 `3` 仍须处理；`fetchSyncPost` 和 `fetchGet` 保留完整响应。动态 URL 保留存量签名；静态 POST 路径必须来自契约或存量路由，错误参数不能通过重载回退。拼接出开放范围的模板 URL 时使用显式 `string` 变量。

## 新增与迁移

1. 在契约包中定义传输类型与端点，并明确请求体、错误码、空值、默认值和历史输入兼容规则
2. 用 `contractHandler` 接入业务入口，保持路由中间件顺序、授权和租约范围
3. 已有接口迁移完成后，从 `legacy_routes.json` 删除对应记录；新接口不能加入该清单
4. 更新实际响应、兼容输入和严格类型测试，运行生成器，再修正编译器指出的调用问题
5. 同步 `petal` 的生成声明和相关公共声明；已公开接口同步更新接口文档

`legacy_routes.json` 记录尚未迁移的路由，包括非 JSON、动态路径和 `ANY` 注册。生成检查读取实际路由与处理函数声明，验证方法、路径、处理函数和契约适配器的对应关系。CI 对照合入前的清单阻止增加存量记录。

## 生成与验证

在 `app/` 下运行：

```text
pnpm run api:generate
pnpm run api:generate --petal ../../petal
pnpm run api:check --petal ../../petal
pnpm run lint
pnpm exec tsx --test src/util/fetch.test.ts src/util/fetchTimeout.test.ts
```

`--petal` 路径相对于生成器的工作目录 `kernel/`，示例对应同级仓库。CI 只检查本仓库产物，本地跨仓库同步须使用该参数核对插件声明。

在 `kernel/` 下运行：

```text
go test ./apicontract/...
go test -tags "fts5 sqlcipher" ./api -run "TestAPIContract|TestBlockAttrsRespectPublishAccess|TestGetBlockInfoRecovery|TestGetBlockInfoPublishAccess|TestListNotebooksSortsBySubDocCount" -count=1
```

`tsconfig.api.json` 单独启用严格检查并检查声明文件，覆盖参数错误、字段拼写、必填请求体、成功与失败分支、可空值和方法不匹配。主应用继续沿用现有配置，因此存量调用的严格空值检查并未全量开启。处理函数测试使用临时工作区和独立测试进程，不启动或重启运行中的内核。
