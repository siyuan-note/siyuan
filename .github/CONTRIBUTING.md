[中文](CONTRIBUTING_zh_CN.md)

## Get the source code

* `git clone git@github.com:siyuan-note/siyuan.git`
* switch to dev branch `git checkout dev`

## User Interface

Install pnpm: `npm install -g pnpm@9.12.1`

<details>
<summary>For China mainland</summary>

Set the Electron mirror environment variable and install Electron:

* macOS/Linux: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@v32.2.7 -D`
* Windows:
    * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
    * `pnpm install electron@v32.2.7 -D`

NPM mirror:

* Use npmmirror China mirror repository `pnpm --registry https://registry.npmmirror.com/ i`
* Revert to using official repository `pnpm --registry https://registry.npmjs.org i`

</details>

On the desktop, go to the app folder to run:

* `pnpm install electron@v32.2.7 -D`
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

### Harmony

Only support compilation under Linux, need to install Harmony SDK, and need to modify Go source code, please refer to https://github.com/siyuan-note/siyuan/issues/13184

* `cd kernel/harmony`
* `./build.sh` (`./build-win.sh` for Windows Emulator)
* https://github.com/siyuan-note/siyuan-harmony
