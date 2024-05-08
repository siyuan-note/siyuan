@echo off
echo 'use ".\scripts\win-build.bat" instead of "win-build.bat"'

echo 'Building UI'
cd app
call pnpm install
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
set GOPROXY=https://goproxy.io
set CGO_ENABLED=1

cd kernel
@REM you can use `go generate` instead (nead add something in main.go)
goversioninfo -platform-specific=true -icon=resource/icon.ico -manifest=resource/goversioninfo.exe.manifest

set GOOS=windows
set GOARCH=amd64
@REM you can use `go mod tidy` to update kernel dependency before build
go build --tags fts5 -v -o "../app/kernel/SiYuan-Kernel.exe" -ldflags "-s -w -H=windowsgui" .
if errorlevel 1 (
    exit /b %errorlevel%
)

cd ..

echo 'Building Electron App'
cd app
call pnpm run dist
if errorlevel 1 (
    exit /b %errorlevel%
)
cd ..

echo 'Building Appx'
echo 'Building Appx should be disabled if you do not need it. Not configured correctly will lead to build failures'
cd . > app\build\win-unpacked\resources\ms-store
electron-windows-store --input-directory app\build\win-unpacked --output-directory app\build\ --package-version 1.0.0.0 --package-name SiYuan --manifest app\appx\AppxManifest.xml --assets app\appx\assets\ --make-pri true
