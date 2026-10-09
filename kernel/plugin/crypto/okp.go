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
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
)

// x25519KeySize 是 X25519 公钥与私钥的字节长度。
const x25519KeySize = 32

// generateEd25519KeyPair 生成 Ed25519 密钥对。
func generateEd25519KeyPair(alg Algorithm, extractable bool, usages []KeyUsage) (*KeyPair, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, operationError("failed to generate an Ed25519 key: %s", err)
	}

	keyAlg := KeyAlgorithm{Name: alg.Name}
	privateUsages, publicUsages := splitAsymmetricUsages(alg.Name, usages)

	return &KeyPair{
		PrivateKey: &Key{Type: KeyTypePrivate, Extractable: extractable, Usages: privateUsages,
			Algorithm: keyAlg, private: privateKey},
		PublicKey: &Key{Type: KeyTypePublic, Extractable: true, Usages: publicUsages,
			Algorithm: keyAlg, public: publicKey},
	}, nil
}

// generateX25519KeyPair 生成 X25519 密钥对。
func generateX25519KeyPair(alg Algorithm, extractable bool, usages []KeyUsage) (*KeyPair, error) {
	privateKey, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, operationError("failed to generate an X25519 key: %s", err)
	}

	keyAlg := KeyAlgorithm{Name: alg.Name}
	privateUsages, publicUsages := splitAsymmetricUsages(alg.Name, usages)

	return &KeyPair{
		PrivateKey: &Key{Type: KeyTypePrivate, Extractable: extractable, Usages: privateUsages,
			Algorithm: keyAlg, private: privateKey},
		PublicKey: &Key{Type: KeyTypePublic, Extractable: true, Usages: publicUsages,
			Algorithm: keyAlg, public: privateKey.PublicKey()},
	}, nil
}

// signEd25519 以 Ed25519 签名。
func signEd25519(key *Key, data []byte) ([]byte, error) {
	privateKey, ok := key.private.(ed25519.PrivateKey)
	if !ok {
		return nil, invalidAccessError("Ed25519 signing requires a private key")
	}
	return ed25519.Sign(privateKey, data), nil
}

// verifyEd25519 校验 Ed25519 签名，签名长度不符时返回 false。
func verifyEd25519(key *Key, signature []byte, data []byte) (bool, error) {
	publicKey, ok := key.public.(ed25519.PublicKey)
	if !ok {
		return false, invalidAccessError("Ed25519 verification requires a public key")
	}
	if len(signature) != ed25519.SignatureSize {
		return false, nil
	}
	return ed25519.Verify(publicKey, data, signature), nil
}

// importEd25519Raw 从原始字节导入 Ed25519 公钥，raw 格式只定义了公钥。
func importEd25519Raw(alg Algorithm, data []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	if len(data) != ed25519.PublicKeySize {
		return nil, dataError("Ed25519 public key data must be %d bytes, got %d",
			ed25519.PublicKeySize, len(data))
	}
	if err := checkUsages(alg.Name, KeyTypePublic, usages); err != nil {
		return nil, err
	}

	return &Key{
		Type:        KeyTypePublic,
		Extractable: extractable,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name},
		public:      ed25519.PublicKey(bytes.Clone(data)),
	}, nil
}

// importX25519Raw 从原始字节导入 X25519 公钥。
func importX25519Raw(alg Algorithm, data []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	if len(data) != x25519KeySize {
		return nil, dataError("X25519 public key data must be %d bytes, got %d", x25519KeySize, len(data))
	}
	if err := checkUsages(alg.Name, KeyTypePublic, usages); err != nil {
		return nil, err
	}

	publicKey, err := ecdh.X25519().NewPublicKey(data)
	if err != nil {
		return nil, dataError("invalid X25519 public key: %s", err)
	}

	return &Key{
		Type:        KeyTypePublic,
		Extractable: extractable,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name},
		public:      publicKey,
	}, nil
}
