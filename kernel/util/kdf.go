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

package util

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"io"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/hkdf"
)

var encryptionMagic = [4]byte{'S', 'E', 'N', 'C'}

const (
	// EncryptionSpec 表示 AES-GCM 密文信封规范版本。旧版密文没有信封头，读取时保持兼容。
	EncryptionSpec byte = 1

	encryptionAlgorithmAES256GCM byte = 1
	encryptionEnvelopeHeaderSize      = len(encryptionMagic) + 3 // magic + spec + algorithm + nonce length
)

// Argon2Params 是 Argon2id 密钥派生函数的参数。参数本身不是秘密，会随配置落盘，以便跨平台一致地派生密钥。
// 默认值遵循 OWASP 2023 推荐（64 MB 内存 / 3 次迭代 / 4 线程 / 32 字节输出）。
type Argon2Params struct {
	Memory      uint32 `json:"memory"`      // 单次派生占用的内存，单位 KB
	Iterations  uint32 `json:"iterations"`  // 遍历内存的次数
	Parallelism uint8  `json:"parallelism"` // 并行线程数
	KeyLength   uint32 `json:"keyLength"`   // 输出密钥长度，单位字节
}

// DefaultArgon2Params 返回 OWASP 2023 推荐的 Argon2id 参数。
func DefaultArgon2Params() Argon2Params {
	return Argon2Params{
		Memory:      64 * 1024,
		Iterations:  3,
		Parallelism: 4,
		KeyLength:   32,
	}
}

// ValidateArgon2Params 校验 Argon2id 参数是否在合理范围内。
// KeyLength 为 0 时视为旧配置，返回默认值；非零但不合法的参数返回错误。
// 防止恶意备份设置极大内存导致 OOM，或过弱参数降低安全性。
func ValidateArgon2Params(p Argon2Params) (Argon2Params, error) {
	if p.KeyLength == 0 {
		return DefaultArgon2Params(), nil
	}
	if p.KeyLength != 32 {
		return p, errors.New("Argon2id KeyLength must be 32")
	}
	if p.Memory < 64*1024 {
		return p, errors.New("Argon2id Memory too low (minimum 64 MB)")
	}
	if p.Memory > 256*1024 {
		return p, errors.New("Argon2id Memory too high (maximum 256 MB)")
	}
	if p.Iterations < 3 {
		return p, errors.New("Argon2id Iterations too low (minimum 3)")
	}
	if p.Iterations > 10 {
		return p, errors.New("Argon2id Iterations too high (maximum 10)")
	}
	if p.Parallelism == 0 || p.Parallelism > 16 {
		return p, errors.New("Argon2id Parallelism must be between 1 and 16")
	}
	return p, nil
}

// DeriveKey 用 Argon2id 从密码派生密钥。同一 password+salt+params 多次调用结果一致。
func DeriveKey(password string, salt []byte, p Argon2Params) []byte {
	return argon2.IDKey([]byte(password), salt, p.Iterations, p.Memory, p.Parallelism, p.KeyLength)
}

// Encrypt 用 AES-256-GCM 加密。每次调用生成随机 nonce，因此同一明文多次加密结果不同。
// 返回格式：magic(4B) || spec(1B) || algorithm(1B) || nonceLength(1B) || nonce || ciphertext || GCM tag(16B)。
func Encrypt(key, plaintext []byte) ([]byte, error) {
	return encryptGCM(key, plaintext, nil, "Encrypt")
}

// Decrypt 对应 Encrypt 的解密。兼容旧版 nonce||ciphertext||tag 格式。
// 密钥错误或密文被篡改时返回错误（GCM 自带完整性校验）。
func Decrypt(key, ciphertext []byte) ([]byte, error) {
	return decryptGCM(key, ciphertext, nil, "Decrypt")
}

// EncryptionNonce 从 AES-GCM 密文中提取 nonce，兼容旧版无信封头格式。
func EncryptionNonce(ciphertext []byte) ([]byte, error) {
	if hasEncryptionMagic(ciphertext) {
		if len(ciphertext) < encryptionEnvelopeHeaderSize {
			return nil, errors.New("encrypted envelope too short")
		}
		if ciphertext[len(encryptionMagic)] != EncryptionSpec {
			return nil, errors.New("unsupported encrypted envelope spec")
		}
		if ciphertext[len(encryptionMagic)+1] != encryptionAlgorithmAES256GCM {
			return nil, errors.New("unsupported encrypted envelope algorithm")
		}
		nonceLength := int(ciphertext[len(encryptionMagic)+2])
		if nonceLength == 0 || len(ciphertext) < encryptionEnvelopeHeaderSize+nonceLength {
			return nil, errors.New("invalid encrypted envelope nonce length")
		}
		return append([]byte(nil), ciphertext[encryptionEnvelopeHeaderSize:encryptionEnvelopeHeaderSize+nonceLength]...), nil
	}
	if len(ciphertext) < 12 {
		return nil, errors.New("ciphertext too short to extract nonce")
	}
	return append([]byte(nil), ciphertext[:12]...), nil
}

// DeriveSubKey 用 HKDF-SHA256 从主 DEK 派生用途隔离的子密钥。
// 同一 (dek, purpose) 多次调用结果一致；不同 purpose 派生出相互独立的子密钥，
// 实现用途分离——.sy/assets/AV 各用独立子密钥，互不可替代，限制单点密钥泄漏的影响面。
func DeriveSubKey(dek []byte, purpose string) []byte {
	// HKDF info 用 purpose 字节；salt 为 nil（DEK 本身已是高熵随机密钥，无需额外 salt）
	r := hkdf.New(sha256.New, dek, nil, []byte(purpose))
	out := make([]byte, 32) // AES-256
	if _, err := io.ReadFull(r, out); err != nil {
		// hkdf.Read 不应出错（除非 dek 为空）；防御性 panic 避免静默返回弱密钥
		panic("hkdf derive failed: " + err.Error())
	}
	return out
}

// EncryptWithAAD 用 AES-256-GCM 加密并绑定 AAD（附加认证数据）。
// AAD 不被加密，但参与 GCM 认证——解密时必须提供相同 AAD，否则认证失败。
// 把用途/boxID/路径等元数据放入 AAD，可防止同 box 内密文被替换用途或路径（bind 到上下文）。
// 返回格式与 Encrypt 一致，但 AAD 参与校验。
func EncryptWithAAD(key, plaintext, aad []byte) ([]byte, error) {
	return encryptGCM(key, plaintext, aad, "EncryptWithAAD")
}

// DecryptWithAAD 对应 EncryptWithAAD 的解密，兼容旧版 nonce||ciphertext||tag 格式。
// AAD 不匹配或密文被篡改时返回错误。
func DecryptWithAAD(key, ciphertext, aad []byte) ([]byte, error) {
	return decryptGCM(key, ciphertext, aad, "DecryptWithAAD")
}

func encryptGCM(key, plaintext, aad []byte, operation string) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New(operation + " requires a 32-byte (AES-256) key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	nonce := make([]byte, nonceSize)
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	envelope := make([]byte, encryptionEnvelopeHeaderSize, encryptionEnvelopeHeaderSize+nonceSize+len(plaintext)+gcm.Overhead())
	copy(envelope, encryptionMagic[:])
	envelope[len(encryptionMagic)] = EncryptionSpec
	envelope[len(encryptionMagic)+1] = encryptionAlgorithmAES256GCM
	envelope[len(encryptionMagic)+2] = byte(nonceSize)
	envelope = append(envelope, nonce...)
	return gcm.Seal(envelope, nonce, plaintext, envelopeAAD(envelope[:encryptionEnvelopeHeaderSize], aad)), nil
}

func decryptGCM(key, ciphertext, aad []byte, operation string) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New(operation + " requires a 32-byte (AES-256) key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	if hasEncryptionMagic(ciphertext) {
		if len(ciphertext) < encryptionEnvelopeHeaderSize {
			return nil, errors.New("encrypted envelope too short")
		}
		if ciphertext[len(encryptionMagic)] != EncryptionSpec {
			return nil, errors.New("unsupported encrypted envelope spec")
		}
		if ciphertext[len(encryptionMagic)+1] != encryptionAlgorithmAES256GCM {
			return nil, errors.New("unsupported encrypted envelope algorithm")
		}
		if int(ciphertext[len(encryptionMagic)+2]) != nonceSize {
			return nil, errors.New("invalid encrypted envelope nonce length")
		}
		if len(ciphertext) < encryptionEnvelopeHeaderSize+nonceSize+gcm.Overhead() {
			return nil, errors.New("encrypted envelope too short")
		}
		nonce := ciphertext[encryptionEnvelopeHeaderSize : encryptionEnvelopeHeaderSize+nonceSize]
		ct := ciphertext[encryptionEnvelopeHeaderSize+nonceSize:]
		return gcm.Open(nil, nonce, ct, envelopeAAD(ciphertext[:encryptionEnvelopeHeaderSize], aad))
	}
	if len(ciphertext) < nonceSize+gcm.Overhead() {
		return nil, errors.New("ciphertext too short")
	}
	nonce, ct := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return gcm.Open(nil, nonce, ct, aad)
}

func hasEncryptionMagic(ciphertext []byte) bool {
	return len(ciphertext) >= len(encryptionMagic) && bytes.Equal(ciphertext[:len(encryptionMagic)], encryptionMagic[:])
}

// IsCiphertext 判断给定字节是否以加密信封魔数开头（即是否为密文）。
// 供历史索引等无法取得 boxID/DEK 的路径做防御性检测：读到密文时跳过解析而非按 JSON 报错，
// 避免加密笔记本的 AV 等对象因路径迁移（同步、导入、历史布局变化）落到全局位置时产生噪声错误。
func IsCiphertext(data []byte) bool {
	return hasEncryptionMagic(data)
}

// envelopeAAD 把公开信封头和调用方 AAD 一并纳入 GCM 认证，防止规范或算法标识被篡改。
func envelopeAAD(header, aad []byte) []byte {
	ret := make([]byte, 0, len(header)+len(aad))
	ret = append(ret, header...)
	return append(ret, aad...)
}

// GenerateSalt 生成随机 salt（16 字节）。
func GenerateSalt() ([]byte, error) {
	return randomBytes(16)
}

// GenerateDEK 生成随机数据密钥（32 字节，AES-256）。
func GenerateDEK() ([]byte, error) {
	return randomBytes(32)
}

// randomBytes 从 crypto/rand 读取指定长度的随机字节。
func randomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}
