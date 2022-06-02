[English](CONTRIBUTING.md)

## 获取源码

* `git clone --recurse-submodules git@github.com:siyuan-note/siyuan.git` 例如保存在 `D:/siyuan/`
* 切换到 dev 分支

## NPM 依赖

安装 pnpm：`npm install -g pnpm`

<details>
<summary>适用于中国大陆</summary>
设置 Electron 镜像环境变量：

* macOS/Linux：ELECTRON_MIRROR="https://cnpmjs.org/mirrors/electron/" pnpm install electron@14.2.5 -D
* Windows: `SET ELECTRON_MIRROR=https://cnpmjs.org/mirrors/electron/`

NPM 镜像：

* 使用镜像仓库 `pnpm --registry https://r.cnpmjs.org/ i`
* 恢复使用官方仓库 `pnpm --registry https://registry.npmjs.org i`
</details>

桌面端进入 app 文件夹编译和运行：

* `pnpm run dev`
* `pnpm run start`

## 内核

### 桌面端

* `cd kernel`
* `go build --tags "fts5" -o "../app/kernel/SiYuan-Kernel.exe"`
* `cd ../app/kernel`
* `./SiYuan-Kernel.exe --wd=.. --mode=dev`

### iOS

* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o ./ios/iosk.xcframework -target=ios ./kernel/mobile/`
* https://github.com/siyuan-note/siyuan-ios

### Android

* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o kernel.aar -target='android/arm,android/arm64' ./kernel/mobile/`
* https://github.com/siyuan-note/siyuan-android

移动端请参考对应项目仓库。
