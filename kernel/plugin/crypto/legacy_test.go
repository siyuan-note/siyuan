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
	"crypto/aes"
	"encoding/hex"
	"encoding/json"
	"testing"
)

// 本文件覆盖 MD5 与 AES-ECB 两个非规范扩展。

func TestMD5Vectors(t *testing.T) {
	// RFC 1321 附录 A.5 的测试用例。
	cases := []struct {
		input string
		want  string
	}{
		{"", "d41d8cd98f00b204e9800998ecf8427e"},
		{"a", "0cc175b9c0f1b6a831c399e269772661"},
		{"abc", "900150983cd24fb0d6963f7d28e17f72"},
		{"message digest", "f96b697d7cb7938d525a2f31aaf161d0"},
		{"abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"},
	}

	for _, c := range cases {
		got, err := Digest(Algorithm{Name: AlgMD5}, []byte(c.input))
		if err != nil {
			t.Fatalf("%q: %v", c.input, err)
		}
		if hex.EncodeToString(got) != c.want {
			t.Errorf("MD5(%q) = %s, want %s", c.input, hex.EncodeToString(got), c.want)
		}
	}

	// 名称大小写不敏感。
	got, err := Digest(Algorithm{Name: "md5"}, []byte("abc"))
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(got) != "900150983cd24fb0d6963f7d28e17f72" {
		t.Fatalf("md5 = %s", hex.EncodeToString(got))
	}
}

func TestHMACMD5Vectors(t *testing.T) {
	// RFC 2202 第 2 节的测试用例 1 到 3。
	cases := []struct {
		secret []byte
		data   []byte
		want   string
	}{
		{bytes.Repeat([]byte{0x0b}, 16), []byte("Hi There"), "9294727a3638bb1c13f48ef8158bfc9d"},
		{[]byte("Jefe"), []byte("what do ya want for nothing?"), "750c783e6ab0b503eaa86e310a5db738"},
		{bytes.Repeat([]byte{0xaa}, 16), bytes.Repeat([]byte{0xdd}, 50), "56be34521d144c88dbb8c733f0e8b3f6"},
	}

	for i, c := range cases {
		key, err := ImportKey(FormatRaw, KeyData{Raw: c.secret},
			Algorithm{Name: AlgHMAC, Hash: AlgMD5}, true, []KeyUsage{UsageSign, UsageVerify})
		if err != nil {
			t.Fatalf("case %d: %v", i+1, err)
		}
		if key.Algorithm.Hash != AlgMD5 {
			t.Fatalf("case %d: key hash = %q, want %s", i+1, key.Algorithm.Hash, AlgMD5)
		}

		signature, err := Sign(Algorithm{Name: AlgHMAC}, key, c.data)
		if err != nil {
			t.Fatalf("case %d: %v", i+1, err)
		}
		if hex.EncodeToString(signature) != c.want {
			t.Errorf("case %d = %s, want %s", i+1, hex.EncodeToString(signature), c.want)
		}

		ok, err := Verify(Algorithm{Name: AlgHMAC}, key, signature, c.data)
		if err != nil {
			t.Fatalf("case %d: %v", i+1, err)
		}
		if !ok {
			t.Errorf("case %d: the signature did not verify", i+1)
		}
	}
}

func TestMD5WorksWithKeyDerivation(t *testing.T) {
	// HKDF 与 PBKDF2 把摘要算法当作伪随机函数使用，因此接受 MD5。
	for _, alg := range []Algorithm{
		{Name: AlgHKDF, Hash: AlgMD5, Salt: []byte("salt"), Info: []byte("info")},
		{Name: AlgPBKDF2, Hash: AlgMD5, Salt: []byte("salt"), Iterations: intPtr(16)},
	} {
		key, err := ImportKey(FormatRaw, KeyData{Raw: []byte("password")},
			Algorithm{Name: alg.Name}, false, []KeyUsage{UsageDeriveBits})
		if err != nil {
			t.Fatalf("%s: %v", alg.Name, err)
		}

		bits, err := DeriveBits(alg, key, intPtr(128))
		if err != nil {
			t.Fatalf("%s: %v", alg.Name, err)
		}
		if len(bits) != 16 {
			t.Fatalf("%s: derived %d bytes, want 16", alg.Name, len(bits))
		}
		// 派生结果必须可复现。
		again, err := DeriveBits(alg, key, intPtr(128))
		if err != nil {
			t.Fatalf("%s: %v", alg.Name, err)
		}
		if !bytes.Equal(bits, again) {
			t.Fatalf("%s: derivation is not deterministic", alg.Name)
		}
	}
}

func TestMD5RejectedBySignatureAlgorithms(t *testing.T) {
	// 非对称算法的安全性依赖抗碰撞性，MD5 必须被拒绝。
	rsaAlgs := []string{AlgRSASSAPKCS1, AlgRSAPSS, AlgRSAOAEP}
	for _, algName := range rsaAlgs {
		usages := []KeyUsage{UsageSign, UsageVerify}
		if algName == AlgRSAOAEP {
			usages = []KeyUsage{UsageEncrypt, UsageDecrypt}
		}

		alg := Algorithm{Name: algName, Hash: AlgMD5,
			ModulusLength: intPtr(2048), PublicExponent: []byte{1, 0, 1}}
		if _, err := GenerateKey(alg, true, usages); errorName(t, err) != ErrNameNotSupported {
			t.Errorf("%s generateKey: error = %v, want NotSupportedError", algName, err)
		}
	}

	// ECDSA 的摘要算法来自签名参数，因此在签名与校验时拒绝。
	pair, err := GenerateKey(Algorithm{Name: AlgECDSA, NamedCurve: CurveP256},
		true, []KeyUsage{UsageSign, UsageVerify})
	if err != nil {
		t.Fatal(err)
	}
	md5Params := Algorithm{Name: AlgECDSA, Hash: AlgMD5}
	if _, err = Sign(md5Params, pair.PrivateKey, []byte("data")); errorName(t, err) != ErrNameNotSupported {
		t.Errorf("ECDSA sign: error = %v, want NotSupportedError", err)
	}
	if _, err = Verify(md5Params, pair.PublicKey, make([]byte, 64), []byte("data")); errorName(t, err) != ErrNameNotSupported {
		t.Errorf("ECDSA verify: error = %v, want NotSupportedError", err)
	}

	// 导入 RSA 密钥时同样拒绝，避免绕过生成时的检查。
	sha256Alg := Algorithm{Name: AlgRSASSAPKCS1, Hash: AlgSHA256,
		ModulusLength: intPtr(2048), PublicExponent: []byte{1, 0, 1}}
	valid, err := GenerateKey(sha256Alg, true, []KeyUsage{UsageSign, UsageVerify})
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		format KeyFormat
		key    *Key
		usages []KeyUsage
	}{
		{FormatSPKI, valid.PublicKey, []KeyUsage{UsageVerify}},
		{FormatPKCS8, valid.PrivateKey, []KeyUsage{UsageSign}},
		{FormatJWK, valid.PrivateKey, []KeyUsage{UsageSign}},
	} {
		data, exportErr := ExportKey(entry.format, entry.key)
		if exportErr != nil {
			t.Fatal(exportErr)
		}
		md5Import := Algorithm{Name: AlgRSASSAPKCS1, Hash: AlgMD5}
		if _, err = ImportKey(entry.format, *data, md5Import, true, entry.usages); errorName(t, err) != ErrNameNotSupported {
			t.Errorf("%s import: error = %v, want NotSupportedError", entry.format, err)
		}
	}
}

func TestAESECBNISTVectors(t *testing.T) {
	// NIST SP 800-38A 的 F.1.1（AES-128）与 F.1.5（AES-256）向量。
	// 内核的 AES-ECB 使用 PKCS#7 填充，因此只比较明文对应的分组。
	cases := []struct {
		label  string
		secret string
		blocks [][2]string
	}{
		{"AES-128", "2b7e151628aed2a6abf7158809cf4f3c", [][2]string{
			{"6bc1bee22e409f96e93d7e117393172a", "3ad77bb40d7a3660a89ecaf32466ef97"},
			{"ae2d8a571e03ac9c9eb76fac45af8e51", "f5d3d58503b9699de785895a96fdbaaf"},
			{"30c81c46a35ce411e5fbc1191a0a52ef", "43b1cd7f598ece23881b00e3ed030688"},
			{"f69f2445df4f9b17ad2b417be66c3710", "7b0c785e27e8ad3f8223207104725dd4"},
		}},
		{"AES-256", "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4", [][2]string{
			{"6bc1bee22e409f96e93d7e117393172a", "f3eed1bdb5d2a03c064b5a7e3db181f8"},
			{"ae2d8a571e03ac9c9eb76fac45af8e51", "591ccb10d410ed26dc5ba74a31362870"},
			{"30c81c46a35ce411e5fbc1191a0a52ef", "b6ed21b99ca6f4f9f153e7b1beafed1d"},
			{"f69f2445df4f9b17ad2b417be66c3710", "23304b7a39f9f3ff067d8d8f9e24ecc7"},
		}},
	}

	for _, c := range cases {
		key := newSecretKey(AlgAESECB, "", mustHex(t, c.secret), UsageEncrypt, UsageDecrypt)
		alg := Algorithm{Name: AlgAESECB}

		var plaintext, expected []byte
		for _, block := range c.blocks {
			plaintext = append(plaintext, mustHex(t, block[0])...)
			expected = append(expected, mustHex(t, block[1])...)
		}

		ciphertext, err := Encrypt(alg, key, plaintext)
		if err != nil {
			t.Fatalf("%s: %v", c.label, err)
		}
		// 明文长度是分组长度的整数倍，因此末尾多出一个完整的填充分组。
		if len(ciphertext) != len(plaintext)+aes.BlockSize {
			t.Fatalf("%s: ciphertext length = %d, want %d", c.label, len(ciphertext), len(plaintext)+aes.BlockSize)
		}
		if !bytes.Equal(ciphertext[:len(expected)], expected) {
			t.Errorf("%s: ciphertext = %s, want prefix %s",
				c.label, hex.EncodeToString(ciphertext[:len(expected)]), hex.EncodeToString(expected))
		}

		decrypted, err := Decrypt(alg, key, ciphertext)
		if err != nil {
			t.Fatalf("%s: %v", c.label, err)
		}
		if !bytes.Equal(decrypted, plaintext) {
			t.Errorf("%s: round trip changed the plaintext", c.label)
		}
	}
}

func TestAESECBIsDeterministic(t *testing.T) {
	// ECB 对相同明文分组产生相同密文分组，这正是它泄漏明文结构的原因。
	key, err := GenerateKey(Algorithm{Name: AlgAESECB, Length: intPtr(256)},
		true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}
	alg := Algorithm{Name: AlgAESECB}

	// 两个完全相同的分组。
	plaintext := bytes.Repeat([]byte{0x41}, 2*aes.BlockSize)
	ciphertext, err := Encrypt(alg, key.Secret, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(ciphertext[:aes.BlockSize], ciphertext[aes.BlockSize:2*aes.BlockSize]) {
		t.Fatal("identical plaintext blocks did not produce identical ciphertext blocks")
	}

	// 同一密钥对同一明文的两次加密结果相同，因为没有 iv。
	again, err := Encrypt(alg, key.Secret, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(ciphertext, again) {
		t.Fatal("AES-ECB encryption is not deterministic")
	}
}

func TestAESECBPaddingAndLengthChecks(t *testing.T) {
	key := newSecretKey(AlgAESECB, "", bytes.Repeat([]byte{7}, 32), UsageEncrypt, UsageDecrypt)
	alg := Algorithm{Name: AlgAESECB}

	// 非分组整数倍的密文必须被拒绝。
	for _, length := range []int{0, 1, aes.BlockSize - 1, aes.BlockSize + 1} {
		if _, err := Decrypt(alg, key, make([]byte, length)); errorName(t, err) != ErrNameOperation {
			t.Errorf("ciphertext length %d: error = %v, want OperationError", length, err)
		}
	}

	// 填充被破坏时必须报错而不是返回错误明文。
	ciphertext, err := Encrypt(alg, key, []byte("legacy data"))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[len(ciphertext)-1] ^= 0xff
	if _, err = Decrypt(alg, key, ciphertext); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}

	// 空明文也会产生一个完整的填充分组。
	empty, err := Encrypt(alg, key, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(empty) != aes.BlockSize {
		t.Fatalf("empty plaintext produced %d bytes, want %d", len(empty), aes.BlockSize)
	}
	decrypted, err := Decrypt(alg, key, empty)
	if err != nil {
		t.Fatal(err)
	}
	if len(decrypted) != 0 {
		t.Fatalf("decrypted %d bytes, want 0", len(decrypted))
	}
}

func TestAESECBRejectsKeyWrapping(t *testing.T) {
	// AES-ECB 不支持包装密钥，因此连带 wrapKey 用法一起被拒绝。
	alg := Algorithm{Name: AlgAESECB, Length: intPtr(256)}
	for _, usages := range [][]KeyUsage{
		{UsageWrapKey},
		{UsageUnwrapKey},
		{UsageEncrypt, UsageWrapKey},
	} {
		if _, err := GenerateKey(alg, true, usages); errorName(t, err) != ErrNameSyntax {
			t.Errorf("usages %v: error = %v, want SyntaxError", usages, err)
		}
	}

	// 可用的加解密密钥不能被当作包装密钥使用。
	key, err := GenerateKey(alg, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}
	target, err := GenerateKey(Algorithm{Name: AlgAESGCM, Length: intPtr(128)},
		true, []KeyUsage{UsageEncrypt})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = WrapKey(FormatRaw, target.Secret, key.Secret,
		Algorithm{Name: AlgAESECB}); errorName(t, err) != ErrNameInvalidAccess {
		t.Fatalf("error = %v, want InvalidAccessError", err)
	}
}

func TestAESECBKeyFormats(t *testing.T) {
	key, err := GenerateKey(Algorithm{Name: AlgAESECB, Length: intPtr(192)},
		true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}

	// raw 往返。
	raw, err := ExportKey(FormatRaw, key.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw.Raw) != 24 {
		t.Fatalf("raw key length = %d, want 24", len(raw.Raw))
	}
	reimported, err := ImportKey(FormatRaw, KeyData{Raw: raw.Raw},
		Algorithm{Name: AlgAESECB}, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}

	// jwk 往返，且不输出 alg 成员：JWA 没有为 AES-ECB 注册名称。
	jwkData, err := ExportKey(FormatJWK, key.Secret)
	if err != nil {
		t.Fatal(err)
	}
	var jwk jsonWebKey
	if err = json.Unmarshal(jwkData.JSON, &jwk); err != nil {
		t.Fatal(err)
	}
	if jwk.Kty != jwkKeyTypeOct {
		t.Fatalf("kty = %q, want %s", jwk.Kty, jwkKeyTypeOct)
	}
	if jwk.Alg != "" {
		t.Fatalf("alg = %q, want an absent member", jwk.Alg)
	}
	fromJWK, err := ImportKey(FormatJWK, KeyData{JSON: jwkData.JSON},
		Algorithm{Name: AlgAESECB}, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}

	// 两种格式导入的密钥必须能解密原密钥产生的密文。
	alg := Algorithm{Name: AlgAESECB}
	ciphertext, err := Encrypt(alg, key.Secret, []byte("format round trip"))
	if err != nil {
		t.Fatal(err)
	}
	for label, candidate := range map[string]*Key{"raw": reimported, "jwk": fromJWK} {
		plaintext, decErr := Decrypt(alg, candidate, ciphertext)
		if decErr != nil {
			t.Fatalf("%s: %v", label, decErr)
		}
		if string(plaintext) != "format round trip" {
			t.Errorf("%s: plaintext = %q", label, plaintext)
		}
	}

	// spki 与 pkcs8 不适用于对称密钥。
	for _, format := range []KeyFormat{FormatSPKI, FormatPKCS8} {
		if _, err = ExportKey(format, key.Secret); errorName(t, err) != ErrNameNotSupported {
			t.Errorf("%s: error = %v, want NotSupportedError", format, err)
		}
	}
}

func TestAESECBDerivedKey(t *testing.T) {
	// 可以用 HKDF 派生 AES-ECB 密钥，长度校验与其他 AES 模式一致。
	base, err := ImportKey(FormatRaw, KeyData{Raw: []byte("derivation secret")},
		Algorithm{Name: AlgHKDF}, false, []KeyUsage{UsageDeriveKey})
	if err != nil {
		t.Fatal(err)
	}
	hkdf := Algorithm{Name: AlgHKDF, Hash: AlgSHA256, Salt: []byte("salt"), Info: []byte("info")}

	derived, err := DeriveKey(hkdf, base, Algorithm{Name: AlgAESECB, Length: intPtr(256)},
		true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}
	if derived.Algorithm.Length == nil || *derived.Algorithm.Length != 256 {
		t.Fatalf("derived key length = %v", derived.Algorithm.Length)
	}

	if _, err = DeriveKey(hkdf, base, Algorithm{Name: AlgAESECB, Length: intPtr(200)},
		true, []KeyUsage{UsageEncrypt}); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
}
