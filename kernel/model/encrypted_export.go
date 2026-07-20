// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type managedEncryptedExport struct {
	boxID     string
	artifact  string
	expiresAt time.Time
}

var managedEncryptedExports = struct {
	sync.Mutex
	jobs map[string]managedEncryptedExport
}{jobs: map[string]managedEncryptedExport{}}

func newManagedEncryptedExportID() (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return hex.EncodeToString(random), nil
}

// registerManagedEncryptedExport 登记一个加密笔记本的导出产物，返回相对路径作为下载令牌。
// kind 标识产物来源（resources/sy/markdown/repo），仅影响注册 key 的分段，解析与撤销均按 boxID 前缀匹配。
func registerManagedEncryptedExport(boxID, kind, artifact string) string {
	relativePath := path.Join(boxID, kind, filepath.Base(artifact))
	managedEncryptedExports.Lock()
	managedEncryptedExports.jobs[relativePath] = managedEncryptedExport{
		boxID:     boxID,
		artifact:  artifact,
		expiresAt: time.Now().Add(time.Hour),
	}
	managedEncryptedExports.Unlock()
	return relativePath
}

// RegisterManagedEncryptedExport 是 registerManagedEncryptedExport 的导出包装，供 api 层调用。
func RegisterManagedEncryptedExport(boxID, kind, artifact string) string {
	return registerManagedEncryptedExport(boxID, kind, artifact)
}

// ResolveManagedEncryptedExport 返回仍有效的加密导出产物，未登记、已撤销或过期的路径均不可下载。
func ResolveManagedEncryptedExport(relativePath string) (boxID, artifact string, ok bool) {
	relativePath = path.Clean("/" + relativePath)
	relativePath = relativePath[1:]

	managedEncryptedExports.Lock()
	job, ok := managedEncryptedExports.jobs[relativePath]
	if !ok {
		managedEncryptedExports.Unlock()
		return "", "", false
	}
	if time.Now().After(job.expiresAt) {
		delete(managedEncryptedExports.jobs, relativePath)
		managedEncryptedExports.Unlock()
		_ = os.Remove(job.artifact)
		return "", "", false
	}
	managedEncryptedExports.Unlock()
	return job.boxID, job.artifact, true
}

// RevokeManagedEncryptedExportsForBox 使指定笔记本的所有导出下载链接立即失效。
func RevokeManagedEncryptedExportsForBox(boxID string) {
	managedEncryptedExports.Lock()
	defer managedEncryptedExports.Unlock()
	for relativePath, job := range managedEncryptedExports.jobs {
		if job.boxID == boxID {
			delete(managedEncryptedExports.jobs, relativePath)
		}
	}
}

// clearEncryptedExportTempOnBoot 清理异常退出后残留的加密笔记本明文导出目录。
// 加密导出的第一层目录固定为 boxID，普通导出和插件临时目录不使用该命名形式。
func clearEncryptedExportTempOnBoot() {
	if strings.TrimSpace(util.TempDir) == "" {
		logging.LogWarnf("skip clearing stale encrypted export temp: temp dir is not initialized")
		return
	}
	exportDir := filepath.Join(util.TempDir, "export")
	entries, err := os.ReadDir(exportDir)
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		logging.LogWarnf("read export temp dir [%s] failed: %s", exportDir, err)
		return
	}
	for _, entry := range entries {
		if !ast.IsNodeIDPattern(entry.Name()) {
			continue
		}
		entryPath := filepath.Join(exportDir, entry.Name())
		if err = os.RemoveAll(entryPath); err != nil {
			logging.LogWarnf("remove stale encrypted export temp [%s] failed: %s", entryPath, err)
		}
	}
}

// IsManagedEncryptedExportPath 判断相对路径是否属于加密导出受控范围（<boxID>/<kind>/<file> 结构）。
// 只要路径首段是合法 boxID 格式即视为受控，不依赖 box 是否仍存在（笔记本删除后仍需按注册表拒绝，
// 避免因 IsEncryptedBox 返回 false 而 fail-open 暴露明文产物）。
func IsManagedEncryptedExportPath(relativePath string) bool {
	relativePath = path.Clean("/" + relativePath)
	parts := strings.SplitN(strings.TrimPrefix(relativePath, "/"), "/", 3)
	return len(parts) >= 1 && ast.IsNodeIDPattern(parts[0])
}

// ResolveManagedExportForMobile 供移动端 GetExportFilePath 调用，校验托管 token 有效且 box 已解锁。
// 任一条件不满足返回 ("", false)（fail-closed），防止移动端绕过注册表直接读取明文导出产物。
func ResolveManagedExportForMobile(relativePath string) (absPath string, ok bool) {
	boxID, artifact, resolved := ResolveManagedEncryptedExport(relativePath)
	if !resolved {
		return "", false
	}
	if _, dekErr := GetDEKIfUnlocked(boxID); dekErr != nil {
		return "", false
	}
	return artifact, true
}
