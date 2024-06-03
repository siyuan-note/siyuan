#!/bin/bash

echo 'Building UI'
cd app
pnpm install && pnpm run build
cd ..

echo 'Cleaning Builds'
rm -rf app/build
rm -rf app/kernel-linux
rm -rf app/kernel-linux-arm64

echo 'Building Kernel'

cd kernel
go version
export GO111MODULE=on
export GOPROXY=https://goproxy.io
export CGO_ENABLED=1

echo 'Building Kernel amd64'
export GOOS=linux
export GOARCH=amd64
export CC=~/x86_64-linux-musl-cross/bin/x86_64-linux-musl-gcc
go build -buildmode=pie --tags fts5 -v -o "../app/kernel-linux/SiYuan-Kernel" -ldflags "-s -w -extldflags -static-pie" .

echo 'Building Kernel arm64'
export GOARCH=arm64
export CC=~/aarch64-linux-musl-cross/bin/aarch64-linux-musl-gcc
go build -buildmode=pie --tags fts5 -v -o "../app/kernel-linux-arm64/SiYuan-Kernel" -ldflags "-s -w -extldflags -static-pie" .
cd ..

echo 'Building Electron App amd64'
cd app
pnpm run dist-linux
echo 'Building Electron App arm64'
pnpm run dist-linux-arm64
cd ..
