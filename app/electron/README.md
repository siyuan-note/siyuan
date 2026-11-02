# 桌面端主进程（`app/electron`）

本目录存放严格 TypeScript 的 Electron 主进程与独立 Markdown 宿主源码。webpack 将 `main.ts` 与 `markdown/preload.ts` 分别编译为 `electron-dist/main.js` 和 `electron-dist/preload.js`；测试与源码同目录，不进入安装包。

`main.ts` 仅承担两项职责：以副作用导入 `./environment`，使环境变量早于启动依赖图求值；以及调用 `startup/bootstrap.ts` 的 `bootstrap()`。装配与启动流程均位于 `startup/`，**装配点不在 `main.ts`**。

## 目录职责

| 目录 | 职责 | 主要模块 |
| --- | --- | --- |
| `shared/` | 跨层基础件，不引用其他目录 | `runtime`（运行期状态）、`types`（领域类型）、`channels`（IPC 通道名）、`desktopDefaults`（固定值与 UA）、`staticMessages`、`errorWindow`、`language`、`crashHistory`、`pagePaths`、`traySupport`、`windowRoundTrip`、`atomicJsonFile`、`timing`、`argv`、`builtinArgs`、`logging`、`errors`、`electronRemote` |
| `startup/` | 启动期条件与进程级事件 | `bootstrap`、`startupBranches`、`startupSwitches`、`chromiumSwitches`、`secondInstance`、`appLifecycle`、`systemShutdown`、`updateCoordination`、`linuxInputMethod`、`accessibility`、`protocolClient`、`lastWorkspace`、`enabledSettingFile` |
| `window/` | 窗口的创建、导航与生命周期 | `mainWindow`、`bootWindows`、`openWindow`、`windowLookup`（按 id 与焦点查找）、`windowVisibility`（显隐切换）、`appExit`（工作空间与应用退出）、`windowRegistry`、`windowLifecycle`、`windowNavigation`、`windowPreferences`、`windowGeometry`、`windowControlsOverlay`、`windowMessaging`、`windowWorkspaces`、`settingsWindows`、`settingsTaskBridge`、`appMenu`、`appMenuSession`、`trayMenu`、`blockDrag`、`globalShortcutBindings`、`rendererCrash` |
| `kernel/` | 本机内核：进程启动、就绪探测与退出编排 | `kernelBoot`、`kernelBootBudget`、`kernelExit`、`kernelEndpoint`、`kernelExitCodes`、`kernelRequestLog`、`kernelDiagnostics`、`localKernelRequest`、`previousKernelExit`（上一次内核的退出等待与恢复）、`workspaceInfo`、`notebookSystemLock`、`appleSiliconWarning` |
| `remote/` | 远端内核：连接管理、认证、协议处理与页面获取 | `connectionManager`、`connectionRuntime`、`connectionStore`、`remoteBoot`、`remoteKernel`、`remoteDocument`（内联脚本识别与 CSP）、`remoteKernelAuth`、`remoteProtocol`、`sessionHeaders`、`webPageFetch`、`webPageNetwork`、`remoteExport` |
| `markdown/` | 独立 Markdown 窗口、文件事务与恢复；不依赖其他主进程层，标题栏等宿主能力由入口注入 | `windows`、`preload`、`host`、`disk`、`registry`、`recoveryStore`、`resources`、`imageImport`、`tree`、`treeView`、`preferences`、`codec`、`launch`、`lifecycle`、`replaceFile` |
| `ipc/` | IPC 通道注册，按通道域拆分；以入参校验与转交为主，剪贴板编解码与文件对话框的实现亦保留在这一层。`getChannel` 仅负责远程内核拦截、上下文组装与分派，领域处理器按对象展开合并；`register` 是全部通道的装配点 | `getChannel`+`getContract` 与四张领域表（`clipboard`/`windowCommands`/`systemSettings`/`connectionCommands`）、`workspace`、`appEvents`、`commandChannel`、`dialogs`、`exportPreview`、`shellIntegration`、`register`、`clipboardFormat`、`richClipboard` |
| `static/` | 不经 webpack 打包、由 `loadFile` 或本机协议处理器直接加载的页面 | `boot.html`、`init.html` 与 `workspace.html`、`connections.html`、`remote-auth.html`、`error.html`，以及 `window.js`/`window.css`、`connections.js`、`connectionEntry.js`、语言包、图标 |

`ipc/workspace.ts` 是唯一带副作用的 IPC 模块：初始化时创建托盘、向本机内核查询工作空间目录并上报 `uiproc`。向 `ipc/` 添加此类逻辑前，应先确认它不需要跨层能力。

## 依赖方向

下表与 `electron/architecture.test.ts` 的 `allowedDependencies` 一致，该测试遍历全部生产文件逐一检查相对导入：

| 层 | 可以引用 |
| --- | --- |
| `shared` | 仅 `shared` |
| `kernel` | `shared`、`kernel` |
| `remote` | `shared`、`kernel`、`remote` |
| `window` | `shared`、`kernel`、`remote`、`window` |
| `markdown` | 仅 `markdown`；通过类型导入复用 `src/markdown/` 的跨平台契约 |
| `ipc` | 以上再加 `startup` |
| `startup` | 全部 |
| `main.ts` | 全部，且不被任何生产模块引用 |

- 依赖整体自 `shared` 向外收敛，例外为 `ipc` 与 `startup` 互为上下游：`startup/bootstrap.ts` 调用 `ipc/register.ts` 完成通道装配
- `window` 可引用 `remote`，不可引用 `ipc` 与 `startup`；`kernel` 无法使用任何窗口能力
- 需要跨层能力时，应先查 `shared/types.ts` 是否已有契约（例如 `BootWindowsApi`），无则交由上层注入，不新增依赖边
- 新增一级目录须同时补 `allowedDependencies`，否则测试将以「unknown layer」失败

## 启动流程

### 三段流程

`startup/bootstrap.ts` 的 `bootstrap()` 自上而下仅分三段：

| 段 | 内容 |
| --- | --- |
| 就绪前定条件 | 解析路径与日志 → Linux 输入法兼容重启 → 进程身份 → 单实例锁 → 远端内核参数与深链 → 协议注册 → Chromium 开关 → 辅助功能 → 首次启动探测与上次工作空间 → `setStartupSnapshot()`。`launchArguments` 为本次生效的命令行（兼容模式已剔除受管开关），单实例锁失败时直接返回 |
| 装配能力 | 设置任务桥、主窗口与设置窗口；`registerAppLifecycle()` 登记进程级事件；末行为 `app.whenReady().then(startAfterReady)`。内核编排与笔记本系统锁不在此段创建 |
| `startAfterReady()` | `whenReady` 之后创建内核编排与系统锁，完成接线并按启动分支开窗 |

`setStartupSnapshot()` 之后 `state.startup` 整组冻结，运行期不再变化。

### startAfterReady 的接线顺序

创建 `createKernelBoot` 与 `createNotebookSystemLock` → `prepareSession()` → `resolveStartupBranch()` → 按分支预创建启动页 → `createConnectionRuntime()` → `registerDesktopIpc()` → `startSecondInstance()` → `registerRuntimeHandlers()` → `runStartupBranch()`。

### 顺序约束

下列顺序属于正确性约束，违反将直接导致故障：

| 约束 | 原因 |
| --- | --- |
| 进程身份早于单实例锁 | `userData` 决定单实例锁的落点目录 |
| Linux 输入法兼容重启早于获取单实例锁、创建窗口与启动内核 | 兼容模式会就地剔除受管开关，其后一律以 `launchArguments` 为准 |
| 协议注册与 Chromium 开关早于创建窗口 | 两者决定其后所有窗口的行为 |
| 辅助功能早于创建窗口 | 配置对本机所有工作空间生效 |
| 会话策略早于任何页面加载 | 启动页在加载之初即向内核发起请求，需要证书信任与失败日志 |
| 分支解析早于预创建启动页 | 仅 `local-kernel` 分支提前创建启动页 |
| 第二实例取锁后即入队 | `app` 就绪并取得 `initKernel` / `initMainWindow` 后按到达顺序重放，先到者不丢失 |

### 启动分支

`startup/startupBranches.ts` 的 `StartupBranch` 为判别联合，载荷随分支一同给出；`resolveStartupBranch` 按下表优先级取首个命中项，`runStartupBranch` 再以 `switch` 分派。

| 分支 | 触发条件 | 结果 |
| --- | --- | --- |
| `remote-arg-invalid` | 远端参数解析失败，或携带将被下发给对端的不安全 Chromium 开关 | 静态错误窗口，不进入任何启动页 |
| `remote-target` | 存在远端内核目标 | 连接并认证，成功后进入主窗口；失败则关闭启动页并提示 |
| `first-open` | 无工作空间记录 | `init.html` 供选择语言与工作空间目录 |
| `crash-recovery` | 存在上次崩溃记录 | `workspace.html`，携带安全模式选项与崩溃信息；内核启动成功后才清除崩溃记录 |
| `workspace-missing` | 上次的工作空间已不存在 | `workspace.html`，列出可用工作空间 |
| `local-kernel` | 其余情形 | 以命令行的工作空间、端口、语言与安全模式启动本机内核 |

### 内核启动与主窗口启动

`initKernel()`（`kernel/kernelBoot.ts`）先确定工作空间的三级回退：命令行 `--workspace` → `SIYUAN_WORKSPACE_PATH` → 上次工作空间；三者皆空时记录日志并返回。若同一工作空间已有启动记录或主窗口，则仅显示该窗口，不重复启动。实际启动内核时依次执行：Apple 芯片提示与内核程序存在性检查 → 分配端口 → 等待上一个工作空间退出（仅限本进程启动的内核）→ 启动进程 → 轮询 `/api/system/version` → 轮询 `/api/system/bootProgress` → 交回端口。失败一律以 `undefined` 结束。

单次尝试的等待 Promise 必须由三条路径之一结算：就绪轮询返回、内核进程 `close` 回调、`before-quit` 取消；尝试本身抛出异常时同样结算为失败，否则调用方会永久等待。`settle` 只生效一次，后到的路径不覆盖已交回的结果。

`initMainWindow()`（`window/mainWindow.ts`）以隐藏状态创建窗口，取得网络配置后载入主界面，登记窗口账本并清除启动记录，待前端回传 `siyuan-event` 后才显示窗口并关闭启动页；命令行中的 `siyuan://` 深链亦在此时转交界面。

## 运行期状态

### 唯一容器

`shared/runtime.ts` 的 `state` 为唯一容器，进程生命周期内保持同一引用（仅 `startup` 整组替换并冻结）。模块直接读取 `runtime.state`，不将其作为参数逐层传递；测试以 `resetRuntimeState()` 复位，容器本身不替换。

| 分组 | 内容 | 写入方 |
| --- | --- | --- |
| `startup` | 启动条件快照 | 仅由 `setStartupSnapshot` 写入一次，整组冻结 |
| `kernel` | 端口、启动中与已运行内核、退出证据 | `kernelBoot` 写端口、启动记录与进程；`mainWindow` 清除已开窗的启动记录；`updateCoordination` 登记预期退出的端口；`kernelExit` 仅读取退出证据 |
| `windows` | 窗口与内核目标、握手与初始化状态、崩溃预期、启动页窗口 | 读写均经由 `windowRegistry` |
| `exit` | 系统关机阶段、更新安装、切换连接后的重启参数 | `systemShutdown`、`updateCoordination` |
| `workspaces` | 已打开的工作空间 | `windowRegistry` 的 `addWorkspace` / `removeWorkspace` |
| `pendingRemoteOpenURLs` | 远端内核下待投递的 `siyuan://` 深链 | `bootstrap`、`appLifecycle`、`secondInstance` 入队；`ipc/workspace` 在窗口就绪后投递并清空 |

`exit.systemShutdown` 的阶段仅由 `startup/systemShutdown.ts` 推进；其他模块以 `runtime.isSystemShuttingDown()` 判断是否处于关机流程，不直接比较阶段值。

### 窗口账本的两个状态

两者的时机与含义均不同，不可合并：

| 状态 | 何时置位 | 影响 |
| --- | --- | --- |
| `handshaken` | 窗口发出首次 `siyuan-event` | 启动页阶段结束，窗口自此被视为应用窗口：作为菜单同步对象，并成为 `getAppWindow` 与 `showWindow` 的候选 |
| `initialized` | 窗口完成 `siyuan-init` | 领取内核能力；重复初始化仅刷新托盘文案，不重建托盘 |

跨窗口消息的投递条件与握手无关：收件方须与发送方指向同一内核 origin，因此远端内核窗口无法影响其他工作空间。

### 窗口模块的两层

`windowRegistry` 仅承担按 `webContents id` 索引的账本读写，直接访问 `state.windows` 的只有它与 `shared/runtime.ts`，其余模块一律经由语义方法；ESLint 拦截取成员、计算属性与解构三种写法。`windowLifecycle` 负责将窗口事件接入账本与拖拽会话。拖拽的焦点顺序与清理入口均位于 `blockDrag`，`windowLifecycle` 单向依赖它，因而不构成循环引用。

窗口的查找、显隐与退出编排分别位于 `windowLookup`、`windowVisibility` 与 `appExit`：查找只依赖账本与焦点状态，显隐只依赖托盘判定，退出编排持有工作空间销毁与重启流程，三者互不引用。

## 扩展指南

### 新增 IPC 通道

1. 在 `shared/channels.ts` 增加通道名
2. 在前端 `app/src/constants.ts` 的 `Constants` 增加同值常量（`channelsConsistency.test.ts` 会比对两侧，以及 `static/` 脚本引用的通道名）
3. 在 `ipc/` 对应域模块注册处理器，入参校验写在此处；新增域模块仅导出 handler 表，由 `getChannel.ts` 以对象展开合并，不应将领域逻辑移回 `getChannel.ts`
4. 需要限制为已初始化窗口时，沿用 `ipc/register.ts` 的判定方式：`isWindowInitialized(sender.id) && !!getWindowKernelTarget(sender.id)`

### 新增启动分支

1. 在 `startupBranches.ts` 的 `StartupBranch` 联合类型中增加变体，同时带上该分支所需的载荷
2. 在 `resolveStartupBranch` 中按优先级给出该变体
3. 在 `runStartupBranch` 中增加一个 `case` 并调用具名动作函数，`assertNever` 将保证编译器指出遗漏

### 新增设置窗口

1. 沿用 `window/settingsWindows.ts` 的 `ApprovedWindow` 流程：先由 `siyuan-settings-prepare` 授权，再由 `setWindowOpenHandler` 放行
2. 显示条件由 `reveal` 保证：`active && ready && painted && !shown`；渲染就绪与首次绘制的先后顺序不限，且仅显示一次
3. 授权有效期为 60 秒；宿主重新导航、渲染进程崩溃或销毁时，未显示的窗口一并作废

### 新增运行期状态字段

1. 在 `shared/types.ts` 对应组的类型中加入字段，并注明读写方
2. 在 `shared/runtime.ts` 的 `state` 初始化中给出起始值
3. 同步补充 `resetRuntimeState()`，否则用例之间会相互污染
4. 存在唯一写入方时，将其补入本文档的「运行期状态」表

## 编码约定

### 注释与文案

- 使用中文，仅描述当前生效的行为，不叙述代码的演变过程
- 注释应说明代码本身未表达的信息，或交代顺序约束的成因；仅复述下一行行为的注释应删除

### 流程与分派

- 长流程采用「流程函数 + 具名阶段」结构：主函数仅按顺序调用阶段函数，阶段函数紧随其后定义。`bootstrap`、`mainWindow.initMainWindow`、`runStartupBranch`、`remoteBoot.initRemoteKernel`、`kernelBoot.initKernel`、`settingsWindows` 的窗口放行策略均采用此形状
- 分派采用 `switch` 加一个分支一个具名动作的写法，不使用「判断链 + 末尾兜底」：`startupBranches` 与 `connectionManager` 的命令表为示例
- 阶段数量无硬性要求：仅有一个调用点且函数名不承载额外语义时，并回流程更易读

### 模块边界与注入

- 跨层协作者不得在本层 import，应由上层注入。`kernel` 与 `remote` 所需的启动页能力统一取自 `shared/types.ts` 的 `BootWindowsApi`；`bootstrap.ts` 与 `startupBranches.ts` 直接传入 `window/bootWindows` 模块本身，不为每个调用点编写适配函数
- 仅在携带信息时保留一层包装：
  - 内联：只有一个调用点且函数体仅为原样转交（如已移除的 `bindMainWindowReady`），或注入的是本模块定义、又被调用方原样传回的函数（如 `registerWindowMessageHandler` 曾接收 `dispatchWindowMessage`）
  - 保留：函数绑定完整协议（通道名、命令名、超时、回执载荷形状、失败策略），如 `prepareNotebookSystemLock` 与 `flushWindowWorkspaces` 各自持有握手协议、仅共用 `shared/windowRoundTrip` 的算法；或它是跨层绑定的唯一定义点
  - 参数中出现 `x = electron.x` / `x = paths.y` 且无测试消费者时，删除参数改为就地读取
- `install*` 为既有惯例：安装器接收安装目标（`installKernelRequestLog(session, ...)`、`installWebPageFetchIPC(ipcMain, ...)`），此类参数保留。`register*` 与 `create*` 不接收 Electron 成员，需要时自行 import；跨层能力仍由参数传入。唯一例外为 `remote/webPageFetch.createWebPageFetcher`，其测试需在纯 Node 与真实 Electron 中双跑
- 持有跨调用可变状态的协作者采用工厂函数（如 `createSettingsWindows`），其余写为模块导出函数。工厂仅在三种情形下保留：需跨调用保存状态、需注入跨层能力、测试需替换副作用
- 跨层登记的单例只保留一份引用：持有方（`remote/connectionRuntime.ts` 的连接管理器）自行保存实例，`shared/` 只登记它所需的那个函数（`setRemoteErrorPresenter`），不再复制一份结构相同但语义更窄的副本
- 同一固定值只写一次：窗口最小尺寸、应用图标、User-Agent、本机页 `webPreferences` 均位于 `shared/desktopDefaults.ts`，不应在调用点复制字面量

### 导入写法

- Electron 成员应直接 import，不作为参数传递。纯 Node 环境下 `require("electron")` 仅返回可执行文件路径，此前因此将 `app` / `BrowserWindow` / `screen` / `net` / `dialog` / `ipcMain` 逐个作为参数传入
- 仅使用一两个成员时采用具名导入；单个函数需使用多个成员时，采用 `import * as electron` 并在函数体首部解构，避免顶部堆积过长的导入列表
- 引用同层协作者按使用面选择：需多个成员且需避开本地标识符重名时采用 `import * as`（`runtime`、`appExit`、`language`），其余采用具名导入
- 仅取类型时一律 `import type`。测试中尤为关键：替身须在被测模块加载前建立绑定，若提前以值导入则会加载真实 Electron

### 测试

- 测试与源码同目录、同名同前缀；改动行为时同步修改对应测试
- Electron 成员由 `fixtures/electronStub.ts` 的 `mockElectron(t, {...})` 替换，测试入口已带 `--experimental-test-module-mocks`；替身须在 `require("./被测模块")` 之前建立
- 同层协作者不能靠 mock 替换：tsx 将模块导出编译为 getter，`t.mock.method` 对其无效。需控制协作者行为时，应令其读取共享状态与磁盘（测试改状态或写文件），或将其保留在注入面上
- 集成与架构用例按关注点命名，不与文件名对应（`architecture`、`channelsConsistency` 等），此为有意设计

## 验证

以下命令均在 `app/` 目录下执行：

| 目的 | 命令 |
| --- | --- |
| 完整检查 | `pnpm run lint`（含类型检查、ESLint 自动修复，以及 CSS、菜单、启动语言检查） |
| 仅类型检查 | `pnpm run typecheck`（同时覆盖 `tsconfig.electron.json` 与 `tsconfig.electron.test.json`） |
| 改动相关测试 | `pnpm run test:affected`；仅查看将执行哪些用例时使用 `pnpm run test:changed` |
| 全量测试 | `pnpm run test` |

单独执行某个测试文件时须带上钩子与开关，否则 `require("./x")` 无法解析 `.ts`，Electron 替身也不会生效：

```
node --import tsx --experimental-test-module-mocks --test electron/<路径>.test.ts
```

构建与开发服务器由开发者手动管理，验证时不应执行 `pnpm dev` 或 `pnpm build`。
