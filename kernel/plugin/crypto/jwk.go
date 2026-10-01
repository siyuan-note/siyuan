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
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// JWK 的 kty 取值。
const jwkKeyTypeOct = "oct"

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
	X string `json:"x,omitempty"` // OKP 公钥材料
	D string `json:"d,omitempty"` // OKP 私钥材料
}

// importJWK 从 JWK 导入密钥。
func importJWK(alg Algorithm, data []byte, extractable bool, usages []KeyUsage) (*Key, error) {
	var jwk jsonWebKey
	if err := json.Unmarshal(data, &jwk); err != nil {
		return nil, dataError("invalid JSON Web Key: %s", err)
	}
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
	case AlgAESCBC, AlgAESCTR, AlgAESGCM:
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
	default:
		return nil, notSupportedError("%s keys cannot be imported from the jwk format", alg.Name)
	}
}

// exportJWK 将密钥导出为 JWK。
func exportJWK(key *Key) ([]byte, error) {
	jwk := jsonWebKey{Ext: &key.Extractable, Alg: jwkAlgorithm(key)}
	for _, usage := range key.Usages {
		jwk.KeyOps = append(jwk.KeyOps, string(usage))
	}

	switch key.Algorithm.Name {
	case AlgAESCBC, AlgAESCTR, AlgAESGCM, AlgHMAC:
		jwk.Kty = jwkKeyTypeOct
		jwk.K = base64.RawURLEncoding.EncodeToString(key.secret)
	default:
		return nil, notSupportedError("%s keys cannot be exported in the jwk format", key.Algorithm.Name)
	}

	return json.Marshal(jwk)
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

// jwkAlgorithm 返回密钥对应的 JWK alg 取值，无对应取值时返回空串。
func jwkAlgorithm(key *Key) string {
	switch key.Algorithm.Name {
	case AlgAESCBC, AlgAESCTR, AlgAESGCM:
		if key.Algorithm.Length == nil {
			return ""
		}
		suffix := map[string]string{
			AlgAESCBC: "CBC",
			AlgAESCTR: "CTR",
			AlgAESGCM: "GCM",
		}[key.Algorithm.Name]
		return fmt.Sprintf("A%d%s", *key.Algorithm.Length, suffix)
	case AlgHMAC:
		switch key.Algorithm.Hash {
		case AlgSHA1:
			return "HS1"
		case AlgSHA256:
			return "HS256"
		case AlgSHA384:
			return "HS384"
		case AlgSHA512:
			return "HS512"
		default:
			return ""
		}
	default:
		return ""
	}
}
