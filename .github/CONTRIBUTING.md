[中文](CONTRIBUTING_zh_CN.md)

## Get the source code

* `git clone --depth=1 git@github.com:siyuan-note/siyuan.git`
* switch to dev branch `git checkout dev`

## User Interface

Install pnpm: `npm install -g pnpm@9.1.1`

<details>
<summary>For China mainland</summary>

Set the Electron mirror environment variable and install Electron:

* macOS/Linux: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@28.3.3 -D`
* Windows:
    * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
    * `pnpm install electron@28.3.3 -D`

NPM mirror:

* Use npmmirror China mirror repository `pnpm --registry https://registry.npmmirror.com/ i`
* Revert to using official repository `pnpm --registry https://registry.npmjs.org i`

</details>

On the desktop, go to the app folder to run:

* `pnpm install electron@28.3.3 -D`
* `pnpm run dev`
* `pnpm run start`

Note: In the development environment, the kernel process will not be automatically started, and you need to manually start the kernel process first.

## Kernel

1. Install the latest version of [golang](https://go.dev/)
2. Open CGO support, that is, configure the environment variable `CGO_ENABLED=1`

### Desktop

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

For the mobile-end, please refer to the corresponding project repository.
