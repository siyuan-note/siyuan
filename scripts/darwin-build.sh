#!/bin/bash

echo 'TIP: This script must be run from the project root directory'
echo 'Usage: ./scripts/darwin-build.sh [--variant=<variant>]'
echo 'Options:'
echo '  --variant=<variant>  Build variant: amd64, arm64, or all (default: all)'
echo

VARIANT='all'

validate_variant() {
    if [[ -z "$1" ]]; then
        echo 'Error: --variant option requires a value'
        echo 'Usage: --variant=<variant>'
        echo 'Examples: --variant=amd64'
        exit 1
    elif [[ "$1" != 'amd64' && "$1" != 'arm64' && "$1" != 'all' ]]; then
        echo "Error: Invalid variant '$1'"
        echo 'Valid variants are: amd64, arm64, all'
        exit 1
    fi
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --variant=*)
            VARIANT="${1#*=}"
            validate_variant "$VARIANT"
            shift
            ;;
        --variant)
            VARIANT="$2"
            validate_variant "$VARIANT"
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
rm -rf app/kernel-darwin
rm -rf app/kernel-darwin-arm64

echo 'Building Kernel'

cd kernel || exit
go version
export GO111MODULE=on
export GOPROXY=https://mirrors.aliyun.com/goproxy/
export CGO_ENABLED=1

if [[ "$VARIANT" == 'amd64' || "$VARIANT" == 'all' ]]; then
    echo 'Building Kernel amd64'
    export GOOS=darwin
    export GOARCH=amd64
    go build --tags fts5 -v -o "../app/kernel-darwin/SiYuan-Kernel" -ldflags "-s -w" .
fi

if [[ "$VARIANT" == 'arm64' || "$VARIANT" == 'all' ]]; then
    echo 'Building Kernel arm64'
    export GOOS=darwin
    export GOARCH=arm64
    go build --tags fts5 -v -o "../app/kernel-darwin-arm64/SiYuan-Kernel" -ldflags "-s -w" .
fi
cd .. || exit

cd app || exit

if [[ "$VARIANT" == 'amd64' || "$VARIANT" == 'all' ]]; then
    echo 'Building Electron App amd64'
    pnpm run dist-darwin
fi

if [[ "$VARIANT" == 'arm64' || "$VARIANT" == 'all' ]]; then
    echo 'Building Electron App arm64'
    pnpm run dist-darwin-arm64
fi

cd .. || exit
