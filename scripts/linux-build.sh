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
HARMONY_KERNEL=false
HARMONY_READY_FILE=''
PROCESS_ID_FILE=''
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
        --harmony-ready-file=*)
            HARMONY_READY_FILE="${1#*=}"
            shift
            ;;
        --process-id-file=*)
            PROCESS_ID_FILE="${1#*=}"
            shift
            ;;
        --with-harmony-kernel)
            HARMONY_KERNEL=true
            shift
            ;;
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

if [[ -n "$PROCESS_ID_FILE" ]]; then
    printf '%s\n' "$$" > "$PROCESS_ID_FILE"
fi

export GO111MODULE=on
export GOPROXY=https://mirrors.aliyun.com/goproxy/,https://goproxy.cn,direct
# Toolchain selection can download and authenticate a toolchain even for
# `go version`. Configure its proxy before the first Go invocation, and fail
# before spending time building frontend resources. Keep checksum validation.
echo 'Checking Go toolchain'
(cd "$PROJECT_ROOT/kernel"; go version)

echo 'Checking OCR worker toolchains (glibc)'
# Each compiler runs in its own process group so failures and interrupts also
# stop its compiler/linker children before packaging can start.
KERNEL_PIDS=()
cleanup_kernels() {
    local pid
    for pid in "${KERNEL_PIDS[@]}"; do
        kill -TERM -- "-$pid" 2>/dev/null || true
        kill -TERM "$pid" 2>/dev/null || true
    done
    for pid in "${KERNEL_PIDS[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
}
build_kernels() {
    local arch suffix remaining=0
    local jobs=1
    [[ "$TARGET" == 'all' ]] && jobs=2
    local package_jobs=$(( $(getconf _NPROCESSORS_ONLN) / jobs ))
    (( package_jobs < 1 )) && package_jobs=1
    trap 'cleanup_kernels' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    for arch in amd64 arm64; do
        [[ "$TARGET" != 'all' && "$TARGET" != "$arch" ]] && continue
        setup_cc "$arch"
        echo "Building Kernel $arch"
        suffix=''
        [[ "$arch" == 'arm64' ]] && suffix='-arm64'
        GOARCH="$arch" setsid go build -p "$package_jobs" -buildmode=pie -tags "fts5 sqlcipher" \
            -o "../app/kernel-linux${suffix}/SiYuan-Kernel" -ldflags "-s -w -extldflags -static-pie" . &
        KERNEL_PIDS+=("$!")
        remaining=$((remaining + 1))
    done
    while (( remaining > 0 )); do
        if wait -n; then
            remaining=$((remaining - 1))
        else
            echo 'Kernel compilation failed; stopping remaining compilers'
            return 1
        fi
    done
    KERNEL_PIDS=()
    trap - EXIT INT TERM
}

if [[ "$TARGET" == 'amd64' || "$TARGET" == 'all' ]]; then
    python3 "$PROJECT_ROOT/scripts/prepare-ocr.py" --runtime linux-amd64 --build-worker --check-only
fi
if [[ "$TARGET" == 'arm64' || "$TARGET" == 'all' ]]; then
    python3 "$PROJECT_ROOT/scripts/prepare-ocr.py" --runtime linux-arm64 --build-worker --check-only
fi

echo 'Cleaning Builds'
rm -rf "$PROJECT_ROOT/app/build" 2>/dev/null || true
rm -rf "$PROJECT_ROOT/app/kernel-linux" 2>/dev/null || true
rm -rf "$PROJECT_ROOT/app/kernel-linux-arm64" 2>/dev/null || true

echo
echo 'Building UI'
cd "$PROJECT_ROOT/app"
pnpm install
pnpm run install:electron
pnpm run build

echo
echo 'Building Kernel'
cd "$PROJECT_ROOT/kernel"
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

build_kernels

if $HARMONY_KERNEL; then
    trap 'cleanup_kernels' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    (cd "$PROJECT_ROOT/kernel/harmony"
     setsid bash -e "$PROJECT_ROOT/scripts/harmony-kernel-build.sh" &
     child=$!
     trap 'kill -TERM -- "-$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true' EXIT
     if ! wait "$child"; then
         if [[ -n "$HARMONY_READY_FILE" ]]; then
             touch "${HARMONY_READY_FILE}.failed"
         fi
         exit 1
     fi
     trap - EXIT
     if [[ -n "$HARMONY_READY_FILE" ]]; then
         touch "$HARMONY_READY_FILE"
     fi) &
    KERNEL_PIDS=("$!")
fi

echo
echo 'Building Electron App'
cd "$PROJECT_ROOT/app"
if [[ "$TARGET" == 'amd64' || "$TARGET" == 'all' ]]; then
    echo
    echo 'Building Electron App amd64'
    # Electron Builder otherwise defaults gzip archives to level 9 even when
    # compression is "normal". Keep this override local to Linux packaging.
    ELECTRON_BUILDER_COMPRESSION_LEVEL=5 pnpm run dist-linux
fi
if [[ "$TARGET" == 'arm64' || "$TARGET" == 'all' ]]; then
    echo
    echo 'Building Electron App arm64'
    ELECTRON_BUILDER_COMPRESSION_LEVEL=5 pnpm run dist-linux-arm64
fi

if $HARMONY_KERNEL; then
    wait "${KERNEL_PIDS[0]}"
    KERNEL_PIDS=()
    trap - EXIT INT TERM
fi
echo
echo '=============================='
echo '      Build successful!'
echo '=============================='

# 返回初始目录
cd "$INITIAL_DIR"
