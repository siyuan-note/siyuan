#!/bin/bash

echo 'Building UI'
cd app
pnpm install && pnpm run build
cd ..

echo 'Cleaning Builds'
rm -rf app/build
rm -rf app/kernel-linux

echo 'Building Kernel'

cd kernel
go version
export GO111MODULE=on
export GOPROXY=https://goproxy.io
export CGO_ENABLED=1

export GOOS=linux
export GOARCH=amd64
go build --tags fts5 -v -o "../app/kernel-linux/SiYuan-Kernel" -ldflags "-s -w" .
cd ..

echo 'Building Electron App'
cd app
pnpm run dist-linux
cd ..
