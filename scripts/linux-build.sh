#!/bin/bash

echo 'TIP: This script must be run from the project root directory'
echo 'Usage: ./scripts/linux-build.sh [--target=<target>]'
echo 'Options:'
echo '  --target=<target>  Build target: amd64, arm64, or all (default: all)'
echo

TARGET='all'

validate_target() {
    if [[ -z "$1" ]]; then
        echo 'Error: --target option requires a value'
        echo 'Usage: --target=<target>'
        echo 'Examples: --target=amd64'
        exit 1
    elif [[ "$1" != 'amd64' && "$1" != 'arm64' && "$1" != 'all' ]]; then
        echo "Error: Invalid target '$1'"
        echo 'Valid targets are: amd64, arm64, all'
        exit 1
    fi
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --target=*)
            TARGET="${1#*=}"
            validate_target "$TARGET"
            shift
            ;;
        --target)
            TARGET="$2"
            validate_target "$TARGET"
            [ -n "$2" ] && shift 2 || shift
            ;;
        *)
            # Skip unknown options
            shift
            ;;
    esac
done

echo 'Building UI'
cd app || exit
pnpm install && pnpm run build
cd .. || exit

echo 'Cleaning Builds'
rm -rf app/build
rm -rf app/kernel-linux
rm -rf app/kernel-linux-arm64

echo 'Building Kernel'

cd kernel || exit
go version
export GO111MODULE=on
export GOPROXY=https://mirrors.aliyun.com/goproxy/
export CGO_ENABLED=1

if [[ "$TARGET" == 'amd64' || "$TARGET" == 'all' ]]; then
    echo 'Building Kernel amd64'
    export GOOS=linux
    export GOARCH=amd64
    export CC=~/x86_64-linux-musl-cross/bin/x86_64-linux-musl-gcc
    go build -buildmode=pie --tags fts5 -v -o "../app/kernel-linux/SiYuan-Kernel" -ldflags "-s -w -extldflags -static-pie" .
fi

if [[ "$TARGET" == 'arm64' || "$TARGET" == 'all' ]]; then
    echo 'Building Kernel arm64'
    export GOARCH=arm64
    export CC=~/aarch64-linux-musl-cross/bin/aarch64-linux-musl-gcc
    go build -buildmode=pie --tags fts5 -v -o "../app/kernel-linux-arm64/SiYuan-Kernel" -ldflags "-s -w -extldflags -static-pie" .
fi
cd .. || exit

cd app || exit

if [[ "$TARGET" == 'amd64' || "$TARGET" == 'all' ]]; then
    echo 'Building Electron App amd64'
    pnpm run dist-linux
fi

if [[ "$TARGET" == 'arm64' || "$TARGET" == 'all' ]]; then
    echo 'Building Electron App arm64'
    pnpm run dist-linux-arm64
fi

cd .. || exit