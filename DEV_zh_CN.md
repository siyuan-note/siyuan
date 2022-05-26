<p align="center">
<a href="https://github.com/siyuan-note/siyuan/blob/master/DEV_zh_CN.md">English</a>
</p>

## 获取源码

* `git clone --recurse-submodules git@github.com:siyuan-note/siyuan.git`
* 切换到 dev 分支

## NPM 依赖

在中国可能需要设置 Electron 镜像环境变量：

* macOS/Linux：ELECTRON_MIRROR="https://cnpmjs.org/mirrors/electron/" npm install electron@14.2.5 -D
* Windows: `SET ELECTRON_MIRROR=https://cnpmjs.org/mirrors/electron/`

NPM 镜像：

* 在中国可能需要使用镜像仓库 `npm --registry https://r.cnpmjs.org/ i -D --sass_binary_site=https://cnpmjs.org/mirrors/node-sass/`
* 恢复使用官方仓库 `npm --registry https://registry.npmjs.org i -D`

## 内核

### 桌面端

* `go build --tags "fts5" -o "D:\\siyuan\\app\\kernel\\SiYuan-Kernel.exe"`
* `SiYuan-Kernel.exe --wd=D:\\siyuan\\app`

### iOS

* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o ./ios/iosk.xcframework -target=ios ./kernel/mobile/`
* https://github.com/siyuan-note/siyuan-ios

### Android

* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o kernel.aar -target='android/arm,android/arm64' ./kernel/mobile/`
* https://github.com/siyuan-note/siyuan-android

## 用户界面

桌面端进入 app 文件夹编译和运行：

* `npm run dev`
* `npm run start`

移动端请参考对应项目仓库。
