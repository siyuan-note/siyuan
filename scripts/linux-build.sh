#!/bin/bash

# 启用错误处理：任何命令失败立即退出，并打印错误信息
set -e
trap 'echo "Error occurred at line $LINENO. Command: $BASH_COMMAND"; exit 1' ERR

echo 'Usage: ./linux-build.sh [--target=<target>]'
echo 'Options:'
echo '  --target=<target>  Build target: amd64, arm64, or all (default: all)'
echo

INITIAL_DIR="$(pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

echo 'Cleaning Builds'
rm -rf "$PROJECT_ROOT/app/build" 2>/dev/null || true
rm -rf "$PROJECT_ROOT/app/kernel-linux" 2>/dev/null || true
rm -rf "$PROJECT_ROOT/app/kernel-linux-arm64" 2>/dev/null || true

echo
echo 'Building UI'
cd "$PROJECT_ROOT/app"
pnpm install
pnpm run build

echo
echo 'Building Kernel'
cd "$PROJECT_ROOT/kernel"
go version
export GO111MODULE=on
export GOPROXY=https://mirrors.aliyun.com/goproxy/
export CGO_ENABLED=1
export GOOS=linux

setup_cc() {
    local arch=$1
    local target_prefix
    if [[ "$arch" == "amd64" ]]; then
        target_prefix="x86_64-linux-musl"
    elif [[ "$arch" == "arm64" ]]; then
        target_prefix="aarch64-linux-musl"
    fi

    local original_cc=~/${target_prefix}-cross/bin/${target_prefix}-gcc

    if [ -x "$original_cc" ]; then
        export CC="$original_cc"
    elif command -v ${target_prefix}-gcc >/dev/null 2>&1; then
        export CC=$(command -v ${target_prefix}-gcc)
    elif [[ "$arch" == "amd64" && "$(uname -m)" == "x86_64" ]] && command -v musl-gcc >/dev/null 2>&1; then
        export CC=$(command -v musl-gcc)
    elif [[ "$arch" == "arm64" && "$(uname -m)" == "aarch64" ]] && command -v musl-gcc >/dev/null 2>&1; then
        export CC=$(command -v musl-gcc)
    else
        local muslbin_dir="$PROJECT_ROOT/muslbin"
        local toolchain_dir="$muslbin_dir/${target_prefix}-cross"
        local downloaded_cc="$toolchain_dir/bin/${target_prefix}-gcc"
        
        if [ ! -x "$downloaded_cc" ]; then
            echo "CC not found, downloading ${target_prefix}-cross..."
            mkdir -p "$muslbin_dir"
            curl -L "https://musl.cc/${target_prefix}-cross.tgz" | tar -xz -C "$muslbin_dir"
        fi
        export CC="$downloaded_cc"
    fi
    echo "Using CC=$CC"
}

if [[ "$TARGET" == 'amd64' || "$TARGET" == 'all' ]]; then
    echo
    echo 'Building Kernel amd64'
    export GOARCH=amd64
    setup_cc amd64
    go build -buildmode=pie -tags fts5 -v -o "../app/kernel-linux/SiYuan-Kernel" -ldflags "-s -w -extldflags -static-pie" .
fi
if [[ "$TARGET" == 'arm64' || "$TARGET" == 'all' ]]; then
    echo
    echo 'Building Kernel arm64'
    export GOARCH=arm64
    setup_cc arm64
    go build -buildmode=pie -tags fts5 -v -o "../app/kernel-linux-arm64/SiYuan-Kernel" -ldflags "-s -w -extldflags -static-pie" .
fi

echo
echo 'Building Electron App'
cd "$PROJECT_ROOT/app"
if [[ "$TARGET" == 'amd64' || "$TARGET" == 'all' ]]; then
    echo
    echo 'Building Electron App amd64'
    pnpm run dist-linux
fi
if [[ "$TARGET" == 'arm64' || "$TARGET" == 'all' ]]; then
    echo
    echo 'Building Electron App arm64'
    pnpm run dist-linux-arm64
fi

echo
echo '=============================='
echo '      Build successful!'
echo '=============================='

# 返回初始目录
cd "$INITIAL_DIR"
