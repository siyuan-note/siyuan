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
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestGenerateAESKeyLengths(t *testing.T) {
	for _, length := range []int{128, 192, 256} {
		alg := Algorithm{Name: AlgAESGCM, Length: intPtr(length)}
		pair, err := GenerateKey(alg, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
		if err != nil {
			t.Fatalf("length %d: %v", length, err)
		}
		if len(pair.Secret.secret) != length/8 {
			t.Fatalf("length %d: key material = %d bytes", length, len(pair.Secret.secret))
		}
	}

	// 非法长度返回 OperationError，缺少 length 返回 TypeError。
	bad := Algorithm{Name: AlgAESGCM, Length: intPtr(100)}
	if _, err := GenerateKey(bad, true, []KeyUsage{UsageEncrypt}); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
	missing := Algorithm{Name: AlgAESGCM}
	if _, err := GenerateKey(missing, true, []KeyUsage{UsageEncrypt}); errorName(t, err) != ErrNameType {
		t.Fatalf("error = %v, want TypeError", err)
	}
}

func TestGenerateHMACKeyDefaultLength(t *testing.T) {
	// 未指定 length 时使用摘要算法的分组长度。
	cases := map[string]int{AlgSHA1: 512, AlgSHA256: 512, AlgSHA384: 1024, AlgSHA512: 1024}
	for hashName, want := range cases {
		alg := Algorithm{Name: AlgHMAC, Hash: hashName}
		pair, err := GenerateKey(alg, true, []KeyUsage{UsageSign})
		if err != nil {
			t.Fatalf("%s: %v", hashName, err)
		}
		if *pair.Secret.Algorithm.Length != want {
			t.Fatalf("%s: length = %d, want %d", hashName, *pair.Secret.Algorithm.Length, want)
		}
		if len(pair.Secret.secret) != want/8 {
			t.Fatalf("%s: key material = %d bytes, want %d", hashName, len(pair.Secret.secret), want/8)
		}
	}

	// 缺少 hash 返回 TypeError，length 为零返回 OperationError。
	if _, err := GenerateKey(Algorithm{Name: AlgHMAC}, true, []KeyUsage{UsageSign}); errorName(t, err) != ErrNameType {
		t.Fatalf("error = %v, want TypeError", err)
	}
	zero := Algorithm{Name: AlgHMAC, Hash: AlgSHA256, Length: intPtr(0)}
	if _, err := GenerateKey(zero, true, []KeyUsage{UsageSign}); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
}

func TestCheckUsagesRejectsDisallowedAndEmpty(t *testing.T) {
	// AES 密钥不能用于签名。
	alg := Algorithm{Name: AlgAESGCM, Length: intPtr(128)}
	if _, err := GenerateKey(alg, true, []KeyUsage{UsageSign}); errorName(t, err) != ErrNameSyntax {
		t.Fatalf("error = %v, want SyntaxError", err)
	}

	// 对称密钥必须至少声明一种用法。
	if _, err := GenerateKey(alg, true, nil); errorName(t, err) != ErrNameSyntax {
		t.Fatalf("error = %v, want SyntaxError", err)
	}
}

func TestOperationsRequireMatchingKey(t *testing.T) {
	alg := Algorithm{Name: AlgAESGCM, IV: bytes.Repeat([]byte{1}, 12)}

	// 密钥未声明 encrypt 用法。
	key := newSecretKey(AlgAESGCM, "", bytes.Repeat([]byte{2}, 16), UsageDecrypt)
	if _, err := Encrypt(alg, key, nil); errorName(t, err) != ErrNameInvalidAccess {
		t.Fatalf("error = %v, want InvalidAccessError", err)
	}

	// 密钥算法与请求算法不一致。
	other := newSecretKey(AlgAESCBC, "", bytes.Repeat([]byte{2}, 16), UsageEncrypt)
	if _, err := Encrypt(alg, other, nil); errorName(t, err) != ErrNameInvalidAccess {
		t.Fatalf("error = %v, want InvalidAccessError", err)
	}

	// 缺少密钥。
	if _, err := Encrypt(alg, nil, nil); errorName(t, err) != ErrNameType {
		t.Fatalf("error = %v, want TypeError", err)
	}
}

func TestImportExportRawAES(t *testing.T) {
	secret := bytes.Repeat([]byte{5}, 32)
	alg := Algorithm{Name: AlgAESGCM}

	key, err := ImportKey(FormatRaw, KeyData{Raw: secret}, alg, true, []KeyUsage{UsageEncrypt})
	if err != nil {
		t.Fatal(err)
	}
	if *key.Algorithm.Length != 256 {
		t.Fatalf("length = %d, want 256", *key.Algorithm.Length)
	}

	data, err := ExportKey(FormatRaw, key)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data.Raw, secret) {
		t.Fatalf("exported = %x, want %x", data.Raw, secret)
	}

	// 密钥长度非法。
	if _, err = ImportKey(FormatRaw, KeyData{Raw: secret[:20]}, alg, true, []KeyUsage{UsageEncrypt}); errorName(t, err) != ErrNameData {
		t.Fatalf("error = %v, want DataError", err)
	}

	// length 与实际密钥材料不一致。
	mismatch := Algorithm{Name: AlgAESGCM, Length: intPtr(128)}
	if _, err = ImportKey(FormatRaw, KeyData{Raw: secret}, mismatch, true, []KeyUsage{UsageEncrypt}); errorName(t, err) != ErrNameData {
		t.Fatalf("error = %v, want DataError", err)
	}
}

func TestImportHMACKeyLength(t *testing.T) {
	// 规范要求 length 不大于密钥材料位长，且大于位长减八，因此 64 位数据允许 57 到 64。
	raw := make([]byte, 8)
	cases := map[int]bool{64: true, 63: true, 57: true, 56: false, 65: false, 0: false}
	for length, ok := range cases {
		alg := Algorithm{Name: AlgHMAC, Hash: AlgSHA256, Length: intPtr(length)}
		key, err := ImportKey(FormatRaw, KeyData{Raw: raw}, alg, true, []KeyUsage{UsageSign})
		if ok {
			if err != nil {
				t.Fatalf("length %d: %v", length, err)
			}
			if *key.Algorithm.Length != length {
				t.Fatalf("length %d: algorithm length = %d", length, *key.Algorithm.Length)
			}
			continue
		}
		if errorName(t, err) != ErrNameData {
			t.Fatalf("length %d: error = %v, want DataError", length, err)
		}
	}

	// 未指定 length 时使用密钥材料的位长。
	alg := Algorithm{Name: AlgHMAC, Hash: AlgSHA256}
	key, err := ImportKey(FormatRaw, KeyData{Raw: raw}, alg, true, []KeyUsage{UsageSign})
	if err != nil {
		t.Fatal(err)
	}
	if *key.Algorithm.Length != 64 {
		t.Fatalf("length = %d, want 64", *key.Algorithm.Length)
	}

	// 空密钥材料无效。
	if _, err = ImportKey(FormatRaw, KeyData{Raw: nil}, alg, true, []KeyUsage{UsageSign}); errorName(t, err) != ErrNameData {
		t.Fatalf("error = %v, want DataError", err)
	}
}

func TestKeyMaterialIsNotAliased(t *testing.T) {
	secret := bytes.Repeat([]byte{5}, 16)
	alg := Algorithm{Name: AlgAESGCM}

	key, err := ImportKey(FormatRaw, KeyData{Raw: secret}, alg, true, []KeyUsage{UsageEncrypt})
	if err != nil {
		t.Fatal(err)
	}

	// 修改导入时传入的切片不应影响密钥。
	secret[0] ^= 0xff
	if key.secret[0] != 5 {
		t.Fatal("import aliases the caller's key material")
	}

	// 修改导出结果也不应影响密钥。
	data, err := ExportKey(FormatRaw, key)
	if err != nil {
		t.Fatal(err)
	}
	data.Raw[0] ^= 0xff
	if key.secret[0] != 5 {
		t.Fatal("export aliases the key material")
	}
}

func TestExportKeyRequiresExtractable(t *testing.T) {
	key := newSecretKey(AlgAESGCM, "", bytes.Repeat([]byte{1}, 16), UsageEncrypt)
	key.Extractable = false

	if _, err := ExportKey(FormatRaw, key); errorName(t, err) != ErrNameInvalidAccess {
		t.Fatalf("error = %v, want InvalidAccessError", err)
	}
	if _, err := ExportKey(FormatJWK, key); errorName(t, err) != ErrNameInvalidAccess {
		t.Fatalf("error = %v, want InvalidAccessError", err)
	}
}

func TestJWKRoundTrip(t *testing.T) {
	// AES 密钥的 alg 取值与密钥位长相关。
	aesCases := map[string]string{
		AlgAESGCM: "A256GCM", AlgAESCBC: "A256CBC", AlgAESCTR: "A256CTR", AlgAESKW: "A256KW",
	}
	for algName, wantAlg := range aesCases {
		// AES-KW 只接受包装用法。
		usages := []KeyUsage{UsageEncrypt, UsageDecrypt}
		if algName == AlgAESKW {
			usages = []KeyUsage{UsageWrapKey, UsageUnwrapKey}
		}

		key := newSecretKey(algName, "", bytes.Repeat([]byte{3}, 32), usages...)
		data, err := ExportKey(FormatJWK, key)
		if err != nil {
			t.Fatalf("%s: %v", algName, err)
		}

		var jwk jsonWebKey
		if err = json.Unmarshal(data.JSON, &jwk); err != nil {
			t.Fatal(err)
		}
		if jwk.Kty != jwkKeyTypeOct || jwk.Alg != wantAlg {
			t.Fatalf("%s: kty = %q, alg = %q, want oct / %s", algName, jwk.Kty, jwk.Alg, wantAlg)
		}
		if jwk.Ext == nil || !*jwk.Ext {
			t.Fatalf("%s: ext = %v, want true", algName, jwk.Ext)
		}
		if len(jwk.KeyOps) != 2 {
			t.Fatalf("%s: key_ops = %v", algName, jwk.KeyOps)
		}

		imported, err := ImportKey(FormatJWK, KeyData{JSON: data.JSON},
			Algorithm{Name: algName}, true, usages)
		if err != nil {
			t.Fatalf("%s: %v", algName, err)
		}
		if !bytes.Equal(imported.secret, key.secret) {
			t.Fatalf("%s: key material changed", algName)
		}
	}

	// HMAC 的 alg 取值与摘要算法相关。
	hmacKey := newSecretKey(AlgHMAC, AlgSHA384, bytes.Repeat([]byte{4}, 48), UsageSign, UsageVerify)
	data, err := ExportKey(FormatJWK, hmacKey)
	if err != nil {
		t.Fatal(err)
	}
	var jwk jsonWebKey
	if err = json.Unmarshal(data.JSON, &jwk); err != nil {
		t.Fatal(err)
	}
	if jwk.Alg != "HS384" {
		t.Fatalf("alg = %q, want HS384", jwk.Alg)
	}
}

func TestJWKImportValidation(t *testing.T) {
	secret := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 16))
	alg := Algorithm{Name: AlgAESGCM}
	usages := []KeyUsage{UsageEncrypt}

	cases := []struct {
		label string
		jwk   string
		want  string
	}{
		{"invalid JSON", `{`, ErrNameData},
		{"missing kty", `{"k":"` + secret + `"}`, ErrNameData},
		{"wrong kty", `{"kty":"RSA"}`, ErrNameData},
		{"missing k", `{"kty":"oct"}`, ErrNameData},
		{"invalid base64url", `{"kty":"oct","k":"not base64!"}`, ErrNameData},
		{"non-extractable", `{"kty":"oct","k":"` + secret + `","ext":false}`, ErrNameData},
		{"key_ops mismatch", `{"kty":"oct","k":"` + secret + `","key_ops":["decrypt"]}`, ErrNameData},
		{"empty key_ops", `{"kty":"oct","k":"` + secret + `","key_ops":[]}`, ErrNameData},
		{"duplicate key_ops", `{"kty":"oct","k":"` + secret + `","key_ops":["encrypt","encrypt"]}`, ErrNameData},
		{"use mismatch", `{"kty":"oct","k":"` + secret + `","use":"sig"}`, ErrNameData},
		{"alg mismatch", `{"kty":"oct","k":"` + secret + `","alg":"A256GCM"}`, ErrNameData},
	}

	for _, c := range cases {
		_, err := ImportKey(FormatJWK, KeyData{JSON: []byte(c.jwk)}, alg, true, usages)
		if name := errorName(t, err); name != c.want {
			t.Errorf("%s: error name = %q, want %q", c.label, name, c.want)
		}
	}

	// 正确的 JWK 可以导入，alg 与 ext 相符。
	valid := `{"kty":"oct","k":"` + secret + `","alg":"A128GCM","ext":true,"key_ops":["encrypt","decrypt"]}`
	if _, err := ImportKey(FormatJWK, KeyData{JSON: []byte(valid)}, alg, true, usages); err != nil {
		t.Fatal(err)
	}

	// 缺少 key_ops 时不限制用法。
	withoutKeyOps := `{"kty":"oct","k":"` + secret + `"}`
	if _, err := ImportKey(FormatJWK, KeyData{JSON: []byte(withoutKeyOps)}, alg, true, usages); err != nil {
		t.Fatal(err)
	}
}

func TestWrapKeyRoundTrip(t *testing.T) {
	wrappingKey := newSecretKey(AlgAESGCM, "", bytes.Repeat([]byte{1}, 32), UsageWrapKey, UsageUnwrapKey)
	target := newSecretKey(AlgAESCBC, "", bytes.Repeat([]byte{2}, 16), UsageEncrypt, UsageDecrypt)
	alg := Algorithm{Name: AlgAESGCM, IV: bytes.Repeat([]byte{3}, 12)}

	for _, format := range []KeyFormat{FormatRaw, FormatJWK} {
		wrapped, err := WrapKey(format, target, wrappingKey, alg)
		if err != nil {
			t.Fatalf("%s: %v", format, err)
		}

		unwrapped, err := UnwrapKey(format, wrapped, wrappingKey, alg,
			Algorithm{Name: AlgAESCBC}, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
		if err != nil {
			t.Fatalf("%s: %v", format, err)
		}
		if !bytes.Equal(unwrapped.secret, target.secret) {
			t.Fatalf("%s: unwrapped key material differs", format)
		}
	}

	// 不可导出的密钥不能被包装。
	target.Extractable = false
	if _, err := WrapKey(FormatRaw, target, wrappingKey, alg); errorName(t, err) != ErrNameInvalidAccess {
		t.Fatalf("error = %v, want InvalidAccessError", err)
	}

	// 包装密钥未声明 wrapKey 用法。
	target.Extractable = true
	plain := newSecretKey(AlgAESGCM, "", bytes.Repeat([]byte{1}, 32), UsageEncrypt)
	if _, err := WrapKey(FormatRaw, target, plain, alg); errorName(t, err) != ErrNameInvalidAccess {
		t.Fatalf("error = %v, want InvalidAccessError", err)
	}
}
