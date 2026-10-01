**English**
| [中文](CONTRIBUTING.zh-CN.md)

## Get the source code

* `git clone git@github.com:siyuan-note/siyuan.git`
* Switch to dev branch `git checkout dev`

## NPM dependencies

Electron 44 requires macOS 13 or later and supports only 64-bit Windows and Linux builds.

Install Node.js 24 to match CI, then install pnpm using npm: `npm install -g pnpm@12.5.1`.

Use the version specified by the `packageManager` field in [`app/package.json`](../app/package.json); update the version in the command above if that field changes. This uses the same installation method as [CI](workflows/cd.yml).

Do not mix this method with pnpm's standalone installation scripts (`@pnpm/exe`). Different pnpm distributions can change the `packageManagerDependencies` metadata in `app/pnpm-lock.yaml`, causing unrelated lockfile changes. If you previously installed standalone pnpm, remove it from `PATH` or uninstall it so that the npm-installed pnpm takes precedence. Before installing dependencies, check `pnpm --version` against `packageManager` and locate the executable with `where.exe pnpm` on Windows or `command -v pnpm` on macOS/Linux. Review lockfile changes before committing and exclude metadata-only changes caused by switching installation methods.

<details>
<summary>For China mainland</summary>

Set the Electron mirror environment variable and install Electron:

* macOS/Linux: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@44.5.1 -D`
* Windows:
  * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  * `pnpm install electron@44.5.1 -D`

NPM mirror:

* Use npmmirror China mirror repository `pnpm --registry https://registry.npmmirror.com/ i`
* Revert to using official repository `pnpm --registry https://registry.npmjs.org i`
</details>

Enter the app folder and execute:

* `pnpm install electron@44.5.1 -D`
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

The optional global `--home-dir <path>` flag sets the base directory for user configuration. Files such as the workspace registry and cookie key remain under `<path>/.config/siyuan/`. Relative paths are resolved against the current process directory, and missing configuration directories are created. Invalid or unwritable paths fail without falling back to the system user home. Omitting the flag preserves the existing behavior. The flag also applies to offline CLI commands such as `workspace list`.

Use `--workspace` for notebook data and `--wd` for application resources independently. For example, after creating an empty `/work/siyuan-workspace` directory: `./SiYuan-Kernel serve --mode=dev --home-dir=/work/siyuan-home --workspace=/work/siyuan-workspace --wd=/work/siyuan/app`. When starting the server without an explicit workspace or a registered workspace in the selected profile, the default workspace remains under the selected home directory using the platform's existing layout (`SiYuan` on Windows/Linux, `Library/Application Support/SiYuan` on macOS). When `--home-dir` is set on Windows, `USERPROFILE` does not override it. These options do not change the mobile app's sandbox paths.

### Desktop OCR packaging prerequisites

Desktop packaging runs `scripts/prepare-ocr.py` to prepare the pinned models and native runtime. Run `python scripts/prepare-ocr.py --runtime windows-amd64 --check-only` or `python3 scripts/prepare-ocr.py --runtime linux-arm64 --build-worker --check-only` to check native prerequisites without downloading assets or compiling anything.

* Windows: the release builder must have redistribution rights under its Visual Studio license and the matching x64/ARM64 **release** CRT files from `VC/Redist/MSVC`. The script discovers installed Visual Studio through `vswhere` or `VCToolsRedistDir`. Set `SIYUAN_OCR_VC_REDIST_DIR` to `VC/Redist/MSVC/<version>` (containing `x64` and/or `arm64`) or the target's `Microsoft.VC*.CRT` directory for a custom location or cross-host packaging. Use official Visual Studio redist files, not DLLs copied from `System32`, debug runtimes, or third-party DLL download sites. The preparation step checks architecture and required exports, bundles the transitive CRT dependencies beside ONNX Runtime, and records their SHA-256 digests and licensing notice. Keep this app-local runtime updated when preparing releases. See Microsoft's [redistribution terms](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution#visual-c-runtime-files). It does not install system-wide runtimes or require elevation on end-user machines
* Linux: the OCR worker needs a **glibc** compiler even when the kernel uses a musl toolchain. Install native `gcc` and the appropriate cross compiler before running `scripts/linux-build.sh`. On Debian/Ubuntu, AMD64-to-ARM64 builds need `gcc-aarch64-linux-gnu`; ARM64-to-AMD64 builds need `gcc-x86-64-linux-gnu`. Both can be installed with `sudo apt-get install gcc gcc-aarch64-linux-gnu gcc-x86-64-linux-gnu`. Optional `SIYUAN_OCR_CC_AMD64` and `SIYUAN_OCR_CC_ARM64` overrides select target-specific compiler commands; the script verifies their target triples and does not reuse the kernel's musl `CC`

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
