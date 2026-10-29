[English](CONTRIBUTING.md)
| **中文**

## 获取源码

* `git clone git@github.com:siyuan-note/siyuan.git`
* 切换到 dev 分支 `git checkout dev`

## NPM 依赖

Electron 44 要求 macOS 13 或更高版本，Windows 和 Linux 仅支持 64 位构建。

安装与 CI 一致的 Node.js 24，然后通过 npm 安装 pnpm：`npm install -g pnpm@12.5.1`。

版本以 [`app/package.json`](../app/package.json) 的 `packageManager` 字段为准；该字段变更后，请相应调整上述命令中的版本号。此安装方式与 [CI](workflows/cd.yml) 保持一致。

不要与 pnpm 独立安装脚本（`@pnpm/exe`）混用。不同的 pnpm 发行包可能改变 `app/pnpm-lock.yaml` 中的 `packageManagerDependencies` 元数据，产生与依赖无关的锁文件变更。如果此前安装过独立版 pnpm，请将其移出 `PATH` 或卸载，以确保优先使用通过 npm 安装的 pnpm。安装依赖前，请用 `pnpm --version` 核对版本是否与 `packageManager` 一致，并在 Windows 上用 `where.exe pnpm`、在 macOS/Linux 上用 `command -v pnpm` 检查可执行文件的位置。提交前请检查锁文件差异，排除因切换安装方式产生的纯元数据变更。

<details>
<summary>适用于中国大陆</summary>

设置 Electron 镜像环境变量并安装 Electron：

* macOS/Linux：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@44.10.0 -D`
* Windows：
  * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  * `pnpm install electron@44.10.0 -D`

NPM 镜像：

* 使用 npmmirror 中国镜像仓库 `pnpm --registry https://registry.npmmirror.com/ i`
* 恢复使用官方仓库 `pnpm --registry https://registry.npmjs.org i`
</details>

进入 app 文件夹执行：

* `pnpm install electron@44.10.0 -D`
* `pnpm run install:electron`
* `pnpm run dev`
* `pnpm run start`

注意：Electron 42 起在 `pnpm install` 时不再自动下载二进制。需先执行 `pnpm run install:electron`（中国大陆请先设置 `ELECTRON_MIRROR`）拉取二进制，再 `pnpm run start`。

注意：在开发环境下不会自动启动内核进程，需要先手动启动。

## 内核

1. 安装最新版 [golang](https://go.dev/)
2. 打开 CGO 支持，即配置环境变量 `CGO_ENABLED=1`
3. Windows 下需将 `go env GOBIN` 输出的目录添加到 `PATH`；如果输出为空，则添加 `go env GOPATH` 目录下的 `bin` 子目录

### 桌面端

* `cd kernel`
* Windows：
  * `go install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest`
  * `goversioninfo -platform-specific=true -icon=resource/icon.ico -manifest=resource/goversioninfo.exe.manifest`
  * `go build -tags "fts5 sqlcipher" -o "../app/kernel/SiYuan-Kernel.exe"`
* Linux/macOS: `go build -tags "fts5 sqlcipher" -o "../app/kernel/SiYuan-Kernel"`
* `cd ../app/kernel`
* Windows: `./SiYuan-Kernel.exe serve --mode=dev`
* Linux/macOS: `./SiYuan-Kernel serve --mode=dev`

可选的全局参数 `--home-dir <path>` 用于指定用户配置目录的基路径。工作空间列表、Cookie 密钥等文件仍保存在 `<path>/.config/siyuan/` 中。相对路径以进程当前目录为基准解析，缺失的配置目录会自动创建；路径无效或不可写时直接报错，不会回退到系统用户主目录。未指定该参数时保持现有行为。该参数也适用于 `workspace list` 等离线 CLI 命令。

笔记数据目录由 `--workspace` 指定，应用资源目录由 `--wd` 指定，三者可以独立使用。例如，先创建空目录 `/work/siyuan-workspace`，再执行：`./SiYuan-Kernel serve --mode=dev --home-dir=/work/siyuan-home --workspace=/work/siyuan-workspace --wd=/work/siyuan/app`。启动服务时未显式指定工作空间且所选配置中没有已注册工作空间，默认工作空间沿用各平台的目录布局，位于所选主目录下：Windows/Linux 为 `SiYuan`，macOS 为 `Library/Application Support/SiYuan`。Windows 上显式指定 `--home-dir` 后，`USERPROFILE` 不再覆盖该选择。这些选项不改变移动端应用的沙箱路径。

### 桌面端 OCR 打包依赖

桌面端打包会运行 `scripts/prepare-ocr.py`，准备固定版本的模型和原生运行库。可以先执行 `python scripts/prepare-ocr.py --runtime windows-amd64 --check-only` 或 `python3 scripts/prepare-ocr.py --runtime linux-arm64 --build-worker --check-only` 检查原生依赖，不会下载资源或执行编译。

* Windows：发布构建者须具有 Visual Studio 许可证授予的再分发权，并从 `VC/Redist/MSVC` 提供对应 x64/ARM64 架构的**发布版** CRT 文件。脚本通过 `vswhere` 或 `VCToolsRedistDir` 查找已安装的 Visual Studio。自定义位置或跨主机打包时，将 `SIYUAN_OCR_VC_REDIST_DIR` 指向含 `x64`、`arm64` 子目录的 `VC/Redist/MSVC/<version>`，也可以直接指向目标架构的 `Microsoft.VC*.CRT` 目录。仅使用官方 Visual Studio 再分发文件，不要从 `System32`、调试运行库或第三方 DLL 下载站收集文件。准备步骤会检查架构和必需的导出符号，将 CRT 的传递依赖放在 ONNX Runtime 旁，并记录 SHA-256 摘要及许可说明。发布时应及时更新这些应用本地运行库，详见 Microsoft 的[再分发条款](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution#visual-c-runtime-files)。该方案不会安装系统级运行库，也不需要最终用户提权
* Linux：桌面 OCR 辅助进程的 AMD64、ARM64 构建统一以 **glibc 2.28** 为兼容目标，独立于内核的 musl 工具链。准备脚本下载 `scripts/ocr-assets.json` 中固定版本的 Zig 编译器，校验摘要并缓存在 `.cache/ocr/`，不随应用分发。请安装 `binutils`，以便使用 `readelf` 检查兼容性。可选环境变量 `SIYUAN_OCR_CC_AMD64`、`SIYUAN_OCR_CC_ARM64` 分别指定带 glibc 2.28 或更旧 sysroot 的编译器命令；脚本会拒绝较新头文件及依赖较新 glibc 符号的产物。`--check-only` 仅校验默认工具链选择，不下载工具链。Docker 继续使用独立的 Alpine/musl OCR 构建流程

### iOS

* `cd kernel`
* `gomobile bind -tags "fts5 sqlcipher" -ldflags '-s -w' -v -o ./ios/iosk.xcframework -target=ios ./mobile/`
* https://github.com/siyuan-note/siyuan-ios

### Android

* `cd kernel`
* `set JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF-8`
* `gomobile bind -tags "fts5 sqlcipher" -ldflags "-s -w"  -v -o kernel.aar -target android/arm64 -androidapi 26 ./mobile/`
* https://github.com/siyuan-note/siyuan-android

Windows 下可在思源仓库根目录执行 `node scripts/android-dev-run.mjs`，构建移动端前端、打包资源、构建 `kernel.aar` 和调试 APK，然后通过 ADB 安装并启动独立调试包，默认使用 `official` 渠道。需准备 Node.js、pnpm、Go、gomobile、JDK、Android SDK 和 NDK，以及支持 ZIP 的 bsdtar（Windows 自带的 `tar`）。在 Android 工程的 `local.properties` 中配置 `sdk.dir`，或设置 `ANDROID_HOME`；脚本会选择 SDK 目录下版本最高的 NDK。设备需开启并授权调试连接。

Android 工程默认位于思源仓库同级，可用 `--android-dir=<路径>` 或 `SIYUAN_ANDROID_DIR` 指定；使用 `--device=<序列号>` 选择 ADB 连接。`--skip-ui` 复用现有前端产物（需包含 mobile、desktop、export），`--skip-kernel` 复用并复制现有 `kernel/kernel.aar`，`--skip-gradle` 仅跳过 APK 构建，仍会执行前面的资源打包和内核处理。仅重新安装已有 APK 时同时传入这三个参数；SDK 和 NDK 仍需可用。更多参数见 `node scripts/android-dev-run.mjs --help`。

### Harmony

仅支持在 Linux 下编译，需要安装鸿蒙 SDK，并且需要修改 Go 源码。

* `cd kernel/harmony`
* `./build.sh` （Windows 模拟器使用 `./build-win.sh`）
* https://github.com/siyuan-note/siyuan-harmony

ARM64 真机可在思源仓库根目录执行 `node scripts/harmony-dev-run.mjs`，构建移动端前端、打包资源、构建内核和已签名的调试 HAP，然后通过 HDC 安装并启动独立调试包。先在 DevEco Studio 为设备配置鸿蒙工程的 `debug` 签名，并准备原生 OCR 运行库和模型（参考鸿蒙仓库 README）。Windows 通过 WSL 在当前检出目录中执行内核构建，WSL 内需具备鸿蒙 SDK、Go 和 Python 3.10+。脚本使用支持 ZIP 的 bsdtar（Windows 自带的 `tar`），不会自动卸载应用。

通过 `--deveco=<路径>`、`--harmony-dir=<路径>`、`--device=<连接标识>` 指定工具、工程和设备。`--skip-ui` 复用现有前端产物（需包含 mobile、desktop、export），`--skip-kernel` 复制现有 `kernel/harmony/libkernel.so` 和 `libkernel.h`，`--skip-hvigor` 则仅重新安装并启动已有的调试 HAP，跳过所有构建及资源复制。更多参数见 `node scripts/harmony-dev-run.mjs --help`。运行脚本测试：`node --test app/scripts/harmony-dev-run.test.js`。

Windows 下，部署脚本会在临时工作区中将当前 `go.work` 的模块路径和本地替换路径转换为 WSL 路径，保留本地依赖覆盖，不修改原始工作区文件。如果已禁用工作区模式，WSL 构建同样使用 `GOWORK=off`。

部署脚本通过 `scripts/prepare-harmony-go.py` 将实际选中的 Go 工具链复制到 Linux 用户缓存（默认 `~/.cache/siyuan-harmony/go`），在副本中应用下面三处鸿蒙适配，再通过 `GOTOOLCHAIN=local` 固定使用该副本。系统 Go 和自动下载的共享工具链均保持不变；版本或适配输入变化时创建另一份缓存，不识别的源码或损坏的缓存会报错。工具链准备测试：`python3 -m unittest scripts/test_prepare_harmony_go.py`；Linux 下还会验证构建包装脚本的工具链选择流程，测试不编译内核。

直接运行 `kernel/harmony/build.sh` 时，需自行修改实际使用的 Go 源码：

1. go/src/runtime/tls_arm64.s

   结尾 `DATA runtime·tls_g+0(SB)/8, $16` 改为 `DATA runtime·tls_g+0(SB)/8, $-144`

2. go/src/runtime/cgo/gcc_android.c

   清空 inittls 函数

   ```c
   inittls(void **tlsg, void **tlsbase)
   {
     return;
   }
   ```
3. go/src/net/cgo_resold.go
   `C.size_t(len(b))` 改为 `C.socklen_t(len(b))`

其他细节请参考 https://github.com/siyuan-note/siyuan/issues/13184

## Issue 流程

* 已关闭且连续 30 天无新动态的 issue 和 PR 会被自动锁定，以保持 issue 列表聚焦在尚未解决的问题上
* 如果你遇到的问题与某个已锁定 issue 类似，请新开一个 issue 并附上原 issue 的链接，不要在已关闭的旧 issue 下追加回复——这会让过时的上下文重新浮现，并打扰所有历史参与者
* 一个带有清晰复现步骤并引用原 issue 的新 issue，远比在几个月前的讨论下追加一条评论更容易被处理
