# 未定位菜单可信 overlay 验证入口

本目录提供合成记录和合成地图的独立验证窗口。菜单 manager、policy、preload、HTML、JS 和 CSS 的唯一实现位于 `app/electron/mapUnplaced/`，真实地图与本入口直接复用，不保留两份菜单实现。合成入口不会读取真实笔记、连接内核或加载 OpenFreeMap，不能替代生产 OFM 验收。

## 可运行入口

在 `app/` 目录运行：

```sh
node --import tsx --test tests/mapUnplacedOverlay.test.js tests/mapUnplacedOverlayStartup.test.js tests/mapUnplacedOverlayBoundary.test.js electron/mapHostManager.test.js
node node_modules/electron/cli.js tests/fixtures/map-unplaced-overlay/harness.cjs
```

第一条命令收集 Node 回归和真实 Electron 边界测试。Linux 缺少 DISPLAY/WAYLAND_DISPLAY 时，真实 Electron 测试明确跳过；不能添加 `--no-sandbox` 或安全绕过参数。第二条命令需要桌面，打开可手动操作的独立窗口。两种入口均在 app ready 前设置独立临时 userData，不使用已有用户 profile。手动入口在退出及启动失败时尽力清理自己创建的临时目录；自动测试管理自己显式传入的 profile。

合成入口在内存编译已有 menu/text-field 共享 SCSS，不生成生产构建文件。生产 webpack.map 输出 `stage/build/map/unplaced-controls.css`，主进程只从本地读取该文件；运行已打包应用不依赖 Sass。其余资源随 `electron/mapUnplaced/` 打包。正式接线生效需要开发者更新前端及地图共享样式构建产物，并完整重启 Electron；本改动不要求重新编译内核。

手动入口启动时输出 `Map overlay prototype starting...`，窗口页面加载完成后输出 `Map overlay prototype window ready.`，失败时输出固定提示。`harness.cjs` 是专用启动入口，`harnessSupport.cjs` 可导入且没有启动副作用。启动回归使用 Electron 相同的动态 `import()` 语义；Node 模式会明确提示检查 `ELECTRON_RUN_AS_NODE`，不会自动改写该环境变量。

## 生产安全边界

- `mapHostManager` 的真实 `getHost` 同时验证 owner WebContents、捕获的主 frame、注册窗口、地图 instanceID、初始化状态和内核 origin。只有已 ready 且可见的存活地图允许打开；后续菜单动作继续验证同一 host，owner/frame 导航和地图销毁关闭菜单
- 每个窗口至多一个菜单。新增地图后只把本窗口已有菜单提升到最上层，不重排地图。所有现有和后续地图的原生 mouseDown 都关闭本窗口菜单，不阻止事件或抢回焦点；窗口 blur 关闭菜单但保持地图绘制
- 每次打开建立新的随机内存 session，不复用 owner 或 OFM session。只允许固定 HTTPS origin 上四个精确本地资源的 GET/HEAD；禁止其他网络、file、导航、子 frame、worker、WebSocket、下载、认证、设备和权限。主文档只允许一次
- 菜单启用 sandbox、contextIsolation、webSecurity，禁用 Node、webview、不安全内容和开发者工具。CSP 不含 unsafe-inline/unsafe-eval，不允许图片、字体、媒体、表单或任意连接；退出后保留拒绝路由并清理 session
- owner 只发送 `{id,title}` 文本条目、计数、页码、加载状态、固定语言标签与主题配置。最多保留当前页 50 条，翻页替换；上一页、下一页和原页重试可访问全部结果，没有 500 条或 20 页截断。标题仅通过 textContent 显示，不接受 HTML、URL 或任意 CSS
- 每个状态必须同时匹配主进程签发的 requestID、query、page 和单调递增 revision。编辑及中文组合开始立刻撤销旧选择集合。选择必须是最新页成员；主进程仅发送一次终止 select 消息，owner 校验 session 和权限、取回私有行对象后才清理状态
- 主题经独立受限 IPC 更新，仅更改浅色/深色和 12–32 整数字号，不推进数据 revision、不恢复选择成员。编辑和主题并行时不会使有效用户动作过期；静态 CSS 枚举不允许任意样式
- 查询、AbortController、最终权限复核和真实行对象保留在可信 owner。OFM renderer 不接收标题、查询或菜单数据
- 锚点是 owner CSS viewport 内与可见滚动容器裁剪后的矩形；实际缩放和窗口 contentBounds 由主进程读取。完全裁掉时关闭，更新 bounds 去重。Esc、选择、显式关闭恢复 owner 焦点，外部点击和窗口失焦不抢焦点
- 菜单可见时地图继续绘制；主进程仅撤销旧版权点击手势，并暂时不给该窗口地图报告完整可见 viewport，避免菜单遮挡仍累计版权展示时间。关闭后恢复 viewport，不隐藏地图或重置相机

## 证据范围与实际验收

Node 回归覆盖真实生产 manager 的 owner/frame/instance 绑定、跨页成员校验、超过 500 条和 20 页的遍历、请求乱序、权限撤销、清理、同窗口菜单排序、新地图外部点击、版权可见计时和地图可见性保持。preload/menu 脚本也在受控 IPC/DOM 下验证。合成 DOM 不能证明浏览器布局、真实中文输入法、CSP 执行或原生合成无闪烁。

真实 Electron 测试使用同一生产菜单实现，验证文本渲染、无 Node/网络权限、主题、分页、Esc、焦点、外部点击、缩放和清理。没有显示环境时必须报告跳过。生产环境仍需人工检查：

1. 实际 OFM 上开关、搜索、分页、窗口切换、滚动和缩放，确认地图无闪烁、相机不跳动、菜单不被新地图盖住
2. 真实中文输入法组合、组合期间 Esc、键盘方向键、长标题、较大字号、不同窗口尺寸和跨平台焦点
3. 实际查询分页、只读权限、锁定加密笔记本、位置字段或视图切换、请求中关闭、快速连续开关及迟到回复
4. 多张地图同时存在、新建地图、关闭所属地图和窗口导航，确认没有残留原生视图、点击层或私有条目

浏览器和移动端继续使用现有 DOM Menu；本入口及 Electron 接线不替换这些平台的行为。
