// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
