[中文](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING_zh_CN.md)

## Get the source code

* `git clone git@github.com:siyuan-note/siyuan.git`
* Switch to dev branch `git checkout dev`

## NPM dependencies

Install pnpm: `npm install -g pnpm@10.29.2`

<details>
<summary>For China mainland</summary>

Set the Electron mirror environment variable and install Electron:

* macOS/Linux: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@39.5.1 -D`
* Windows:
  * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  * `pnpm install electron@39.5.1 -D`

NPM mirror:

* Use npmmirror China mirror repository `pnpm --registry https://registry.npmmirror.com/ i`
* Revert to using official repository `pnpm --registry https://registry.npmjs.org i`
</details>

Enter the app folder and execute:

* `pnpm install electron@39.5.1 -D`
* `pnpm run dev`
* `pnpm run start`

Note: In the development environment, the kernel process will not be automatically started, and you need to manually start the kernel process first.

## Kernel

1. Install the latest version of [golang](https://go.dev/)
2. Open CGO support, that is, configure the environment variable `CGO_ENABLED=1`

### Desktop

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

Only support compilation under Linux, need to install Harmony SDK, and need to modify Go source code.

* `cd kernel/harmony`
* `./build.sh` (`./build-win.sh` for Windows Emulator)
* https://github.com/siyuan-note/siyuan-harmony

Modify Go source code:

1. go/src/runtime/vim tls_arm64.s

   Change the ending `DATA runtime·tls_g+0(SB)/8, $16` to `DATA runtime·tls_g+0(SB)/8, $-144`

2. go/src/runtime/cgo/gcc_android.c

   Clear the inittls function

   ```c
   inittls(void **tlsg, void **tlsbase)
   {
     return;
   }
   ```
3. go/src/net/cgo_resold.go
   `C.size_t(len(b))` to `C.socklen_t(len(b))`

For other details, please refer to https://github.com/siyuan-note/siyuan/issues/13184
