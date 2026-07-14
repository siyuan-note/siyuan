[English](CONTRIBUTING.md)
| **中文**

## 获取源码

* `git clone git@github.com:siyuan-note/siyuan.git`
* 切换到 dev 分支 `git checkout dev`

## NPM 依赖

安装 pnpm：`npm install -g pnpm@11.12.0`

<details>
<summary>适用于中国大陆</summary>

设置 Electron 镜像环境变量并安装 Electron：

* macOS/Linux：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@42.6.1 -D`
* Windows：
  * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  * `pnpm install electron@42.6.1 -D`

NPM 镜像：

* 使用 npmmirror 中国镜像仓库 `pnpm --registry https://registry.npmmirror.com/ i`
* 恢复使用官方仓库 `pnpm --registry https://registry.npmjs.org i`
</details>

进入 app 文件夹执行：

* `pnpm install electron@42.6.1 -D`
* `pnpm run install:electron`
* `pnpm run dev`
* `pnpm run start`

注意：Electron 42 起在 `pnpm install` 时不再自动下载二进制。需先执行 `pnpm run install:electron`（中国大陆请先设置 `ELECTRON_MIRROR`）拉取二进制，再 `pnpm run start`。

注意：在开发环境下不会自动拉起内核进程，需要先手动拉起内核进程。

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

### iOS

* `cd kernel`
* `gomobile bind -tags "fts5 sqlcipher" -ldflags '-s -w' -v -o ./ios/iosk.xcframework -target=ios ./mobile/`
* https://github.com/siyuan-note/siyuan-ios

### Android

* `cd kernel`
* `set JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF-8`
* `gomobile bind -tags "fts5 sqlcipher" -ldflags "-s -w"  -v -o kernel.aar -target android/arm64 -androidapi 26 ./mobile/`
* https://github.com/siyuan-note/siyuan-android

### Harmony

仅支持在 Linux 下编译，需要安装鸿蒙 SDK，并且需要修改 Go 源码。

* `cd kernel/harmony`
* `./build.sh` （Windows 模拟器使用 `./build-win.sh`）
* https://github.com/siyuan-note/siyuan-harmony

修改 Go 源码：

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
