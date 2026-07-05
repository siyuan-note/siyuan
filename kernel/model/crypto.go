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

package model

import (
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// kekVerifierMagic 是写入 KEKVerifier 的固定魔数。启用时用 KEK 加密它，校验主密码时解密比对。
var kekVerifierMagic = []byte("siyuan-enc-v1")

// cachedDEKs 缓存已解锁加密笔记本的 DEK，按 boxID 索引。
// KEK 不全局缓存（"严格每笔记本单独解锁"语义）：UnlockBox 临时派生 KEK 解出 DEK 后即丢弃 KEK，
// 仅保留 per-box DEK 供后续读写加解密。
var (
	cachedDEKs     = map[string][]byte{}
	cachedDEKsLock sync.RWMutex
)

// EnableEncryptedNotebook 启用加密笔记本功能：生成 MasterSalt、派生 KEK、写入校验值并持久化。
// 重复调用（已启用）返回错误，避免覆盖现有加密笔记本的密钥参数。
// KEK 不缓存——启用后用户需对每个加密笔记本单独调 UnlockBox 解锁。
func EnableEncryptedNotebook(password string) error {
	if len(password) == 0 {
		return errors.New("password must not be empty")
	}

	salt, err := util.GenerateSalt()
	if err != nil {
		return err
	}
	params := Conf.NotebookCrypto.KDFParams
	if params.KeyLength == 0 {
		params = util.DefaultArgon2Params()
	}
	kek := util.DeriveKey(password, salt, params)

	// 用 KEK 加密固定魔数作为校验值，落盘后供后续 UnlockBox 离线校验
	verifierCT, err := util.Encrypt(kek, kekVerifierMagic)
	if err != nil {
		return err
	}

	Conf.m.Lock()
	if Conf.NotebookCrypto.Enabled {
		Conf.m.Unlock()
		return errors.New(Conf.Language(312))
	}
	Conf.NotebookCrypto.Enabled = true
	Conf.NotebookCrypto.MasterSalt = salt
	Conf.NotebookCrypto.KDFParams = params
	Conf.NotebookCrypto.KEKVerifier = verifierCT
	Conf.NotebookCrypto.VerifierNonce = verifierCT[:12]
	Conf.m.Unlock()

	// Conf.Save 内部会加 Conf.m，不能在持锁状态下调用（RWMutex 不可重入）
	Conf.Save()
	return nil
}

// deriveKEK 从主密码派生 KEK 并校验。校验失败返回错误。KEK 仅在函数作用域内有效，调用方负责使用。
func deriveKEK(password string) ([]byte, error) {
	Conf.m.RLock()
	nc := Conf.NotebookCrypto
	Conf.m.RUnlock()

	if !nc.Enabled {
		return nil, errors.New(Conf.Language(310))
	}
	params := nc.KDFParams
	if params.KeyLength == 0 {
		params = util.DefaultArgon2Params()
	}
	kek := util.DeriveKey(password, nc.MasterSalt, params)

	decrypted, err := util.Decrypt(kek, nc.KEKVerifier)
	if err != nil {
		return nil, errors.New(Conf.Language(311))
	}
	if string(decrypted) != string(kekVerifierMagic) {
		return nil, errors.New(Conf.Language(311))
	}
	return kek, nil
}

// UnlockBox 用主密码派生 KEK，解出该笔记本的 DEK 并缓存。KEK 用完即弃，不全局缓存。
// 每次调用都跑一次 Argon2id（约 1 秒），严格满足"每笔记本单独解锁"语义。
func UnlockBox(boxID string, password string, boxEnc *conf.BoxEncryption) error {
	if boxEnc == nil || len(boxEnc.WrappedDEK) == 0 {
		return errors.New("no encrypted key material for box")
	}
	kek, err := deriveKEK(password)
	if err != nil {
		return err
	}
	dek, err := util.Decrypt(kek, boxEnc.WrappedDEK)
	if err != nil {
		return err
	}
	// 持锁保护"开 db + 缓存 DEK"的原子性，避免与并发的 LockBox 导致 db/DEK 不一致
	cachedDEKsLock.Lock()
	defer cachedDEKsLock.Unlock()
	if err = sql.OpenEncryptedDB(boxID, dek); err != nil {
		return err
	}
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		sql.CloseEncryptedDB(boxID)
		return err
	}
	cachedDEKs[boxID] = dek
	return nil
}

// IsBoxUnlocked 返回该笔记本的 DEK 是否在内存（是否已解锁）。
func IsBoxUnlocked(boxID string) bool {
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	_, ok := cachedDEKs[boxID]
	return ok
}

// LockBox 清除指定笔记本的 DEK 并关闭其加密 db。Unmount 单个加密笔记本或手动锁定时调用。
// 同时清空所有明文缓存（树/Block/IAL/AV），避免明文在内存中残留。
func LockBox(boxID string) {
	cachedDEKsLock.Lock()
	if dek, ok := cachedDEKs[boxID]; ok {
		zeroAndClear(dek)
		delete(cachedDEKs, boxID)
	}
	cachedDEKsLock.Unlock()
	sql.CloseEncryptedDB(boxID)
	treenode.CloseEncryptedBlockTreeDB(boxID)
	// 清空明文缓存：锁定后任何加密 box 的明文都不应残留内存
	cache.ClearTreeCache()
	sql.ClearCache()
	cache.ClearDocsIAL()
	cache.ClearBlocksIAL()
	cache.ClearAVCache()
}

// LockAllBoxes 清除所有已缓存的 DEK 并关闭所有加密 db。退出登录或全局锁定时调用。
func LockAllBoxes() {
	cachedDEKsLock.Lock()
	for id, dek := range cachedDEKs {
		zeroAndClear(dek)
		delete(cachedDEKs, id)
	}
	cachedDEKsLock.Unlock()
	// 关闭所有已打开的加密 db 连接，清空明文缓存避免残留
	sql.CloseAllEncryptedDBs()
	treenode.CloseAllEncryptedBlockTreeDBs()
	cache.ClearTreeCache()
	sql.ClearCache()
	cache.ClearDocsIAL()
	cache.ClearBlocksIAL()
	cache.ClearAVCache()
}

// WrapNewDEK 用给定 KEK 生成随机 DEK 并包络，返回 BoxEncryption 元数据。
// KEK 由调用方临时派生（不来自全局缓存），调用方负责使用后丢弃。
// 同时返回原始 DEK，供调用方在创建场景下直接开 db 缓存，省去再次 Argon2id 派生。
func WrapNewDEK(kek []byte) (*conf.BoxEncryption, []byte, error) {
	dek, err := util.GenerateDEK()
	if err != nil {
		return nil, nil, err
	}
	wrapped, err := util.Encrypt(kek, dek)
	if err != nil {
		return nil, nil, err
	}
	return &conf.BoxEncryption{
		WrappedDEK: wrapped,
		WrapNonce:  wrapped[:12],
		CreatedAt:  time.Now().UnixMilli(),
	}, dek, nil
}

// UnwrapDEK 从 BoxEncryption 解出 DEK 并缓存到内存，供后续 GetDEK 使用。
// 仅在 KEK 已通过 UnlockBox 缓存 DEK 的场景之外使用（如改密流程内部）。
func UnwrapDEK(boxID string, enc *conf.BoxEncryption, kek []byte) error {
	if enc == nil || len(enc.WrappedDEK) == 0 {
		return errors.New("no encrypted key material for box")
	}
	dek, err := util.Decrypt(kek, enc.WrappedDEK)
	if err != nil {
		return err
	}
	cachedDEKsLock.Lock()
	cachedDEKs[boxID] = dek
	cachedDEKsLock.Unlock()
	return nil
}

// GetDEK 取已缓存的 DEK。filesys/assets/db 加解密时调用。
func GetDEK(boxID string) ([]byte, error) {
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	dek, ok := cachedDEKs[boxID]
	if !ok {
		return nil, errors.New("no DEK cached for box " + boxID)
	}
	return dek, nil
}

// ClearDEK 清除指定笔记本的 DEK。Unmount 单个加密笔记本时调用。
func ClearDEK(boxID string) {
	LockBox(boxID)
}

// ChangeMasterPassword 改主密码：用旧密码校验后，用新密码派生新 KEK，
// 重新加密 verifier，并把所有加密笔记本的 WrappedDEK 用新 KEK 重新包络后写回各自的 BoxConf。
//
// 注意：必须在所有加密笔记本都已 Unmount 的状态下调用（DEK 不在内存），否则新旧 KEK 切换会让缓存与磁盘不一致。
func ChangeMasterPassword(oldPassword, newPassword string) error {
	if len(newPassword) == 0 {
		return errors.New("new password must not be empty")
	}

	// 改密期间不能有已 Mount 的加密笔记本（DEK 在内存），否则新旧 KEK 切换会让缓存与磁盘不一致
	cachedDEKsLock.RLock()
	dekCount := len(cachedDEKs)
	cachedDEKsLock.RUnlock()
	if dekCount > 0 {
		return errors.New("cannot change master password while encrypted notebooks are unlocked (DEKs in memory), lock them first")
	}

	oldKEK, err := deriveKEK(oldPassword)
	if err != nil {
		return err
	}

	Conf.m.Lock()
	nc := Conf.NotebookCrypto
	Conf.m.Unlock()

	newKEK := util.DeriveKey(newPassword, nc.MasterSalt, nc.KDFParams)
	newVerifier, err := util.Encrypt(newKEK, kekVerifierMagic)
	if err != nil {
		return err
	}

	// 遍历所有笔记本，找到加密笔记本并用新 KEK 重新 wrap 其 WrappedDEK
	boxes, err := ListNotebooks()
	if err != nil {
		return err
	}
	for _, b := range boxes {
		boxConf := b.GetConf()
		if boxConf == nil || !boxConf.Encrypted || boxConf.BoxCrypt == nil {
			continue
		}
		dek, err := util.Decrypt(oldKEK, boxConf.BoxCrypt.WrappedDEK)
		if err != nil {
			return errors.New("failed to unwrap DEK for box " + b.ID + " during password change: " + err.Error())
		}
		newWrapped, err := util.Encrypt(newKEK, dek)
		if err != nil {
			return err
		}
		boxConf.BoxCrypt.WrappedDEK = newWrapped
		boxConf.BoxCrypt.WrapNonce = newWrapped[:12]
		b.SaveConf(boxConf)
	}

	Conf.m.Lock()
	Conf.NotebookCrypto.KEKVerifier = newVerifier
	Conf.NotebookCrypto.VerifierNonce = newVerifier[:12]
	Conf.m.Unlock()

	// Conf.Save 内部会加 Conf.m，不能在持锁状态下调用（RWMutex 不可重入）
	Conf.Save()
	return nil
}

// IsEncryptedBox 判断给定 boxID 是否为加密笔记本。
func IsEncryptedBox(boxID string) bool {
	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	return boxConf != nil && boxConf.Encrypted
}

// IsBlockRefCrossingBoundary 判断从 srcBoxID 引用 defBlockID 是否跨越加密边界。
// 加密笔记本禁止跨边界块引（双向）：加密 box 的块只能引用同一加密 box 内的块，普通 box 的块不能引用加密 box 的块。
// 供 transaction 落库时兜底校验，防止手工输入/拖拽/粘贴/API 直调绕过前端搜索分流。
func IsBlockRefCrossingBoundary(srcBoxID, defBlockID string) bool {
	if "" == defBlockID {
		return false
	}
	if IsEncryptedBox(srcBoxID) {
		// 源在加密 box：def 块必须在同一加密 box（查加密 blocktree db）
		bt := treenode.GetBlockTreeInBox(defBlockID, srcBoxID)
		return nil == bt || bt.BoxID != srcBoxID
	}
	// 源在普通 box：def 块必须在普通 box（查全局 blocktree，且其 box 非加密）
	bt := treenode.GetBlockTree(defBlockID)
	if nil == bt {
		return false // def 块不存在（可能是新建块的临时态），不拦
	}
	return IsEncryptedBox(bt.BoxID)
}

// IsEncryptedAssetPath 判断给定 asset 绝对路径是否属于加密笔记本。
// 供 server 层在缩略图等场景判断是否需跳过密文文件的处理。
func IsEncryptedAssetPath(absPath string) bool {
	boxID := ExtractBoxIDFromAssetsPath(absPath)
	return boxID != "" && IsEncryptedBox(boxID)
}

// GetDEKIfUnlocked 返回已解锁加密 box 的 DEK；非加密 box 或未解锁时返回 (nil, nil)。
// 供 filesys.DEKProvider 注入用——对非加密 box 透明返回 nil，使 filesys 的加解密函数走"原样返回"分支。
func GetDEKIfUnlocked(boxID string) ([]byte, error) {
	if !IsEncryptedBox(boxID) {
		return nil, nil
	}
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	dek, ok := cachedDEKs[boxID]
	if !ok {
		return nil, nil // 已加密但未解锁
	}
	return dek, nil
}

// extractBoxIDFromPath 从 data 目录下的绝对路径反推 boxID。
// 路径形如 <DataDir>/<boxID>/...，切出紧跟在 DataDir 后的一段。
// 若路径不在 DataDir 下或格式不符，返回空字符串。
func extractBoxIDFromPath(absPath string) string {
	return ExtractBoxIDFromAssetsPath(absPath)
}

// ExtractBoxIDFromAssetsPath 从 data 目录下的绝对路径（.sy 或 assets）反推 boxID。
// 供 server/api 层判断 asset 是否属于加密笔记本。路径形如 <DataDir>/<boxID>/...；
// 若不在 DataDir 下或 boxID 非合法 ID 模式，返回空串。
func ExtractBoxIDFromAssetsPath(absPath string) string {
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

// copyAssetDecryptIfEncrypted 把 srcPath 的 asset 复制到 destPath。
// 若 srcPath 在已解锁的加密 box 下，读密文→解密→写明文到 destPath（导出目录）；
// 否则走 filelock.Copy 原路径（字节级复制，密文/明文均可）。
func copyAssetDecryptIfEncrypted(srcPath, destPath string) error {
	boxID := ExtractBoxIDFromAssetsPath(srcPath)
	if boxID != "" {
		if dek, err := GetDEK(boxID); err == nil && dek != nil {
			raw, readErr := filelock.ReadFile(srcPath)
			if readErr != nil {
				return readErr
			}
			plain, decErr := util.Decrypt(dek, raw)
			if decErr != nil {
				return decErr
			}
			if err := filelock.WriteFile(destPath, plain); err != nil {
				return err
			}
			return nil
		}
	}
	return filelock.Copy(srcPath, destPath)
}

// CreateEncryptedBox 创建一个新的加密笔记本。可多次调用创建多个。
// 前置：加密功能已启用。创建时需要主密码（临时派生 KEK 用于 wrap DEK，用完即弃）。
// 创建后直接用生成的 DEK 打开加密 db 并缓存（已解锁状态），调用方随后调 openNotebook 即可挂载。
func CreateEncryptedBox(name, password string) (id string, err error) {
	Conf.m.RLock()
	enabled := Conf.NotebookCrypto.Enabled
	Conf.m.RUnlock()
	if !enabled {
		return "", errors.New(Conf.Language(310))
	}

	kek, err := deriveKEK(password)
	if err != nil {
		return "", err
	}

	enc, dek, err := WrapNewDEK(kek)
	if err != nil {
		return "", err
	}

	id, err = CreateBox(name)
	if err != nil {
		return "", err
	}

	box := &Box{ID: id}
	boxConf := box.GetConf()
	boxConf.Encrypted = true
	boxConf.BoxCrypt = enc
	box.SaveConf(boxConf)

	// 复用刚派生的 DEK 直接开 db + 缓存，省去再次 Argon2id 解锁
	cachedDEKsLock.Lock()
	defer cachedDEKsLock.Unlock()
	if err = sql.OpenEncryptedDB(id, dek); err != nil {
		return "", err
	}
	if err = treenode.OpenEncryptedBlockTreeDB(id, dek); err != nil {
		sql.CloseEncryptedDB(id)
		return "", err
	}
	cachedDEKs[id] = dek

	IncSync()
	return id, nil
}

// zeroAndClear 把密钥字节清零后再置空，尽量减少密钥在内存中的残留时间。
func zeroAndClear(key []byte) {
	for i := range key {
		key[i] = 0
	}
}
