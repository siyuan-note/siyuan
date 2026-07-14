**English**
| [中文](CONTRIBUTING.zh-CN.md)

## Get the source code

* `git clone git@github.com:siyuan-note/siyuan.git`
* Switch to dev branch `git checkout dev`

## NPM dependencies

Install pnpm: `npm install -g pnpm@11.12.0`

<details>
<summary>For China mainland</summary>

Set the Electron mirror environment variable and install Electron:

* macOS/Linux: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@42.6.1 -D`
* Windows:
  * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  * `pnpm install electron@42.6.1 -D`

NPM mirror:

* Use npmmirror China mirror repository `pnpm --registry https://registry.npmmirror.com/ i`
* Revert to using official repository `pnpm --registry https://registry.npmjs.org i`
</details>

Enter the app folder and execute:

* `pnpm install electron@42.6.1 -D`
* `pnpm run install:electron`
* `pnpm run dev`
* `pnpm run start`

Note: Electron 42 no longer downloads its binary automatically during `pnpm install`. Run `pnpm run install:electron` (or set `ELECTRON_MIRROR` first on China mainland) to fetch the binary before `pnpm run start`.

Note: In the development environment, the kernel process will not be automatically started, and you need to manually start the kernel process first.

## Kernel

1. Install the latest version of [golang](https://go.dev/)
2. Open CGO support, that is, configure the environment variable `CGO_ENABLED=1`
3. On Windows, add the directory reported by `go env GOBIN` to `PATH`; if it is empty, add the `bin` subdirectory of `go env GOPATH`

### Desktop

* `cd kernel`
* Windows:
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

## Issue workflow

* Issues and pull requests that have been closed with no activity for 30 days are locked automatically to keep the tracker focused on open work
* If you run into a problem similar to a locked one, please open a new issue and link back to the original — avoid replying on old, closed threads, as that revives stale context and pings everyone who participated
* A new issue with a clear reproduction and a reference to the closed one is far easier to act on than a comment appended to a months-old thread
