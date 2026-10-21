#!/bin/bash
# 按模块要求选择 Go 版本，再为鸿蒙构建准备隔离的工具链。
set -euo pipefail

source_root=$(go env GOROOT)
script_dir=$(cd -- "$(dirname -- "${1:-$0}")" && pwd)
harmony_root=$(python3 "$script_dir/prepare-harmony-go.py" --source "$source_root")
export GOROOT="$harmony_root"
export GOTOOLCHAIN=local
export PATH="$GOROOT/bin:$PATH"
echo "Harmony Go: $GOROOT"
# 清除 Windows 检出文件的 CRLF，不修改原始构建脚本。
sed 's/\r$//' build.sh | bash -e
