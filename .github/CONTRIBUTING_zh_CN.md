[English](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING.md)

## 获取源码

* `git clone git@github.com:siyuan-note/siyuan.git`
* 切换到 dev 分支 `git checkout dev`

## NPM 依赖

安装 pnpm：`npm install -g pnpm@10.29.2`

<details>
<summary>适用于中国大陆</summary>

设置 Electron 镜像环境变量并安装 Electron：

* macOS/Linux：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@39.5.1 -D`
* Windows：
  * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  * `pnpm install electron@39.5.1 -D`

NPM 镜像：

* 使用 npmmirror 中国镜像仓库 `pnpm --registry https://registry.npmmirror.com/ i`
* 恢复使用官方仓库 `pnpm --registry https://registry.npmjs.org i`
</details>

进入 app 文件夹执行：

* `pnpm install electron@39.5.1 -D`
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
