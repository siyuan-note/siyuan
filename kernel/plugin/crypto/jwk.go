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
	"encoding/base64"
	"encoding/json"
	"fmt"

	jose "github.com/go-jose/go-jose/v4"
)

// JWK 的 kty 取值。
const (
	jwkKeyTypeOct = "oct"
	jwkKeyTypeOKP = "OKP"
)

// JWK 的 crv 取值，用于 OKP 类型的密钥。
const (
	jwkCurveEd25519 = "Ed25519"
	jwkCurveX25519  = "X25519"
)

// jsonWebKey 是 JWK 的通用视图：非对称密钥材料交由 go-jose 处理，
// 此处负责 Web Crypto 关心的元数据（kty、alg、ext、key_ops）与对称、OKP 密钥材料。
type jsonWebKey struct {
	Kty string `json:"kty,omitempty"`
	Crv string `json:"crv,omitempty"`
	Alg string `json:"alg,omitempty"`
	Use string `json:"use,omitempty"`

	KeyOps []string `json:"key_ops,omitempty"`
	Ext    *bool    `json:"ext,omitempty"`

	K string `json:"k,omitempty"` // 对称密钥材料
	X string `json:"x,omitempty"` // OKP 与 EC 的公钥材料
	D string `json:"d,omitempty"` // 私钥材料

	raw []byte // 原始 JSON，RSA 与 EC 的密钥材料交由 go-jose 解析
}

// importJWK 从 JWK 导入密钥。
func importJWK(alg Algorithm, data []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	var jwk jsonWebKey
	if err := json.Unmarshal(data, &jwk); err != nil {
		return nil, dataError("invalid JSON Web Key: %s", err)
	}
	jwk.raw = data
	if jwk.Kty == "" {
		return nil, dataError("JSON Web Key is missing the kty member")
	}
	if err := checkJWKMetadata(&jwk, extractable, usages); err != nil {
		return nil, err
	}

	key, err := importJWKMaterial(&jwk, alg, extractable, usages)
	if err != nil {
		return nil, err
	}

	// alg 需要密钥位长才能确定，因此在密钥构造完成后校验。
	if jwk.Alg != "" {
		expected := jwkAlgorithm(key)
		if expected != "" && jwk.Alg != expected {
			return nil, dataError("JSON Web Key alg %q does not match %s", jwk.Alg, alg.Name)
		}
	}
	return key, nil
}

// importJWKMaterial 按算法解析 JWK 的密钥材料。
func importJWKMaterial(jwk *jsonWebKey, alg Algorithm, extractable bool, usages []KeyUsage) (*Key, error) {
	switch alg.Name {
	case AlgAESCBC, AlgAESCTR, AlgAESGCM, AlgAESKW:
		secret, err := decodeJWKOct(jwk, alg.Name)
		if err != nil {
			return nil, err
		}
		if err = checkUsages(alg.Name, KeyTypeSecret, usages); err != nil {
			return nil, err
		}
		return importAESKey(alg, secret, extractable, usages)
	case AlgHMAC:
		secret, err := decodeJWKOct(jwk, alg.Name)
		if err != nil {
			return nil, err
		}
		if err = checkUsages(alg.Name, KeyTypeSecret, usages); err != nil {
			return nil, err
		}
		return importHMACKey(alg, secret, extractable, usages)
	case AlgEd25519, AlgX25519:
		return importJWKOKP(jwk, alg, extractable, usages)
	case AlgRSASSAPKCS1, AlgRSAPSS, AlgRSAOAEP, AlgECDSA, AlgECDH:
		return importJWKAsymmetric(jwk, alg, extractable, usages)
	default:
		return nil, notSupportedError("%s keys cannot be imported from the jwk format", alg.Name)
	}
}

// importJWKOKP 解析 OKP 类型的 JWK。go-jose 不支持 X25519，因此两种曲线都在此处理。
func importJWKOKP(jwk *jsonWebKey, alg Algorithm, extractable bool, usages []KeyUsage) (*Key, error) {
	if jwk.Kty != jwkKeyTypeOKP {
		return nil, dataError("%s keys require a JSON Web Key with kty %q, got %q",
			alg.Name, jwkKeyTypeOKP, jwk.Kty)
	}

	expectedCurve := jwkCurveEd25519
	if alg.Name == AlgX25519 {
		expectedCurve = jwkCurveX25519
	}
	if jwk.Crv != expectedCurve {
		return nil, dataError("%s keys require crv %q, got %q", alg.Name, expectedCurve, jwk.Crv)
	}
	if jwk.X == "" {
		return nil, dataError("JSON Web Key is missing the x member")
	}

	public, err := decodeBase64URL(jwk.X, "x")
	if err != nil {
		return nil, err
	}

	// 含 d 成员的是私钥，否则是公钥。
	if jwk.D == "" {
		if alg.Name == AlgX25519 {
			return importX25519Raw(alg, public, extractable, usages)
		}
		return importEd25519Raw(alg, public, extractable, usages)
	}

	private, err := decodeBase64URL(jwk.D, "d")
	if err != nil {
		return nil, err
	}
	if err = checkUsages(alg.Name, KeyTypePrivate, usages); err != nil {
		return nil, err
	}

	key := &Key{
		Type:        KeyTypePrivate,
		Extractable: extractable,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: alg.Name},
	}

	if alg.Name == AlgX25519 {
		privateKey, newErr := ecdh.X25519().NewPrivateKey(private)
		if newErr != nil {
			return nil, dataError("invalid X25519 private key: %s", newErr)
		}
		// 校验 d 与 x 是否对应同一密钥。
		if !bytes.Equal(privateKey.PublicKey().Bytes(), public) {
			return nil, dataError("the X25519 private key does not match the public key")
		}
		key.private = privateKey
		return key, nil
	}

	if len(private) != ed25519.SeedSize {
		return nil, dataError("Ed25519 private key data must be %d bytes, got %d",
			ed25519.SeedSize, len(private))
	}
	privateKey := ed25519.NewKeyFromSeed(private)
	if !bytes.Equal(privateKey.Public().(ed25519.PublicKey), public) {
		return nil, dataError("the Ed25519 private key does not match the public key")
	}
	key.private = privateKey
	return key, nil
}

// importJWKAsymmetric 借助 go-jose 解析 RSA 与 EC 的 JWK 密钥材料。
func importJWKAsymmetric(jwk *jsonWebKey, alg Algorithm, extractable bool, usages []KeyUsage) (*Key, error) {
	// go-jose 会校验坐标长度、点是否在曲线上，并对 RSA 私钥执行 Validate，
	// 并按是否含 d 成员返回私钥或公钥类型的材料。
	var parsed jose.JSONWebKey
	if err := parsed.UnmarshalJSON(jwk.raw); err != nil {
		return nil, dataError("invalid JSON Web Key: %s", err)
	}
	return keyFromMaterial(alg, parsed.Key, extractable, usages)
}

// exportJWK 将密钥导出为 JWK。
func exportJWK(key *Key) ([]byte, error) {
	jwk := jsonWebKey{Ext: &key.Extractable, Alg: jwkAlgorithm(key)}
	for _, usage := range key.Usages {
		jwk.KeyOps = append(jwk.KeyOps, string(usage))
	}

	switch key.Algorithm.Name {
	case AlgAESCBC, AlgAESCTR, AlgAESGCM, AlgAESKW, AlgHMAC:
		jwk.Kty = jwkKeyTypeOct
		jwk.K = base64.RawURLEncoding.EncodeToString(key.secret)
		return json.Marshal(jwk)

	case AlgEd25519, AlgX25519:
		if err := exportJWKOKP(key, &jwk); err != nil {
			return nil, err
		}
		return json.Marshal(jwk)

	case AlgRSASSAPKCS1, AlgRSAPSS, AlgRSAOAEP, AlgECDSA, AlgECDH:
		return exportJWKAsymmetric(key, &jwk)

	default:
		return nil, notSupportedError("%s keys cannot be exported in the jwk format", key.Algorithm.Name)
	}
}

// exportJWKOKP 导出 Ed25519 与 X25519 的 JWK 密钥材料。
func exportJWKOKP(key *Key, jwk *jsonWebKey) error {
	jwk.Kty = jwkKeyTypeOKP
	jwk.Crv = jwkCurveEd25519
	if key.Algorithm.Name == AlgX25519 {
		jwk.Crv = jwkCurveX25519
	}

	switch material := key.private.(type) {
	case ed25519.PrivateKey:
		jwk.D = base64.RawURLEncoding.EncodeToString(material.Seed())
		jwk.X = base64.RawURLEncoding.EncodeToString(material.Public().(ed25519.PublicKey))
		return nil
	case *ecdh.PrivateKey:
		jwk.D = base64.RawURLEncoding.EncodeToString(material.Bytes())
		jwk.X = base64.RawURLEncoding.EncodeToString(material.PublicKey().Bytes())
		return nil
	}

	switch material := key.public.(type) {
	case ed25519.PublicKey:
		jwk.X = base64.RawURLEncoding.EncodeToString(material)
		return nil
	case *ecdh.PublicKey:
		jwk.X = base64.RawURLEncoding.EncodeToString(material.Bytes())
		return nil
	default:
		return operationError("the key does not hold %s key material", key.Algorithm.Name)
	}
}

// exportJWKAsymmetric 借助 go-jose 导出 RSA 与 EC 的密钥材料，再合并 Web Crypto 的元数据。
func exportJWKAsymmetric(key *Key, jwk *jsonWebKey) ([]byte, error) {
	material := key.public
	if key.Type == KeyTypePrivate {
		material = key.private
	}

	// ECDH 的密钥在内核中以 ecdh 类型保存，go-jose 只认 ecdsa 类型。
	converted, err := ecdsaMaterialOf(material)
	if err != nil {
		return nil, err
	}

	encoded, err := (&jose.JSONWebKey{Key: converted}).MarshalJSON()
	if err != nil {
		return nil, operationError("failed to encode the JSON Web Key: %s", err)
	}

	// 将 go-jose 输出的密钥材料与 Web Crypto 的元数据合并到同一个对象。
	var merged map[string]any
	if err = json.Unmarshal(encoded, &merged); err != nil {
		return nil, operationError("failed to decode the JSON Web Key: %s", err)
	}
	// go-jose 不输出这些成员，由 Web Crypto 规范决定其取值。
	delete(merged, "use")
	delete(merged, "kid")
	if jwk.Alg != "" {
		merged["alg"] = jwk.Alg
	}
	if len(jwk.KeyOps) > 0 {
		merged["key_ops"] = jwk.KeyOps
	}
	merged["ext"] = key.Extractable

	return json.Marshal(merged)
}

// checkJWKMetadata 校验 JWK 的 ext、key_ops 与 use 成员是否与导入参数相符。
func checkJWKMetadata(jwk *jsonWebKey, extractable bool, usages []KeyUsage) error {
	if jwk.Ext != nil && !*jwk.Ext && extractable {
		return dataError("JSON Web Key is marked as non-extractable")
	}

	if len(jwk.KeyOps) > 0 {
		allowed := make([]KeyUsage, 0, len(jwk.KeyOps))
		for _, op := range jwk.KeyOps {
			allowed = append(allowed, KeyUsage(op))
		}
		for _, usage := range usages {
			if !containsUsage(allowed, usage) {
				return dataError("JSON Web Key key_ops does not allow %s", usage)
			}
		}
	}

	if jwk.Use != "" {
		if expected := jwkUse(usages); expected != "" && jwk.Use != expected {
			return dataError("JSON Web Key use %q does not match the requested key usages", jwk.Use)
		}
	}
	return nil
}

// jwkUse 返回用法列表对应的 use 取值，混合用法返回空串表示不做校验。
func jwkUse(usages []KeyUsage) string {
	var sig, enc bool
	for _, usage := range usages {
		switch usage {
		case UsageSign, UsageVerify:
			sig = true
		case UsageEncrypt, UsageDecrypt, UsageWrapKey, UsageUnwrapKey:
			enc = true
		}
	}

	switch {
	case sig && !enc:
		return "sig"
	case enc && !sig:
		return "enc"
	default:
		return ""
	}
}

// decodeJWKOct 解析对称密钥的 k 成员。
func decodeJWKOct(jwk *jsonWebKey, algName string) ([]byte, error) {
	if jwk.Kty != jwkKeyTypeOct {
		return nil, dataError("%s keys require a JSON Web Key with kty %q, got %q", algName, jwkKeyTypeOct, jwk.Kty)
	}
	if jwk.K == "" {
		return nil, dataError("JSON Web Key is missing the k member")
	}

	secret, err := decodeBase64URL(jwk.K, "k")
	if err != nil {
		return nil, err
	}
	return secret, nil
}

// decodeBase64URL 解析 JWK 中的 base64url 成员，不接受填充字符。
func decodeBase64URL(value string, member string) ([]byte, error) {
	ret, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, dataError("JSON Web Key %s member is not valid base64url: %s", member, err)
	}
	return ret, nil
}

// ecdsaMaterialOf 将内核保存的密钥材料转换为 go-jose 可编码的类型。
// crypto/ecdh 的密钥需要转换为 crypto/ecdsa 的等价表示。
func ecdsaMaterialOf(material any) (any, error) {
	switch typed := material.(type) {
	case *ecdh.PrivateKey:
		curve, err := ellipticCurveOf(typed.Curve())
		if err != nil {
			return nil, err
		}
		privateKey, err := ecdsa.ParseRawPrivateKey(curve, typed.Bytes())
		if err != nil {
			return nil, operationError("failed to convert the ECDH private key: %s", err)
		}
		return privateKey, nil
	case *ecdh.PublicKey:
		curve, err := ellipticCurveOf(typed.Curve())
		if err != nil {
			return nil, err
		}
		publicKey, err := ecdsa.ParseUncompressedPublicKey(curve, typed.Bytes())
		if err != nil {
			return nil, operationError("failed to convert the ECDH public key: %s", err)
		}
		return publicKey, nil
	default:
		return material, nil
	}
}

// ellipticCurveOf 返回 ecdh 曲线对应的 elliptic 曲线。
func ellipticCurveOf(curve ecdh.Curve) (elliptic.Curve, error) {
	for _, info := range curves {
		if info.ECDH == curve {
			return info.Curve, nil
		}
	}
	return nil, notSupportedError("the key uses a curve that cannot be encoded as a JSON Web Key")
}

// jwkAlgorithm 返回密钥对应的 JWK alg 取值，无对应取值时返回空串。
func jwkAlgorithm(key *Key) string {
	switch key.Algorithm.Name {
	case AlgAESCBC, AlgAESCTR, AlgAESGCM, AlgAESKW:
		if key.Algorithm.Length == nil {
			return ""
		}
		suffix := map[string]string{
			AlgAESCBC: "CBC",
			AlgAESCTR: "CTR",
			AlgAESGCM: "GCM",
			AlgAESKW:  "KW",
		}[key.Algorithm.Name]
		return fmt.Sprintf("A%d%s", *key.Algorithm.Length, suffix)
	case AlgRSASSAPKCS1:
		return jwkHashSuffix("RS", key.Algorithm.Hash)
	case AlgRSAPSS:
		return jwkHashSuffix("PS", key.Algorithm.Hash)
	case AlgRSAOAEP:
		switch key.Algorithm.Hash {
		case AlgSHA1:
			return "RSA-OAEP"
		case AlgSHA256:
			return "RSA-OAEP-256"
		case AlgSHA384:
			return "RSA-OAEP-384"
		case AlgSHA512:
			return "RSA-OAEP-512"
		default:
			return ""
		}
	case AlgECDSA:
		switch key.Algorithm.NamedCurve {
		case CurveP256:
			return "ES256"
		case CurveP384:
			return "ES384"
		case CurveP521:
			return "ES512"
		default:
			return ""
		}
	case AlgECDH, AlgX25519, AlgEd25519:
		// 规范未为这些算法定义 alg 取值。
		return ""
	case AlgHMAC:
		return jwkHashSuffix("HS", key.Algorithm.Hash)
	default:
		return ""
	}
}

// jwkHashSuffix 按摘要算法拼接 alg 取值，例如 RS256。SHA-1 的后缀为 1。
func jwkHashSuffix(prefix string, hashName string) string {
	switch hashName {
	case AlgSHA1:
		return prefix + "1"
	case AlgSHA256:
		return prefix + "256"
	case AlgSHA384:
		return prefix + "384"
	case AlgSHA512:
		return prefix + "512"
	default:
		return ""
	}
}
