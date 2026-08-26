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
	"path"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/88250/lute/ast"
)

// IsForbiddenAbsPath 判断绝对路径是否为敏感路径，HTTP 文件 API（kernel/api/file.go 的 refuseToAccess）
// 与 MCP 文件工具（kernel/mcp/tools/file.go 的 resolvePath）共用同一黑名单：
// conf 目录下的 conf.json 与 TLS 密钥材料、data/snippets/conf.json、data/templates 目录、
// data/.siyuan/publishAccess.json、笔记本目录下的 .siyuan 内部文件以及 temp 目录下的 siyuan.log 日志文件。
func IsForbiddenAbsPath(abs string) bool {
	fileNorm := NormalizeAndResolve(abs)

	// 禁止访问日志文件 siyuan.log：Timing 中间件可能把含 API token 的查询串写入日志（如慢查询告警），
	// 日志被任意已认证用户读取即等于泄露管理员凭据，因此即使日志不再记录查询串也保持拦截
	if "" != LogPath && fileNorm == NormalizeAndResolve(LogPath) {
		return true
	}

	// 禁止访问 conf 目录下的敏感文件：conf.json（含 accessAuthCode/api.token/cookieKey 等明文凭据）
	// 以及 TLS 私钥与证书（见 GetOrCreateTLSCert，私钥被读取可导致 HTTPS 流量被解密或证书被伪造）
	forbiddenConfFiles := []string{
		"conf.json",
		TLSCACertFilename,
		TLSCAKeyFilename,
		TLSCertFilename,
		TLSKeyFilename,
	}
	for _, filename := range forbiddenConfFiles {
		if fileNorm == NormalizeAndResolve(filepath.Join(ConfDir, filename)) {
			return true
		}
	}

	// 数据目录内的敏感位置（snippets/conf.json、templates、.siyuan/publishAccess.json），
	// 与历史快照、仓库 diff 路由（IsForbiddenDataRelPath）共用同一判断，避免黑名单分散维护。
	dataNorm := NormalizeAndResolve(DataDir)
	if rel, relErr := filepath.Rel(dataNorm, fileNorm); nil == relErr &&
		!strings.HasPrefix(rel, "..") && IsForbiddenDataRelPath(rel) {
		return true
	}
	return false
}

// IsForbiddenDataRelPath 判断数据目录下的相对路径是否指向敏感位置（data/snippets/conf.json、
// data/templates 目录、data/.siyuan/publishAccess.json 以及笔记本目录下的 .siyuan 内部文件
// 如 conf.json、sort.json、历史快照和 notebook-crypto-backup.json）。历史快照与仓库 diff 检出
// 中的文件副本位于其他绝对路径下，无法用 IsForbiddenAbsPath 的精确匹配拦截，因此 /history
// 与 /repo/diff 路由（kernel/server/serve.go）在去掉快照目录前缀后按数据相对路径调用本函数进行片段匹配。
func IsForbiddenDataRelPath(rel string) bool {
	// 统一为斜杠并清理（path.Clean 使用斜杠语义，避免 Windows 上分隔符差异）
	rel = path.Clean("/" + filepath.ToSlash(rel))
	// 在 Windows 和 macOS 上文件系统通常为不区分大小写，使用小写统一比较
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		rel = strings.ToLower(rel)
	}

	// 禁止访问 data/snippets/conf.json
	if rel == "/snippets/conf.json" {
		return true
	}

	// 禁止访问 data/templates 目录（含目录本身及其全部子路径）
	if rel == "/templates" || strings.HasPrefix(rel, "/templates/") {
		return true
	}

	// 禁止访问 data/.siyuan/publishAccess.json（含发布模式明文访问密码）。
	// 磁盘上的真实文件名为驼峰 publishAccess.json：Windows/macOS 上路径已在上方转为小写，与小写常量比较即可；
	// Linux 等大小写敏感平台需与真实名称精确比较，并对大小写变体做小写兜底比较，防止变体路径绕过黑名单
	if rel == "/.siyuan/publishAccess.json" || strings.ToLower(rel) == "/.siyuan/publishaccess.json" {
		return true
	}

	// 禁止访问笔记本目录下的 .siyuan 内部文件（含目录本身）：conf.json、sort.json、
	// 历史快照与 notebook-crypto-backup.json 等均为内部数据，不应通过原始文件通道暴露。
	// 笔记本 ID 目录名以时间戳开头，据此限定匹配范围避免误伤用户文档
	pathParts := strings.Split(rel, "/")
	if 3 <= len(pathParts) && ast.IsNodeIDPattern(pathParts[1]) && ".siyuan" == pathParts[2] {
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
