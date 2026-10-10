# 独立地图 webview 原型

此入口使用正式 createMapHostManager 和合成条目，不读取笔记，也不接入现有笔记窗口。主窗口保留本地实际配置：`nodeIntegration=true`、`contextIsolation=false`、`webSecurity=false`。地图 guest 使用独立内存会话、固定预载脚本和既有资源路由，强制启用 sandbox、contextIsolation 和 webSecurity，关闭全部 Node 能力。

在 `app/` 中运行，确保没有设置 `ELECTRON_RUN_AS_NODE`：

```sh
node node_modules/electron/cli.js tests/fixtures/map-webview-boundary/harness.cjs
```

默认是真实 OpenFreeMap 模式，直接读取开发者已有的 `stage/build/map/` 产物，使用固定合成坐标。缺产物会明确报错，不自动编译或替换成假图。此模式需要访问 OpenFreeMap。先等终端输出边界检查通过与窗口就绪，再确认真实瓦片出图。

不访问地图服务的合成模式，以及自动安全与覆盖断言：

```sh
node node_modules/electron/cli.js tests/fixtures/map-webview-boundary/harness.cjs --synthetic
node node_modules/electron/cli.js tests/fixtures/map-webview-boundary/harness.cjs --synthetic --verify
```

远程内核宿主边界使用本机测试服务器代替真实内核，但保留远程主窗口的 `webSecurity=true`、正式 `createRemoteDocumentContentSecurityPolicy` 和 `shouldBlockRemoteFrameNavigation` 策略，以及独立 owner 会话；不会删除 CSP。地图授权守卫在 owner 首次加载前注册，先验证无分区、普通分区、持久分区的未授权 webview，以及 iframe/object 均被拒绝，再创建合法地图，完成同样的就绪、隔离、圆角像素、菜单覆盖和输入断言。

```sh
node node_modules/electron/cli.js tests/fixtures/map-webview-boundary/harness.cjs --remote --synthetic --verify
node node_modules/electron/cli.js tests/fixtures/map-webview-boundary/harness.cjs --remote --real
```

如果正式远程 CSP 或导航策略拦住合法地图，远程测试必须失败；不要为使测试通过而修改 CSP、关闭 webSecurity 或移除子框架拦截。真实模式仍需已有地图产物与 OpenFreeMap 网络，合成模式不能证明真实瓦片或 WebGL 可用。

终端会在远程宿主安全断言通过后输出固定的 `Remote map owner policy: PASS.`；启动或验证失败会输出 `Remote map webview verification: FAIL.` 及固定失败阶段，不输出原始异常或私有地址。自动验证还会在合法地图就绪后再次检查默认拒绝仍生效。

自动验证覆盖 guest Node/IPC 与 owner DOM 不可访问、独立会话不受默认会话删除 CSP 影响、内核 API/非白名单/worker 请求拒绝、导航及伪造 guest 拒绝、普通 DOM 菜单合成像素及真实输入、Esc、地图内点击关闭菜单且同次点击仍传给地图、滚动、地图实例/视野/visibility 稳定。合成适配器验证不等于真实 OFM/WebGL 出图验证。

手动打开普通菜单，输入中文并使用输入法候选，按 Esc，反复开关菜单，滚动地图所在容器。地图应持续可见，不重建、不重置视野；菜单应覆盖地图并正确接受输入。输入法与平台合成仍需在目标桌面实际确认。

```sh
node --test tests/mapWebviewStartup.test.js tests/mapWebviewBoundary.test.js
```

没有 DISPLAY/WAYLAND_DISPLAY 的 Linux 环境会明确跳过真实 Electron 验证，单元测试通过不能替代运行验证。禁止使用 `--no-sandbox`、`--disable-web-security` 或其他安全降级参数。开发环境实装 Electron 44.5.1，package.json 声明 44.7.0；两个版本的真实桌面验证结果需要分别记录。

本地和远程 Electron 均使用网页内的受控地图 webview，普通菜单直接覆盖地图；远程仅放行主进程登记的地图预约，其余 webview 仍默认拒绝。此入口用于持续验证同一个正式宿主及网络隔离边界。
