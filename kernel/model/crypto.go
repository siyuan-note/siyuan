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
	"sync"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// kekVerifierMagic 是写入 KEKVerifier 的固定魔数。启用时用 KEK 加密它，校验主密码时解密比对。
var kekVerifierMagic = []byte("siyuan-enc-v1")

var (
	cachedKEK      []byte            // 主密码派生的 KEK，启用且解锁后驻留内存
	cachedKEKLock  sync.RWMutex
	cachedDEKs     = map[string][]byte{} // boxID → DEK
	cachedDEKsLock sync.RWMutex
)

// EnableEncryptedNotebook 启用加密笔记本功能：生成 MasterSalt、派生 KEK、写入校验值并持久化。
// 重复调用（已启用）返回错误，避免覆盖现有加密笔记本的密钥参数。
func EnableEncryptedNotebook(password string) error {
	if len(password) == 0 {
		return errors.New("password must not be empty")
	}
	Conf.m.Lock()
	defer Conf.m.Unlock()

	if Conf.NotebookCrypto.Enabled {
		return errors.New("encrypted notebook already enabled")
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

	// 用 KEK 加密固定魔数作为校验值，落盘后供后续 UnlockKEK 离线校验
	verifierCT, err := util.Encrypt(kek, kekVerifierMagic)
	if err != nil {
		return err
	}

	Conf.NotebookCrypto.Enabled = true
	Conf.NotebookCrypto.MasterSalt = salt
	Conf.NotebookCrypto.KDFParams = params
	// Encrypt 返回 nonce||ciphertext，整段存为 KEKVerifier，nonce 从前 12 字节切出。
	Conf.NotebookCrypto.KEKVerifier = verifierCT
	Conf.NotebookCrypto.VerifierNonce = verifierCT[:12]

	cachedKEKLock.Lock()
	cachedKEK = kek
	cachedKEKLock.Unlock()

	Conf.Save()
	return nil
}

// UnlockKEK 用主密码派生 KEK，校验通过后缓存到内存。
// 校验方式：解 KEKVerifier，若能得到 kekVerifierMagic 则密码正确。
func UnlockKEK(password string) error {
	Conf.m.RLock()
	nc := Conf.NotebookCrypto
	Conf.m.RUnlock()

	if !nc.Enabled {
		return errors.New("encrypted notebook not enabled")
	}
	params := nc.KDFParams
	if params.KeyLength == 0 {
		params = util.DefaultArgon2Params()
	}
	kek := util.DeriveKey(password, nc.MasterSalt, params)

	decrypted, err := util.Decrypt(kek, nc.KEKVerifier)
	if err != nil {
		return errors.New("incorrect password")
	}
	if string(decrypted) != string(kekVerifierMagic) {
		return errors.New("incorrect password")
	}

	cachedKEKLock.Lock()
	cachedKEK = kek
	cachedKEKLock.Unlock()
	return nil
}

// IsKEKUnlocked 返回 KEK 是否在内存（加密功能是否已解锁）。
func IsKEKUnlocked() bool {
	cachedKEKLock.RLock()
	defer cachedKEKLock.RUnlock()
	return len(cachedKEK) > 0
}

// getKEK 取内存中的 KEK，未解锁时返回错误。
func getKEK() ([]byte, error) {
	cachedKEKLock.RLock()
	defer cachedKEKLock.RUnlock()
	if len(cachedKEK) == 0 {
		return nil, errors.New("encrypted notebook locked, KEK unavailable")
	}
	return cachedKEK, nil
}

// LockKEK 清除内存中的 KEK 和所有已缓存的 DEK。Unmount 加密笔记本或全局锁定时调用。
func LockKEK() {
	cachedKEKLock.Lock()
	zeroAndClear(cachedKEK)
	cachedKEK = nil
	cachedKEKLock.Unlock()

	cachedDEKsLock.Lock()
	for id, dek := range cachedDEKs {
		zeroAndClear(dek)
		delete(cachedDEKs, id)
	}
	cachedDEKsLock.Unlock()
}

// WrapNewDEK 为新加密笔记本生成随机 DEK，用 KEK 包络后返回 BoxEncryption 元数据。
// 调用方负责把返回值写入 BoxConf.BoxCrypt 并 SaveConf。
func WrapNewDEK() (*conf.BoxEncryption, error) {
	kek, err := getKEK()
	if err != nil {
		return nil, err
	}
	dek, err := util.GenerateDEK()
	if err != nil {
		return nil, err
	}
	wrapped, err := util.Encrypt(kek, dek)
	if err != nil {
		return nil, err
	}
	return &conf.BoxEncryption{
		WrappedDEK: wrapped,
		WrapNonce:  wrapped[:12],
		CreatedAt:  time.Now().UnixMilli(),
	}, nil
}

// UnwrapDEK 从 BoxEncryption 解出 DEK 并缓存到内存，供后续 GetDEK 使用。
func UnwrapDEK(boxID string, enc *conf.BoxEncryption) error {
	if enc == nil || len(enc.WrappedDEK) == 0 {
		return errors.New("no encrypted key material for box")
	}
	kek, err := getKEK()
	if err != nil {
		return err
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
	cachedDEKsLock.Lock()
	defer cachedDEKsLock.Unlock()
	if dek, ok := cachedDEKs[boxID]; ok {
		zeroAndClear(dek)
		delete(cachedDEKs, boxID)
	}
}

// ChangeMasterPassword 改主密码：用旧密码校验后，用新密码派生新 KEK，
// 重新加密 verifier，并把所有加密笔记本的 WrappedDEK 用新 KEK 重新包络后写回各自的 BoxConf。
//
// 注意：必须在所有加密笔记本都已 Unmount 的状态下调用（DEK 不在内存）。
// 本函数会遍历磁盘上的加密笔记本，用旧 KEK 解开 WrappedDEK 再用新 KEK 重新 wrap，
// 因此改密成本与加密笔记本数量、磁盘 IO 相关，但不涉及 .sy/assets 数据本身的重新加密。
func ChangeMasterPassword(oldPassword, newPassword string) error {
	if len(newPassword) == 0 {
		return errors.New("new password must not be empty")
	}

	// 改密期间不能有已 Mount 的加密笔记本（DEK 在内存），否则新旧 KEK 切换会让缓存与磁盘不一致
	cachedDEKsLock.RLock()
	dekCount := len(cachedDEKs)
	cachedDEKsLock.RUnlock()
	if dekCount > 0 {
		return errors.New("cannot change master password while encrypted notebooks are mounted (DEKs in memory), unmount them first")
	}

	// 用旧密码校验并取出旧 KEK
	if err := UnlockKEK(oldPassword); err != nil {
		return err
	}
	oldKEK, err := getKEK()
	if err != nil {
		return err
	}

	Conf.m.Lock()
	defer Conf.m.Unlock()

	nc := Conf.NotebookCrypto
	newKEK := util.DeriveKey(newPassword, nc.MasterSalt, nc.KDFParams)
	newVerifier, err := util.Encrypt(newKEK, kekVerifierMagic)
	if err != nil {
		return err
	}

	// 遍历所有笔记本，找到加密笔记本并用新 KEK 重新 wrap 其 WrappedDEK。
	// 当前设计只有一个加密笔记本（EncryptedBoxID），但用 Encrypted 标志遍历更稳健，也为未来多笔记本预留。
	boxes, err := ListNotebooks()
	if err != nil {
		return err
	}
	for _, b := range boxes {
		boxConf := b.GetConf()
		if boxConf == nil || !boxConf.Encrypted || boxConf.BoxCrypt == nil {
			continue
		}
		// 用旧 KEK 解出 DEK 明文
		dek, err := util.Decrypt(oldKEK, boxConf.BoxCrypt.WrappedDEK)
		if err != nil {
			// 解不开说明 WrappedDEK 与旧 KEK 不匹配（配置损坏或 KEK 已被其他流程改过），中断改密避免数据不可用
			return errors.New("failed to unwrap DEK for box " + b.ID + " during password change: " + err.Error())
		}
		// 用新 KEK 重新 wrap
		newWrapped, err := util.Encrypt(newKEK, dek)
		if err != nil {
			return err
		}
		boxConf.BoxCrypt.WrappedDEK = newWrapped
		boxConf.BoxCrypt.WrapNonce = newWrapped[:12]
		b.SaveConf(boxConf)
	}

	Conf.NotebookCrypto.KEKVerifier = newVerifier
	Conf.NotebookCrypto.VerifierNonce = newVerifier[:12]

	cachedKEKLock.Lock()
	zeroAndClear(cachedKEK)
	cachedKEK = newKEK
	cachedKEKLock.Unlock()

	Conf.Save()
	return nil
}

// IsEncryptedBox 判断给定 boxID 是否为加密笔记本。
func IsEncryptedBox(boxID string) bool {
	Conf.m.RLock()
	defer Conf.m.RUnlock()
	return Conf.NotebookCrypto.Enabled && Conf.NotebookCrypto.EncryptedBoxID == boxID
}

// zeroAndClear 把密钥字节清零后再置空，尽量减少密钥在内存中的残留时间。
func zeroAndClear(key []byte) {
	for i := range key {
		key[i] = 0
	}
}
