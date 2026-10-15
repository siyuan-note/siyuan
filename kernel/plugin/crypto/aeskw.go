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
	josecipher "github.com/go-jose/go-jose/v4/cipher"
)

// AES-KW 的数据长度限制：RFC 3394 要求明文至少两个 64 位分组，密文比明文多一个分组。
const (
	aesKWMinPlaintext  = 16
	aesKWMinCiphertext = 24
)

// wrapAESKW 以 RFC 3394 包装密钥材料。
func wrapAESKW(key *Key, plaintext []byte) ([]byte, error) {
	block, err := aesBlock(key)
	if err != nil {
		return nil, err
	}
	// go-jose 只校验 8 字节对齐，单个分组的输入不符合 RFC 3394 的定义。
	if len(plaintext) < aesKWMinPlaintext {
		return nil, operationError("AES-KW requires at least %d bytes of key data, got %d",
			aesKWMinPlaintext, len(plaintext))
	}
	if len(plaintext)%8 != 0 {
		return nil, operationError("AES-KW key data length must be a multiple of 8, got %d", len(plaintext))
	}

	ret, err := josecipher.KeyWrap(block, plaintext)
	if err != nil {
		return nil, operationError("AES-KW wrapping failed: %s", err)
	}
	return ret, nil
}

// unwrapAESKW 以 RFC 3394 解包装密钥材料，完整性校验失败返回 OperationError。
func unwrapAESKW(key *Key, ciphertext []byte) ([]byte, error) {
	block, err := aesBlock(key)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < aesKWMinCiphertext {
		return nil, operationError("AES-KW requires at least %d bytes of wrapped data, got %d",
			aesKWMinCiphertext, len(ciphertext))
	}
	if len(ciphertext)%8 != 0 {
		return nil, operationError("AES-KW wrapped data length must be a multiple of 8, got %d", len(ciphertext))
	}

	ret, err := josecipher.KeyUnwrap(block, ciphertext)
	if err != nil {
		return nil, operationError("AES-KW integrity check failed")
	}
	return ret, nil
}
