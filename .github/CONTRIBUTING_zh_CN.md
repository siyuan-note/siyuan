[English](CONTRIBUTING.md)

## 获取源码

* `git clone --depth=1 git@github.com:siyuan-note/siyuan.git`
* 切换到 dev 分支 `git checkout dev`

备注：`app/stage/protyle/**` 使用 git lfs 管理，正常情况下无需关注，关联 [#9253](https://github.com/siyuan-note/siyuan/issues/9253)。

## NPM 依赖

安装 pnpm：`npm install -g pnpm`

<details>
<summary>适用于中国大陆</summary>

设置 Electron 镜像环境变量并安装 Electron：

* macOS/Linux: 
 ```
 ELECTRON_MIRROR=https://cnpmjs.org/mirrors/electron/ pnpm install electron@25.8.1 -D
 ```
* Windows:
    * `SET ELECTRON_MIRROR=https://cnpmjs.org/mirrors/electron/`
    * `pnpm install electron@25.8.1 -D`

NPM 镜像：

* 使用 npmmirror 中国镜像仓库 `pnpm --registry https://r.cnpmjs.org/ i`
* 恢复使用官方仓库 `pnpm --registry https://registry.npmjs.org i`
</details>

桌面端进入 app 文件夹运行：

* `pnpm install electron@25.8.1 -D`
* `pnpm run dev`
* `pnpm run start`

注意：在开发环境下不会自动拉起内核进程，需要先手动拉起内核进程。

## 内核

1. 安装最新版 [golang](https://go.dev/)
2. 打开 CGO 支持，即配置环境变量 `CGO_ENABLED=1`

### 桌面端

* `cd kernel`
* `go build --tags "fts5" -o "../app/kernel/SiYuan-Kernel.exe"`
* `cd ../app/kernel`
* `./SiYuan-Kernel.exe --wd=.. --mode=dev`

### iOS

* `cd kernel`
* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o ./ios/iosk.xcframework -target=ios ./mobile/`
* https://github.com/siyuan-note/siyuan-ios

### Android

* `cd kernel`
* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o kernel.aar -target='android/arm64' -androidapi 24 ./mobile/`
* https://github.com/siyuan-note/siyuan-android

移动端请参考对应项目仓库。
