#!/bin/bash

echo 'Building UI'
cd app
pnpm install && pnpm run build
cd ..

echo 'Cleaning Builds'
rm -rf app/build
rm -rf app/kernel-darwin
rm -rf app/kernel-darwin-arm64

echo 'Building Kernel'

cd kernel
go version
export GO111MODULE=on
export GOPROXY=https://goproxy.io
export CGO_ENABLED=1

export GOOS=darwin
export GOARCH=amd64
go build --tags fts5 -v -o "../app/kernel-darwin/SiYuan-Kernel" -ldflags "-s -w" .

export GOOS=darwin
export GOARCH=arm64
go build --tags fts5 -v -o "../app/kernel-darwin-arm64/SiYuan-Kernel" -ldflags "-s -w" .
cd ..

echo 'Building Electron App amd64'
cd app
pnpm run dist-darwin
echo 'Building Electron App arm64'
pnpm run dist-darwin-arm64
cd ..
