@echo off
echo 'use ".\scripts\win-build.bat" instead of "win-build.bat"'

echo 'Building UI'
cd app
call pnpm install
if errorlevel 1 (
    exit /b %errorlevel%
)
call pnpm run build
if errorlevel 1 (
    exit /b %errorlevel%
)
cd ..

echo 'Cleaning Builds'
del /S /Q /F app\build 1>nul
del /S /Q /F app\kernel 1>nul

echo 'Building Kernel'
@REM the C compiler "gcc" is necessary https://sourceforge.net/projects/mingw-w64/files/mingw-w64/
go version
set GO111MODULE=on
set GOPROXY=https://mirrors.aliyun.com/goproxy/
set CGO_ENABLED=1

cd kernel
@REM you can use `go mod tidy` to update kernel dependency before build
@REM you can use `go generate` instead (need add something in main.go)
goversioninfo -platform-specific=true -icon=resource/icon.ico -manifest=resource/goversioninfo.exe.manifest

echo 'Building Kernel amd64'
set GOOS=windows
set GOARCH=amd64
go build --tags fts5 -v -o "../app/kernel/SiYuan-Kernel.exe" -ldflags "-s -w -H=windowsgui" .
if errorlevel 1 (
    exit /b %errorlevel%
)


cd ..

echo 'Building Electron App amd64'
cd app

copy "elevator\elevator-amd64.exe" "kernel\elevator.exe"

call pnpm run dist
if errorlevel 1 (
    exit /b %errorlevel%
)
cd ..