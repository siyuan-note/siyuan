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
	"encoding/hex"
	"testing"
)

// signVerifyAlgorithms 覆盖所有签名算法的生成、签名与校验流程。
func TestSignVerifyRoundTrip(t *testing.T) {
	cases := []struct {
		label string
		alg   Algorithm
	}{
		{"RSASSA-PKCS1-v1_5", Algorithm{Name: AlgRSASSAPKCS1, Hash: AlgSHA256,
			ModulusLength: intPtr(2048), PublicExponent: []byte{1, 0, 1}}},
		{"RSA-PSS", Algorithm{Name: AlgRSAPSS, Hash: AlgSHA256,
			ModulusLength: intPtr(2048), PublicExponent: []byte{1, 0, 1}, SaltLength: intPtr(32)}},
		{"ECDSA P-256", Algorithm{Name: AlgECDSA, Hash: AlgSHA256, NamedCurve: CurveP256}},
		{"ECDSA P-384", Algorithm{Name: AlgECDSA, Hash: AlgSHA384, NamedCurve: CurveP384}},
		{"ECDSA P-521", Algorithm{Name: AlgECDSA, Hash: AlgSHA512, NamedCurve: CurveP521}},
		{"Ed25519", Algorithm{Name: AlgEd25519}},
	}

	data := []byte("siyuan kernel plugin crypto")
	for _, c := range cases {
		pair, err := GenerateKey(c.alg, true, []KeyUsage{UsageSign, UsageVerify})
		if err != nil {
			t.Fatalf("%s: generate: %v", c.label, err)
		}
		if pair.PrivateKey == nil || pair.PublicKey == nil {
			t.Fatalf("%s: generateKey did not return a key pair", c.label)
		}
		if pair.PrivateKey.Type != KeyTypePrivate || pair.PublicKey.Type != KeyTypePublic {
			t.Fatalf("%s: unexpected key types", c.label)
		}
		// 用法按公私钥拆分。
		if len(pair.PrivateKey.Usages) != 1 || pair.PrivateKey.Usages[0] != UsageSign {
			t.Fatalf("%s: private usages = %v", c.label, pair.PrivateKey.Usages)
		}
		if len(pair.PublicKey.Usages) != 1 || pair.PublicKey.Usages[0] != UsageVerify {
			t.Fatalf("%s: public usages = %v", c.label, pair.PublicKey.Usages)
		}

		signature, err := Sign(c.alg, pair.PrivateKey, data)
		if err != nil {
			t.Fatalf("%s: sign: %v", c.label, err)
		}

		ok, err := Verify(c.alg, pair.PublicKey, signature, data)
		if err != nil {
			t.Fatalf("%s: verify: %v", c.label, err)
		}
		if !ok {
			t.Fatalf("%s: verification of a valid signature failed", c.label)
		}

		// 篡改签名与数据都必须校验失败。
		tampered := bytes.Clone(signature)
		tampered[0] ^= 0xff
		if ok, err = Verify(c.alg, pair.PublicKey, tampered, data); err != nil || ok {
			t.Fatalf("%s: tampered signature verified (err = %v)", c.label, err)
		}
		if ok, err = Verify(c.alg, pair.PublicKey, signature, []byte("other")); err != nil || ok {
			t.Fatalf("%s: signature verified for different data (err = %v)", c.label, err)
		}

		// 长度不符的签名返回 false 而非错误。
		if ok, err = Verify(c.alg, pair.PublicKey, []byte{1, 2, 3}, data); err != nil || ok {
			t.Fatalf("%s: short signature verified (err = %v)", c.label, err)
		}
	}
}

func TestECDSASignatureIsFixedLength(t *testing.T) {
	// Web Crypto 的 ECDSA 签名是固定长度的 r‖s，而不是 DER 编码。
	cases := map[string]int{CurveP256: 64, CurveP384: 96, CurveP521: 132}
	for curve, size := range cases {
		alg := Algorithm{Name: AlgECDSA, Hash: AlgSHA256, NamedCurve: curve}
		pair, err := GenerateKey(alg, true, []KeyUsage{UsageSign, UsageVerify})
		if err != nil {
			t.Fatalf("%s: %v", curve, err)
		}

		// 多次签名长度必须恒定，不能随 r、s 的前导零变化。
		for i := 0; i < 8; i++ {
			signature, signErr := Sign(alg, pair.PrivateKey, []byte{byte(i)})
			if signErr != nil {
				t.Fatalf("%s: %v", curve, signErr)
			}
			if len(signature) != size {
				t.Fatalf("%s: signature length = %d, want %d", curve, len(signature), size)
			}
			// DER 编码以 0x30 开头，固定长度编码不应如此。
			if signature[0] == 0x30 && len(signature) > 8 {
				t.Logf("%s: signature starts with 0x30, verify it is not DER", curve)
			}
		}
	}
}

func TestRSAOAEPRoundTrip(t *testing.T) {
	alg := Algorithm{Name: AlgRSAOAEP, Hash: AlgSHA256,
		ModulusLength: intPtr(2048), PublicExponent: []byte{1, 0, 1}}

	pair, err := GenerateKey(alg, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}
	// RSA-OAEP 的加密用法归公钥，解密用法归私钥。
	if !pair.PublicKey.HasUsage(UsageEncrypt) || pair.PublicKey.HasUsage(UsageDecrypt) {
		t.Fatalf("public usages = %v", pair.PublicKey.Usages)
	}
	if !pair.PrivateKey.HasUsage(UsageDecrypt) || pair.PrivateKey.HasUsage(UsageEncrypt) {
		t.Fatalf("private usages = %v", pair.PrivateKey.Usages)
	}

	data := []byte("encrypted with RSA-OAEP")
	ciphertext, err := Encrypt(alg, pair.PublicKey, data)
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := Decrypt(alg, pair.PrivateKey, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(plaintext, data) {
		t.Fatalf("plaintext = %q, want %q", plaintext, data)
	}

	// label 参与认证，解密时不一致必须失败。
	labeled := alg
	labeled.Label = []byte("label")
	ciphertext, err = Encrypt(labeled, pair.PublicKey, data)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Decrypt(alg, pair.PrivateKey, ciphertext); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
	plaintext, err = Decrypt(labeled, pair.PrivateKey, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(plaintext, data) {
		t.Fatalf("plaintext = %q, want %q", plaintext, data)
	}
}

func TestRSALimits(t *testing.T) {
	base := Algorithm{Name: AlgRSASSAPKCS1, Hash: AlgSHA256,
		ModulusLength: intPtr(2048), PublicExponent: []byte{1, 0, 1}}
	usages := []KeyUsage{UsageSign, UsageVerify}

	// 公开指数只支持 65537。
	exponent3 := base
	exponent3.PublicExponent = []byte{3}
	if _, err := GenerateKey(exponent3, true, usages); errorName(t, err) != ErrNameNotSupported {
		t.Fatalf("error = %v, want NotSupportedError", err)
	}

	// 模数长度下限。
	short := base
	short.ModulusLength = intPtr(512)
	if _, err := GenerateKey(short, true, usages); errorName(t, err) != ErrNameNotSupported {
		t.Fatalf("error = %v, want NotSupportedError", err)
	}

	// 缺少必需成员。
	missing := Algorithm{Name: AlgRSASSAPKCS1, Hash: AlgSHA256}
	if _, err := GenerateKey(missing, true, usages); errorName(t, err) != ErrNameType {
		t.Fatalf("error = %v, want TypeError", err)
	}

	// RSA-PSS 的零长度盐无法用 Go 表达。
	pssAlg := Algorithm{Name: AlgRSAPSS, Hash: AlgSHA256,
		ModulusLength: intPtr(2048), PublicExponent: []byte{1, 0, 1}}
	pair, err := GenerateKey(pssAlg, true, usages)
	if err != nil {
		t.Fatal(err)
	}
	zeroSalt := pssAlg
	zeroSalt.SaltLength = intPtr(0)
	if _, err = Sign(zeroSalt, pair.PrivateKey, []byte("data")); errorName(t, err) != ErrNameNotSupported {
		t.Fatalf("error = %v, want NotSupportedError", err)
	}
	// 缺少 saltLength 属于参数缺失。
	if _, err = Sign(pssAlg, pair.PrivateKey, []byte("data")); errorName(t, err) != ErrNameType {
		t.Fatalf("error = %v, want TypeError", err)
	}
}

func TestECDHDeriveBits(t *testing.T) {
	for _, curve := range []string{CurveP256, CurveP384, CurveP521} {
		alg := Algorithm{Name: AlgECDH, NamedCurve: curve}
		alice, err := GenerateKey(alg, true, []KeyUsage{UsageDeriveBits, UsageDeriveKey})
		if err != nil {
			t.Fatalf("%s: %v", curve, err)
		}
		bob, err := GenerateKey(alg, true, []KeyUsage{UsageDeriveBits, UsageDeriveKey})
		if err != nil {
			t.Fatalf("%s: %v", curve, err)
		}

		// 公钥不参与派生，usages 为空。
		if len(alice.PublicKey.Usages) != 0 {
			t.Fatalf("%s: public usages = %v, want empty", curve, alice.PublicKey.Usages)
		}

		aliceAlg := alg
		aliceAlg.Public = bob.PublicKey
		bobAlg := alg
		bobAlg.Public = alice.PublicKey

		fromAlice, err := DeriveBits(aliceAlg, alice.PrivateKey, intPtr(256))
		if err != nil {
			t.Fatalf("%s: %v", curve, err)
		}
		fromBob, err := DeriveBits(bobAlg, bob.PrivateKey, intPtr(256))
		if err != nil {
			t.Fatalf("%s: %v", curve, err)
		}
		if !bytes.Equal(fromAlice, fromBob) {
			t.Fatalf("%s: derived secrets differ", curve)
		}

		// length 为空返回完整共享密钥。
		full, err := DeriveBits(aliceAlg, alice.PrivateKey, nil)
		if err != nil {
			t.Fatalf("%s: %v", curve, err)
		}
		if !bytes.HasPrefix(full, fromAlice) {
			t.Fatalf("%s: truncated secret is not a prefix of the full secret", curve)
		}

		// 请求超过共享密钥长度必须报错。
		if _, err = DeriveBits(aliceAlg, alice.PrivateKey, intPtr(len(full)*8+8)); errorName(t, err) != ErrNameOperation {
			t.Fatalf("%s: error = %v, want OperationError", curve, err)
		}
	}
}

func TestX25519DeriveBits(t *testing.T) {
	alg := Algorithm{Name: AlgX25519}
	alice, err := GenerateKey(alg, true, []KeyUsage{UsageDeriveBits})
	if err != nil {
		t.Fatal(err)
	}
	bob, err := GenerateKey(alg, true, []KeyUsage{UsageDeriveBits})
	if err != nil {
		t.Fatal(err)
	}

	aliceAlg := alg
	aliceAlg.Public = bob.PublicKey
	bobAlg := alg
	bobAlg.Public = alice.PublicKey

	fromAlice, err := DeriveBits(aliceAlg, alice.PrivateKey, intPtr(256))
	if err != nil {
		t.Fatal(err)
	}
	fromBob, err := DeriveBits(bobAlg, bob.PrivateKey, intPtr(256))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(fromAlice, fromBob) {
		t.Fatal("derived secrets differ")
	}
	if len(fromAlice) != 32 {
		t.Fatalf("secret length = %d, want 32", len(fromAlice))
	}
}

func TestECDHRejectsMismatchedPublicKey(t *testing.T) {
	p256 := Algorithm{Name: AlgECDH, NamedCurve: CurveP256}
	p384 := Algorithm{Name: AlgECDH, NamedCurve: CurveP384}

	alice, err := GenerateKey(p256, true, []KeyUsage{UsageDeriveBits})
	if err != nil {
		t.Fatal(err)
	}
	other, err := GenerateKey(p384, true, []KeyUsage{UsageDeriveBits})
	if err != nil {
		t.Fatal(err)
	}
	x25519, err := GenerateKey(Algorithm{Name: AlgX25519}, true, []KeyUsage{UsageDeriveBits})
	if err != nil {
		t.Fatal(err)
	}

	// 曲线不一致。
	mismatched := p256
	mismatched.Public = other.PublicKey
	if _, err = DeriveBits(mismatched, alice.PrivateKey, intPtr(128)); errorName(t, err) != ErrNameInvalidAccess {
		t.Fatalf("error = %v, want InvalidAccessError", err)
	}

	// 算法不一致。
	wrongAlg := p256
	wrongAlg.Public = x25519.PublicKey
	if _, err = DeriveBits(wrongAlg, alice.PrivateKey, intPtr(128)); errorName(t, err) != ErrNameInvalidAccess {
		t.Fatalf("error = %v, want InvalidAccessError", err)
	}

	// 缺少 public 成员。
	if _, err = DeriveBits(p256, alice.PrivateKey, intPtr(128)); errorName(t, err) != ErrNameType {
		t.Fatalf("error = %v, want TypeError", err)
	}
}

func TestECDHDeriveKey(t *testing.T) {
	alg := Algorithm{Name: AlgECDH, NamedCurve: CurveP256}
	alice, err := GenerateKey(alg, true, []KeyUsage{UsageDeriveKey})
	if err != nil {
		t.Fatal(err)
	}
	bob, err := GenerateKey(alg, true, []KeyUsage{UsageDeriveKey})
	if err != nil {
		t.Fatal(err)
	}

	derive := alg
	derive.Public = bob.PublicKey
	key, err := DeriveKey(derive, alice.PrivateKey,
		Algorithm{Name: AlgAESGCM, Length: intPtr(256)}, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}
	if key.Algorithm.Name != AlgAESGCM || *key.Algorithm.Length != 256 {
		t.Fatalf("derived algorithm = %+v", key.Algorithm)
	}
}

func TestAESKWRFC3394(t *testing.T) {
	// RFC 3394 第 4.1 节：128 位密钥包装 128 位密钥数据。
	key := newSecretKey(AlgAESKW, "", mustHex(t, "000102030405060708090A0B0C0D0E0F"),
		UsageWrapKey, UsageUnwrapKey)
	plaintext := mustHex(t, "00112233445566778899AABBCCDDEEFF")

	wrapped, err := wrapAESKW(key, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	want := "1fa68b0a8112b447aef34bd8fb5a7b829d3e862371d2cfe5"
	if hex.EncodeToString(wrapped) != want {
		t.Fatalf("AES-KW = %s, want %s", hex.EncodeToString(wrapped), want)
	}

	unwrapped, err := unwrapAESKW(key, wrapped)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(unwrapped, plaintext) {
		t.Fatalf("unwrapped = %x, want %x", unwrapped, plaintext)
	}

	// 完整性校验失败。
	tampered := bytes.Clone(wrapped)
	tampered[0] ^= 0xff
	if _, err = unwrapAESKW(key, tampered); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}

	// 长度不符合 RFC 3394 的要求。
	if _, err = wrapAESKW(key, plaintext[:8]); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
	if _, err = unwrapAESKW(key, wrapped[:16]); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
	// 长度不是 8 的整数倍。
	misaligned := append(bytes.Clone(plaintext), 0)
	if _, err = wrapAESKW(key, misaligned); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
}

func TestAESKWWrapUnwrapKey(t *testing.T) {
	wrappingKey, err := GenerateKey(Algorithm{Name: AlgAESKW, Length: intPtr(256)},
		true, []KeyUsage{UsageWrapKey, UsageUnwrapKey})
	if err != nil {
		t.Fatal(err)
	}
	target, err := GenerateKey(Algorithm{Name: AlgAESGCM, Length: intPtr(128)},
		true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}

	alg := Algorithm{Name: AlgAESKW}
	wrapped, err := WrapKey(FormatRaw, target.Secret, wrappingKey.Secret, alg)
	if err != nil {
		t.Fatal(err)
	}
	if len(wrapped) != 24 {
		t.Fatalf("wrapped length = %d, want 24", len(wrapped))
	}

	unwrapped, err := UnwrapKey(FormatRaw, wrapped, wrappingKey.Secret, alg,
		Algorithm{Name: AlgAESGCM}, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(unwrapped.secret, target.Secret.secret) {
		t.Fatal("unwrapped key material differs")
	}
}

func TestKeyPairUsageValidation(t *testing.T) {
	// 签名算法必须至少包含一个私钥用法。
	alg := Algorithm{Name: AlgECDSA, Hash: AlgSHA256, NamedCurve: CurveP256}
	if _, err := GenerateKey(alg, true, []KeyUsage{UsageVerify}); errorName(t, err) != ErrNameSyntax {
		t.Fatalf("error = %v, want SyntaxError", err)
	}

	// 算法不接受的用法。
	if _, err := GenerateKey(alg, true, []KeyUsage{UsageSign, UsageEncrypt}); errorName(t, err) != ErrNameSyntax {
		t.Fatalf("error = %v, want SyntaxError", err)
	}

	// 只有 sign 时公钥用法为空。
	pair, err := GenerateKey(alg, true, []KeyUsage{UsageSign})
	if err != nil {
		t.Fatal(err)
	}
	if len(pair.PublicKey.Usages) != 0 {
		t.Fatalf("public usages = %v, want empty", pair.PublicKey.Usages)
	}

	// 公钥始终可导出，即便请求了不可导出。
	pair, err = GenerateKey(alg, false, []KeyUsage{UsageSign, UsageVerify})
	if err != nil {
		t.Fatal(err)
	}
	if !pair.PublicKey.Extractable || pair.PrivateKey.Extractable {
		t.Fatalf("extractable: public = %v, private = %v",
			pair.PublicKey.Extractable, pair.PrivateKey.Extractable)
	}
}
