echo 'Building UI'
cd app
call pnpm install
call pnpm run build
cd ..

echo 'Cleaning Builds'
del /S /Q /F app\build 1>nul
del /S /Q /F app\kernel 1>nul
del /S /Q /F app\kernel32 1>nul

echo 'Building Kernel'
go version
set GO111MODULE=on
set GOPROXY=https://goproxy.io
set CGO_ENABLED=1

cd kernel
goversioninfo -platform-specific=true -icon=resource/icon.ico -manifest=resource/goversioninfo.exe.manifest

set GOOS=windows
set GOARCH=amd64
go build --tags fts5 -v -o "../app/kernel/SiYuan-Kernel.exe" -ldflags "-s -w -H=windowsgui" .

set GOOS=windows
set GOARCH=386
go build --tags fts5 -v -o "../app/kernel32/SiYuan-Kernel.exe" -ldflags "-s -w -H=windowsgui" .
cd ..

echo 'Building Electron'
cd app
call pnpm run dist
echo 'Building Electron win32'
call pnpm run dist-win32
cd ..

echo 'Building Appx'
electron-windows-store --input-directory app\build\win-unpacked --output-directory app\build\ --package-version 1.0.0.0 --package-name SiYuan --manifest app\appx\AppxManifest.xml --assets app\appx\assets\ --make-pri true
