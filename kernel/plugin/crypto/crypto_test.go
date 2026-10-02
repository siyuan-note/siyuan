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

// mustHex 解析测试向量中的十六进制字符串。
func mustHex(t *testing.T, value string) []byte {
	t.Helper()
	ret, err := hex.DecodeString(value)
	if err != nil {
		t.Fatalf("decode hex %q: %v", value, err)
	}
	return ret
}

// errorName 返回错误的规范名称，便于断言失败原因。
func errorName(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		return ""
	}
	cryptoErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error %v is not a *crypto.Error", err)
	}
	return cryptoErr.Name
}

// newSecretKey 构造测试用的对称密钥。
func newSecretKey(algName string, hashName string, secret []byte, usages ...KeyUsage) *Key {
	length := len(secret) * 8
	return &Key{
		Type:        KeyTypeSecret,
		Extractable: true,
		Usages:      cloneUsages(usages),
		Algorithm:   KeyAlgorithm{Name: algName, Hash: hashName, Length: &length},
		secret:      secret,
	}
}

func TestDigestVectors(t *testing.T) {
	// 来自 RFC 3174、FIPS 180-4 的 "abc" 摘要值。
	cases := []struct {
		alg  string
		want string
	}{
		{AlgSHA1, "a9993e364706816aba3e25717850c26c9cd0d89d"},
		{AlgSHA256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
		{AlgSHA384, "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed" +
			"8086072ba1e7cc2358baeca134c825a7"},
		{AlgSHA512, "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" +
			"2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"},
	}

	for _, c := range cases {
		got, err := Digest(Algorithm{Name: c.alg}, []byte("abc"))
		if err != nil {
			t.Fatalf("%s: %v", c.alg, err)
		}
		if hex.EncodeToString(got) != c.want {
			t.Errorf("%s digest = %s, want %s", c.alg, hex.EncodeToString(got), c.want)
		}
	}
}

func TestDigestRejectsUnknownAlgorithm(t *testing.T) {
	_, err := Digest(Algorithm{Name: "SHA-3"}, nil)
	if name := errorName(t, err); name != ErrNameNotSupported {
		t.Fatalf("error name = %q, want %q", name, ErrNameNotSupported)
	}
}

func TestHMACRFC4231(t *testing.T) {
	// RFC 4231 第 4.3 节测试用例 2。
	key := newSecretKey(AlgHMAC, AlgSHA256, []byte("Jefe"), UsageSign, UsageVerify)
	data := []byte("what do ya want for nothing?")

	signature, err := Sign(Algorithm{Name: AlgHMAC}, key, data)
	if err != nil {
		t.Fatal(err)
	}
	want := "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
	if hex.EncodeToString(signature) != want {
		t.Fatalf("HMAC-SHA256 = %s, want %s", hex.EncodeToString(signature), want)
	}

	ok, err := Verify(Algorithm{Name: AlgHMAC}, key, signature, data)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("Verify returned false for a valid signature")
	}

	signature[0] ^= 0xff
	ok, err = Verify(Algorithm{Name: AlgHMAC}, key, signature, data)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("Verify returned true for a tampered signature")
	}
}

func TestHKDFRFC5869(t *testing.T) {
	// RFC 5869 附录 A.1 测试用例 1。
	ikm := mustHex(t, "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b")
	key := &Key{
		Type: KeyTypeSecret, Usages: []KeyUsage{UsageDeriveBits},
		Algorithm: KeyAlgorithm{Name: AlgHKDF}, secret: ikm,
	}
	alg := Algorithm{
		Name: AlgHKDF, Hash: AlgSHA256,
		Salt: mustHex(t, "000102030405060708090a0b0c"),
		Info: mustHex(t, "f0f1f2f3f4f5f6f7f8f9"),
	}

	got, err := DeriveBits(alg, key, intPtr(42*8))
	if err != nil {
		t.Fatal(err)
	}
	want := "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
	if hex.EncodeToString(got) != want {
		t.Fatalf("HKDF = %s, want %s", hex.EncodeToString(got), want)
	}
}

func TestPBKDF2RFC6070(t *testing.T) {
	// RFC 6070 第 2 节测试用例 2：SHA-1、2 次迭代。
	key := &Key{
		Type: KeyTypeSecret, Usages: []KeyUsage{UsageDeriveBits},
		Algorithm: KeyAlgorithm{Name: AlgPBKDF2}, secret: []byte("password"),
	}
	alg := Algorithm{Name: AlgPBKDF2, Hash: AlgSHA1, Salt: []byte("salt"), Iterations: intPtr(2)}

	got, err := DeriveBits(alg, key, intPtr(20*8))
	if err != nil {
		t.Fatal(err)
	}
	want := "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957"
	if hex.EncodeToString(got) != want {
		t.Fatalf("PBKDF2 = %s, want %s", hex.EncodeToString(got), want)
	}
}

func TestDeriveBitsRejectsInvalidLength(t *testing.T) {
	key := &Key{
		Type: KeyTypeSecret, Usages: []KeyUsage{UsageDeriveBits},
		Algorithm: KeyAlgorithm{Name: AlgHKDF}, secret: []byte("secret"),
	}
	alg := Algorithm{Name: AlgHKDF, Hash: AlgSHA256, Salt: []byte{}, Info: []byte{}}

	for _, length := range []*int{nil, intPtr(0), intPtr(7)} {
		if _, err := DeriveBits(alg, key, length); errorName(t, err) != ErrNameOperation {
			t.Fatalf("length %v: error = %v, want OperationError", length, err)
		}
	}
}

func TestPBKDF2RejectsZeroIterations(t *testing.T) {
	key := &Key{
		Type: KeyTypeSecret, Usages: []KeyUsage{UsageDeriveBits},
		Algorithm: KeyAlgorithm{Name: AlgPBKDF2}, secret: []byte("password"),
	}
	alg := Algorithm{Name: AlgPBKDF2, Hash: AlgSHA256, Salt: []byte("salt"), Iterations: intPtr(0)}

	if _, err := DeriveBits(alg, key, intPtr(128)); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
}

func TestKDFKeyMustNotBeExtractable(t *testing.T) {
	alg := Algorithm{Name: AlgPBKDF2}
	_, err := ImportKey(FormatRaw, KeyData{Raw: []byte("password")}, alg, true, []KeyUsage{UsageDeriveBits})
	if errorName(t, err) != ErrNameSyntax {
		t.Fatalf("error = %v, want SyntaxError", err)
	}

	key, err := ImportKey(FormatRaw, KeyData{Raw: []byte("password")}, alg, false, []KeyUsage{UsageDeriveBits})
	if err != nil {
		t.Fatal(err)
	}
	if key.Extractable {
		t.Fatal("PBKDF2 key is extractable")
	}
}

func TestDeriveKeyProducesUsableKey(t *testing.T) {
	base := &Key{
		Type: KeyTypeSecret, Usages: []KeyUsage{UsageDeriveKey},
		Algorithm: KeyAlgorithm{Name: AlgPBKDF2}, secret: []byte("password"),
	}
	alg := Algorithm{Name: AlgPBKDF2, Hash: AlgSHA256, Salt: []byte("salt"), Iterations: intPtr(16)}
	derived := Algorithm{Name: AlgAESGCM, Length: intPtr(256)}

	key, err := DeriveKey(alg, base, derived, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}
	if key.Algorithm.Name != AlgAESGCM || *key.Algorithm.Length != 256 {
		t.Fatalf("derived algorithm = %+v, want AES-GCM 256", key.Algorithm)
	}

	// 相同参数必须派生出相同密钥。
	again, err := DeriveKey(alg, base, derived, true, []KeyUsage{UsageEncrypt, UsageDecrypt})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(key.secret, again.secret) {
		t.Fatal("deriveKey is not deterministic")
	}
}

func TestDeriveKeyRejectsKDFTarget(t *testing.T) {
	base := &Key{
		Type: KeyTypeSecret, Usages: []KeyUsage{UsageDeriveKey},
		Algorithm: KeyAlgorithm{Name: AlgHKDF}, secret: []byte("secret"),
	}
	alg := Algorithm{Name: AlgHKDF, Hash: AlgSHA256, Salt: []byte{}, Info: []byte{}}

	_, err := DeriveKey(alg, base, Algorithm{Name: AlgPBKDF2}, false, []KeyUsage{UsageDeriveBits})
	if errorName(t, err) != ErrNameNotSupported {
		t.Fatalf("error = %v, want NotSupportedError", err)
	}
}
