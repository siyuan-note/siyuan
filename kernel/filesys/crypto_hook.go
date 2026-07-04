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
// 返回 (nil, nil) 表示该 box 非加密或未解锁——此时加解密函数原样返回 data，对普通笔记本透明。
// filesys 不能直接 import model（会形成 model → filesys → model 循环依赖），故采用回调注入。
var DEKProvider func(boxID string) ([]byte, error)

// encryptData 若 boxID 是已解锁的加密 box，用其 DEK 加密 data；否则原样返回。
// 用于 .sy 写盘前：明文 data → 密文 encData。
func encryptData(boxID string, data []byte) ([]byte, error) {
	if DEKProvider == nil {
		return data, nil
	}
	dek, err := DEKProvider(boxID)
	if err != nil || dek == nil {
		return data, nil
	}
	return util.Encrypt(dek, data)
}

// decryptData 对应解密。非加密 box 或未解锁时原样返回。
// 用于 .sy 读盘后：密文 data → 明文 data。
func decryptData(boxID string, data []byte) ([]byte, error) {
	if DEKProvider == nil {
		return data, nil
	}
	dek, err := DEKProvider(boxID)
	if err != nil || dek == nil {
		return data, nil
	}
	return util.Decrypt(dek, data)
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
