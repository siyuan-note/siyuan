// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import (
	"path/filepath"
	"runtime"
	"strings"

	"github.com/88250/gulu"
)

// IsForbiddenAbsPath 判断绝对路径是否为敏感路径，HTTP 文件 API（kernel/api/file.go 的 refuseToAccess）
// 与 MCP 文件工具（kernel/mcp/tools/file.go 的 resolvePath）共用同一黑名单：
// conf/conf.json、data/snippets/conf.json、data/templates 目录以及 data/.siyuan/publishAccess.json。
func IsForbiddenAbsPath(abs string) bool {
	fileNorm := NormalizeAndResolve(abs)

	// 禁止访问配置文件 conf/conf.json（含 accessAuthCode/api.token/cookieKey 等明文凭据）
	confPath := NormalizeAndResolve(filepath.Join(ConfDir, "conf.json"))
	if fileNorm == confPath {
		return true
	}

	// 禁止访问 data/snippets/conf.json
	snippetPath := NormalizeAndResolve(filepath.Join(DataDir, "snippets", "conf.json"))
	if fileNorm == snippetPath {
		return true
	}

	// 禁止访问 data/templates 目录（含目录本身及其全部子路径）
	templatesBase := NormalizeAndResolve(filepath.Join(DataDir, "templates"))
	if fileNorm == templatesBase || gulu.File.IsSubPath(templatesBase, fileNorm) {
		return true
	}

	// 禁止访问 data/.siyuan/publishAccess.json（含发布模式明文访问密码）
	publishAccessPath := NormalizeAndResolve(filepath.Join(DataDir, ".siyuan", "publishAccess.json"))
	if fileNorm == publishAccessPath {
		return true
	}
	return false
}

// NormalizeAndResolve 将路径转为绝对、解析符号链接并清理；在需要时转为小写以实现不区分大小写比较
func NormalizeAndResolve(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	if eval, err := filepath.EvalSymlinks(p); err == nil {
		p = eval
	}
	p = filepath.Clean(p)
	// 在 Windows 和 macOS 上文件系统通常为不区分大小写，使用小写统一比较
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		p = strings.ToLower(p)
	}
	return p
}
