# 未定位菜单可信 overlay 独立原型

本目录没有生产入口。它不修改现有 `unplaced.ts`、`desktopTransport.ts`、`unplacedMenu.ts` 或 `mapHostManager.js`，不替换当前裁剪方案。生产环境「点击菜单仍闪烁」尚未解决。原型中所有记录是合成数据，底图是独立 WebContentsView 占位页；它没有连接真实笔记、内核、加密笔记本或 OpenFreeMap。

## 可运行入口

在 `app/` 目录运行：

```sh
node --import tsx --test tests/mapUnplacedOverlay.test.js tests/mapUnplacedOverlayBoundary.test.js
pnpm exec electron tests/fixtures/map-unplaced-overlay/harness.cjs
```

第一条命令同时收集纯 Node 测试和真实 Electron 测试。Linux 缺少 DISPLAY/WAYLAND_DISPLAY 时，真实 Electron 测试明确跳过；不允许添加 `--no-sandbox` 或安全绕过参数来令测试通过。第二条需要可用桌面，打开可手动测试的独立原型。自动与手动入口均在 app ready 前设置独立临时 userData，不使用用户原有 profile。手动入口在退出及启动失败时尽力清理自己生成的临时目录，显式传入的测试 profile 由调用者负责清理。运行入口只在内存编译已有 menu/text-field 共享 SCSS，不生成生产构建文件。

当前环境无法运行真实 GUI。已执行的 Node 测试验证严格 schema、资源路由、owner/frame/session/revision/requestID、选择成员集合、权限撤销、导航和销毁、失败清理、几何去重，以及实际 preload/menu 脚本在模拟 IPC/DOM 下的行为。模拟 DOM 使用项目现有 parse5 fixture，不证明浏览器排版、真实键盘输入、中文输入法候选窗、CSP 的浏览器执行、原生层合成或真实 OFM 覆盖正确。真实 Electron 入口已经编写，但只有它实际通过后才可报告相应浏览器证据。

## 最小安全边界

- owner 是构造 manager 时固定登记的 WebContents、当前主 frame 和精确文档 URL。程序导航、销毁、窗口隐藏或失焦都会销毁旧 overlay；owner WebContents 失焦进入同一窗口 overlay 不会误关
- 每次打开使用新随机内存 session，不复用 owner 或 OFM 会话。只有固定 synthetic HTTPS origin 上精确四个本地资源可通过 GET/HEAD 加载，额外 query、编码路径、凭证和其他地址全部拒绝。初始主文档只允许一次，子 frame、worker、WebSocket、下载和导航全部拒绝
- overlay 禁用 Node、webview 和不安全内容，启用 contextIsolation、sandbox、webSecurity。CSP 不含 unsafe-inline/unsafe-eval，禁止网络、图片、字体、媒体、表单等能力；权限、设备、认证和新窗口拒绝。销毁后保留拒绝路由并清理 session
- 可信 owner 只发送受限文本条目、计数、页码、加载状态、语言标签和主题枚举。所有标签用 textContent 渲染，不接受 HTML、URL、任意 CSS 或脚本。主题只支持静态浅色/深色与六档字体，使用本地 CSS 属性选择器，不动态注入样式
- overlay 的桥只暴露 subscribe/editing/search/more/select/close。主进程校验发送者、主 frame、session、revision 和当前选择集合；编辑/组合开始立即撤销旧选择。主进程为请求签发递增 requestID，旧 A→B→A 回复即使 query 相同也不能复活旧成员
- owner 保留查询取消和最终权限校验责任。这里的 owner 只用内存合成数据模拟，不从原型自行 fetch 内核。真实记录与权限/加密租约逻辑必须留在既有可信 owner
- overlay 使用固定容量视口，owner 传 CSS 锚点与滚动容器/窗口的可见交集，完全裁掉时关闭且不恢复焦点；缩放从真实 owner WebContents 读取，按当前窗口 contentBounds 重验。滚动/缩放只更新且去重 bounds，不因菜单 DOM mutation 使用 hide/show 稳定延迟。未改变任何生产 observer/stabilize 行为
- owner 的可信 DOM pointerdown 处理外部点击并排除 toggle；独立地图占位视图通过主进程 before-mouse-event 处理外部点击。Esc、选择和显式关闭恢复 owner 焦点；外部点击及窗口失焦不抢焦点。关闭取消 owner 定时器并清理 view、监听器、会话及条目集合

## 实际 GUI 验收仍待完成

1. 在 Windows、macOS 和 Linux 的真实桌面启动原型，运行 Electron 测试，再人工检查原生输入法候选窗和组合中的 Esc；合成 composition 事件不算真实中文输入法验证
2. 搜索、防抖、清空搜索、重复搜索 A→B→A、分页、快速连续开关、加载中关闭、加载失败后重试、空列表、超长标签、键盘方向键和焦点恢复
3. 浅色/深色、较大字体、不同窗口大小、125%/150% 缩放、滚动、锚点离开可视区、其他原生地图视图和窗口抢焦点；验证无残留透明点击层
4. 使用真实 OFM 和生产 observer/stabilize，检查菜单打开、输入、分页、焦点变动时地图不闪烁或被压住。占位地图始终可见的测试不能替代此项
5. 真实内核查询的搜索分页契约、只读和权限撤销、锁定加密笔记本、当前视图/位置字段切换、地图销毁、窗口导航，以及在请求途中关闭后的迟到回复
6. 现有自定义主题的有限 token 映射、共享菜单快捷键与可访问性、菜单尺寸与定位策略。这些产品接线细节尚未完成，不应因原型通过而默认启用

## 将来最小接线范围

- `map/unplaced.ts`：保留现有 getAttributeViewMapUnplaced、toMapUnplacedRow、available/canEditMapSettings、AbortController 和 openMapRecord；只把渲染目标抽为 DOM Menu / desktop overlay adapter。仅向 overlay 发送所需标题与稳定选择 ID，收到选择时重新核对当前上下文、权限和条目映射。新增 requestID/session 校验不能取代最终权限检查
- 独立可信菜单 manager、preload 和打包本地资源：登记真实 owner，复用现有 owner 信任判定，不给 OFM renderer 新通道、私有数据、菜单 DOM 或任何权限。资源必须纳入明确打包清单
- `map/desktopTransport.ts` / `map/unplacedMenu.ts` 与 `electron/mapHostManager.js`：只在实际 overlay 成功就绪且安全绑定对应地图后，让该菜单退出 DOM 遮挡裁剪路径，并维护原生 sibling 层级与外部点击。不能全局忽略菜单遮挡或降低其他覆盖物的隔离
- `electron/main.js` 及构建资源清单：仅负责可信 manager 的受限接线、销毁和本地资源打包。保留当前失败处理，准备好返回现有 DOM 菜单的路径；禁止把加载失败转为宽松 CSP 或共享 session
- 浏览器/移动端继续使用现有 DOM Menu；此原型只研究 Electron 原生层级问题，未改变移动行为

只有独立实现复核与实际 GUI/生产 OFM 验收完成，才可以决定是否接入和替换裁剪。此目录自身不授权或执行该替换。
