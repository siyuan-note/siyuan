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
	stdcrypto "crypto"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"hash"
)

// hashInfo 描述一个受支持的摘要算法。
type hashInfo struct {
	Name string           // 规范化后的算法名称
	New  func() hash.Hash // 哈希构造函数
	ID   stdcrypto.Hash   // 标准库的哈希标识，用于 RSA 签名等场景
}

var hashes = map[string]*hashInfo{
	AlgSHA1:   {Name: AlgSHA1, New: sha1.New, ID: stdcrypto.SHA1},
	AlgSHA256: {Name: AlgSHA256, New: sha256.New, ID: stdcrypto.SHA256},
	AlgSHA384: {Name: AlgSHA384, New: sha512.New384, ID: stdcrypto.SHA384},
	AlgSHA512: {Name: AlgSHA512, New: sha512.New, ID: stdcrypto.SHA512},
}

// hashByName 按名称查找摘要算法，名称大小写不敏感。
func hashByName(name string) (*hashInfo, error) {
	canonical, err := CanonicalAlgorithmName(name)
	if err != nil {
		return nil, err
	}

	h, ok := hashes[canonical]
	if !ok {
		return nil, notSupportedError("%s is not a supported hash algorithm", name)
	}
	return h, nil
}

// hashOf 返回算法参数中 hash 成员指定的摘要算法。
func hashOf(alg Algorithm) (*hashInfo, error) {
	if alg.Hash == "" {
		return nil, typeError("%s requires the hash member", alg.Name)
	}
	return hashByName(alg.Hash)
}

// Digest 计算数据的摘要。
func Digest(alg Algorithm, data []byte) ([]byte, error) {
	h, err := hashByName(alg.Name)
	if err != nil {
		return nil, err
	}

	digest := h.New()
	digest.Write(data)
	return digest.Sum(nil), nil
}
