# macOS Markdown Quick Look

扩展独立于 Electron 主界面和内核，安装包在 `Contents/PlugIns/SiYuanQuickLook.appex` 内携带 Swift 可执行文件及离线资源。`app/scripts/quicklook.js` 复用 Markdown 资源清单、已安装的 Lute 和共享正文样式，分别编译 macOS 12.0 的 x86_64、arm64 后合并。现有 Pandoc 解压步骤先执行。Markdown 导入类型使用 `net.daringfireball.markdown`，保留默认应用的选择权。

正文仅使用系统传入文件的访问授权。原生读取限制为 256 KiB，支持 UTF-8、UTF-8 BOM 和带 BOM 的 UTF-16；页面最多 20000 个元素、512 个代码块、256 个公式，整体超时 15 秒。高亮单块上限 32768 字符，公式上限 8192 字符；超限项保留源码或给出提示。图片最多 256 个，单张 8 MiB、总计 32 MiB、单张最多 4000 万像素。图片按路径分量以 `openat` 和 `O_NOFOLLOW` 打开，只允许文档目录内的相对栅格图片，不枚举目录或请求额外授权。实际无权限时显示占位，不能将有权读取文档等同于有权读取图片。

页面净化 Markdown 输出，禁用交互控件、外链和远程资源。自定义资源通道按安装清单及当前请求的图片令牌提供内容，不提供任意文件读取。每个预览有独立标识；页面就绪、正文提交、图片返回、渲染完成分别处理。完成回调只结算一次；取消、超时和关闭会使旧请求及资源回调失效。

签名钩子先以主应用所选身份及扩展专有的只读沙箱权限签名扩展，再调用 electron-builder 26 使用的 `@electron/osx-sign` 签名主应用。扩展不会继承 Electron helper 权限；最后检查整包嵌套签名。公证仍由原有 electron-builder 配置及发布凭据处理。参考 [Apple Quick Look 协议](https://developer.apple.com/documentation/quicklook/qlpreviewingcontroller) 和 [扩展权限说明](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionCreation.html)。

## 检查

在 `app/` 执行 `pnpm run test:focused scripts/quicklook.test.js tests/quickLookPreview.test.js`，验证离线资源、打包/签名调用以及 Chromium 下的只读渲染、安全净化和取消行为。这些测试不能验证 WKWebView 或 Finder。

在 macOS 执行 `pnpm run test:quicklook:macos`，编译临时测试程序，检查原生文件、编码、边界、符号链接和取消路径；不编译或替换产品内核。正常 Darwin 打包会编译并嵌入扩展。应检查两个架构安装包中的 `lipo -archs`、`codesign --verify --deep --strict`、`codesign -d --entitlements :-` 及发布渠道所需的公证结果。

必须再使用签名后的安装包，在 Intel 和 Apple Silicon、最低及当前支持的 macOS 上完成 Finder 实测：全新安装且从未启动、离线、主应用关闭/运行、深浅色和缩放、中文表格代码公式、权限不足/缺失图片、大小与编码错误、快速切换及取消、安装升级卸载，以及与其他 Markdown 预览扩展并存。当前 Windows 开发环境未执行 Swift/macOS SDK 编译、签名、公证和这些实机验收；#21139 保持打开，等待验收。
