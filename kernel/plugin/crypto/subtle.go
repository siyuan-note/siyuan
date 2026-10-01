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

import "bytes"

// Encrypt 使用密钥加密数据。
func Encrypt(alg Algorithm, key *Key, data []byte) ([]byte, error) {
	if err := checkOperation(key, alg.Name, UsageEncrypt); err != nil {
		return nil, err
	}
	return encrypt(alg, key, data)
}

// Decrypt 使用密钥解密数据。
func Decrypt(alg Algorithm, key *Key, data []byte) ([]byte, error) {
	if err := checkOperation(key, alg.Name, UsageDecrypt); err != nil {
		return nil, err
	}
	return decrypt(alg, key, data)
}

// encrypt 按算法分发加密，不校验用法，便于 wrapKey 复用。
func encrypt(alg Algorithm, key *Key, data []byte) ([]byte, error) {
	switch alg.Name {
	case AlgAESGCM:
		return encryptAESGCM(alg, key, data)
	case AlgAESCBC:
		return encryptAESCBC(alg, key, data)
	case AlgAESCTR:
		return cryptAESCTR(alg, key, data)
	default:
		return nil, notSupportedError("%s does not support encryption", alg.Name)
	}
}

// decrypt 按算法分发解密，不校验用法，便于 unwrapKey 复用。
func decrypt(alg Algorithm, key *Key, data []byte) ([]byte, error) {
	switch alg.Name {
	case AlgAESGCM:
		return decryptAESGCM(alg, key, data)
	case AlgAESCBC:
		return decryptAESCBC(alg, key, data)
	case AlgAESCTR:
		return cryptAESCTR(alg, key, data)
	default:
		return nil, notSupportedError("%s does not support decryption", alg.Name)
	}
}

// Sign 使用密钥对数据签名。
func Sign(alg Algorithm, key *Key, data []byte) ([]byte, error) {
	if err := checkOperation(key, alg.Name, UsageSign); err != nil {
		return nil, err
	}

	switch alg.Name {
	case AlgHMAC:
		return hmacSum(key, data)
	default:
		return nil, notSupportedError("%s does not support signing", alg.Name)
	}
}

// Verify 校验数据的签名。
func Verify(alg Algorithm, key *Key, signature []byte, data []byte) (bool, error) {
	if err := checkOperation(key, alg.Name, UsageVerify); err != nil {
		return false, err
	}

	switch alg.Name {
	case AlgHMAC:
		return verifyHMAC(key, signature, data)
	default:
		return false, notSupportedError("%s does not support verification", alg.Name)
	}
}

// GenerateKey 生成密钥或密钥对。
func GenerateKey(alg Algorithm, extractable bool, usages []KeyUsage) (*KeyPair, error) {
	switch alg.Name {
	case AlgAESCBC, AlgAESCTR, AlgAESGCM:
		if err := checkUsages(alg.Name, KeyTypeSecret, usages); err != nil {
			return nil, err
		}
		key, err := generateAESKey(alg, extractable, usages)
		if err != nil {
			return nil, err
		}
		return &KeyPair{Secret: key}, nil
	case AlgHMAC:
		if err := checkUsages(alg.Name, KeyTypeSecret, usages); err != nil {
			return nil, err
		}
		key, err := generateHMACKey(alg, extractable, usages)
		if err != nil {
			return nil, err
		}
		return &KeyPair{Secret: key}, nil
	default:
		return nil, notSupportedError("%s does not support key generation", alg.Name)
	}
}

// ImportKey 从外部格式导入密钥。
func ImportKey(format KeyFormat, data KeyData, alg Algorithm, extractable bool, usages []KeyUsage) (*Key, error) {
	switch format {
	case FormatRaw:
		return importRawKey(alg, data.Raw, extractable, usages)
	case FormatJWK:
		return importJWK(alg, data.JSON, extractable, usages)
	default:
		return nil, notSupportedError("%s keys cannot be imported from the %s format", alg.Name, format)
	}
}

// importRawKey 从原始字节导入对称密钥与 KDF 基础密钥。
func importRawKey(alg Algorithm, data []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	switch alg.Name {
	case AlgAESCBC, AlgAESCTR, AlgAESGCM:
		if err := checkUsages(alg.Name, KeyTypeSecret, usages); err != nil {
			return nil, err
		}
		return importAESKey(alg, data, extractable, usages)
	case AlgHMAC:
		if err := checkUsages(alg.Name, KeyTypeSecret, usages); err != nil {
			return nil, err
		}
		return importHMACKey(alg, data, extractable, usages)
	case AlgHKDF, AlgPBKDF2:
		if err := checkUsages(alg.Name, KeyTypeSecret, usages); err != nil {
			return nil, err
		}
		return importKDFKey(alg, data, extractable, usages)
	default:
		return nil, notSupportedError("%s keys cannot be imported from the raw format", alg.Name)
	}
}

// ExportKey 将密钥导出为外部格式。
func ExportKey(format KeyFormat, key *Key) (*KeyData, error) {
	if key == nil {
		return nil, typeError("key is required")
	}
	if !key.Extractable {
		return nil, invalidAccessError("key is not extractable")
	}
	return exportKey(format, key)
}

// exportKey 按格式导出密钥，不校验 extractable，便于 wrapKey 复用。
func exportKey(format KeyFormat, key *Key) (*KeyData, error) {
	switch format {
	case FormatRaw:
		switch key.Algorithm.Name {
		case AlgAESCBC, AlgAESCTR, AlgAESGCM, AlgHMAC:
			// 复制密钥材料，避免调用方修改导出结果时影响密钥本身。
			return &KeyData{Raw: bytes.Clone(key.secret)}, nil
		default:
			return nil, notSupportedError("%s keys cannot be exported in the raw format", key.Algorithm.Name)
		}
	case FormatJWK:
		data, err := exportJWK(key)
		if err != nil {
			return nil, err
		}
		return &KeyData{JSON: data}, nil
	default:
		return nil, notSupportedError("%s keys cannot be exported in the %s format", key.Algorithm.Name, format)
	}
}

// DeriveBits 派生比特串，length 为 nil 表示未指定长度。
func DeriveBits(alg Algorithm, key *Key, length *int) ([]byte, error) {
	if err := checkOperation(key, alg.Name, UsageDeriveBits); err != nil {
		return nil, err
	}
	return deriveBits(alg, key, length)
}

// deriveBits 按算法分发派生，不校验用法，便于 deriveKey 复用。
func deriveBits(alg Algorithm, key *Key, length *int) ([]byte, error) {
	switch alg.Name {
	case AlgHKDF:
		return deriveBitsHKDF(alg, key, length)
	case AlgPBKDF2:
		return deriveBitsPBKDF2(alg, key, length)
	default:
		return nil, notSupportedError("%s does not support bit derivation", alg.Name)
	}
}

// DeriveKey 派生密钥：先按目标算法所需长度派生比特串，再以 raw 格式导入。
func DeriveKey(alg Algorithm, key *Key, derived Algorithm, extractable bool, usages []KeyUsage) (*Key, error) {
	if err := checkOperation(key, alg.Name, UsageDeriveKey); err != nil {
		return nil, err
	}

	length, err := derivedKeyLength(derived)
	if err != nil {
		return nil, err
	}

	bits, err := deriveBits(alg, key, length)
	if err != nil {
		return nil, err
	}
	return importRawKey(derived, bits, extractable, usages)
}

// derivedKeyLength 返回派生目标算法所需的密钥位长。
func derivedKeyLength(derived Algorithm) (*int, error) {
	switch derived.Name {
	case AlgAESCBC, AlgAESCTR, AlgAESGCM:
		if derived.Length == nil {
			return nil, typeError("%s requires the length member", derived.Name)
		}
		if !containsInt(aesKeyLengths, *derived.Length) {
			return nil, operationError("%s key length must be 128, 192 or 256, got %d", derived.Name, *derived.Length)
		}
		return derived.Length, nil
	case AlgHMAC:
		if derived.Length != nil {
			if *derived.Length == 0 {
				return nil, typeError("HMAC length must not be zero")
			}
			return derived.Length, nil
		}
		h, err := hashOf(derived)
		if err != nil {
			return nil, err
		}
		return intPtr(h.New().BlockSize() * 8), nil
	case AlgHKDF, AlgPBKDF2:
		return nil, notSupportedError("%s keys cannot be derived", derived.Name)
	default:
		return nil, notSupportedError("%s keys cannot be derived", derived.Name)
	}
}

// WrapKey 导出目标密钥后用包装密钥加密。
func WrapKey(format KeyFormat, key *Key, wrappingKey *Key, alg Algorithm) ([]byte, error) {
	if err := checkOperation(wrappingKey, alg.Name, UsageWrapKey); err != nil {
		return nil, err
	}
	if key == nil {
		return nil, typeError("key is required")
	}
	if !key.Extractable {
		return nil, invalidAccessError("key is not extractable")
	}

	data, err := exportKey(format, key)
	if err != nil {
		return nil, err
	}

	plaintext := data.Raw
	if format == FormatJWK {
		plaintext = data.JSON
	}
	return encrypt(alg, wrappingKey, plaintext)
}

// UnwrapKey 用包装密钥解密后导入目标密钥。
func UnwrapKey(format KeyFormat, wrapped []byte, unwrappingKey *Key, alg Algorithm,
	unwrapped Algorithm, extractable bool, usages []KeyUsage) (*Key, error) {
	if err := checkOperation(unwrappingKey, alg.Name, UsageUnwrapKey); err != nil {
		return nil, err
	}

	plaintext, err := decrypt(alg, unwrappingKey, wrapped)
	if err != nil {
		return nil, err
	}

	data := KeyData{Raw: plaintext}
	if format == FormatJWK {
		data = KeyData{JSON: plaintext}
	}
	return ImportKey(format, data, unwrapped, extractable, usages)
}
