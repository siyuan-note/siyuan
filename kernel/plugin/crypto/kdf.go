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
	"crypto/hkdf"
	"crypto/pbkdf2"
	"hash"
)

// importKDFKey 导入 HKDF/PBKDF2 的基础密钥材料，规范要求此类密钥不可导出。
func importKDFKey(alg Algorithm, secret []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	if extractable {
		return nil, syntaxError("%s keys must not be extractable", alg.Name)
	}

	return &Key{
		Type:        KeyTypeSecret,
		Extractable: false,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name},
		secret:      bytes.Clone(secret),
	}, nil
}

// deriveBitsHKDF 以 HKDF 派生比特串。
func deriveBitsHKDF(alg Algorithm, key *Key, length *int) ([]byte, error) {
	h, err := hashOf(alg)
	if err != nil {
		return nil, err
	}
	if alg.Salt == nil {
		return nil, typeError("HKDF requires the salt member")
	}
	if alg.Info == nil {
		return nil, typeError("HKDF requires the info member")
	}

	size, err := deriveByteLength(AlgHKDF, length)
	if err != nil {
		return nil, err
	}

	ret, err := hkdf.Key[hash.Hash](h.New, key.secret, alg.Salt, string(alg.Info), size)
	if err != nil {
		return nil, operationError("HKDF derivation failed: %s", err)
	}
	return ret, nil
}

// deriveBitsPBKDF2 以 PBKDF2 派生比特串。
func deriveBitsPBKDF2(alg Algorithm, key *Key, length *int) ([]byte, error) {
	h, err := hashOf(alg)
	if err != nil {
		return nil, err
	}
	if alg.Salt == nil {
		return nil, typeError("PBKDF2 requires the salt member")
	}
	if alg.Iterations == nil {
		return nil, typeError("PBKDF2 requires the iterations member")
	}
	if *alg.Iterations <= 0 {
		return nil, operationError("PBKDF2 iterations must be greater than zero")
	}

	size, err := deriveByteLength(AlgPBKDF2, length)
	if err != nil {
		return nil, err
	}

	// PBKDF2 的口令按字节处理，string 转换保留原始字节。
	ret, err := pbkdf2.Key[hash.Hash](h.New, string(key.secret), alg.Salt, *alg.Iterations, size)
	if err != nil {
		return nil, operationError("PBKDF2 derivation failed: %s", err)
	}
	return ret, nil
}

// deriveByteLength 校验派生长度：必须存在、非零且为 8 的整数倍。
func deriveByteLength(algName string, length *int) (int, error) {
	if length == nil {
		return 0, operationError("%s requires a non-null length", algName)
	}
	if *length == 0 || *length%8 != 0 {
		return 0, operationError("%s length must be a non-zero multiple of 8, got %d", algName, *length)
	}
	return *length / 8, nil
}
