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
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"

	"golang.org/x/crypto/argon2"
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

// DeriveKey 用 Argon2id 从密码派生密钥。同一 password+salt+params 多次调用结果一致。
func DeriveKey(password string, salt []byte, p Argon2Params) []byte {
	return argon2.IDKey([]byte(password), salt, p.Iterations, p.Memory, p.Parallelism, p.KeyLength)
}

// Encrypt 用 AES-256-GCM 加密。每次调用生成随机 12 字节 nonce 并 prepend 到密文前，因此同一明文多次加密结果不同。
// 返回格式：nonce(12B) || ciphertext || GCM tag(16B)。
func Encrypt(key, plaintext []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New("Encrypt requires a 32-byte (AES-256) key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	// Seal 会把 nonce 前置，一次性产出 nonce||ciphertext||tag
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt 对应 Encrypt 的解密。密钥错误或密文被篡改时返回错误（GCM 自带完整性校验）。
func Decrypt(key, ciphertext []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New("Decrypt requires a 32-byte (AES-256) key")
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
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}
	nonce, ct := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return gcm.Open(nil, nonce, ct, nil)
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
