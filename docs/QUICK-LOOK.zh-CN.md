# macOS Markdown Quick Look

扩展独立于 Electron 主界面和内核，安装包在 `Contents/PlugIns/SiYuanQuickLook.appex` 内携带 Swift 可执行文件及离线资源。`app/scripts/quicklook.js` 复用 Markdown 资源清单、已安装的 Lute 和共享正文样式，分别编译 macOS 12.0 的 x86_64、arm64 后合并。现有 Pandoc 解压步骤先执行。Markdown 导入类型使用 `net.daringfireball.markdown`，保留默认应用的选择权。

正文仅使用系统传入文件的访问授权。原生读取限制为 256 KiB，支持 UTF-8、UTF-8 BOM 和带 BOM 的 UTF-16；页面最多 20000 个元素、512 个代码块、256 个公式，整体超时 15 秒。高亮单块上限 32768 字符，公式上限 8192 字符；超限项保留源码或给出提示。图片最多 256 个，单张 8 MiB、总计 32 MiB、单张最多 4000 万像素。图片按路径分量以 `openat` 和 `O_NOFOLLOW` 打开，只允许文档目录内的相对栅格图片，不枚举目录或请求额外授权。实际无权限时显示占位，不能将有权读取文档等同于有权读取图片。

扩展在 JavaScriptCore 内解析 Markdown、高亮代码并生成公式，用 HTML 解析器筛选元素和属性，再由 `QLPreviewProvider` 将静态 HTML 交给系统显示。预览禁止脚本、外链导航和远程资源。获准读取的图片、内置公式字体和经校验的工作空间字体快照作为本次预览的附件，已安装字体按字体名称使用。每次请求独立结算，超时和取消后停止读取附件，丢弃迟到的结果。

签名钩子先以主应用所选身份及扩展专有的只读沙箱权限签名扩展，再调用 electron-builder 26 使用的 `@electron/osx-sign` 签名主应用。扩展不会继承 Electron helper 权限；最后检查整包嵌套签名。公证仍由原有 electron-builder 配置及发布凭据处理。参考 [Apple Quick Look 协议](https://developer.apple.com/documentation/quicklook/qlpreviewingcontroller) 和 [扩展权限说明](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionCreation.html)。

## 检查

在 `app/` 执行 `pnpm run test:focused scripts/quicklook.test.js tests/quickLookPreview.test.js`，验证离线资源、打包和签名调用、静态 HTML 净化与附件选择。

在 macOS 执行 `pnpm run test:quicklook:macos`，编译临时测试程序，检查原生文件、编码、边界、符号链接、取消路径及 JavaScriptCore 生成的 HTML 和附件。正常 Darwin 打包会编译并嵌入扩展。应检查两个架构安装包中的 `lipo -archs`、`codesign --verify --deep --strict`、`codesign -d --entitlements :-` 及发布渠道所需的公证结果。

使用签名后的安装包，在 Intel 和 Apple Silicon、最低及当前支持的 macOS 上完成 Finder 实测。覆盖全新安装且从未启动、离线、主应用关闭和运行、深浅色和缩放、中文表格代码公式、系统字体和工作空间字体、权限不足或缺失图片、大小与编码错误、快速切换及取消、安装升级卸载，以及与其他 Markdown 预览扩展并存。
