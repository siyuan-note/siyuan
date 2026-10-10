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

自动验证覆盖 guest Node/IPC 与 owner DOM 不可访问、独立会话不受默认会话删除 CSP 影响、内核 API/非白名单/worker 请求拒绝、导航及伪造 guest 拒绝、普通 DOM 菜单合成像素及真实输入、Esc、地图内点击关闭菜单且同次点击仍传给地图、滚动、地图实例/视野/visibility 稳定。合成适配器验证不等于真实 OFM/WebGL 出图验证。

手动打开普通菜单，输入中文并使用输入法候选，按 Esc，反复开关菜单，滚动地图所在容器。地图应持续可见，不重建、不重置视野；菜单应覆盖地图并正确接受输入。输入法与平台合成仍需在目标桌面实际确认。

```sh
node --test tests/mapWebviewStartup.test.js tests/mapWebviewBoundary.test.js
```

没有 DISPLAY/WAYLAND_DISPLAY 的 Linux 环境会明确跳过真实 Electron 验证，单元测试通过不能替代运行验证。禁止使用 `--no-sandbox`、`--disable-web-security` 或其他安全降级参数。开发环境实装 Electron 44.5.1，package.json 声明 44.7.0；两个版本的真实桌面验证结果需要分别记录。

本地 Electron 使用网页内 webview 承载，普通菜单直接覆盖地图；远程内核保持现有独立宿主路径。此入口用于持续验证同一个正式宿主及网络隔离边界。
