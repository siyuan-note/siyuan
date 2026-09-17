# 发布构建与安装包校验

> **使用范围：`scripts/build-release.py` 是思源官方打包脚本，仅供官方发布环境使用，其他环境请勿使用。脚本依赖官方构建机器的目录结构、工具链、WSL 配置和签名环境，不是通用打包工具。**

需要 Python 3.11 或更新版本。安装包检查不需要更改打包流程，也不需要从其他机器带回基准文件。EXE、DMG、AppImage、DEB、RPM 等格式还需要 7-Zip，可用 `--sevenzip` 指定路径。

## 常用命令

以下命令均在官方 Windows 构建机器的仓库根目录 `D:\88250\siyuan` 执行。执行前完成各仓库版本号、更新日志等发布准备，停止前端开发构建，并将 WSL 仓库同步到与 Windows 相同的提交和构建输入。Windows 签名需插好 YubiKey，按系统提示输入 PIN。

先查看打包计划，不会实际构建：

```powershell
python -X utf8 scripts/build-release.py
```

全部平台打包，包括 Windows、WSL Linux、Android 和鸿蒙：

```powershell
python -X utf8 scripts/build-release.py --execute
```

首次使用建议分平台执行，按需要选择下面的命令：

```powershell
python -X utf8 scripts/build-release.py --platforms windows --execute
python -X utf8 scripts/build-release.py --platforms linux --execute
python -X utf8 scripts/build-release.py --platforms android --execute
python -X utf8 scripts/build-release.py --platforms harmony --execute
```

Windows 额外生成 Appx 包：

```powershell
python -X utf8 scripts/build-release.py --platforms windows --appx --execute
```

产物验证通过后收集到桌面 `siyuan` 文件夹，同时生成 `SHA256SUMS.txt`。Android 官方版命名为 `siyuan-版本号.apk`，例如 `siyuan-3.8.4.apk`。已有同名安装包不会覆盖。

单独验证桌面 `siyuan` 文件夹中的安装包，将 `3.8.4` 替换为本次发布版本：

```powershell
python -X utf8 scripts/verify-release.py check --version 3.8.4
```

WSL 默认用户为 `d`，仓库路径为 `/home/d/88250/siyuan`。完整构建流程尚未实际运行，首次使用请分平台确认工具链与签名环境；具体参数和检查范围见下文。

## 直接检查安装包

把安装包放入桌面 `siyuan` 文件夹，在仓库根目录执行：

```text
python -X utf8 scripts/verify-release.py check
```

默认从包名推断发布版本。版本混杂、包名不含版本，或希望明确检查目标时指定版本：

```text
python -X utf8 scripts/verify-release.py check --version 3.8.4
python -X utf8 scripts/verify-release.py check D:/releases/siyuan --version 3.8.4 --report D:/releases/verification.json
```

报告路径必须是尚不存在的 `.json` 文件。退出码 `0` 表示所有包通过当前检查，`1` 表示失败或无法验证。检查不会运行安装器、内核或包内 JavaScript，不修改安装包；每个包使用独立临时目录，检查后清理。

### 检查内容

- 从 PE、ELF 或 Mach-O 内核中的完整 `SiYuan v… (pdfcpu ` 标识读取版本，该标识由 `kernel/model/export.go` 的 `util.Ver` 编译生成；同时交叉检查可识别的桌面 CLI 完整版本标识，不把任意版本子串当成通过依据
- 检查内核版本与发布版本一致，并识别可判定的内核架构和格式错误
- 从 HTML 实际引用的 JavaScript 读取 `Constants.SIYUAN_VERSION`，检查前端与内核一致，不使用未被入口引用的新文件掩盖旧入口
- 检查 HTML、CSS 的可解析本地资源引用，以及当前 webpack 的数字分块哈希映射，发现缺失脚本、样式、字体或动态分块
- 检查导出前端版本、语言 JSON、用户指南和正式版当前更新日志；桌面包额外检查 `resources/app/package.json` 版本
- 展开 NSIS 内层压缩包、移动端 `app.zip`、AAB、HAP、APP 和 Linux 安装包载荷
- macOS 不依赖本机存在对应构建产物；7-Zip 无法完整提取时明确失败
- IPA 尝试从主程序识别静态链接内核；加密、缺少标识或无法唯一确定版本时明确失败

已用真实 Windows、Android 和鸿蒙包验证解包及版本检查。Linux、macOS 和 iOS 尚未完成真实安装包验证。

### 检查边界

仅凭安装包不能证明“同一版本号多次构建中，这是最后一次构建”，也不能证明所有资源与当前源代码逐字节一致。脚本能发现旧版本内核、旧版本前端和可解析引用缺失。没有统一发布标识的图标、第三方库版本，以及任意运行时拼接的 URL，不能全部自动判定。

未知文件或目录、空目录、解包失败和无法识别版本均不算通过。`checksum.exe`、`SHA256SUMS.txt`、`.blockmap`、YAML 更新元数据及可选基准 JSON 不作为安装包处理。独立检查脚本目前不验证校验和清单、签名、证书或原生外壳功能，也不推断此次应发布哪些平台。

## 自动构建

在 Windows 上先查看四个平台的计划，再执行：

```text
python -X utf8 scripts/build-release.py
python -X utf8 scripts/build-release.py --execute
```

可分批选择平台，Windows Store 包通过 `--appx` 额外启用：

```text
python -X utf8 scripts/build-release.py --platforms windows --appx --execute
python -X utf8 scripts/build-release.py --platforms linux,android,harmony --execute
```

不传 `--execute` 只显示计划，不构建、不修改文件。完整流水线尚未实际运行，回归测试使用模拟构建产物；首次使用应按平台分批执行，确认本机工具链和签名环境。

### 执行前准备

- 按原流程完成版本号、更新日志和数据库版本准备；脚本检查内核 `Ver`、`Mode`、Android、鸿蒙版本，以及启用 Appx 时的清单版本，不自动修改版本号或 `versionCode`
- 停止前端开发构建再执行正式构建，脚本会调用生产构建命令
- 准备 Go、Node、pnpm、Windows 双架构编译器、gomobile、Android SDK/NDK、DevEco Studio 和 7-Zip；Appx 还需 `electron-windows-store`
- 插好 YubiKey，保留现有 Android 与鸿蒙签名配置；脚本不读取或输出这些配置里的密码
- WSL 默认用户 `d`、仓库 `/home/d/88250/siyuan`，可通过 `--wsl-user`、`--wsl-repo`、`--wsl-distro` 调整；Windows 与 WSL 必须处于同一提交，受检查的构建输入须一致
- Android、鸿蒙仓库默认在思源仓库同级，可用 `--android-dir`、`--harmony-dir` 调整；工具路径可用 `--arm64-cc`、`--deveco`、`--sevenzip` 调整

### 流程

- 本地前端生产构建一次，Linux 前端在 WSL 中构建
- Windows 在全新目录构建两个架构内核，生成临时 Electron Builder 配置启用证书签名，不修改仓库 YAML，不复用开发内核目录；默认生成两个 NSIS 包并检查 Authenticode 签名
- Linux 调用现有 `scripts/linux-build.sh --target=all`，收集双架构 TAR、AppImage、DEB、RPM 共八个包
- Android 在本次临时目录生成新 AAR，确认内核版本和架构后复制到工程；生成并复制新 `app.zip`，再运行 `gradlew clean buildReleaseTask` 生成四个渠道包；官方版收集为 `siyuan-版本号.apk`（例如 `siyuan-3.8.4.apk`），不带 `official` 或 `release` 后缀，其他渠道保持原文件名
- 鸿蒙先构建并复制 ARM64 内核，再构建并复制 x86_64 内核，避免同名 `libkernel.so` 被覆盖后拷错；使用同一份新 `app.zip`，通过 Hvigor release 模式生成 APP 和已签名 HAP
- 每条命令失败立即停止，产物必须是本次生成，复制时再次核对摘要
- 新安装包全部验证通过后才收集到桌面 `siyuan`，不覆盖同名包；分批构建会检查目录中已有的其他包，并更新覆盖所有包的 `SHA256SUMS.txt`
- 构建目录保留在系统临时目录，控制台打印实际路径，失败后可检查并取回产物；不会自动提交、推送、打标签、上传或发布公告

### YubiKey PIN

沿用 Windows 智能卡驱动和 Electron Builder 的 SignTool 签名链路，按系统提示输入 PIN。提示次数取决于驱动、密钥策略和签名会话，不能保证只有一次。脚本不存储 PIN、不模拟输入，也不改变 PIN 或触摸策略。

默认按现有证书主题选择有效代码签名证书；多张证书时用 `--certificate-sha1` 指定 40 位公开指纹，它不是密码。SignTool 的 `/p` 是证书文件密码选项，不能当成通用 YubiKey PIN 参数。参见 [Yubico 驱动说明](https://www.yubico.com/support/download/smart-card-drivers-tools/) 和 [SignTool 文档](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)。

## 可选的完整摘要基准

通常无需使用。如果将来要比较同版本号的字节差异，可以从可信构建产物生成基准，使用 `check --baseline` 显式启用。不能从待验包反向生成基准。

```text
python -X utf8 scripts/verify-release.py baseline --version 3.8.4 --target android-arm64 --kernel kernel/kernel.aar --resources app --output android-arm64.release-baseline.json
python -X utf8 scripts/verify-release.py check --version 3.8.4 --baseline android-arm64.release-baseline.json
```

资源目录必须对应实际打包的集合。桌面包筛选外观文件并裁剪更新日志，不能直接比较未筛选的 `app/`；macOS 签名也可能改变内核摘要。

## 回归测试

```text
python -X utf8 -m unittest discover -s scripts -p "test_*release.py"
```
