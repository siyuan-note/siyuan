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
	"os"
	"testing"
)

// interopFixtures 是 testdata/interop.json 的结构，由 testdata/generate_fixtures.mjs
// 使用 Node 的 WebCrypto 生成，用于验证内核实现与浏览器实现互通。
type interopFixtures struct {
	Message string        `json:"message"`
	Cases   []interopCase `json:"cases"`
}

type interopCase struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`

	Hash       string `json:"hash"`
	NamedCurve string `json:"namedCurve"`
	Algorithm  any    `json:"algorithm"`

	SPKI       string          `json:"spki"`
	PKCS8      string          `json:"pkcs8"`
	PublicJWK  json.RawMessage `json:"publicJwk"`
	PrivateJWK json.RawMessage `json:"privateJwk"`
	JWK        json.RawMessage `json:"jwk"`

	Input             string `json:"input"`
	Digest            string `json:"digest"`
	Signature         string `json:"signature"`
	Ciphertext        string `json:"ciphertext"`
	LabeledCiphertext string `json:"labeledCiphertext"`
	LabelText         string `json:"labelText"`
	Wrapped           string `json:"wrapped"`
	Bits              string `json:"bits"`

	KeyBytes    string `json:"keyBytes"`
	TargetBytes string `json:"targetBytes"`
	Secret      string `json:"secret"`
	Salt        string `json:"salt"`
	Info        string `json:"info"`
	IV          string `json:"iv"`
	Counter     string `json:"counter"`
	AAD         string `json:"additionalData"`

	Length        int `json:"length"`
	TagLength     int `json:"tagLength"`
	CounterLength int `json:"counterLength"`
	Iterations    int `json:"iterations"`

	AlicePKCS8 string `json:"alicePkcs8"`
	BobSPKI    string `json:"bobSpki"`
}

func loadInteropFixtures(t *testing.T) *interopFixtures {
	t.Helper()

	data, err := os.ReadFile("testdata/interop.json")
	if err != nil {
		t.Fatalf("read interop fixtures: %v", err)
	}

	ret := &interopFixtures{}
	if err = json.Unmarshal(data, ret); err != nil {
		t.Fatalf("parse interop fixtures: %v", err)
	}
	if len(ret.Cases) == 0 {
		t.Fatal("interop fixtures contain no cases")
	}
	return ret
}

func decodeB64(t *testing.T, value string) []byte {
	t.Helper()
	if value == "" {
		return nil
	}
	ret, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		t.Fatalf("decode base64 %q: %v", value, err)
	}
	return ret
}

// signAlgorithmOf 根据夹具还原签名算法参数。
func signAlgorithmOf(c interopCase) Algorithm {
	switch {
	case c.Label == "Ed25519":
		return Algorithm{Name: AlgEd25519}
	case c.NamedCurve != "":
		return Algorithm{Name: AlgECDSA, Hash: c.Hash, NamedCurve: c.NamedCurve}
	case bytes.Contains([]byte(c.Label), []byte("RSA-PSS")):
		return Algorithm{Name: AlgRSAPSS, Hash: c.Hash, SaltLength: intPtr(32)}
	default:
		return Algorithm{Name: AlgRSASSAPKCS1, Hash: c.Hash}
	}
}

// TestInteropWithNodeWebCrypto 用 Node 生成的密钥与结果验证内核实现。
func TestInteropWithNodeWebCrypto(t *testing.T) {
	fixtures := loadInteropFixtures(t)
	message := []byte(fixtures.Message)
	covered := map[string]bool{}

	for _, c := range fixtures.Cases {
		covered[c.Kind] = true

		t.Run(c.Label, func(t *testing.T) {
			switch c.Kind {
			case "sign":
				runInteropSignCase(t, c, message)
			case "rsa-oaep":
				runInteropRSAOAEPCase(t, c, message)
			case "aes":
				runInteropAESCase(t, c, message)
			case "aes-kw":
				runInteropAESKWCase(t, c)
			case "hmac":
				runInteropHMACCase(t, c, message)
			case "hkdf", "pbkdf2":
				runInteropKDFCase(t, c)
			case "ecdh":
				runInteropECDHCase(t, c)
			case "md5":
				runInteropMD5Case(t, c)
			case "hmac-md5":
				runInteropHMACMD5Case(t, c, message)
			case "aes-ecb":
				runInteropAESECBCase(t, c, message)
			default:
				t.Fatalf("unknown fixture kind %q", c.Kind)
			}
		})
	}

	// 确保夹具覆盖了所有预期的算法族，避免夹具被意外裁剪后测试仍然通过。
	for _, kind := range []string{"sign", "rsa-oaep", "aes", "aes-kw", "hmac", "hkdf", "pbkdf2", "ecdh",
		"md5", "hmac-md5", "aes-ecb"} {
		if !covered[kind] {
			t.Errorf("interop fixtures do not cover %q", kind)
		}
	}
}

// runInteropSignCase 校验 Node 的签名，并用 Node 的公钥验证内核生成的签名。
func runInteropSignCase(t *testing.T, c interopCase, message []byte) {
	alg := signAlgorithmOf(c)
	// ECDSA 的导入参数只有 namedCurve，摘要算法属于签名参数。
	importAlg := alg
	if alg.Name == AlgECDSA {
		importAlg = Algorithm{Name: AlgECDSA, NamedCurve: c.NamedCurve}
	}

	publicKey, err := ImportKey(FormatSPKI, KeyData{Raw: decodeB64(t, c.SPKI)}, importAlg, true,
		[]KeyUsage{UsageVerify})
	if err != nil {
		t.Fatalf("import spki: %v", err)
	}
	privateKey, err := ImportKey(FormatPKCS8, KeyData{Raw: decodeB64(t, c.PKCS8)}, importAlg, true,
		[]KeyUsage{UsageSign})
	if err != nil {
		t.Fatalf("import pkcs8: %v", err)
	}

	// Node 生成的签名必须通过内核校验。
	ok, err := Verify(alg, publicKey, decodeB64(t, c.Signature), message)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !ok {
		t.Fatal("the kernel rejected a signature produced by Node")
	}

	// 内核生成的签名必须能用同一公钥校验。
	signature, err := Sign(alg, privateKey, message)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if ok, err = Verify(alg, publicKey, signature, message); err != nil || !ok {
		t.Fatalf("round trip verification failed (err = %v)", err)
	}

	// Node 导出的 JWK 必须可导入，且能完成同样的校验。
	jwkPublic, err := ImportKey(FormatJWK, KeyData{JSON: c.PublicJWK}, importAlg, true, []KeyUsage{UsageVerify})
	if err != nil {
		t.Fatalf("import public jwk: %v", err)
	}
	if ok, err = Verify(alg, jwkPublic, decodeB64(t, c.Signature), message); err != nil || !ok {
		t.Fatalf("verification with the imported public JWK failed (err = %v)", err)
	}

	jwkPrivate, err := ImportKey(FormatJWK, KeyData{JSON: c.PrivateJWK}, importAlg, true, []KeyUsage{UsageSign})
	if err != nil {
		t.Fatalf("import private jwk: %v", err)
	}
	if signature, err = Sign(alg, jwkPrivate, message); err != nil {
		t.Fatalf("sign with the imported private JWK: %v", err)
	}
	if ok, err = Verify(alg, publicKey, signature, message); err != nil || !ok {
		t.Fatalf("verification of the imported private JWK's signature failed (err = %v)", err)
	}
}

// runInteropRSAOAEPCase 解密 Node 生成的 RSA-OAEP 密文。
func runInteropRSAOAEPCase(t *testing.T, c interopCase, message []byte) {
	alg := Algorithm{Name: AlgRSAOAEP, Hash: c.Hash}

	privateKey, err := ImportKey(FormatPKCS8, KeyData{Raw: decodeB64(t, c.PKCS8)}, alg, true,
		[]KeyUsage{UsageDecrypt})
	if err != nil {
		t.Fatalf("import pkcs8: %v", err)
	}
	publicKey, err := ImportKey(FormatSPKI, KeyData{Raw: decodeB64(t, c.SPKI)}, alg, true,
		[]KeyUsage{UsageEncrypt})
	if err != nil {
		t.Fatalf("import spki: %v", err)
	}

	plaintext, err := Decrypt(alg, privateKey, decodeB64(t, c.Ciphertext))
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(plaintext, message) {
		t.Fatalf("plaintext = %q, want %q", plaintext, message)
	}

	// 带 label 的密文需要相同的 label 才能解密。
	labeled := alg
	labeled.Label = []byte(c.LabelText)
	if plaintext, err = Decrypt(labeled, privateKey, decodeB64(t, c.LabeledCiphertext)); err != nil {
		t.Fatalf("decrypt with label: %v", err)
	}
	if !bytes.Equal(plaintext, message) {
		t.Fatalf("labeled plaintext = %q, want %q", plaintext, message)
	}

	// 内核加密的结果必须能用同一私钥解密。
	ciphertext, err := Encrypt(alg, publicKey, message)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if plaintext, err = Decrypt(alg, privateKey, ciphertext); err != nil {
		t.Fatalf("decrypt the kernel's ciphertext: %v", err)
	}
	if !bytes.Equal(plaintext, message) {
		t.Fatalf("round trip plaintext = %q, want %q", plaintext, message)
	}
}

// runInteropAESCase 解密 Node 生成的 AES 密文，并比较内核加密结果。
func runInteropAESCase(t *testing.T, c interopCase, message []byte) {
	var alg Algorithm
	switch {
	case c.Counter != "":
		alg = Algorithm{Name: AlgAESCTR, Counter: decodeB64(t, c.Counter), Length: intPtr(c.CounterLength)}
	case len(decodeB64(t, c.IV)) == 16 && c.TagLength == 0 && c.AAD == "":
		alg = Algorithm{Name: AlgAESCBC, IV: decodeB64(t, c.IV)}
	default:
		alg = Algorithm{Name: AlgAESGCM, IV: decodeB64(t, c.IV), AAD: decodeB64(t, c.AAD)}
		if c.TagLength != 0 {
			alg.TagLength = intPtr(c.TagLength)
		}
	}

	key, err := ImportKey(FormatRaw, KeyData{Raw: decodeB64(t, c.KeyBytes)},
		Algorithm{Name: alg.Name}, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatalf("import raw key: %v", err)
	}

	plaintext, err := Decrypt(alg, key, decodeB64(t, c.Ciphertext))
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(plaintext, message) {
		t.Fatalf("plaintext = %q, want %q", plaintext, message)
	}

	// 确定性算法下内核的密文必须与 Node 完全一致。
	ciphertext, err := Encrypt(alg, key, message)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !bytes.Equal(ciphertext, decodeB64(t, c.Ciphertext)) {
		t.Fatalf("ciphertext differs from Node's output\n got %x\nwant %x", ciphertext, decodeB64(t, c.Ciphertext))
	}
}

// runInteropAESKWCase 解包装 Node 包装的密钥。
func runInteropAESKWCase(t *testing.T, c interopCase) {
	wrappingKey, err := ImportKey(FormatRaw, KeyData{Raw: decodeB64(t, c.KeyBytes)},
		Algorithm{Name: AlgAESKW}, true, []KeyUsage{UsageWrapKey, UsageUnwrapKey})
	if err != nil {
		t.Fatalf("import raw key: %v", err)
	}

	unwrapped, err := UnwrapKey(FormatRaw, decodeB64(t, c.Wrapped), wrappingKey, Algorithm{Name: AlgAESKW},
		Algorithm{Name: AlgAESGCM}, true, []KeyUsage{UsageEncrypt})
	if err != nil {
		t.Fatalf("unwrap: %v", err)
	}

	data, err := ExportKey(FormatRaw, unwrapped)
	if err != nil {
		t.Fatalf("export unwrapped key: %v", err)
	}
	if !bytes.Equal(data.Raw, decodeB64(t, c.TargetBytes)) {
		t.Fatalf("unwrapped key = %x, want %x", data.Raw, decodeB64(t, c.TargetBytes))
	}

	// 内核包装的结果必须与 Node 一致，AES-KW 是确定性算法。
	target, err := ImportKey(FormatRaw, KeyData{Raw: decodeB64(t, c.TargetBytes)},
		Algorithm{Name: AlgAESGCM}, true, []KeyUsage{UsageEncrypt})
	if err != nil {
		t.Fatalf("import target key: %v", err)
	}
	wrapped, err := WrapKey(FormatRaw, target, wrappingKey, Algorithm{Name: AlgAESKW})
	if err != nil {
		t.Fatalf("wrap: %v", err)
	}
	if !bytes.Equal(wrapped, decodeB64(t, c.Wrapped)) {
		t.Fatalf("wrapped key differs from Node's output\n got %x\nwant %x", wrapped, decodeB64(t, c.Wrapped))
	}
}

// runInteropHMACCase 比较 HMAC 结果并导入 Node 导出的 JWK。
func runInteropHMACCase(t *testing.T, c interopCase, message []byte) {
	alg := Algorithm{Name: AlgHMAC, Hash: c.Hash}

	key, err := ImportKey(FormatRaw, KeyData{Raw: decodeB64(t, c.KeyBytes)}, alg, true,
		[]KeyUsage{UsageSign, UsageVerify})
	if err != nil {
		t.Fatalf("import raw key: %v", err)
	}

	signature, err := Sign(alg, key, message)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !bytes.Equal(signature, decodeB64(t, c.Signature)) {
		t.Fatalf("HMAC differs from Node's output\n got %x\nwant %x", signature, decodeB64(t, c.Signature))
	}

	// Node 导出的 JWK 必须可导入并得到相同结果。
	jwkKey, err := ImportKey(FormatJWK, KeyData{JSON: c.JWK}, alg, true, []KeyUsage{UsageSign})
	if err != nil {
		t.Fatalf("import jwk: %v", err)
	}
	if signature, err = Sign(alg, jwkKey, message); err != nil {
		t.Fatalf("sign with the imported JWK: %v", err)
	}
	if !bytes.Equal(signature, decodeB64(t, c.Signature)) {
		t.Fatal("the JWK-imported key produced a different HMAC")
	}
}

// runInteropKDFCase 比较 HKDF 与 PBKDF2 的派生结果。
func runInteropKDFCase(t *testing.T, c interopCase) {
	algName := AlgHKDF
	if c.Kind == "pbkdf2" {
		algName = AlgPBKDF2
	}

	key, err := ImportKey(FormatRaw, KeyData{Raw: decodeB64(t, c.Secret)},
		Algorithm{Name: algName}, false, []KeyUsage{UsageDeriveBits})
	if err != nil {
		t.Fatalf("import raw key: %v", err)
	}

	alg := Algorithm{Name: algName, Hash: c.Hash, Salt: decodeB64(t, c.Salt)}
	if c.Kind == "hkdf" {
		alg.Info = decodeB64(t, c.Info)
	} else {
		alg.Iterations = intPtr(c.Iterations)
	}

	bits, err := DeriveBits(alg, key, intPtr(c.Length))
	if err != nil {
		t.Fatalf("deriveBits: %v", err)
	}
	if !bytes.Equal(bits, decodeB64(t, c.Bits)) {
		t.Fatalf("derived bits differ from Node's output\n got %x\nwant %x", bits, decodeB64(t, c.Bits))
	}
}

// runInteropECDHCase 用 Node 的密钥计算共享密钥。
func runInteropECDHCase(t *testing.T, c interopCase) {
	algName := AlgECDH
	if c.NamedCurve == "" {
		algName = AlgX25519
	}
	alg := Algorithm{Name: algName, NamedCurve: c.NamedCurve}

	privateKey, err := ImportKey(FormatPKCS8, KeyData{Raw: decodeB64(t, c.AlicePKCS8)}, alg, true,
		[]KeyUsage{UsageDeriveBits})
	if err != nil {
		t.Fatalf("import pkcs8: %v", err)
	}
	publicKey, err := ImportKey(FormatSPKI, KeyData{Raw: decodeB64(t, c.BobSPKI)}, alg, true, nil)
	if err != nil {
		t.Fatalf("import spki: %v", err)
	}

	derive := alg
	derive.Public = publicKey
	bits, err := DeriveBits(derive, privateKey, intPtr(c.Length))
	if err != nil {
		t.Fatalf("deriveBits: %v", err)
	}
	if !bytes.Equal(bits, decodeB64(t, c.Bits)) {
		t.Fatalf("shared secret differs from Node's output\n got %x\nwant %x", bits, decodeB64(t, c.Bits))
	}
}

// runInteropMD5Case 比较 MD5 摘要。MD5 是非规范扩展，夹具来自 Node 的传统 crypto 接口。
func runInteropMD5Case(t *testing.T, c interopCase) {
	digest, err := Digest(Algorithm{Name: AlgMD5}, decodeB64(t, c.Input))
	if err != nil {
		t.Fatalf("digest: %v", err)
	}
	if !bytes.Equal(digest, decodeB64(t, c.Digest)) {
		t.Fatalf("digest differs from Node's output\n got %x\nwant %x", digest, decodeB64(t, c.Digest))
	}
}

// runInteropHMACMD5Case 比较 HMAC-MD5 的签名。
func runInteropHMACMD5Case(t *testing.T, c interopCase, message []byte) {
	key, err := ImportKey(FormatRaw, KeyData{Raw: decodeB64(t, c.KeyBytes)},
		Algorithm{Name: AlgHMAC, Hash: AlgMD5}, true, []KeyUsage{UsageSign, UsageVerify})
	if err != nil {
		t.Fatalf("import raw: %v", err)
	}

	signature, err := Sign(Algorithm{Name: AlgHMAC}, key, message)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !bytes.Equal(signature, decodeB64(t, c.Signature)) {
		t.Fatalf("signature differs from Node's output\n got %x\nwant %x", signature, decodeB64(t, c.Signature))
	}

	// Node 生成的签名必须通过内核校验。
	ok, err := Verify(Algorithm{Name: AlgHMAC}, key, decodeB64(t, c.Signature), message)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !ok {
		t.Fatal("the kernel rejected a signature produced by Node")
	}
}

// runInteropAESECBCase 比较 AES-ECB 的密文。两端都使用 PKCS#7 填充，因此结果应逐字节相同。
func runInteropAESECBCase(t *testing.T, c interopCase, message []byte) {
	key, err := ImportKey(FormatRaw, KeyData{Raw: decodeB64(t, c.KeyBytes)},
		Algorithm{Name: AlgAESECB}, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatalf("import raw: %v", err)
	}
	alg := Algorithm{Name: AlgAESECB}

	ciphertext, err := Encrypt(alg, key, message)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !bytes.Equal(ciphertext, decodeB64(t, c.Ciphertext)) {
		t.Fatalf("ciphertext differs from Node's output\n got %x\nwant %x",
			ciphertext, decodeB64(t, c.Ciphertext))
	}

	// 内核必须能解密 Node 生成的密文。
	plaintext, err := Decrypt(alg, key, decodeB64(t, c.Ciphertext))
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(plaintext, message) {
		t.Fatalf("decrypted %q, want %q", plaintext, message)
	}
}
