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
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// kekVerifierMagic 是写入 KEKVerifier 的固定魔数。启用时用 KEK 加密它，校验主密码时解密比对。
var kekVerifierMagic = []byte("siyuan-enc-v1")

// ErrWrappedDEKCorrupted 表示 WrappedDEK 解密失败（密钥不匹配或数据损坏）。
// 底层 crypto 函数返回此错误，API 层需要展示用户文案时转换成 Conf.Language(316)。
var ErrWrappedDEKCorrupted = errors.New("wrapped DEK corrupted or key mismatch")

// notebookCryptoBackupPath 是 NotebookCrypto 的备份路径，位于 DataDir/.siyuan/ 下（进入 dejavu 同步范围）。
// MasterSalt 是加密体系的全局根基：conf/conf.json 丢失后若重新启用会生成新 salt，
// 导致旧 WrappedDEK 无法用相同主密码解开（KEK 随 salt 改变）。把整套 NotebookCrypto 备份到
// 同步目录，conf.json 丢失时通过同步恢复或本地备份即可重新解锁已有加密笔记本。
// MasterSalt/KEKVerifier 设计为可明文（salt 不保密，verifier 是密文），备份文件按明文 JSON 存储。
func notebookCryptoBackupPath() string {
	return filepath.Join(util.DataDir, ".siyuan", "notebook-crypto-backup.json")
}

// ExportNotebookCryptoBackup 把密钥备份文件复制到 export 目录，返回可下载的相对路径。
// 供用户主动导出保存，作为同步之外的独立恢复途径（详见设计文档 §4.1）。
// 备份文件本身不含主密码（salt 不保密、verifier 是密文），拿到它也解不开任何数据。
func ExportNotebookCryptoBackup() (downloadPath string, err error) {
	backupPath := notebookCryptoBackupPath()
	data, readErr := filelock.ReadFile(backupPath)
	if readErr != nil {
		if os.IsNotExist(readErr) {
			err = errors.New(Conf.Language(315))
			return
		}
		err = readErr
		return
	}
	exportBase := filepath.Join(util.TempDir, "export")
	if mkErr := os.MkdirAll(exportBase, 0755); mkErr != nil {
		err = mkErr
		return
	}
	// 用随机名避免不同用户/设备互相覆盖，文件名固定带易识别前缀
	fileName := "notebook-crypto-backup-" + gulu.Rand.String(7) + ".json"
	downloadPath = "/export/" + url.PathEscape(fileName)
	if writeErr := os.WriteFile(filepath.Join(exportBase, fileName), data, 0644); writeErr != nil {
		err = writeErr
		return
	}
	return
}

// ImportNotebookCryptoBackup 接收用户导入的密钥备份文件内容（JSON 字节），
// 校验为合法 NotebookCrypto 后写回 <DataDir>/.siyuan/notebook-crypto-backup.json 并装回本机 Conf。
// 用于新设备/重装后不依赖同步、手动恢复加密配置（详见设计文档 §4.1）。
// 安全：备份文件不含主密码（salt 不保密、verifier 是密文），导入只恢复配置，解锁仍需主密码。
// 防呆：本机已启用加密笔记本时拒绝导入，避免覆盖现有 salt/verifier 孤立现有 WrappedDEK。
// ImportNotebookCryptoBackup 接收用户导入的密钥备份文件内容（JSON 字节）+ 主密码，
// 校验主密码能解开备份里的 verifier 后才写回配置。防止 crafted 备份设置弱 KDFParams 等攻击。
func ImportNotebookCryptoBackup(data []byte, password string) error {
	nc := &conf.NotebookCrypto{}
	if err := json.Unmarshal(data, nc); err != nil {
		return errors.New(Conf.Language(317))
	}
	if len(nc.MasterSalt) == 0 || len(nc.KEKVerifier) == 0 {
		return errors.New(Conf.Language(317))
	}

	Conf.m.RLock()
	enabled := Conf.NotebookCrypto.Enabled
	Conf.m.RUnlock()
	if enabled {
		// 本机已启用：覆盖会改变 salt，孤立现有 WrappedDEK（数据永久锁死）
		return errors.New(Conf.Language(312))
	}

	// 用导入的 salt + 用户输入的主密码派生 KEK，校验能否解开备份里的 verifier
	params, validErr := util.ValidateArgon2Params(nc.KDFParams)
	if validErr != nil {
		return errors.New(Conf.Language(317))
	}
	kek := util.DeriveKey(password, nc.MasterSalt, params)
	decrypted, dErr := util.Decrypt(kek, nc.KEKVerifier)
	if dErr != nil || string(decrypted) != string(kekVerifierMagic) {
		return errors.New(Conf.Language(311)) // 主密码错误
	}

	nc.KDFParams = params // 归一化：确保写回 Conf 的是校验后的参数（含默认值回退）
	nc.Enabled = true
	Conf.m.Lock()
	*Conf.NotebookCrypto = *nc
	Conf.m.Unlock()
	Conf.Save()

	// 同步写回备份文件（导入的备份即新的本地备份）
	if err := os.MkdirAll(filepath.Dir(notebookCryptoBackupPath()), 0755); err != nil {
		logging.LogErrorf("mkdir notebook crypto backup dir failed: %s", err)
		return nil
	}
	if err := filelock.WriteFile(notebookCryptoBackupPath(), data); err != nil {
		logging.LogErrorf("write notebook crypto backup failed: %s", err)
	}
	return nil
}

// saveNotebookCryptoBackup 把当前 NotebookCrypto（含 MasterSalt/KEKVerifier/KDFParams）备份到 DataDir。
func saveNotebookCryptoBackup() {
	Conf.m.RLock()
	nc := *Conf.NotebookCrypto // 值拷贝，避免持锁写文件
	Conf.m.RUnlock()
	data, err := json.Marshal(nc)
	if err != nil {
		logging.LogErrorf("marshal notebook crypto backup failed: %s", err)
		return
	}
	backupPath := notebookCryptoBackupPath()
	if err := os.MkdirAll(filepath.Dir(backupPath), 0755); err != nil {
		logging.LogErrorf("mkdir notebook crypto backup dir failed: %s", err)
		return
	}
	if err := filelock.WriteFile(backupPath, data); err != nil {
		logging.LogErrorf("write notebook crypto backup failed: %s", err)
	}
}

// loadNotebookCryptoBackup 从 DataDir 读取 NotebookCrypto 备份。文件不存在返回 (nil, nil)。
func loadNotebookCryptoBackup() (*conf.NotebookCrypto, error) {
	data, err := filelock.ReadFile(notebookCryptoBackupPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	nc := &conf.NotebookCrypto{}
	if err := json.Unmarshal(data, nc); err != nil {
		return nil, err
	}
	return nc, nil
}

// removeNotebookCryptoBackup 删除备份文件（禁用加密功能时调用）。文件不存在视为成功。
func removeNotebookCryptoBackup() {
	if err := os.Remove(notebookCryptoBackupPath()); err != nil && !os.IsNotExist(err) {
		logging.LogErrorf("remove notebook crypto backup failed: %s", err)
	}
}

// hasEncryptedNotebook 检查是否已存在加密笔记本（即便功能未启用/已禁用，只要磁盘上有 Encrypted=true 的 box）。
// EnableEncryptedNotebook 的防呆守卫用：存在加密笔记本时禁止重新生成 MasterSalt（会孤立旧 WrappedDEK）。
func hasEncryptedNotebook() bool {
	boxes, err := ListNotebooks()
	if err != nil {
		return false
	}
	for _, box := range boxes {
		if box.Encrypted {
			return true
		}
	}
	return false
}

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

	Conf.m.Lock()
	if Conf.NotebookCrypto.Enabled {
		Conf.m.Unlock()
		return errors.New(Conf.Language(312))
	}
	Conf.m.Unlock()

	// 防呆：若已存在加密笔记本（磁盘上有 Encrypted=true 的 box），不能重新生成 MasterSalt。
	// conf.json 丢失后重新启用会派生新 KEK，导致旧 WrappedDEK 用相同主密码也无法解开（数据永久锁死）。
	// 此时必须从 DataDir 备份恢复原 MasterSalt/KEKVerifier，并用主密码校验通过后才算恢复成功。
	if hasEncryptedNotebook() {
		if _, restoreErr := tryRestoreNotebookCryptoFromBackup(password); restoreErr != nil {
			// 恢复失败：主密码错（恢复函数返回 311 文案）保持原提示；其余（备份缺失/损坏）提示需恢复备份
			if strings.Contains(restoreErr.Error(), Conf.Language(311)) {
				return errors.New(Conf.Language(311)) // 主密码错误
			}
			return errors.New(Conf.Language(315))
		}
		logging.LogInfof("encrypted notebook re-enabled with restored master key material from backup")
		return nil
	}

	// 不存在加密笔记本：正常生成新 MasterSalt
	salt, err := util.GenerateSalt()
	if err != nil {
		return err
	}
	params, validErr := util.ValidateArgon2Params(Conf.NotebookCrypto.KDFParams)
	if validErr != nil {
		return validErr
	}
	kek := util.DeriveKey(password, salt, params)

	// 用 KEK 加密固定魔数作为校验值，落盘后供后续 UnlockBox 离线校验
	verifierCT, err := util.Encrypt(kek, kekVerifierMagic)
	if err != nil {
		return err
	}

	Conf.m.Lock()
	Conf.NotebookCrypto.Enabled = true
	Conf.NotebookCrypto.MasterSalt = salt
	Conf.NotebookCrypto.KDFParams = params
	Conf.NotebookCrypto.KEKVerifier = verifierCT
	Conf.NotebookCrypto.VerifierNonce = verifierCT[:12]
	Conf.m.Unlock()

	// Conf.Save 内部会加 Conf.m，不能在持锁状态下调用（RWMutex 不可重入）
	Conf.Save()
	saveNotebookCryptoBackup() // 备份到 DataDir（进入同步范围），conf.json 丢失时可用于恢复
	return nil
}

// DisableEncryptedNotebook 关闭加密笔记本功能。前置：不能有加密笔记本存在。
// 清除全局加密配置（MasterSalt/KEKVerifier），KEK/DEK 不再可用。
func DisableEncryptedNotebook() error {
	// 检查是否还有加密笔记本
	boxes, err := ListNotebooks()
	if err != nil {
		return err
	}
	for _, box := range boxes {
		boxConf := box.GetConf()
		if boxConf != nil && boxConf.Encrypted {
			return errors.New("cannot disable encrypted notebook feature while encrypted notebooks exist, remove them first")
		}
	}

	Conf.m.Lock()
	Conf.NotebookCrypto.Enabled = false
	Conf.NotebookCrypto.MasterSalt = nil
	Conf.NotebookCrypto.KEKVerifier = nil
	Conf.NotebookCrypto.VerifierNonce = nil
	Conf.m.Unlock()

	Conf.Save()
	removeNotebookCryptoBackup() // 禁用时清理备份，避免残留旧密钥材料
	return nil
}

// restoreNotebookCryptoConfigFromBackup 把备份里的 NotebookCrypto 配置装回本机 conf.json（不需主密码）。
// 用于数据同步/导入 Data.zip 后：备份文件随 DataDir 到达新设备，但本机 conf.json 的 NotebookCrypto 还是空的。
// 此时把 salt/verifier/KDFParams 装回并置 Enabled=true，让 UI 显示"已启用"，笔记本显示为锁定（解锁仍需主密码）。
// 前置：仅在本机 Enabled=false 时调用，避免覆盖正在使用的本机配置。
// 安全：salt 不保密、verifier 是密文，装回配置本身不暴露任何明文数据（解锁仍需主密码派生 KEK）。
func restoreNotebookCryptoConfigFromBackup() {
	Conf.m.RLock()
	enabled := Conf.NotebookCrypto.Enabled
	Conf.m.RUnlock()
	if enabled {
		return // 本机已启用，不覆盖
	}
	backup, err := loadNotebookCryptoBackup()
	if err != nil || backup == nil || len(backup.MasterSalt) == 0 || len(backup.KEKVerifier) == 0 {
		return // 无可用备份，静默跳过
	}
	// 校验 KDFParams：非法参数（如恶意备份设置极大内存）时拒绝恢复，避免卡到"已启用但无法解锁"状态
	params, validErr := util.ValidateArgon2Params(backup.KDFParams)
	if validErr != nil {
		logging.LogErrorf("skip restore notebook crypto: invalid KDFParams in backup: %s", validErr)
		return
	}
	backup.KDFParams = params
	backup.Enabled = true
	Conf.m.Lock()
	*Conf.NotebookCrypto = *backup
	Conf.m.Unlock()
	Conf.Save()
	logging.LogInfof("notebook crypto config restored from backup (auto-enable after sync/import)")
}

// tryRestoreNotebookCryptoFromBackup 在本机 NotebookCrypto 未启用时，尝试从 DataDir 备份恢复。
// 数据同步到新设备后，本机 conf.json 的 NotebookCrypto 是空的（Enabled=false），但备份文件已随
// DataDir 同步过来。此时用户点加密笔记本输主密码，deriveKEK 会调本函数用主密码校验备份里的
// verifier，校验通过则装回 salt/verifier 并置 Enabled=true，让旧 WrappedDEK 可正常解开。
// 校验通过时同时返回已派生的 KEK（恢复用的 salt 与装回的 salt 相同，避免 deriveKEK 重复跑 Argon2id）。
// 返回错误表示恢复失败（备份缺失/主密码错），此时 KEK 为 nil。
func tryRestoreNotebookCryptoFromBackup(password string) (kek []byte, err error) {
	backup, bErr := loadNotebookCryptoBackup()
	if bErr != nil || backup == nil || len(backup.MasterSalt) == 0 || len(backup.KEKVerifier) == 0 {
		// 备份不存在或不完整：无法恢复，调用方按"未启用"报错
		return nil, errors.New(Conf.Language(310))
	}
	params, validErr := util.ValidateArgon2Params(backup.KDFParams)
	if validErr != nil {
		return nil, errors.New(Conf.Language(317))
	}
	kek = util.DeriveKey(password, backup.MasterSalt, params)
	decrypted, dErr := util.Decrypt(kek, backup.KEKVerifier)
	if dErr != nil || string(decrypted) != string(kekVerifierMagic) {
		// 主密码错误（或备份损坏），不能恢复
		return nil, errors.New(Conf.Language(311))
	}
	backup.KDFParams = params // 归一化：确保写回 Conf 的是校验后的参数（含默认值回退）
	backup.Enabled = true
	Conf.m.Lock()
	*Conf.NotebookCrypto = *backup
	Conf.m.Unlock()
	Conf.Save()
	logging.LogInfof("notebook crypto restored from backup (e.g. after sync to a new device)")
	return kek, nil
}

// deriveKEK 从主密码派生 KEK 并校验。校验失败返回错误。KEK 仅在函数作用域内有效，调用方负责使用。
func deriveKEK(password string) ([]byte, error) {
	Conf.m.RLock()
	nc := Conf.NotebookCrypto
	Conf.m.RUnlock()

	if !nc.Enabled {
		// 本机未启用：可能是数据同步到新设备后本机 conf.json 还没有加密配置。
		// 尝试从 DataDir 备份恢复（备份会随 DataDir 同步过来）；恢复成功时直接复用其派生的 KEK。
		kek, restoreErr := tryRestoreNotebookCryptoFromBackup(password)
		if restoreErr != nil {
			return nil, restoreErr
		}
		return kek, nil // 恢复函数已校验过 verifier，KEK 直接可用
	}
	params, validErr := util.ValidateArgon2Params(nc.KDFParams)
	if validErr != nil {
		return nil, validErr
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
		// 密码已通过 deriveKEK 的 verifier 校验，此处失败说明 WrappedDEK 数据损坏
		return errors.New(Conf.Language(316))
	}
	// 持锁保护"开 db + 缓存 DEK"的原子性，避免与并发的 LockBox 导致 db/DEK 不一致
	cachedDEKsLock.Lock()
	defer cachedDEKsLock.Unlock()
	if err = sql.OpenEncryptedDB(boxID, dek); err != nil {
		return err
	}
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		sql.RemoveEncryptedDBFile(boxID) // 清理已创建的 content db 文件，避免遗留空加密库
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

// LockBox 清除指定笔记本的 DEK 并删除其加密 db 文件。Unmount 单个加密笔记本或手动锁定时调用。
// 同时清空所有明文缓存（树/Block/IAL/AV），避免明文在内存中残留。
// 关闭即删 db 文件：加密索引可由 box.Index() 全量重建，文件无需持久化；
// 同时避免关闭后残留旧索引数据导致下次解锁叠加重复行。
func LockBox(boxID string) {
	cachedDEKsLock.Lock()
	if dek, ok := cachedDEKs[boxID]; ok {
		zeroAndClear(dek)
		delete(cachedDEKs, boxID)
	}
	cachedDEKsLock.Unlock()
	sql.RemoveEncryptedDBFile(boxID)
	treenode.RemoveEncryptedBlockTreeDBFile(boxID)
	// 清空明文缓存：锁定后任何加密笔记本的明文都不应残留内存
	cache.ClearTreeCache()
	sql.ClearCache()
	cache.ClearDocsIAL()
	cache.ClearBlocksIAL()
	cache.ClearAVCache()
}

// LockAllBoxes 清除所有已缓存的 DEK 并删除所有加密 db 文件。退出登录或全局锁定时调用。
// 与 LockBox 一致采用"关闭即删 db 文件"策略，避免残留旧索引数据。
func LockAllBoxes() {
	cachedDEKsLock.Lock()
	for id, dek := range cachedDEKs {
		zeroAndClear(dek)
		delete(cachedDEKs, id)
	}
	cachedDEKsLock.Unlock()
	// 删除所有已打开的加密 db 文件（关闭连接 + 删文件），清空明文缓存避免残留
	sql.RemoveAllEncryptedDBFiles()
	treenode.RemoveAllEncryptedBlockTreeDBFiles()
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
		return ErrWrappedDEKCorrupted
	}
	cachedDEKsLock.Lock()
	cachedDEKs[boxID] = dek
	cachedDEKsLock.Unlock()
	return nil
}

// GetDEK 取已缓存的 DEK。返回副本，避免外部零化影响缓存。
// filesys/assets/db 加解密时调用。
func GetDEK(boxID string) ([]byte, error) {
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	dek, ok := cachedDEKs[boxID]
	if !ok {
		return nil, errors.New("no DEK cached for box " + boxID)
	}
	ret := make([]byte, len(dek))
	copy(ret, dek)
	return ret, nil
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

	params, validErr := util.ValidateArgon2Params(nc.KDFParams)
	if validErr != nil {
		return validErr
	}
	newKEK := util.DeriveKey(newPassword, nc.MasterSalt, params)
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
			return errors.New(Conf.Language(316) + " [box=" + b.ID + "]")
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
	Conf.NotebookCrypto.KDFParams = params // 归一化：确保存的是校验后的参数
	Conf.m.Unlock()

	// Conf.Save 内部会加 Conf.m，不能在持锁状态下调用（RWMutex 不可重入）
	Conf.Save()
	saveNotebookCryptoBackup() // verifier 已变，刷新备份
	return nil
}

// IsEncryptedBox 判断给定 boxID 是否为加密笔记本。
func IsEncryptedBox(boxID string) bool {
	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	return boxConf != nil && boxConf.Encrypted
}

// IsSameCryptoBoundary 判断 srcBox 与 dstBox 是否处于同一加密边界（跨 box 操作是否安全）。
// 普通笔记本之间允许（都不加密）；加密笔记本仅允许同一 box 内部操作——两个不同的加密笔记本各有独立 DEK，
// 之间互为"加密边界外"，跨 box 移动/合并会用错 DEK 导致密文损坏。供 MoveDocs/Doc2Heading 等跨 box 操作校验。
func IsSameCryptoBoundary(srcBox, dstBox string) bool {
	srcEnc := IsEncryptedBox(srcBox)
	dstEnc := IsEncryptedBox(dstBox)
	if !srcEnc && !dstEnc {
		return true // 普通↔普通：允许
	}
	return srcEnc && dstEnc && srcBox == dstBox // 加密：仅同一 box 内允许
}

// IsBlockRefCrossingBoundary 判断从 srcBoxID 引用 defBlockID 是否跨越加密边界。
// 加密笔记本禁止跨边界块引（双向）：加密笔记本的块只能引用同一加密笔记本内的块，普通 box 的块不能引用加密笔记本的块。
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
		// 全局查不到时遍历加密笔记本查找，防止对向漏判（普通 box 引用加密笔记本块）
		for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
			if encBT := treenode.GetBlockTreeInBox(defBlockID, encBoxID); nil != encBT {
				bt = encBT
				break
			}
		}
	}
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

// GetDEKIfUnlocked 返回已解锁加密笔记本的 DEK（副本）。
// 非加密笔记本返回 (nil, nil)——filesys 据此原样读写，对普通笔记本透明。
// 加密但未解锁（DEK 不在内存）返回 (nil, error)——filesys 的加解密函数遇 error 后拒绝读写，
// 避免加密笔记本在未解锁状态下静默以明文落盘（深度防御，见 issue #18034）。
func GetDEKIfUnlocked(boxID string) ([]byte, error) {
	if !IsEncryptedBox(boxID) {
		return nil, nil
	}
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	dek, ok := cachedDEKs[boxID]
	if !ok {
		return nil, errors.New("encrypted notebook is locked, please unlock it first")
	}
	ret := make([]byte, len(dek))
	copy(ret, dek)
	return ret, nil
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

// ExtractBoxIDFromHistoryPath 从历史目录下的绝对路径反推 boxID。
// 路径形如 <HistoryDir>/<timestamp>-<op>/<boxID>/...，切出紧跟在时间戳目录后的一段。
// 若路径不在 HistoryDir 下或 boxID 非合法 ID 模式，返回空串。
func ExtractBoxIDFromHistoryPath(absPath string) string {
	absPath = filepath.ToSlash(absPath)
	historyDir := filepath.ToSlash(util.HistoryDir)
	rel, err := filepath.Rel(historyDir, absPath)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	if strings.HasPrefix(rel, "..") || rel == "." || rel == "" {
		return ""
	}
	parts := strings.SplitN(rel, "/", 3)
	if len(parts) < 2 {
		return ""
	}
	// parts[0] = timestamp-op, parts[1] = boxID
	boxID := parts[1]
	if !ast.IsNodeIDPattern(boxID) {
		return ""
	}
	return boxID
}

// copyAssetDecryptIfEncrypted 把 srcPath 的 asset 复制到 destPath。
// 若 srcPath 在已解锁的加密笔记本下，读密文→解密→写明文到 destPath（导出目录）；
// 否则走 filelock.Copy 原路径（字节级复制，密文/明文均可）。
// EncryptFile 用 fileKey（DEK 派生子密钥）加密 .sy 文档字节，AAD 绑定 boxID。
// 与 filesys.encryptData/decryptData 使用相同的 AAD（boxID 级），保证读写一致。
func EncryptFile(boxID string, dek, plaintext []byte) ([]byte, error) {
	fileKey := util.DeriveSubKey(dek, "siyuan/file")
	return util.EncryptWithAAD(fileKey, plaintext, []byte(boxID))
}

// DecryptFile 对应解密。
func DecryptFile(boxID string, dek, ciphertext []byte) ([]byte, error) {
	fileKey := util.DeriveSubKey(dek, "siyuan/file")
	return util.DecryptWithAAD(fileKey, ciphertext, []byte(boxID))
}

// EncryptAsset 用 assetKey（DEK 派生子密钥）加密 asset 字节，AAD 绑定 boxID。
// 供 assets/.names.json/.sya 等资源类数据统一加密，与 .sy（fileKey）和 AV（avKey）用途分离。
func EncryptAsset(boxID string, dek, plaintext []byte) ([]byte, error) {
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	return util.EncryptWithAAD(assetKey, plaintext, []byte(boxID))
}

// DecryptAsset 对应解密。
func DecryptAsset(boxID string, dek, ciphertext []byte) ([]byte, error) {
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	return util.DecryptWithAAD(assetKey, ciphertext, []byte(boxID))
}

func copyAssetDecryptIfEncrypted(srcPath, destPath string) error {
	boxID := ExtractBoxIDFromAssetsPath(srcPath)
	if boxID != "" && IsEncryptedBox(boxID) {
		dek, err := GetDEKIfUnlocked(boxID)
		if err != nil {
			// 加密笔记本未解锁：fail-closed，拒绝复制（不复制密文，避免泄漏无效文件）
			return errors.New(Conf.Language(314))
		}
		raw, readErr := filelock.ReadFile(srcPath)
		if readErr != nil {
			return readErr
		}
		plain, decErr := DecryptAsset(boxID, dek, raw)
		if decErr != nil {
			return errors.New(Conf.Language(316))
		}
		if err := filelock.WriteFile(destPath, plain); err != nil {
			return err
		}
		return nil
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
