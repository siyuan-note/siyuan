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
	"fmt"
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

// DEKLockAcquire / DEKLockRelease 由 model 层注入，在获取 DEK 前后持 box 读锁，
// 防止 LockBox 在加解密期间清除缓存。非加密 box 的注入为空时不影响行为。
var DEKLockAcquire func(boxID string)
var DEKLockRelease func(boxID string)

// SyObjectBase 从 box 内相对路径提取稳定文件基名并校验合法性。
// 接受形如 <rootID>.sy 的基名：扩展名必须是 .sy，且 stem 是合法节点 ID。
// 非法扩展名或非节点 ID 模式返回错误，避免把任意路径当 AAD 绑定物产生不可解密的数据。
// 由 filesys、model 历史查看/回滚、import 等所有 .sy 加解密路径共同使用，保证 AAD 一致。
func SyObjectBase(relativePath string) (string, error) {
	p := filepath.ToSlash(relativePath)
	p = strings.TrimPrefix(p, "/")
	base := p
	if idx := strings.LastIndex(p, "/"); idx >= 0 {
		base = p[idx+1:]
	}
	if !strings.HasSuffix(base, ".sy") {
		return "", fmt.Errorf("invalid .sy base name [%s]: must end with .sy", base)
	}
	stem := strings.TrimSuffix(base, ".sy")
	if !ast.IsNodeIDPattern(stem) {
		return "", fmt.Errorf("invalid .sy base name [%s]: stem is not a node ID", base)
	}
	return base, nil
}

// SyAAD 构造 .sy 密文的 AAD：siyuan:v1:file:<boxID>:<稳定文件基名>。
// 父目录不进 AAD——同 box 内文件名不变的移动允许原样 Rename 密文，内容/box/类型/对象 ID 仍受认证。
func SyAAD(boxID, relativePath string) (string, error) {
	base, err := SyObjectBase(relativePath)
	if err != nil {
		return "", err
	}
	return "siyuan:v1:file:" + boxID + ":" + base, nil
}

// encryptedBox 判断 boxID 是否为已解锁的加密 box，供 filesys 内部分流（如静默修正禁用）。
// 通过 DEKProvider 探测：返回非 nil dek 即加密且已解锁。
func encryptedBox(boxID string) bool {
	if DEKProvider == nil {
		return false
	}
	if DEKLockAcquire != nil {
		DEKLockAcquire(boxID)
		defer DEKLockRelease(boxID)
	}
	dek, err := DEKProvider(boxID)
	return err == nil && dek != nil
}

// encryptData 若 boxID 是已解锁的加密 box，用 fileKey（DEK 派生子密钥）加密 data，
// AAD 绑定 boxID + 稳定文件基名（不含父目录）；非加密笔记本原样返回；加密但未解锁时返回 error，拒绝写盘（防止明文泄漏）。
func encryptData(boxID, relativePath string, data []byte) ([]byte, error) {
	if DEKProvider == nil {
		return data, nil
	}
	if DEKLockAcquire != nil {
		DEKLockAcquire(boxID)
		defer DEKLockRelease(boxID)
	}
	dek, err := DEKProvider(boxID)
	if err != nil {
		return nil, err
	}
	if dek == nil {
		return data, nil // 非加密 box
	}
	fileKey := util.DeriveSubKey(dek, "siyuan/file")
	aad, err := SyAAD(boxID, relativePath)
	if err != nil {
		return nil, err
	}
	return util.EncryptWithAAD(fileKey, data, []byte(aad))
}

// decryptData 对应解密。非加密笔记本原样返回；加密但未解锁时返回 error，拒绝读盘。
func decryptData(boxID, relativePath string, data []byte) ([]byte, error) {
	if DEKProvider == nil {
		return data, nil
	}
	if DEKLockAcquire != nil {
		DEKLockAcquire(boxID)
		defer DEKLockRelease(boxID)
	}
	dek, err := DEKProvider(boxID)
	if err != nil {
		return nil, err
	}
	if dek == nil {
		return data, nil // 非加密 box
	}
	fileKey := util.DeriveSubKey(dek, "siyuan/file")
	aad, err := SyAAD(boxID, relativePath)
	if err != nil {
		return nil, err
	}
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
