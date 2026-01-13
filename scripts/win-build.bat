@echo off

echo TIP: This script must be run from the project root directory
echo Usage: .\scripts\win-build.bat [--variant=^<variant^>]
echo Options: 
echo   --variant=^<variant^>  Build variant: amd64, arm64, appx-amd64, appx-arm64, or all (default: all)
echo.

set "VARIANT=all"

:parse_args
if "%1"=="" goto :end_parse_args
if "%1"=="--variant" (
    if "%2"=="" (
        echo Error: --variant option requires an equal sign and value
        echo Usage: --variant=^<variant^>
        echo Example: --variant=amd64
        exit /b 1
    ) else (
        if not "%2"=="amd64" if not "%2"=="arm64" if not "%2"=="appx-amd64" if not "%2"=="appx-arm64" if not "%2"=="all" (
            echo Error: Invalid variant '%2'
            echo Valid variants are: amd64, arm64, appx-amd64, appx-arm64, all
            exit /b 1
        )
        set "VARIANT=%2"
        shift
        shift
        goto :parse_args
    )
) else (
    @REM Skip unknown options
    shift
    goto :parse_args
)
:end_parse_args

if "%VARIANT%"=="amd64" (
    set BUILD_AMD64=1
) else if "%VARIANT%"=="arm64" (
    set BUILD_ARM64=1
) else if "%VARIANT%"=="appx-amd64" (
    set BUILD_APPX_AMD64=1
) else if "%VARIANT%"=="appx-arm64" (
    set BUILD_APPX_ARM64=1
) else (
    REM all: build everything
    set BUILD_AMD64=1
    set BUILD_ARM64=1
    set BUILD_APPX_AMD64=1
    set BUILD_APPX_ARM64=1
)

echo Building UI
cd app
if errorlevel 1 (
    exit /b %errorlevel%
)
call pnpm install
if errorlevel 1 (
    exit /b %errorlevel%
)
call pnpm run build
if errorlevel 1 (
    exit /b %errorlevel%
)
cd ..
if errorlevel 1 (
    exit /b %errorlevel%
)

echo Cleaning Builds
rmdir /S /Q app\build 1>nul
rmdir /S /Q app\kernel 1>nul
rmdir /S /Q app\kernel-arm64 1>nul

echo Building Kernel
@REM the C compiler "gcc" is necessary https://sourceforge.net/projects/mingw-w64/files/mingw-w64/
go version
set GO111MODULE=on
set GOPROXY=https://mirrors.aliyun.com/goproxy/
set CGO_ENABLED=1
set GOOS=windows

cd kernel
if errorlevel 1 (
    exit /b %errorlevel%
)
@REM you can use `go mod tidy` to update kernel dependency before build
@REM you can use `go generate` instead (need add something in main.go)
goversioninfo -platform-specific=true -icon=resource/icon.ico -manifest=resource/goversioninfo.exe.manifest

if defined BUILD_AMD64 (
    echo Building Kernel amd64
    set GOARCH=amd64
    go build --tags fts5 -v -o "../app/kernel/SiYuan-Kernel.exe" -ldflags "-s -w -H=windowsgui" .
    if errorlevel 1 (
        exit /b %errorlevel%
    )
)

if defined BUILD_ARM64 (
    echo Building Kernel arm64
    set GOARCH=arm64
    @REM if you want to build arm64, you need to install aarch64-w64-mingw32-gcc
    set CC="D:/Program Files/llvm-mingw-20240518-ucrt-x86_64/bin/aarch64-w64-mingw32-gcc.exe"
    go build --tags fts5 -v -o "../app/kernel-arm64/SiYuan-Kernel.exe" -ldflags "-s -w -H=windowsgui" .
    if errorlevel 1 (
        exit /b %errorlevel%
    )
)
cd ..
if errorlevel 1 (
    exit /b %errorlevel%
)

cd app
if errorlevel 1 (
    exit /b %errorlevel%
)

if defined BUILD_AMD64 (
    echo Building Electron App amd64
    copy "elevator\elevator-amd64.exe" "kernel\elevator.exe"
    call pnpm run dist
    if errorlevel 1 (
        exit /b %errorlevel%
    )
)

if defined BUILD_ARM64 (
    echo Building Electron App arm64
    copy "elevator\elevator-arm64.exe" "kernel-arm64\elevator.exe"
    call pnpm run dist-arm64
    if errorlevel 1 (
        exit /b %errorlevel%
    )
)
cd ..
if errorlevel 1 (
    exit /b %errorlevel%
)

if defined BUILD_APPX_AMD64 (
    echo Building Appx amd64
    echo Building Appx amd64 should be disabled if you do not need it. Not configured correctly will lead to build failures
    cd . > app\build\win-unpacked\resources\ms-store
    if errorlevel 1 (
        exit /b %errorlevel%
    )
    call electron-windows-store --input-directory app\build\win-unpacked --output-directory app\build\ --package-version 1.0.0.0 --package-name SiYuan --manifest app\appx\AppxManifest.xml --assets app\appx\assets\ --make-pri true

    rmdir /S /Q app\build\pre-appx 1>nul
)

if defined BUILD_APPX_ARM64 (
    echo Building Appx arm64
    echo Building Appx arm64 should be disabled if you do not need it. Not configured correctly will lead to build failures
    cd . > app\build\win-arm64-unpacked\resources\ms-store
    if errorlevel 1 (
        exit /b %errorlevel%
    )
    call electron-windows-store --input-directory app\build\win-arm64-unpacked --output-directory app\build\ --package-version 1.0.0.0 --package-name SiYuan-arm64 --manifest app\appx\AppxManifest-arm64.xml --assets app\appx\assets\ --make-pri true

    rmdir /S /Q app\build\pre-appx 1>nul
)
