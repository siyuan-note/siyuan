// SiYuan - From thought to insight, with agents
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

package crypto

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"math/big"
)

// aesKeyLengths 是 AES 允许的密钥位长。
var aesKeyLengths = []int{128, 192, 256}

// aesBlock 构造密钥对应的 AES 分组密码。
func aesBlock(key *Key) (cipher.Block, error) {
	if len(key.secret) == 0 {
		return nil, operationError("%s key has no key material", key.Algorithm.Name)
	}
	return aes.NewCipher(key.secret)
}

// generateAESKey 生成 AES 密钥，length 必须是 128、192 或 256。
func generateAESKey(alg Algorithm, extractable bool, usages []KeyUsage) (*Key, error) {
	if alg.Length == nil {
		return nil, typeError("%s requires the length member", alg.Name)
	}
	if !containsInt(aesKeyLengths, *alg.Length) {
		return nil, operationError("%s key length must be 128, 192 or 256, got %d", alg.Name, *alg.Length)
	}

	secret := make([]byte, *alg.Length/8)
	if _, err := rand.Read(secret); err != nil {
		return nil, operationError("failed to generate random key: %s", err)
	}

	return &Key{
		Type:        KeyTypeSecret,
		Extractable: extractable,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name, Length: intPtr(*alg.Length)},
		secret:      secret,
	}, nil
}

// importAESKey 从原始字节导入 AES 密钥。规范的 AES 导入参数只有 name，
// 密钥位长完全由密钥数据决定，参数中的 length（例如复用加密参数时 AES-CTR 的计数器位长）不参与导入。
func importAESKey(alg Algorithm, secret []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	length := len(secret) * 8
	if !containsInt(aesKeyLengths, length) {
		return nil, dataError("%s key data must be 16, 24 or 32 bytes, got %d", alg.Name, len(secret))
	}

	return &Key{
		Type:        KeyTypeSecret,
		Extractable: extractable,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name, Length: intPtr(length)},
		secret:      bytes.Clone(secret),
	}, nil
}

// encryptAESGCM 以 AES-GCM 加密，受 Go 标准库限制，认证标签只支持 96 到 128 位。
func encryptAESGCM(alg Algorithm, key *Key, plaintext []byte) ([]byte, error) {
	aead, err := newAESGCM(alg, key)
	if err != nil {
		return nil, err
	}
	return aead.Seal(nil, alg.IV, plaintext, alg.AAD), nil
}

// decryptAESGCM 以 AES-GCM 解密，认证失败返回 OperationError。
func decryptAESGCM(alg Algorithm, key *Key, ciphertext []byte) ([]byte, error) {
	aead, err := newAESGCM(alg, key)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < aead.Overhead() {
		return nil, operationError("ciphertext is shorter than the authentication tag")
	}

	plaintext, err := aead.Open(nil, alg.IV, ciphertext, alg.AAD)
	if err != nil {
		return nil, operationError("AES-GCM authentication failed")
	}
	return plaintext, nil
}

// newAESGCM 按 iv 与 tagLength 构造 GCM。Go 不支持同时自定义 nonce 与标签长度，
// 也不支持短于 96 位的标签，因此除 12 字节 iv 以外只允许 128 位标签。
func newAESGCM(alg Algorithm, key *Key) (cipher.AEAD, error) {
	if len(alg.IV) == 0 {
		return nil, operationError("AES-GCM requires a non-empty iv")
	}

	tagLength := 128
	if alg.TagLength != nil {
		tagLength = *alg.TagLength
	}
	switch tagLength {
	case 96, 104, 112, 120, 128:
	case 32, 64:
		return nil, notSupportedError("AES-GCM tagLength %d is not supported by the kernel", tagLength)
	default:
		return nil, operationError("AES-GCM tagLength must be 32, 64, 96, 104, 112, 120 or 128, got %d", tagLength)
	}

	block, err := aesBlock(key)
	if err != nil {
		return nil, err
	}

	if len(alg.IV) == 12 {
		return cipher.NewGCMWithTagSize(block, tagLength/8)
	}
	if tagLength != 128 {
		return nil, notSupportedError("AES-GCM with a %d-bit iv requires tagLength 128", len(alg.IV)*8)
	}
	return cipher.NewGCMWithNonceSize(block, len(alg.IV))
}

// encryptAESCBC 以 AES-CBC 加密，使用 PKCS#7 填充。
func encryptAESCBC(alg Algorithm, key *Key, plaintext []byte) ([]byte, error) {
	block, err := aesCBCBlock(alg, key)
	if err != nil {
		return nil, err
	}

	padded := padPKCS7(plaintext, block.BlockSize())
	ciphertext := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, alg.IV).CryptBlocks(ciphertext, padded)
	return ciphertext, nil
}

// decryptAESCBC 以 AES-CBC 解密并去除 PKCS#7 填充，填充无效返回 OperationError。
func decryptAESCBC(alg Algorithm, key *Key, ciphertext []byte) ([]byte, error) {
	block, err := aesCBCBlock(alg, key)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) == 0 || len(ciphertext)%block.BlockSize() != 0 {
		return nil, operationError("AES-CBC ciphertext length must be a non-zero multiple of %d", block.BlockSize())
	}

	plaintext := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, alg.IV).CryptBlocks(plaintext, ciphertext)
	return unpadPKCS7(AlgAESCBC, plaintext, block.BlockSize())
}

func aesCBCBlock(alg Algorithm, key *Key) (cipher.Block, error) {
	if len(alg.IV) != aes.BlockSize {
		return nil, operationError("AES-CBC requires a %d-byte iv, got %d", aes.BlockSize, len(alg.IV))
	}
	return aesBlock(key)
}

// encryptAESECB 以 AES-ECB 加密，使用 PKCS#7 填充。该模式不属于 Web Crypto 规范，
// 标准库也刻意没有提供对应的 BlockMode，因此逐分组调用分组密码。
func encryptAESECB(key *Key, plaintext []byte) ([]byte, error) {
	block, err := aesBlock(key)
	if err != nil {
		return nil, err
	}

	padded := padPKCS7(plaintext, block.BlockSize())
	ciphertext := make([]byte, len(padded))
	for offset := 0; offset < len(padded); offset += block.BlockSize() {
		block.Encrypt(ciphertext[offset:offset+block.BlockSize()], padded[offset:offset+block.BlockSize()])
	}
	return ciphertext, nil
}

// decryptAESECB 以 AES-ECB 解密并去除 PKCS#7 填充。
func decryptAESECB(key *Key, ciphertext []byte) ([]byte, error) {
	block, err := aesBlock(key)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) == 0 || len(ciphertext)%block.BlockSize() != 0 {
		return nil, operationError("AES-ECB ciphertext length must be a non-zero multiple of %d", block.BlockSize())
	}

	plaintext := make([]byte, len(ciphertext))
	for offset := 0; offset < len(ciphertext); offset += block.BlockSize() {
		block.Decrypt(plaintext[offset:offset+block.BlockSize()], ciphertext[offset:offset+block.BlockSize()])
	}
	return unpadPKCS7(AlgAESECB, plaintext, block.BlockSize())
}

// cryptAESCTR 以 AES-CTR 加解密。规范要求计数器只在低 length 位内回绕，
// 而标准库的 CTR 会把进位带入整个分组，因此按剩余计数空间分段处理。
func cryptAESCTR(alg Algorithm, key *Key, data []byte) ([]byte, error) {
	if len(alg.Counter) != aes.BlockSize {
		return nil, operationError("AES-CTR requires a %d-byte counter, got %d", aes.BlockSize, len(alg.Counter))
	}
	if alg.Length == nil {
		return nil, typeError("AES-CTR requires the length member")
	}
	counterLength := *alg.Length
	if counterLength <= 0 || counterLength > 128 {
		return nil, operationError("AES-CTR length must be between 1 and 128, got %d", counterLength)
	}

	block, err := aesBlock(key)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return []byte{}, nil
	}

	blocks := (len(data) + aes.BlockSize - 1) / aes.BlockSize
	// 计数空间为 2^counterLength 个分组，超出则无法保证计数器块不重复。
	space := new(big.Int).Lsh(big.NewInt(1), uint(counterLength))
	if space.Cmp(big.NewInt(int64(blocks))) < 0 {
		return nil, dataError("AES-CTR counter space of %d bits is too small for %d blocks", counterLength, blocks)
	}

	counter := counterValue(alg.Counter, counterLength)
	// 计数器回绕前还能使用的分组数。
	untilWrap := new(big.Int).Sub(space, counter)
	ret := make([]byte, 0, len(data))

	first := len(data)
	if untilWrap.Cmp(big.NewInt(int64(blocks))) < 0 {
		first = int(untilWrap.Int64()) * aes.BlockSize
	}

	ret = append(ret, ctrSegment(block, alg.Counter, data[:first])...)
	if first < len(data) {
		// 回绕后计数器部分归零，固定前缀保持不变。
		wrapped := setCounterValue(alg.Counter, counterLength, new(big.Int))
		ret = append(ret, ctrSegment(block, wrapped, data[first:])...)
	}
	return ret, nil
}

func ctrSegment(block cipher.Block, iv []byte, data []byte) []byte {
	ret := make([]byte, len(data))
	cipher.NewCTR(block, iv).XORKeyStream(ret, data)
	return ret
}

// counterValue 读取计数器块低 counterLength 位的数值。
func counterValue(counterBlock []byte, counterLength int) *big.Int {
	value := new(big.Int).SetBytes(counterBlock)
	mask := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), uint(counterLength)), big.NewInt(1))
	return value.And(value, mask)
}

// setCounterValue 保留计数器块的固定前缀，将低 counterLength 位替换为 value。
func setCounterValue(counterBlock []byte, counterLength int, value *big.Int) []byte {
	mask := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), uint(counterLength)), big.NewInt(1))
	prefix := new(big.Int).SetBytes(counterBlock)
	prefix.AndNot(prefix, mask)
	prefix.Or(prefix, new(big.Int).And(value, mask))

	ret := make([]byte, len(counterBlock))
	prefix.FillBytes(ret)
	return ret
}

// padPKCS7 按分组长度补齐 PKCS#7 填充。
func padPKCS7(data []byte, blockSize int) []byte {
	padding := blockSize - len(data)%blockSize
	ret := make([]byte, len(data)+padding)
	copy(ret, data)
	for i := len(data); i < len(ret); i++ {
		ret[i] = byte(padding)
	}
	return ret
}

// unpadPKCS7 校验并去除 PKCS#7 填充，使用常数时间比较避免填充预言。
func unpadPKCS7(algName string, data []byte, blockSize int) ([]byte, error) {
	padding := int(data[len(data)-1])
	valid := subtle.ConstantTimeLessOrEq(1, padding) & subtle.ConstantTimeLessOrEq(padding, blockSize)

	// 密文长度是分组长度的整数倍，因此始终比较整个末尾分组，填充字节数不合法时结果必然不匹配。
	for i := 0; i < blockSize; i++ {
		expected := subtle.ConstantTimeLessOrEq(i+1, padding)
		matched := subtle.ConstantTimeByteEq(data[len(data)-1-i], byte(padding))
		valid &= matched | (1 ^ expected)
	}

	if valid != 1 {
		return nil, operationError("%s padding is invalid", algName)
	}
	return data[:len(data)-padding], nil
}

func containsInt(values []int, value int) bool {
	for _, cur := range values {
		if cur == value {
			return true
		}
	}
	return false
}
