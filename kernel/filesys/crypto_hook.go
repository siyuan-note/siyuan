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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package filesys

import (
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// DEKProvider 由 model 层在 init 时注入，用于查询 boxID 对应的 DEK。
// 返回 (nil, nil) 表示该 box 非加密——加解密函数原样返回 data，对普通笔记本透明。
// 返回 (nil, error) 表示加密但未解锁——加解密函数拒绝读写，避免未解锁时静默落盘明文。
// filesys 不能直接 import model（会形成 model → filesys → model 循环依赖），故采用回调注入。
var DEKProvider func(boxID string) ([]byte, error)

// normalizeRelPath 标准化 box 内相对路径用于 AAD：去掉前导 /、统一为正斜杠。
func normalizeRelPath(p string) string {
	p = filepath.ToSlash(p)
	p = strings.TrimPrefix(p, "/")
	return p
}

// encryptData 若 boxID 是已解锁的加密 box，用 fileKey（DEK 派生子密钥）加密 data，
// AAD 绑定 boxID + 相对路径；非加密笔记本原样返回；加密但未解锁时返回 error，拒绝写盘（防止明文泄漏）。
func encryptData(boxID, relativePath string, data []byte) ([]byte, error) {
	if DEKProvider == nil {
		return data, nil
	}
	dek, err := DEKProvider(boxID)
	if err != nil {
		return nil, err
	}
	if dek == nil {
		return data, nil // 非加密 box
	}
	fileKey := util.DeriveSubKey(dek, "siyuan/file")
	aad := "siyuan:v1:file:" + boxID + ":" + normalizeRelPath(relativePath)
	return util.EncryptWithAAD(fileKey, data, []byte(aad))
}

// decryptData 对应解密。非加密笔记本原样返回；加密但未解锁时返回 error，拒绝读盘。
func decryptData(boxID, relativePath string, data []byte) ([]byte, error) {
	if DEKProvider == nil {
		return data, nil
	}
	dek, err := DEKProvider(boxID)
	if err != nil {
		return nil, err
	}
	if dek == nil {
		return data, nil // 非加密 box
	}
	fileKey := util.DeriveSubKey(dek, "siyuan/file")
	aad := "siyuan:v1:file:" + boxID + ":" + normalizeRelPath(relativePath)
	return util.DecryptWithAAD(fileKey, data, []byte(aad))
}

// docIALBoxID 从 .sy 绝对路径反推 boxID，供 DocIAL 判断是否需整体解密。
// 路径形如 <DataDir>/<boxID>/...；若不在 DataDir 下或 boxID 非合法 ID 模式，返回空串。
func docIALBoxID(absPath string) string {
	absPath = filepath.ToSlash(absPath)
	dataDir := filepath.ToSlash(util.DataDir)
	rel, err := filepath.Rel(dataDir, absPath)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	if strings.HasPrefix(rel, "..") || rel == "." || rel == "" {
		return ""
	}
	parts := strings.SplitN(rel, "/", 2)
	boxID := parts[0]
	if !ast.IsNodeIDPattern(boxID) {
		return ""
	}
	return boxID
}
