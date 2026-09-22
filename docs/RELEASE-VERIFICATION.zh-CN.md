# 发布流程、构建与安装包校验

<!-- release-version: 3.8.5 -->

> **使用范围：`scripts/build-release.py` 是思源官方打包脚本，仅供官方发布环境使用，其他环境请勿使用。脚本依赖官方构建机器的目录结构、工具链、WSL 配置和签名环境，不是通用打包工具。**

需要 Python 3.11 或更新版本。安装包检查不需要更改打包流程，也不需要从其他机器带回基准文件。EXE、DMG、AppImage、DEB、RPM 等格式还需要 7-Zip，可用 `--sevenzip` 指定路径。

## 发布分工

- 正式版按下文完成本地构建、产物汇总、检查和手动发布
- alpha、beta、rc 由 GitHub Actions 自动发布：准备并同步主仓库和 Android 仓库的版本后，推送对应预发布标签，不同时手动上传同名发布产物

## 开发版发布步骤

alpha、beta、rc 使用语义化预发布版本号，例如 `3.8.5-alpha.1`、`3.8.5-beta.1`、`3.8.5-rc.1`。以下以 `3.8.5-beta.1` 为例，执行时替换为本次版本。自动发布由 [CD 工作流](../.github/workflows/cd.yml) 执行，无需运行本地四平台构建脚本。

### 1. 准备版本并同步代码

- 将 `kernel/util/working.go` 的 `Mode` 设置为 `prod`，将 `Ver` 和 `app/package.json` 的版本更新为同一个预发布版本号
- 更新 Android 仓库 `build.gradle` 的 `siyuanVersionName` 和 `siyuanVersionCode`，其中版本名称须与主仓库一致
- 先将 Android 发布准备提交同步到远端 `main`；工作流从该分支检查版本，并锁定本次构建使用的 Android 提交，不按主仓库标签检出 Android 仓库
- 提交并推送主仓库待发布代码，确认当前检出的是本次发布提交
- 确认仓库 Actions 所需的 Android 签名配置和凭据可用，凭据仅通过仓库 Secrets 管理，不写入文档或源代码

### 2. 打标签并触发构建

在主仓库根目录执行，仅推送本次标签：

```powershell
git tag v3.8.5-beta.1
git push origin v3.8.5-beta.1
```

推送包含 `-alpha`、`-beta` 或 `-rc` 的标签会触发 `CD For SiYuan`。标签去掉开头的 `v` 后必须与 `app/package.json` 版本完全一致，Android 版本也必须匹配，否则准备阶段会失败。

### 3. 等待自动构建与发布

在 GitHub Actions 中查看本次标签对应的 `CD For SiYuan` 运行记录。工作流生成发布说明、运行检查并构建以下八个安装包：

| 平台 | 自动发布产物 |
| --- | --- |
| Windows | AMD64 NSIS 安装包 |
| Linux | AMD64 AppImage、tar.gz、deb、rpm，共四个包 |
| macOS | Intel、Apple Silicon 两个 DMG |
| Android | 官方版 ARM64 APK |

开发版当前不自动发布 Windows ARM64、Linux ARM64、Appx、鸿蒙、iOS 或其他 Android 渠道包，不使用正式版的全平台齐全清单。

工作流会自动生成并校验 `SHA256SUMS.txt`，创建预发布草稿，上传安装包与摘要文件，再核对远端资产摘要，全部匹配后自动公开为预发布版本。这里的摘要由 GitHub Actions 生成；正式版本地构建脚本仍不生成摘要，由发布者最后手动执行自己的工具。

### 4. 检查结果与处理失败

- 确认本次工作流完成，检查测试日志；部分测试允许失败后继续，发布成功不代表所有测试都通过
- 确认对应标签的 GitHub Release 已公开且标记为预发布，版本正确，八个安装包及 `SHA256SUMS.txt` 均已上传
- 若构建或上传失败，先检查失败步骤和已有 Release 状态；修复环境问题后可重跑失败任务，涉及源代码或版本调整时使用新的预发布版本和标签
- 工作流上传时会覆盖同名资产，不同时手动上传，也不提前公开草稿；已有 Release 被公开时，草稿检查会阻止后续自动上传

## 正式版发布步骤

除明确注明的步骤外，以下命令均在官方 Windows 构建机器的仓库根目录 `D:\88250\siyuan` 执行。

### 1. 完成发布准备

- 生成 changelogs

在主仓库根目录指定本次正式版版本，先查看准备计划：

```powershell
python -X utf8 scripts/prepare-release.py 3.8.5
```

脚本更新本文版本示例（包括上传命令）、内核 `Mode=prod` 和 `Ver`、`app/package.json`、两个 Appx 清单、Android 和鸿蒙版本。文档顶部的 `release-version` 标记用于识别待替换版本，请保留。Android、鸿蒙版本名称变化时版本代码各加一；同版本重复执行不再递增，可用 `--android-code`、`--harmony-code` 显式指定版本代码。必须传入目标正式版版本号，脚本不自动查询最新版本。

仅修改文件，留待人工检查和提交：

```powershell
python -X utf8 scripts/prepare-release.py 3.8.5 --execute
```

确认三个仓库已跟踪的改动均需发布后，查看提交推送计划，再执行：

```powershell
python -X utf8 scripts/prepare-release.py 3.8.5 --publish
python -X utf8 scripts/prepare-release.py 3.8.5 --publish --execute
```

`--publish` 准备版本后提交主仓库、Android、鸿蒙仓库的全部已跟踪改动，推送各自当前分支到 `origin`，最后创建并推送 Android 标签 `v3.8.5`，不会自动切换分支。未跟踪文件须先人工确认并纳入版本管理；远端分支必须是本地 HEAD 的祖先，否则先同步仓库。不会强推或覆盖已有标签。跨仓库发布不是原子操作，失败后检查已完成步骤并重跑；已发布版本需要修改内容时应使用新的版本号。

如果各仓库已手动提交并推送，可仅在 Android 当前提交版本匹配且工作区干净时创建本地标签，然后自行推送：

```powershell
python -X utf8 scripts/prepare-release.py 3.8.5 --tag-android --execute
```

准备脚本默认使用主仓库同级的 `siyuan-android`、`siyuan-harmony`，可用 `--android-dir`、`--harmony-dir` 指定路径。主仓库正式版标签仍在最终发布步骤中创建，iOS 仓库仍需手动准备和同步。

### 2. 同步 WSL 仓库

在 WSL 中以用户 `d` 进入 `/home/d/88250/siyuan`，切到对应发布分支并拉取代码，确保与 Windows 是同一提交，受检查的构建输入一致。脚本不会自动拉取。

### 3. 准备构建环境

- 准备 Go、Node、pnpm、Windows 双架构编译器、gomobile、Android SDK/NDK、DevEco Studio 和 7-Zip；Appx 还需 `electron-windows-store`
- 停止正在运行的前端开发构建
- 插好 YubiKey，签名时按系统提示输入 PIN
- 确认 Android、鸿蒙签名配置可用
- 桌面 `siyuan` 文件夹不要留有旧版本或同名安装包；分批构建时保留本次版本已验证的其他平台产物

### 4. 查看计划

```powershell
python -X utf8 scripts/build-release.py
```

此命令只显示计划，不构建、不修改文件，也不检查构建工具或签名环境。

### 5. 执行构建

一次性构建 Windows、WSL Linux、Android 和鸿蒙。正式版需要两个 Appx 包，保留 `--appx`：

```powershell
python -X utf8 scripts/build-release.py --appx --execute
```

各平台按 Windows、Linux、Android、鸿蒙的顺序串行构建，中途失败会停止后续步骤。

补充：需要单独构建某个平台或排查构建问题时，可选择对应命令：

```powershell
python -X utf8 scripts/build-release.py --platforms windows --appx --execute
python -X utf8 scripts/build-release.py --platforms linux --execute
python -X utf8 scripts/build-release.py --platforms android --execute
python -X utf8 scripts/build-release.py --platforms harmony --execute
```

脚本自动构建、复制移动端内核和资源，各平台产物生成后立即收集到桌面 `siyuan` 文件夹，不等待全部平台完成；所有选定平台构建结束后，在桌面目录统一校验，包含目录中已有的安装包。后续平台构建或最终校验失败时，已收集的包仍保留，但不能视为校验通过。Android 官方版命名为 `siyuan-版本号.apk`，例如 `siyuan-3.8.5.apk`。已有同名安装包不会覆盖。脚本不生成或更新 `SHA256SUMS.txt`，也不调用 `checksum.exe`。

### 6. 汇总其他平台产物

macOS、iOS 在对应构建机器上完成构建和签名。macOS 完成公证并收集双架构 DMG；iOS 同步内核、资源及 changelogs，确认版本号后完成上架构建。Windows 编排脚本不执行这两个平台的构建。

将其他机器上需要分发的安装包收集到桌面 `siyuan` 后，再进行最终检查。iOS 在对应平台完成验收后直接上传 App Store，不收集 IPA 到桌面目录，也不使用本脚本校验。

### 7. 发布前再次检查

人工确认以下安装包齐全，分平台构建时可以暂时缺包，最终发布前必须收齐：

| 平台 | 必需产物 |
| --- | --- |
| Windows | AMD64、ARM64 两个 NSIS 安装包 |
| Linux | AMD64、ARM64 各包含 AppImage、tar.gz、deb、rpm，共八个包 |
| macOS | Intel、Apple Silicon 两个 DMG |
| Microsoft Store | 两个架构的 Appx |
| Android | 官方版、国内渠道 APK，以及 Google Play、华为渠道 AAB，共四个包 |
| 鸿蒙 | 已签名 APP（`siyuan-harmony-default-signed.app`） |

核对版本、平台和架构后，在仓库根目录执行：

```powershell
python -X utf8 scripts/verify-release.py check --version 3.8.5
```

校验器已检查必需前端入口，整套前端漏打包会报错。当前架构检查并不完整，也不检查此次应发布的平台是否齐全，因此不能代替上面的人工核对；校验器不验证 `SHA256SUMS.txt`。

### 8. 手动生成校验和

全部产物收齐并校验通过后，在桌面 `siyuan` 目录中手动执行自己的 `checksum.exe`，生成 `SHA256SUMS.txt`。后续添加或替换安装包后，需重新检查并再次手动生成。上传时使用这份最终清单。

### 9. 手动发布与上架

- 合并 master，触发 Docker 镜像构建
- 打正式版标签
- 发布 GitHub Releases，并附上 `SHA256SUMS.txt`
- 同步 Gitee
- 上传 R2 和网盘
- 发布公告
- 部署 Rhy，粘贴最终的 `SHA256SUMS.txt`
- 更新并推送 Index（命令见下方），部署 Index
- 完成小米、华为、荣耀、OPPO、vivo、App Store、Microsoft Store、腾讯应用宝、Google Play、360 和腾讯电脑管家等应用市场上架

安装包已上传后，更新 `b3log-index` 中的思源官网版本、编译页面并提交推送：

```powershell
# 预览，不修改、构建或推送
python -X utf8 scripts/prepare-release.py 3.8.5 --publish-index

# 更新官网版本、构建、提交并推送
python -X utf8 scripts/prepare-release.py 3.8.5 --publish-index --execute
```

此模式仅处理 `b3log-index`，不修改主仓库、Android、鸿蒙或标签，不能与 `--publish`、`--tag-android` 组合。默认使用主仓库同级的 `b3log-index`，可通过 `--index-dir` 指定。脚本更新 `src/siyuan/src/version.pug`，在 `src/siyuan` 执行 `pnpm install --frozen-lockfile` 和 `pnpm run build`，检查中英文页面的下载版本后，提交版本文件和编译页面，推送当前分支到 `origin`。官网工程的 `package.json` 版本不是思源版本，不修改。存在其他未提交改动或远端领先时停止；构建或校验失败不提交推送，保留文件供排查。重复执行且内容不变时不会创建空提交。此命令不执行服务器部署。

上架应用市场：

- [小米](https://dev.mi.com/distribute)
- [华为](https://developer.huawei.com/consumer/cn/service/josp/agc/index.html#/myApp)
- [荣耀](https://developer.honor.com/)
- [OPPO](https://open.oppomobile.com/)
- [vivo](https://dev.vivo.com.cn/appLists)
- [iOS](https://appstoreconnect.apple.com/apps/1583226508/appstore)
- [微软](https://partner.microsoft.com/en-us/dashboard/windows/overview)
- [腾讯应用宝](https://app.open.qq.com/p/app/detail?appId=1112307632)
- [Google Play](https://play.google.com/console/developers)
- [360软件开放平台](https://open.soft.360.cn/softlist.php)
- [腾讯电脑管家软件开放平台](https://guanjia.qq.com/software-platform/softwarelibrary)

上传发布包：

```
wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5.apk -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5.apk --content-type application/vnd.android.package-archive --remote

wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-linux.AppImage -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-linux.AppImage --remote
wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-linux.tar.gz -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-linux.tar.gz --remote
wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-linux.deb -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-linux.deb --remote
wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-linux.rpm -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-linux.rpm --remote

wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-linux-arm64.AppImage -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-linux-arm64.AppImage --remote
wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-linux-arm64.tar.gz -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-linux-arm64.tar.gz --remote
wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-linux-arm64.deb -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-linux-arm64.deb --remote
wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-linux-arm64.rpm -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-linux-arm64.rpm --remote

wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-mac.dmg -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-mac.dmg --content-type application/octet-stream --remote
wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-mac-arm64.dmg -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-mac-arm64.dmg --content-type application/octet-stream --remote

wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-win.exe -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-win.exe --remote
wrangler r2 object put siyuan-releases/siyuan/siyuan-3.8.5-win-arm64.exe -f C:\Users\DL882\Desktop\siyuan\siyuan-3.8.5-win-arm64.exe --remote
echo 'complete'
```

### 10. 清理发布产物

发布完成、确认桌面 `siyuan` 中的安装包已收齐并校验通过后，停止所有构建任务，在 Windows 主仓库执行：

```powershell
# 预览清理路径
python -X utf8 scripts/clean-release.py

# 实际清理
python -X utf8 scripts/clean-release.py --execute
```

脚本清理发布脚本留下的系统临时构建目录、本地及 WSL 的 `app/build`、Linux 内核目录、鸿蒙生成的内核及头文件，以及 Android、鸿蒙工程中的构建输出和复制进去的内核、资源包。桌面 `siyuan` 始终保留；受 Git 管理的文件（包括鸿蒙公共头文件）、源码、签名配置、依赖和工具缓存、开发前端 `app/stage/build` 均保留。清理后再次打包需要重新生成内核和移动端资源包。

自定义过构建参数时，清理时传入相同的 `--android-dir`、`--harmony-dir`、`--wsl-distro`、`--wsl-user`、`--wsl-repo`；使用自定义收集目录时，必须同时传入 `--output` 保护该目录。`--skip-wsl` 可只清理 Windows 本地。脚本拒绝越界路径、与保留目录重叠的目标以及自身或上级为链接的清理入口；构建目录内部的符号链接和目录联接只删除链接本身，不清理其指向的目录。不会清理其他电脑上的 macOS 或 iOS 构建产物。

### 11. 等待 GitHub Actions 完成并部署用户指南

最后等待本次发布相关的 GitHub Actions 执行完成，确认用于用户指南部署的构建成功、版本与本次发布一致，再部署用户指南。工作流失败时先处理失败原因，成功后再部署。

## 直接检查安装包

把安装包放入桌面 `siyuan` 文件夹，在仓库根目录执行：

```text
python -X utf8 scripts/verify-release.py check
```

默认从包名推断发布版本。版本混杂、包名不含版本，或希望明确检查目标时指定版本：

```text
python -X utf8 scripts/verify-release.py check --version 3.8.5
python -X utf8 scripts/verify-release.py check D:/releases/siyuan --version 3.8.5 --report D:/releases/verification.json
```

报告路径必须是尚不存在的 `.json` 文件。退出码 `0` 表示所有包通过当前检查，`1` 表示失败或无法验证。检查不会运行安装器、内核或包内 JavaScript，不修改安装包；每个包使用独立临时目录，检查后清理。

### 检查内容

- 从 PE、ELF 或 Mach-O 内核中的完整 `SiYuan v… (pdfcpu ` 标识读取版本，该标识由 `kernel/model/export.go` 的 `util.Ver` 编译生成；同时交叉检查可识别的桌面 CLI 完整版本标识，不把任意版本子串当成通过依据
- 检查内核版本与发布版本一致，并识别可判定的内核架构和格式错误
- 检查必需前端入口：桌面包必须包含 `app/index.html`、`app/window.html`、`desktop/index.html`、`mobile/index.html` 和 `export/protyle-method.js`，移动包必须包含 `mobile/index.html` 和 `export/protyle-method.js`，以上路径均相对于 `stage/build/`；整套前端目录缺失也会失败
- 从 HTML 实际引用的 JavaScript 读取 `Constants.SIYUAN_VERSION`，检查前端与内核一致，不使用未被入口引用的新文件掩盖旧入口
- 检查 HTML、CSS 的可解析本地资源引用，以及当前 webpack 的数字分块哈希映射，发现缺失脚本、样式、字体或动态分块
- 检查导出前端版本、语言 JSON、用户指南和正式版当前更新日志；桌面包必须包含资源根目录下的 `app/package.json`，其版本必须与发布版本一致
- 展开 NSIS 内层压缩包、移动端 `app.zip`、AAB、APP 和 Linux 安装包载荷；鸿蒙仅支持 APP，解包其内部 HAP 以检查内核与资源，不支持单独校验 HAP 文件
- macOS 不依赖本机存在对应构建产物；7-Zip 无法完整提取时明确失败
- 解包时跳过符号链接，避免 Windows 提取 AppImage 等包时因创建链接权限不足而失败；普通文件解包错误仍会报错，必需入口、内核或被引用资源缺失也不会通过，链接本身不在校验范围内

当前回归测试主要使用模拟安装包，配置加载测试使用本机已安装的 Electron Builder。尚无随文档维护、可核验的真实安装包验收记录，不据此宣称任一平台的当前版本已经通过真实包验证。正式使用前应分平台验收，并保留包版本、SHA256、工具版本及检查报告；测试通过不等于实际构建、签名或安装成功。

### 检查边界

仅凭安装包不能证明“同一版本号多次构建中，这是最后一次构建”，也不能证明所有资源与当前源代码逐字节一致。脚本能发现旧版本内核、旧版本前端和可解析引用缺失。没有统一发布标识的图标、第三方库版本，以及任意运行时拼接的 URL，不能全部自动判定。

未知文件或目录、空目录、解包失败和无法识别版本均不算通过。`checksum.exe`、`SHA256SUMS.txt`、`.blockmap`、YAML 更新元数据及可选基准 JSON 不作为安装包处理。独立检查脚本目前不验证校验和清单、签名、证书或原生外壳功能，也不推断此次应发布哪些平台。

## 自动构建参数与行为

### 参数与预检

- 脚本检查内核 `Ver`、`Mode`、Android、鸿蒙版本，以及启用 Appx 时的清单版本，不自动修改版本号或 `versionCode`
- `--platforms` 接受逗号分隔的平台名称，可选 `windows`、`linux`、`android`、`harmony`；默认构建四个平台，Appx 需额外指定 `--appx`
- `--output` 可指定产物收集目录，默认桌面 `siyuan`；脚本不覆盖已有同名安装包
- 脚本保留现有 Android 与鸿蒙签名配置，不读取或输出这些配置里的密码
- WSL 默认用户 `d`、仓库 `/home/d/88250/siyuan`，可通过 `--wsl-user`、`--wsl-repo`、`--wsl-distro` 调整；Windows 与 WSL 必须处于同一提交，受检查的构建输入须一致
- Android、鸿蒙仓库默认在思源仓库同级，可用 `--android-dir`、`--harmony-dir` 调整；工具路径可用 `--arm64-cc`、`--deveco`、`--sevenzip` 调整

### 流程

- 本地前端生产构建一次，Linux 前端在 WSL 中构建
- Windows 在全新目录构建两个架构内核，生成临时 Electron Builder 配置启用证书签名，不修改仓库 YAML，不复用开发内核目录；默认生成两个 NSIS 包并检查 Authenticode 签名
- Linux 调用现有 `scripts/linux-build.sh --target=all`，收集双架构 TAR、AppImage、DEB、RPM 共八个包
- Android 在本次临时目录生成新 AAR，确认内核版本和架构后复制到工程；生成并复制新 `app.zip`，再运行 `gradlew clean buildReleaseTask` 生成四个渠道包；官方版收集为 `siyuan-版本号.apk`（例如 `siyuan-3.8.5.apk`），不带 `official` 或 `release` 后缀，其他渠道保持原文件名
- 鸿蒙先构建并复制 ARM64 内核，再构建并复制 x86_64 内核，避免同名 `libkernel.so` 被覆盖后拷错；使用同一份新 `app.zip`，通过 Hvigor release 模式执行 `assembleApp`，对应 DevEco Studio 的“构建 - 编译 Hap(s)/APP(s) - 编译 APP(s)”，只收集 `build/outputs/default/siyuan-harmony-default-signed.app`，缺少签名产物时失败，不收集 `unsigned.app` 或单独的 HAP
- 每条命令失败立即停止，产物必须是本次生成，复制时再次核对摘要
- 鸿蒙各架构内核构建后同时复制构建目录中的 `.h` 文件到对应 `entry/libs/<ABI>/`，并将 ARM64 的头文件同步到 `entry/src/main/cpp/include/`；`libkernel.h` 必须为本次生成，`lan_sync_bridge.h` 若由构建目录提供则同步，否则保留工程中维护的版本，缺少必需头文件时停止构建
- 各平台产物生成后立即复制到桌面 `siyuan`，不覆盖同名包；最后统一检查桌面目录，失败时保留已复制的包。需要重新构建同名包时，先人工移走旧包；校验失败修复后可直接对桌面目录重跑 `verify-release.py check`。保留已有的 `SHA256SUMS.txt`，校验和清单由发布者最终手动生成
- 构建目录保留在系统临时目录，控制台打印实际路径，失败后可检查并取回产物；不会自动提交、推送、打标签、上传或发布公告

### YubiKey PIN

沿用 Windows 智能卡驱动和 Electron Builder 的 SignTool 签名链路，按系统提示输入 PIN。提示次数取决于驱动、密钥策略和签名会话，不能保证只有一次。脚本不存储 PIN、不模拟输入，也不改变 PIN 或触摸策略。

默认按现有证书主题选择有效代码签名证书；多张证书时用 `--certificate-sha1` 指定 40 位公开指纹，它不是密码。SignTool 的 `/p` 是证书文件密码选项，不能当成通用 YubiKey PIN 参数。参见 [Yubico 驱动说明](https://www.yubico.com/support/download/smart-card-drivers-tools/) 和 [SignTool 文档](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)。

## 可选的完整摘要基准

通常无需使用。如果将来要比较同版本号的字节差异，可以从可信构建产物生成基准，使用 `check --baseline` 显式启用。基准比对在普通检查通过后执行，不跳过包名、内核版本和架构、前端版本、资源引用或桌面外壳元数据检查。不能从待验包反向生成基准。

以 Android 为例，先从本次构建日志取得“本次构建目录”，替换下面的 `$releaseWork`。新构建的 AAR 位于该目录的 `android/kernel.aar`，用于打包的资源归档位于 `mobile/app.zip`。不要使用主仓库的 `kernel/kernel.aar` 或未筛选的 `app/`，它们可能是旧产物或包含未打包的历史更新日志。

```powershell
$releaseWork = "C:\Users\DL882\AppData\Local\Temp\siyuan-release-3.8.5-实际目录后缀"
$resources = Join-Path $releaseWork "baseline-resources"
$baseline = Join-Path $releaseWork "android-arm64.release-baseline.json"
Expand-Archive -LiteralPath (Join-Path $releaseWork "mobile/app.zip") -DestinationPath $resources
python -X utf8 scripts/verify-release.py baseline --version 3.8.5 --target android-arm64 --kernel (Join-Path $releaseWork "android/kernel.aar") --resources $resources --output $baseline
python -X utf8 scripts/verify-release.py check ../siyuan-android/app/build-release/siyuan-3.8.5-all --version 3.8.5 --baseline $baseline
```

上述资源解压目录和基准文件应使用尚不存在的路径，Android 检查目录须与本次工程路径和版本一致。此示例只检查 Android 四渠道包；检查混合平台目录时，须重复传入 `--baseline` 提供各平台所需基准。

资源目录必须对应实际打包的集合。桌面包筛选外观文件并裁剪更新日志，不能直接比较未筛选的 `app/`；签名或原生库处理也可能改变内核摘要。出现摘要差异时应核对可信构建过程，选取对应处理阶段的可信产物，不能从待验安装包反向生成基准以消除差异。

## 回归测试

```text
python -X utf8 -m unittest discover -s scripts -p "test_*release.py"
```
