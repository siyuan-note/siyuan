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
	"crypto/rand"
	"crypto/rsa"
	"math/big"
)

// RSA 密钥的限制：Go 1.24 起生成密钥固定使用 65537 作为公开指数，且模数至少 1024 位。
const (
	rsaPublicExponent   = 65537
	rsaMinModulusLength = 1024
	rsaMaxModulusLength = 16384
)

// generateRSAKeyPair 生成 RSA 密钥对。
func generateRSAKeyPair(alg Algorithm, extractable bool, usages []KeyUsage) (*KeyPair, error) {
	h, err := hashOf(alg)
	if err != nil {
		return nil, err
	}
	if alg.ModulusLength == nil {
		return nil, typeError("%s requires the modulusLength member", alg.Name)
	}
	if alg.PublicExponent == nil {
		return nil, typeError("%s requires the publicExponent member", alg.Name)
	}

	exponent := new(big.Int).SetBytes(alg.PublicExponent)
	if !exponent.IsInt64() || exponent.Int64() != rsaPublicExponent {
		return nil, notSupportedError("%s only supports a publicExponent of %d", alg.Name, rsaPublicExponent)
	}
	if *alg.ModulusLength < rsaMinModulusLength || *alg.ModulusLength > rsaMaxModulusLength {
		return nil, notSupportedError("%s modulusLength must be between %d and %d, got %d",
			alg.Name, rsaMinModulusLength, rsaMaxModulusLength, *alg.ModulusLength)
	}

	privateKey, err := rsa.GenerateKey(rand.Reader, *alg.ModulusLength)
	if err != nil {
		return nil, operationError("failed to generate an RSA key: %s", err)
	}

	keyAlg := KeyAlgorithm{
		Name:           alg.Name,
		Hash:           h.Name,
		ModulusLength:  intPtr(privateKey.N.BitLen()),
		PublicExponent: big.NewInt(rsaPublicExponent).Bytes(),
	}
	privateUsages, publicUsages := splitAsymmetricUsages(alg.Name, usages)

	return &KeyPair{
		PrivateKey: &Key{
			Type:        KeyTypePrivate,
			Extractable: extractable,
			Usages:      privateUsages,
			Algorithm:   keyAlg,
			private:     privateKey,
		},
		PublicKey: &Key{
			Type:        KeyTypePublic,
			Extractable: true, // 公钥始终可导出
			Usages:      publicUsages,
			Algorithm:   keyAlg,
			public:      &privateKey.PublicKey,
		},
	}, nil
}

// rsaExponentBytes 将 RSA 公开指数转换为大端字节序。
func rsaExponentBytes(exponent int) []byte {
	return big.NewInt(int64(exponent)).Bytes()
}

// newRSAKey 由解析得到的密钥材料构造 Key。
func newRSAKey(alg Algorithm, hashName string, material any, extractable bool, usages []KeyUsage) (*Key, error) {
	switch typed := material.(type) {
	case *rsa.PrivateKey:
		if err := checkUsages(alg.Name, KeyTypePrivate, usages); err != nil {
			return nil, err
		}
		return &Key{
			Type:        KeyTypePrivate,
			Extractable: extractable,
			Usages:      cloneUsages(usages),
			Algorithm: KeyAlgorithm{
				Name: alg.Name, Hash: hashName,
				ModulusLength:  intPtr(typed.N.BitLen()),
				PublicExponent: rsaExponentBytes(typed.E),
			},
			private: typed,
		}, nil
	case *rsa.PublicKey:
		if err := checkUsages(alg.Name, KeyTypePublic, usages); err != nil {
			return nil, err
		}
		return &Key{
			Type:        KeyTypePublic,
			Extractable: extractable,
			Usages:      cloneUsages(usages),
			Algorithm: KeyAlgorithm{
				Name: alg.Name, Hash: hashName,
				ModulusLength:  intPtr(typed.N.BitLen()),
				PublicExponent: rsaExponentBytes(typed.E),
			},
			public: typed,
		}, nil
	default:
		return nil, dataError("%s keys require RSA key data", alg.Name)
	}
}

// signRSA 以 RSASSA-PKCS1-v1_5 或 RSA-PSS 签名。
func signRSA(alg Algorithm, key *Key, data []byte) ([]byte, error) {
	privateKey, ok := key.private.(*rsa.PrivateKey)
	if !ok {
		return nil, invalidAccessError("%s signing requires a private key", alg.Name)
	}
	h, err := hashByName(key.Algorithm.Hash)
	if err != nil {
		return nil, err
	}

	digest := h.New()
	digest.Write(data)
	hashed := digest.Sum(nil)

	switch alg.Name {
	case AlgRSASSAPKCS1:
		signature, signErr := rsa.SignPKCS1v15(rand.Reader, privateKey, h.ID, hashed)
		if signErr != nil {
			return nil, operationError("RSASSA-PKCS1-v1_5 signing failed: %s", signErr)
		}
		return signature, nil
	case AlgRSAPSS:
		options, optionsErr := pssOptions(alg, h.ID)
		if optionsErr != nil {
			return nil, optionsErr
		}
		signature, signErr := rsa.SignPSS(rand.Reader, privateKey, h.ID, hashed, options)
		if signErr != nil {
			return nil, operationError("RSA-PSS signing failed: %s", signErr)
		}
		return signature, nil
	default:
		return nil, notSupportedError("%s does not support signing", alg.Name)
	}
}

// verifyRSA 校验 RSASSA-PKCS1-v1_5 或 RSA-PSS 签名。
func verifyRSA(alg Algorithm, key *Key, signature []byte, data []byte) (bool, error) {
	publicKey, ok := key.public.(*rsa.PublicKey)
	if !ok {
		return false, invalidAccessError("%s verification requires a public key", alg.Name)
	}
	h, err := hashByName(key.Algorithm.Hash)
	if err != nil {
		return false, err
	}

	digest := h.New()
	digest.Write(data)
	hashed := digest.Sum(nil)

	switch alg.Name {
	case AlgRSASSAPKCS1:
		return rsa.VerifyPKCS1v15(publicKey, h.ID, hashed, signature) == nil, nil
	case AlgRSAPSS:
		options, optionsErr := pssOptions(alg, h.ID)
		if optionsErr != nil {
			return false, optionsErr
		}
		return rsa.VerifyPSS(publicKey, h.ID, hashed, signature, options) == nil, nil
	default:
		return false, notSupportedError("%s does not support verification", alg.Name)
	}
}

// pssOptions 构造 RSA-PSS 的选项。Go 用 0 表示自动选择盐长度，
// 因此无法表达规范允许的零长度盐。
func pssOptions(alg Algorithm, hashID stdcrypto.Hash) (*rsa.PSSOptions, error) {
	if alg.SaltLength == nil {
		return nil, typeError("RSA-PSS requires the saltLength member")
	}
	if *alg.SaltLength == 0 {
		return nil, notSupportedError("RSA-PSS with a zero-length salt is not supported by the kernel")
	}
	return &rsa.PSSOptions{SaltLength: *alg.SaltLength, Hash: hashID}, nil
}

// encryptRSAOAEP 以 RSA-OAEP 加密。
func encryptRSAOAEP(alg Algorithm, key *Key, plaintext []byte) ([]byte, error) {
	publicKey, ok := key.public.(*rsa.PublicKey)
	if !ok {
		return nil, invalidAccessError("RSA-OAEP encryption requires a public key")
	}
	h, err := hashByName(key.Algorithm.Hash)
	if err != nil {
		return nil, err
	}

	ciphertext, err := rsa.EncryptOAEP(h.New(), rand.Reader, publicKey, plaintext, alg.Label)
	if err != nil {
		return nil, operationError("RSA-OAEP encryption failed: %s", err)
	}
	return ciphertext, nil
}

// decryptRSAOAEP 以 RSA-OAEP 解密。
func decryptRSAOAEP(alg Algorithm, key *Key, ciphertext []byte) ([]byte, error) {
	privateKey, ok := key.private.(*rsa.PrivateKey)
	if !ok {
		return nil, invalidAccessError("RSA-OAEP decryption requires a private key")
	}
	h, err := hashByName(key.Algorithm.Hash)
	if err != nil {
		return nil, err
	}

	plaintext, err := rsa.DecryptOAEP(h.New(), rand.Reader, privateKey, ciphertext, alg.Label)
	if err != nil {
		return nil, operationError("RSA-OAEP decryption failed")
	}
	return plaintext, nil
}

// splitAsymmetricUsages 按算法把用法分配给私钥与公钥。
func splitAsymmetricUsages(algName string, usages []KeyUsage) (private []KeyUsage, public []KeyUsage) {
	switch algName {
	case AlgRSAOAEP:
		return filterUsages(usages, UsageDecrypt, UsageUnwrapKey),
			filterUsages(usages, UsageEncrypt, UsageWrapKey)
	case AlgECDH, AlgX25519:
		// 公钥不参与派生，usages 必须为空。
		return filterUsages(usages, UsageDeriveBits, UsageDeriveKey), []KeyUsage{}
	default:
		return filterUsages(usages, UsageSign), filterUsages(usages, UsageVerify)
	}
}
