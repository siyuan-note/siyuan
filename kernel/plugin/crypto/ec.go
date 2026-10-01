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
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"math/big"
)

// 受支持的命名曲线。
const (
	CurveP256 = "P-256"
	CurveP384 = "P-384"
	CurveP521 = "P-521"
)

// curveInfo 描述一条命名曲线及其字节长度。
type curveInfo struct {
	Name  string
	Curve elliptic.Curve
	ECDH  ecdh.Curve
	Size  int // 坐标与标量的字节长度
}

var curves = map[string]*curveInfo{
	CurveP256: {Name: CurveP256, Curve: elliptic.P256(), ECDH: ecdh.P256(), Size: 32},
	CurveP384: {Name: CurveP384, Curve: elliptic.P384(), ECDH: ecdh.P384(), Size: 48},
	CurveP521: {Name: CurveP521, Curve: elliptic.P521(), ECDH: ecdh.P521(), Size: 66},
}

// curveByName 按名称查找命名曲线，名称区分大小写以与规范一致。
func curveByName(name string) (*curveInfo, error) {
	if name == "" {
		return nil, typeError("the namedCurve member is required")
	}
	curve, ok := curves[name]
	if !ok {
		return nil, notSupportedError("%s is not a supported named curve", name)
	}
	return curve, nil
}

// curveOfKey 返回密钥所属的命名曲线。
func curveOfKey(key *Key) (*curveInfo, error) {
	return curveByName(key.Algorithm.NamedCurve)
}

// generateECKeyPair 生成 ECDSA 或 ECDH 密钥对。
func generateECKeyPair(alg Algorithm, extractable bool, usages []KeyUsage) (*KeyPair, error) {
	curve, err := curveByName(alg.NamedCurve)
	if err != nil {
		return nil, err
	}

	// EcKeyGenParams 与 EcKeyAlgorithm 都只有 namedCurve，摘要算法由 EcdsaParams 在签名时指定。
	keyAlg := KeyAlgorithm{Name: alg.Name, NamedCurve: curve.Name}
	privateUsages, publicUsages := splitAsymmetricUsages(alg.Name, usages)

	if alg.Name == AlgECDH {
		privateKey, genErr := curve.ECDH.GenerateKey(rand.Reader)
		if genErr != nil {
			return nil, operationError("failed to generate an ECDH key: %s", genErr)
		}
		return &KeyPair{
			PrivateKey: &Key{Type: KeyTypePrivate, Extractable: extractable, Usages: privateUsages,
				Algorithm: keyAlg, private: privateKey},
			PublicKey: &Key{Type: KeyTypePublic, Extractable: true, Usages: publicUsages,
				Algorithm: keyAlg, public: privateKey.PublicKey()},
		}, nil
	}

	privateKey, err := ecdsa.GenerateKey(curve.Curve, rand.Reader)
	if err != nil {
		return nil, operationError("failed to generate an ECDSA key: %s", err)
	}
	return &KeyPair{
		PrivateKey: &Key{Type: KeyTypePrivate, Extractable: extractable, Usages: privateUsages,
			Algorithm: keyAlg, private: privateKey},
		PublicKey: &Key{Type: KeyTypePublic, Extractable: true, Usages: publicUsages,
			Algorithm: keyAlg, public: &privateKey.PublicKey},
	}, nil
}

// signECDSA 以 ECDSA 签名。Web Crypto 使用固定长度的 r‖s，而非 DER 编码。
// 摘要算法来自 EcdsaParams 的 hash 成员，而不是密钥。
func signECDSA(alg Algorithm, key *Key, data []byte) ([]byte, error) {
	privateKey, ok := key.private.(*ecdsa.PrivateKey)
	if !ok {
		return nil, invalidAccessError("ECDSA signing requires a private key")
	}
	curve, err := curveOfKey(key)
	if err != nil {
		return nil, err
	}
	h, err := hashOf(alg)
	if err != nil {
		return nil, err
	}

	digest := h.New()
	digest.Write(data)

	r, s, err := ecdsa.Sign(rand.Reader, privateKey, digest.Sum(nil))
	if err != nil {
		return nil, operationError("ECDSA signing failed: %s", err)
	}

	signature := make([]byte, 2*curve.Size)
	r.FillBytes(signature[:curve.Size])
	s.FillBytes(signature[curve.Size:])
	return signature, nil
}

// verifyECDSA 校验 ECDSA 签名，签名长度不符时返回 false。
func verifyECDSA(alg Algorithm, key *Key, signature []byte, data []byte) (bool, error) {
	publicKey, ok := key.public.(*ecdsa.PublicKey)
	if !ok {
		return false, invalidAccessError("ECDSA verification requires a public key")
	}
	curve, err := curveOfKey(key)
	if err != nil {
		return false, err
	}
	h, err := hashOf(alg)
	if err != nil {
		return false, err
	}
	if len(signature) != 2*curve.Size {
		return false, nil
	}

	digest := h.New()
	digest.Write(data)

	r := new(big.Int).SetBytes(signature[:curve.Size])
	s := new(big.Int).SetBytes(signature[curve.Size:])
	return ecdsa.Verify(publicKey, digest.Sum(nil), r, s), nil
}

// exportPublicRaw 以 raw 格式导出公钥：EC 为未压缩点，Ed25519 与 X25519 为 32 字节公钥。
func exportPublicRaw(key *Key) ([]byte, error) {
	if key.Type != KeyTypePublic {
		return nil, invalidAccessError("only public keys can be exported in the raw format")
	}

	switch material := key.public.(type) {
	case *ecdsa.PublicKey:
		data, err := material.Bytes()
		if err != nil {
			return nil, operationError("failed to encode the public key: %s", err)
		}
		return data, nil
	case *ecdh.PublicKey:
		return material.Bytes(), nil
	case ed25519.PublicKey:
		return bytes.Clone(material), nil
	default:
		return nil, notSupportedError("%s keys cannot be exported in the raw format", key.Algorithm.Name)
	}
}

// importECRaw 从未压缩点导入 EC 公钥，raw 格式只定义了公钥。
func importECRaw(alg Algorithm, data []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	curve, err := curveByName(alg.NamedCurve)
	if err != nil {
		return nil, err
	}
	// 未压缩点为 0x04 前缀加上两个坐标。
	if len(data) != 1+2*curve.Size || data[0] != 4 {
		return nil, dataError("%s raw key data must be a %d-byte uncompressed point",
			alg.Name, 1+2*curve.Size)
	}

	if alg.Name == AlgECDH {
		publicKey, newErr := curve.ECDH.NewPublicKey(data)
		if newErr != nil {
			return nil, dataError("invalid %s public key: %s", curve.Name, newErr)
		}
		if err = checkUsages(alg.Name, KeyTypePublic, usages); err != nil {
			return nil, err
		}
		return &Key{
			Type: KeyTypePublic, Extractable: extractable, Usages: cloneUsages(usages),
			Algorithm: KeyAlgorithm{Name: alg.Name, NamedCurve: curve.Name}, public: publicKey,
		}, nil
	}

	publicKey, err := ecdsa.ParseUncompressedPublicKey(curve.Curve, data)
	if err != nil {
		return nil, dataError("invalid %s public key: %s", curve.Name, err)
	}
	return newECDSAKey(alg, publicKey, extractable, usages)
}

// deriveBitsECDH 以 ECDH 或 X25519 计算共享密钥，并按 length 截断。
func deriveBitsECDH(alg Algorithm, key *Key, length *int) ([]byte, error) {
	privateKey, ok := key.private.(*ecdh.PrivateKey)
	if !ok {
		return nil, invalidAccessError("%s derivation requires a private key", alg.Name)
	}
	if alg.Public == nil {
		return nil, typeError("%s requires the public member", alg.Name)
	}
	if alg.Public.Algorithm.Name != key.Algorithm.Name {
		return nil, invalidAccessError("the public key algorithm %s does not match %s",
			alg.Public.Algorithm.Name, key.Algorithm.Name)
	}
	if alg.Public.Algorithm.NamedCurve != key.Algorithm.NamedCurve {
		return nil, invalidAccessError("the public key curve %s does not match %s",
			alg.Public.Algorithm.NamedCurve, key.Algorithm.NamedCurve)
	}

	publicKey, ok := alg.Public.public.(*ecdh.PublicKey)
	if !ok {
		return nil, invalidAccessError("%s requires an ECDH public key", alg.Name)
	}

	secret, err := privateKey.ECDH(publicKey)
	if err != nil {
		return nil, operationError("%s derivation failed: %s", alg.Name, err)
	}

	// length 为空表示返回完整的共享密钥。
	if length == nil {
		return secret, nil
	}
	if *length == 0 || *length%8 != 0 {
		return nil, operationError("%s length must be a non-zero multiple of 8, got %d", alg.Name, *length)
	}
	size := *length / 8
	if size > len(secret) {
		return nil, operationError("%s can derive at most %d bits, requested %d",
			alg.Name, len(secret)*8, *length)
	}
	return secret[:size], nil
}
