[English](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING.md)

## 获取源码

* `git clone git@github.com:siyuan-note/siyuan.git`
* 切换到 dev 分支 `git checkout dev`

## NPM 依赖

安装 pnpm：`npm install -g pnpm@10.28.1`

<details>
<summary>适用于中国大陆</summary>

设置 Electron 镜像环境变量并安装 Electron：

* macOS/Linux：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@39.3.0 -D`
* Windows：
  * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  * `pnpm install electron@39.3.0 -D`

NPM 镜像：

* 使用 npmmirror 中国镜像仓库 `pnpm --registry https://registry.npmmirror.com/ i`
* 恢复使用官方仓库 `pnpm --registry https://registry.npmjs.org i`
</details>

进入 app 文件夹执行：

* `pnpm install electron@39.3.0 -D`
* `pnpm run dev`
* `pnpm run start`

注意：在开发环境下不会自动拉起内核进程，需要先手动拉起内核进程。

## 内核

1. 安装最新版 [golang](https://go.dev/)
2. 打开 CGO 支持，即配置环境变量 `CGO_ENABLED=1`

### 桌面端

* `cd kernel`
* Windows: `go build --tags "fts5" -o "../app/kernel/SiYuan-Kernel.exe"`
* Linux/macOS: `go build --tags "fts5" -o "../app/kernel/SiYuan-Kernel"`
* `cd ../app/kernel`
* Windows: `./SiYuan-Kernel.exe --wd=.. --mode=dev`
* Linux/macOS: `./SiYuan-Kernel --wd=.. --mode=dev`

### iOS

* `cd kernel`
* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o ./ios/iosk.xcframework -target=ios ./mobile/`
* https://github.com/siyuan-note/siyuan-ios

### Android

* `cd kernel`
* `set JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF-8`
* `gomobile bind --tags fts5 -ldflags "-s -w"  -v -o kernel.aar -target=android/arm64 -androidapi 26 ./mobile/`
* https://github.com/siyuan-note/siyuan-android

### Harmony

仅支持在 Linux 下编译，需要安装鸿蒙 SDK，并且需要修改 Go 源码，详情请参考 https://github.com/siyuan-note/siyuan/issues/13184

* `cd kernel/harmony`
* `./build.sh` （Windows 模拟器使用 `./build-win.sh`）
* https://github.com/siyuan-note/siyuan-harmony
