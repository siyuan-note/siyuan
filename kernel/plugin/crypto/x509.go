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
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/x509"
)

// importSPKI 从 SubjectPublicKeyInfo 导入公钥。
func importSPKI(alg Algorithm, data []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	parsed, err := x509.ParsePKIXPublicKey(data)
	if err != nil {
		return nil, dataError("invalid SubjectPublicKeyInfo: %s", err)
	}
	return keyFromMaterial(alg, parsed, extractable, usages)
}

// importPKCS8 从 PrivateKeyInfo 导入私钥。
func importPKCS8(alg Algorithm, data []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	parsed, err := x509.ParsePKCS8PrivateKey(data)
	if err != nil {
		return nil, dataError("invalid PrivateKeyInfo: %s", err)
	}
	return keyFromMaterial(alg, parsed, extractable, usages)
}

// exportSPKI 将公钥导出为 SubjectPublicKeyInfo。
func exportSPKI(key *Key) ([]byte, error) {
	if key.Type != KeyTypePublic {
		return nil, invalidAccessError("only public keys can be exported in the spki format")
	}

	data, err := x509.MarshalPKIXPublicKey(key.public)
	if err != nil {
		return nil, operationError("failed to encode the public key: %s", err)
	}
	return data, nil
}

// exportPKCS8 将私钥导出为 PrivateKeyInfo。
func exportPKCS8(key *Key) ([]byte, error) {
	if key.Type != KeyTypePrivate {
		return nil, invalidAccessError("only private keys can be exported in the pkcs8 format")
	}

	data, err := x509.MarshalPKCS8PrivateKey(key.private)
	if err != nil {
		return nil, operationError("failed to encode the private key: %s", err)
	}
	return data, nil
}

// keyFromMaterial 校验解析出的密钥材料是否与请求的算法匹配，并构造 Key。
// 公钥与私钥由材料本身区分，调用方无需指定密钥类型。
func keyFromMaterial(alg Algorithm, material any, extractable bool, usages []KeyUsage) (*Key, error) {
	switch alg.Name {
	case AlgRSASSAPKCS1, AlgRSAPSS, AlgRSAOAEP:
		h, err := hashOf(alg)
		if err != nil {
			return nil, err
		}
		return newRSAKey(alg, h.Name, material, extractable, usages)

	case AlgECDSA:
		// EcKeyImportParams 只有 namedCurve，摘要算法在 sign/verify 时由 EcdsaParams 指定。
		return newECDSAKey(alg, material, extractable, usages)

	case AlgECDH, AlgX25519:
		return newECDHKey(alg, material, extractable, usages)

	case AlgEd25519:
		return newEd25519Key(alg, material, extractable, usages)

	default:
		return nil, notSupportedError("%s keys cannot be imported from this format", alg.Name)
	}
}

// newECDSAKey 由解析得到的材料构造 ECDSA 密钥，并校验曲线是否与参数一致。
// 密钥类型由材料决定，避免与调用方的预期不一致时把私钥标记为公钥。
func newECDSAKey(alg Algorithm, material any, extractable bool, usages []KeyUsage) (*Key, error) {
	expected, err := curveByName(alg.NamedCurve)
	if err != nil {
		return nil, err
	}

	key := &Key{
		Extractable: extractable,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name, NamedCurve: expected.Name},
	}

	var curve elliptic.Curve
	switch typed := material.(type) {
	case *ecdsa.PrivateKey:
		curve = typed.Curve
		key.Type = KeyTypePrivate
		key.private = typed
	case *ecdsa.PublicKey:
		curve = typed.Curve
		key.Type = KeyTypePublic
		key.public = typed
	default:
		return nil, dataError("ECDSA keys require EC key data")
	}
	if curve != expected.Curve {
		return nil, dataError("the key data uses a curve other than %s", expected.Name)
	}

	if err = checkUsages(alg.Name, key.Type, usages); err != nil {
		return nil, err
	}
	return key, nil
}

// newECDHKey 由解析得到的材料构造 ECDH 或 X25519 密钥。
// x509 将 EC 密钥解析为 ecdsa 类型，需转换为 ecdh 类型后使用。
// 密钥类型由材料决定，避免与调用方的预期不一致时把私钥标记为公钥。
func newECDHKey(alg Algorithm, material any, extractable bool, usages []KeyUsage) (*Key, error) {
	keyAlg := KeyAlgorithm{Name: alg.Name}
	if alg.Name == AlgECDH {
		curve, err := curveByName(alg.NamedCurve)
		if err != nil {
			return nil, err
		}
		keyAlg.NamedCurve = curve.Name
	}

	key := &Key{Extractable: extractable, Usages: cloneUsages(usages), Algorithm: keyAlg}

	switch typed := material.(type) {
	case *ecdh.PrivateKey:
		if err := checkECDHCurve(alg, typed.Curve()); err != nil {
			return nil, err
		}
		key.Type = KeyTypePrivate
		key.private = typed
	case *ecdh.PublicKey:
		if err := checkECDHCurve(alg, typed.Curve()); err != nil {
			return nil, err
		}
		key.Type = KeyTypePublic
		key.public = typed
	case *ecdsa.PrivateKey:
		converted, err := typed.ECDH()
		if err != nil {
			return nil, dataError("the EC private key cannot be used for ECDH: %s", err)
		}
		if err = checkECDHCurve(alg, converted.Curve()); err != nil {
			return nil, err
		}
		key.Type = KeyTypePrivate
		key.private = converted
	case *ecdsa.PublicKey:
		converted, err := typed.ECDH()
		if err != nil {
			return nil, dataError("the EC public key cannot be used for ECDH: %s", err)
		}
		if err = checkECDHCurve(alg, converted.Curve()); err != nil {
			return nil, err
		}
		key.Type = KeyTypePublic
		key.public = converted
	default:
		return nil, dataError("%s keys require EC or X25519 key data", alg.Name)
	}

	if err := checkUsages(alg.Name, key.Type, usages); err != nil {
		return nil, err
	}
	return key, nil
}

// checkECDHCurve 校验密钥材料的曲线与请求的算法一致。
func checkECDHCurve(alg Algorithm, curve ecdh.Curve) error {
	if alg.Name == AlgX25519 {
		if curve != ecdh.X25519() {
			return dataError("X25519 keys require X25519 key data")
		}
		return nil
	}

	expected, err := curveByName(alg.NamedCurve)
	if err != nil {
		return err
	}
	if curve != expected.ECDH {
		return dataError("the key data uses a curve other than %s", expected.Name)
	}
	return nil
}

// newEd25519Key 由解析得到的材料构造 Ed25519 密钥，密钥类型由材料决定。
func newEd25519Key(alg Algorithm, material any, extractable bool, usages []KeyUsage) (*Key, error) {
	key := &Key{
		Extractable: extractable,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name},
	}
	switch typed := material.(type) {
	case ed25519.PrivateKey:
		key.Type = KeyTypePrivate
		key.private = typed
	case ed25519.PublicKey:
		key.Type = KeyTypePublic
		key.public = typed
	default:
		return nil, dataError("Ed25519 keys require Ed25519 key data")
	}

	if err := checkUsages(alg.Name, key.Type, usages); err != nil {
		return nil, err
	}
	return key, nil
}
