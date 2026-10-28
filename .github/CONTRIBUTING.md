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

* macOS/Linux: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install electron@44.10.0 -D`
* Windows:
  * `SET ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  * `pnpm install electron@44.10.0 -D`

NPM mirror:

* Use npmmirror China mirror repository `pnpm --registry https://registry.npmmirror.com/ i`
* Revert to using official repository `pnpm --registry https://registry.npmjs.org i`
</details>

Enter the app folder and execute:

* `pnpm install electron@44.10.0 -D`
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
* Linux: the desktop OCR worker targets **glibc 2.28** on both AMD64 and ARM64, independently of the kernel's musl toolchain. The preparation script downloads the pinned Zig compiler from `scripts/ocr-assets.json`, verifies its checksum, and caches it in `.cache/ocr/`; the compiler is not distributed in the application. Install `binutils` for the `readelf` compatibility check. Optional `SIYUAN_OCR_CC_AMD64` and `SIYUAN_OCR_CC_ARM64` overrides select compiler commands with a glibc 2.28 or older sysroot; newer headers and artifacts requiring newer glibc symbols are rejected. `--check-only` validates the default toolchain selection without downloading it. Docker uses its separate Alpine/musl OCR build and is unchanged

### iOS

* `cd kernel`
* `gomobile bind -tags "fts5 sqlcipher" -ldflags '-s -w' -v -o ./ios/iosk.xcframework -target=ios ./mobile/`
* https://github.com/siyuan-note/siyuan-ios

### Android

* `cd kernel`
* `set JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF-8`
* `gomobile bind -tags "fts5 sqlcipher" -ldflags "-s -w"  -v -o kernel.aar -target android/arm64 -androidapi 26 ./mobile/`
* https://github.com/siyuan-note/siyuan-android

On Windows, run `node scripts/android-dev-run.mjs` from the SiYuan repository root to build the mobile frontend, package resources, build `kernel.aar` and the debug APK, then install and launch the separate debug app through ADB. The default flavor is `official`. Prepare Node.js, pnpm, Go, gomobile, a JDK, the Android SDK and NDK, and ZIP-capable bsdtar (the bundled Windows `tar`). Configure `sdk.dir` in the Android project's `local.properties`, or set `ANDROID_HOME`; the script selects the highest NDK version under the SDK directory. Enable debugging on the device and authorize the connection.

The Android project defaults to a sibling of the SiYuan repository; override it with `--android-dir=<path>` or `SIYUAN_ANDROID_DIR`. Use `--device=<serial>` to select an ADB connection. `--skip-ui` reuses existing frontend output (mobile, desktop, and export are required), `--skip-kernel` reuses and copies existing `kernel/kernel.aar`, and `--skip-gradle` only skips APK compilation while still performing resource packaging and kernel processing. Pass all three flags to reinstall an existing APK without rebuilding; the SDK and NDK must still be available. See `node scripts/android-dev-run.mjs --help` for more options.

### Harmony

Only support compilation under Linux, need to install Harmony SDK, and need to modify Go source code.

* `cd kernel/harmony`
* `./build.sh` (`./build-win.sh` for Windows Emulator)
* https://github.com/siyuan-note/siyuan-harmony

For ARM64 devices, run `node scripts/harmony-dev-run.mjs` from the SiYuan repository root to build the mobile frontend, package resources, build the kernel and signed debug HAP, then install and launch the separate debug app through HDC. First configure the Harmony project's `debug` signing profile for your device in DevEco Studio and prepare the native OCR runtime and models (see the Harmony repository README). On Windows, WSL builds the kernel against the current checkout; the Harmony SDK, Go, and Python 3.10+ must be available inside WSL. The script requires ZIP-capable bsdtar (the bundled Windows `tar`) and never automatically uninstalls the app.

Use `--deveco=<path>`, `--harmony-dir=<path>`, and `--device=<connect-key>` to select tools, project, and device. `--skip-ui` reuses existing frontend output (mobile, desktop, and export are required), `--skip-kernel` copies existing `kernel/harmony/libkernel.so` and `libkernel.h`, and `--skip-hvigor` only reinstalls and launches the existing debug HAP, skipping all builds and resource copies. See `node scripts/harmony-dev-run.mjs --help` for more options. Run script tests with `node --test app/scripts/harmony-dev-run.test.js`.

On Windows, the deployment script translates active `go.work` module paths and local replacements into WSL paths in a temporary workspace. Local dependency overrides remain active; the original workspace files are not changed. If workspace mode is disabled, the WSL build also uses `GOWORK=off`.

The deployment script uses `scripts/prepare-harmony-go.py` to copy the selected Go toolchain into the Linux user cache (default: `~/.cache/siyuan-harmony/go`), applies the three Harmony adaptations below to that copy, and pins it with `GOTOOLCHAIN=local`. The system installation and shared downloaded toolchains remain unchanged. Toolchain version or patch input changes produce another cache entry; unsupported sources and corrupted caches cause an error. Run preparation tests with `python3 -m unittest scripts/test_prepare_harmony_go.py`; on Linux, these also check toolchain selection in the build wrapper without compiling the kernel.

When running `kernel/harmony/build.sh` directly, modify the Go sources actually used by the build:

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
