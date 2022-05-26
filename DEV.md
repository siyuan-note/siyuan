[中文](https://github.com/siyuan-note/siyuan/blob/master/DEV_zh_CN.md)

## Get the source code

* `git clone --recurse-submodules git@github.com:siyuan-note/siyuan.git` For example saved in `D:/siyuan/`
* switch to dev branch

## NPM dependencies

In China, it may be necessary to set the Electron mirror environment variable:

* macOS/Linux: ELECTRON_MIRROR="https://cnpmjs.org/mirrors/electron/" npm install electron@14.2.5 -D
* Windows: `SET ELECTRON_MIRROR=https://cnpmjs.org/mirrors/electron/`

NPM mirror:

* May need to use mirror repository in China `npm --registry https://r.cnpmjs.org/ i -D --sass_binary_site=https://cnpmjs.org/mirrors/node-sass/`
* Revert to using official repository `npm --registry https://registry.npmjs.org i -D`

## Kernel

### Desktop

* `cd kernel`
* `go build --tags "fts5" -o "../app/kernel/SiYuan-Kernel.exe"`
* `SiYuan-Kernel.exe --wd=D:/siyuan/app`

### iOS

* `cd kernel`
* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o ./ios/iosk.xcframework -target=ios ./mobile/`
* https://github.com/siyuan-note/siyuan-ios

### Android

* `cd kernel`
* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o kernel.aar -target='android/arm,android/arm64' ./mobile/`
* https://github.com/siyuan-note/siyuan-android

## User Interface

On the desktop, go to the app folder to compile and run:

* `npm run dev`
* `npm run start`

For the mobile-end, please refer to the corresponding project repository.