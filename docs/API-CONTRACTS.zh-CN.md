# 内核接口类型契约

[English](API-CONTRACTS.md)

## 适用范围

本文规定内核 HTTP 接口的类型定义、兼容要求、生成产物和验证流程。端点定义以 `kernel/apicontract/contracts.go` 为准；`kernel/apicontract/legacy_routes.json` 登记使用既有处理方式的路由，包括非 JSON、动态路径和 `ANY` 注册。新增接口必须定义类型契约，不得加入存量清单。

## 契约与实现

`kernel/apicontract/contracts.go` 定义请求、响应和端点。契约包独立于内核启动、数据库和持久化模型，生成器可以单独运行。API 入口通过 `contractHandler` 绑定端点，请求参数和成功返回值受到 Go 泛型签名约束；响应载荷通过构造函数设置，不能直接给通用 `ret.Data` 赋值。业务校验继续使用现有辅助函数，`contractFailure` 保留其错误码、消息和已支持的错误载荷。

生成器从同一组 Go 类型生成 `app/src/types/api/index.d.ts` 和 `kernel/apicontract/schema.json`。后者包含共享的 `$defs` 和每个端点的请求、响应 schema，测试使用同一套 schema 检查实际 HTTP 响应。类型声明不会在运行时验证 JSON，CI 中的处理函数测试负责验证序列化结果。

输入和输出分别处理。`json` tag 控制线协议字段名；请求字段默认必填，`api:"optional"` 表示可缺省，`nullable` 表示接受 `null`，指针保留可空语义。输出字段的 `omitempty` 只控制输出省略，不推导请求必填性。嵌入结构体展平，递归类型通过引用表示；接口联合、常量字段和自定义编解码需要显式建模。未支持的类型、字段冲突和未知 JSON tag 会使生成失败，不会降级为 `any`。

数组、字典和嵌套结构体递归检查请求约束，字符串数组中的 `null` 不会被转换为空字符串，批量属性中的 `null` 值仍表示删除属性。标签树单独定义递归传输结构；前端共享树节点中的笔记本和文档路径字段为可选，反映标签节点不返回这些字段的实际行为。

`Notebook` 是接口载荷，业务模型通过显式转换映射到该载荷，回归测试比较完整 JSON，包括各个加密状态。修改契约不会改变 `.sy`、数据库、历史、同步或加密格式。

## 兼容要求

契约维护必须保留接口已有的可观察行为，不能仅因类型定义或处理函数重构而改变调用语义：

- 请求语义：保持请求体是否必需、字段是否可缺省，以及空请求体、缺失字段、`null`、空字符串、空对象和空数组的区别
- 参数处理：保持默认值、空白处理、数字转换和已支持的历史输入规则；不得隐式扩大或缩小接受范围
- 响应结构：保持字段名称、类型、可空性和省略规则，区分 `{}`、`[]` 与 `null`，完整声明成功、提示和失败等响应分支
- 错误行为：保持 HTTP 状态、业务错误码、消息、附加错误载荷和提示显示时长，不将已有业务失败重新解释为成功
- 权限与生命周期：保持认证、角色、只读和发布权限校验，以及加密笔记本的操作准入、租约范围与释放时机；兼容处理不得绕过授权或认证解密

具体接口的特殊行为由契约定义、兼容解码和回归测试共同记录。测试应覆盖实际 HTTP 序列化结果、边界输入和权限场景，不能只验证类型能否编译。

`ignoretype` 和 `filterstrings` 仅用于声明过的旧参数兼容行为。生成的请求类型描述规范调用形式；兼容解码可能接受并忽略更宽的旧输入，兼容测试明确覆盖这些例外。不存在全局「绑定失败后回退旧解析」的开关。

只读中间件仍可返回带 `closeTimeout` 的提示对象。`fetchPost` 的普通回调只接收消息处理后保留的非负错误码，块信息接口的 `3` 仍须处理；`fetchSyncPost` 和 `fetchGet` 保留完整响应。动态 URL 保留存量签名；静态 POST 路径必须来自契约或存量路由，错误参数不能通过重载回退。拼接出开放范围的模板 URL 时使用显式 `string` 变量。

业务错误需要保留提示显示时长时使用 `FailureWithTimeout`。使用契约的块查询通过 `holdContractBlockRequest` 保留显式笔记本及附带 ID 的租约检查；状态查询允许已删除 ID 的行为仍由对应入口明确指定。

## 接口维护流程

1. 在契约包中定义或更新传输类型与端点，明确请求体、错误码、空值、默认值和历史输入兼容规则
2. 用 `contractHandler` 绑定业务入口，保持路由中间件顺序、授权和租约范围
3. 使用类型契约的路由不得同时出现在 `legacy_routes.json`；删除接口时同步移除对应记录，新增接口不得加入该清单
4. 更新实际响应、兼容输入和严格类型测试，运行生成器，再修正编译器指出的调用问题
5. 同步 `petal` 的生成声明和相关公共声明；公开接口同步更新接口文档

生成检查读取实际路由与处理函数声明，验证方法、路径、处理函数和契约适配器的对应关系。CI 对照变更前的清单阻止增加存量记录。不得通过 `any`、类型断言或修改存量清单绕过契约检查。

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
go test -tags "fts5 sqlcipher" ./api -run "TestAPIContract|TestBlockAttrsRespectPublishAccess|TestGetBlockInfoRecovery|TestGetBlockInfoPublishAccess|TestListNotebooksSortsBySubDocCount|TestContract.*NotebookResponseLease" -count=1
```

`tsconfig.api.json` 单独启用严格检查并检查声明文件，覆盖参数错误、字段拼写、必填请求体、成功与失败分支、可空值和方法不匹配。主应用继续沿用现有配置，不假定全部调用都启用了严格空值检查。处理函数测试使用临时工作区和独立测试进程，不启动或重启运行中的内核。
