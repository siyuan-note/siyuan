// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package crypto

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
)

// generateHMACKey 生成 HMAC 密钥，未指定 length 时使用摘要算法的分组长度。
func generateHMACKey(alg Algorithm, extractable bool, usages []KeyUsage) (*Key, error) {
	h, err := hashOf(alg)
	if err != nil {
		return nil, err
	}

	length := h.New().BlockSize() * 8
	if alg.Length != nil {
		if *alg.Length == 0 {
			return nil, operationError("HMAC length must not be zero")
		}
		length = *alg.Length
	}

	secret := make([]byte, (length+7)/8)
	if _, err := rand.Read(secret); err != nil {
		return nil, operationError("failed to generate random key: %s", err)
	}

	return &Key{
		Type:        KeyTypeSecret,
		Extractable: extractable,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name, Hash: h.Name, Length: new(length)},
		secret:      secret,
	}, nil
}

// importHMACKey 从原始字节导入 HMAC 密钥。
func importHMACKey(alg Algorithm, secret []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	h, err := hashOf(alg)
	if err != nil {
		return nil, err
	}
	if len(secret) == 0 {
		return nil, dataError("HMAC key data must not be empty")
	}

	length := len(secret) * 8
	if alg.Length != nil {
		if *alg.Length == 0 {
			return nil, dataError("HMAC length must not be zero")
		}
		// 规范只允许 length 落在密钥材料最后一个字节内，避免丢弃整个字节。
		if *alg.Length > length || *alg.Length <= length-8 {
			return nil, dataError("HMAC length %d does not match %d bits of key data", *alg.Length, length)
		}
		length = *alg.Length
	}

	return &Key{
		Type:        KeyTypeSecret,
		Extractable: extractable,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name, Hash: h.Name, Length: new(length)},
		secret:      bytes.Clone(secret),
	}, nil
}

// hmacSum 使用密钥计算数据的 HMAC 值。
func hmacSum(key *Key, data []byte) ([]byte, error) {
	h, err := hashByName(key.Algorithm.Hash)
	if err != nil {
		return nil, err
	}
	if len(key.secret) == 0 {
		return nil, operationError("HMAC key has no key material")
	}

	mac := hmac.New(h.New, key.secret)
	mac.Write(data)
	return mac.Sum(nil), nil
}

// verifyHMAC 以常数时间比较签名。
func verifyHMAC(key *Key, signature []byte, data []byte) (bool, error) {
	expected, err := hmacSum(key, data)
	if err != nil {
		return false, err
	}
	return hmac.Equal(signature, expected), nil
}
