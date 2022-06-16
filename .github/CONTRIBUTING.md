[中文](CONTRIBUTING_zh_CN.md)

## Get the source code

* `git clone --recurse-submodules git@github.com:siyuan-note/siyuan.git` For example saved in `D:/siyuan/`
* switch to dev branch

## User Interface

Install pnpm: `npm install -g pnpm`

<details>
<summary>For China mainland</summary>
Set the Electron mirror environment variable:

* macOS/Linux: ELECTRON_MIRROR="https://cnpmjs.org/mirrors/electron/" pnpm install electron@14.2.5 -D
* Windows: `SET ELECTRON_MIRROR=https://cnpmjs.org/mirrors/electron/`

NPM mirror:

* Use mirror repository `pnpm --registry https://r.cnpmjs.org/ i`
* Revert to using official repository `pnpm --registry https://registry.npmjs.org i`
</details>

On the desktop, go to the app folder to compile and run:

* `pnpm run dev`
* `pnpm run start`

## Kernel

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
* `gomobile bind --tags fts5 -ldflags '-s -w' -v -o kernel.aar -target='android/arm,android/arm64' ./mobile/`
* https://github.com/siyuan-note/siyuan-android

For the mobile-end, please refer to the corresponding project repository.

## Container (Optional)

* It's expected to run in linux only. (May work in `Windows WSL 2` as well.)
* The container is based on `podman`, `buildah` and `catatonit`, you need to install them with your system package manager.
* The container operation is combined into `start-dev.sh` script.

### User Interface

```bash
sudo scripts/start-dev.sh -u $(id -u) -f     # Start frontend development
sudo scripts/start-dev.sh -u $(id -u) -f     # Run the command again to attach container shell
```

### Kernel

```bash
sudo scripts/start-dev.sh -u $(id -u) -b                    # Start backend development
sudo scripts/start-dev.sh -u $(id -u) -b -ws /tmp/siyuan    # Start backend development with workspace mapping with /tmp/siyuan
```

### Force rebuild image

```bash
sudo scripts/start-dev.sh -u $(id -u) -f -r  # Force rebuild frontend image
sudo scripts/start-dev.sh -u $(id -u) -b -r  # Force rebuild backend image
```

### Attach a running container as root

```bash
sudo scripts/start-dev.sh -u 0 -f            # Attach frontend as root
sudo scripts/start-dev.sh -u 0 -b            # Attach backend as root
```

### Script Arguments

```
Usage:
    start-dev.sh [-ws|--workspace <WORKSPACE>] [-u|--uid <UID>]  [-r|--rebuild] [-f|--frontend] [-b|--backend]

Arguments:

    -h, --help                                   Print help information
    -u=<UID>, --uid=<UID>                        Set the user id (default: 0)
    -ws=<WORKSPACE>, --workspace=<WORKSPACE>     Set workspace directory for SiYuan kernel (default: Documents/SiYuan)
    -r, --rebuild                                Force rebuild image (default: false)
    -f, --frontend                               Start frontend devlop (default: false)
    -b, --backend                                Start backend devlop (default: true)
```
