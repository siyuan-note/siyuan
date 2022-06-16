[English](CONTRIBUTING.md)

## 获取源码

* `git clone --recurse-submodules git@github.com:siyuan-note/siyuan.git` 例如保存在 `D:/siyuan/`
* 切换到 dev 分支

## NPM 依赖

### 桌面

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

## 容器 (可选)

* 只适用于`Linux` (理论上也能在`Windows WSL 2`中运行。)
* 容器基于`podman`，`buildah`，`catatonit`开发，需要使用系统自带的包管理器安装它们。
* 容器自动构建与运行集成在`scripts/start-dev.sh`脚本中。

### 桌面

```bash
sudo scripts/start-dev.sh -u $(id -u) -f     # 进行前端开发
sudo scripts/start-dev.sh -u $(id -u) -f     # 再一次运行此命令，进入到前端容器shell
```

### 内核 

```bash
sudo scripts/start-dev.sh -u $(id -u) -b                    # 开始后端开发
sudo scripts/start-dev.sh -u $(id -u) -b -ws /tmp/siyuan    # 开始后端开发,映射本地/tmp/siyuan为工作区
```

### 强制重建镜像

```bash
sudo scripts/start-dev.sh -u $(id -u) -f -r  # 强制重建前端镜像
sudo scripts/start-dev.sh -u $(id -u) -b -r  # 强制重建后端镜像
```

### 以root角色执行容器Shell

```bash
sudo scripts/start-dev.sh -u 0 -f            # 以root角色执行前端容器Shell
sudo scripts/start-dev.sh -u 0 -b            # 以root角色执行后端容器Shell
```

### 脚本参数

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
