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
	"sync"
	"time"
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
// kind 标识产物来源（resources/sy/markdown），仅影响注册 key 的分段，解析与撤销均按 boxID 前缀匹配。
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
