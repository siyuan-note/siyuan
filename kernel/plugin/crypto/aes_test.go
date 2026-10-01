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
	"crypto/cipher"
	"encoding/hex"
	"testing"
)

func TestAESGCMNISTVector(t *testing.T) {
	// NIST SP 800-38D 配套测试向量（gcmEncryptExtIV256，Count = 0 的 96 位 IV 用例）。
	key := newSecretKey(AlgAESGCM, "",
		mustHex(t, "b52c505a37d78eda5dd34f20c22540ea1b58963cf8e5bf8ffa85f9f2492505b4"),
		UsageEncrypt, UsageDecrypt)
	alg := Algorithm{Name: AlgAESGCM, IV: mustHex(t, "516c33929df5a3284ff463d7")}

	ciphertext, err := Encrypt(alg, key, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := "bdc1ac884d332457a1d2664f168c76f0"
	if hex.EncodeToString(ciphertext) != want {
		t.Fatalf("AES-GCM tag = %s, want %s", hex.EncodeToString(ciphertext), want)
	}

	plaintext, err := Decrypt(alg, key, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if len(plaintext) != 0 {
		t.Fatalf("plaintext = %x, want empty", plaintext)
	}
}

func TestAESGCMRoundTripWithAAD(t *testing.T) {
	key := newSecretKey(AlgAESGCM, "", bytes.Repeat([]byte{7}, 32), UsageEncrypt, UsageDecrypt)
	alg := Algorithm{
		Name: AlgAESGCM,
		IV:   bytes.Repeat([]byte{1}, 12),
		AAD:  []byte("attribute view"),
	}
	data := []byte("siyuan kernel plugin")

	ciphertext, err := Encrypt(alg, key, data)
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := Decrypt(alg, key, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(plaintext, data) {
		t.Fatalf("plaintext = %q, want %q", plaintext, data)
	}

	// 附加认证数据不同必须导致认证失败。
	tampered := alg
	tampered.AAD = []byte("other")
	if _, err = Decrypt(tampered, key, ciphertext); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
}

func TestAESGCMTagLength(t *testing.T) {
	key := newSecretKey(AlgAESGCM, "", bytes.Repeat([]byte{2}, 16), UsageEncrypt, UsageDecrypt)
	iv := bytes.Repeat([]byte{3}, 12)

	// 96 到 128 位的标签长度按请求长度生效。
	for _, tagLength := range []int{96, 104, 112, 120, 128} {
		alg := Algorithm{Name: AlgAESGCM, IV: iv, TagLength: intPtr(tagLength)}
		ciphertext, err := Encrypt(alg, key, []byte("x"))
		if err != nil {
			t.Fatalf("tagLength %d: %v", tagLength, err)
		}
		if want := 1 + tagLength/8; len(ciphertext) != want {
			t.Fatalf("tagLength %d: ciphertext length = %d, want %d", tagLength, len(ciphertext), want)
		}
	}

	// Go 不支持 32、64 位标签，按设计返回 NotSupportedError。
	for _, tagLength := range []int{32, 64} {
		alg := Algorithm{Name: AlgAESGCM, IV: iv, TagLength: intPtr(tagLength)}
		if _, err := Encrypt(alg, key, []byte("x")); errorName(t, err) != ErrNameNotSupported {
			t.Fatalf("tagLength %d: error = %v, want NotSupportedError", tagLength, err)
		}
	}

	// 其他取值不符合规范，返回 OperationError。
	alg := Algorithm{Name: AlgAESGCM, IV: iv, TagLength: intPtr(100)}
	if _, err := Encrypt(alg, key, []byte("x")); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
}

func TestAESGCMNonStandardIVRequiresFullTag(t *testing.T) {
	key := newSecretKey(AlgAESGCM, "", bytes.Repeat([]byte{4}, 16), UsageEncrypt, UsageDecrypt)

	alg := Algorithm{Name: AlgAESGCM, IV: bytes.Repeat([]byte{5}, 16)}
	ciphertext, err := Encrypt(alg, key, []byte("data"))
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := Decrypt(alg, key, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(plaintext, []byte("data")) {
		t.Fatalf("plaintext = %q, want %q", plaintext, "data")
	}

	alg.TagLength = intPtr(96)
	if _, err = Encrypt(alg, key, []byte("data")); errorName(t, err) != ErrNameNotSupported {
		t.Fatalf("error = %v, want NotSupportedError", err)
	}
}

func TestAESCBCRoundTripAndPadding(t *testing.T) {
	key := newSecretKey(AlgAESCBC, "", bytes.Repeat([]byte{9}, 16), UsageEncrypt, UsageDecrypt)
	alg := Algorithm{Name: AlgAESCBC, IV: bytes.Repeat([]byte{8}, 16)}

	// 空数据也会补满一个分组，密文长度始终是分组长度的整数倍。
	for _, size := range []int{0, 1, 15, 16, 17, 32} {
		data := bytes.Repeat([]byte{byte(size)}, size)
		ciphertext, err := Encrypt(alg, key, data)
		if err != nil {
			t.Fatalf("size %d: %v", size, err)
		}
		if len(ciphertext)%aes.BlockSize != 0 || len(ciphertext) <= size {
			t.Fatalf("size %d: ciphertext length = %d", size, len(ciphertext))
		}

		plaintext, err := Decrypt(alg, key, ciphertext)
		if err != nil {
			t.Fatalf("size %d: %v", size, err)
		}
		if !bytes.Equal(plaintext, data) {
			t.Fatalf("size %d: plaintext = %x, want %x", size, plaintext, data)
		}
	}
}

func TestAESCBCRejectsInvalidInput(t *testing.T) {
	key := newSecretKey(AlgAESCBC, "", bytes.Repeat([]byte{9}, 16), UsageEncrypt, UsageDecrypt)

	// iv 必须是 16 字节。
	short := Algorithm{Name: AlgAESCBC, IV: bytes.Repeat([]byte{1}, 8)}
	if _, err := Encrypt(short, key, []byte("data")); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}

	alg := Algorithm{Name: AlgAESCBC, IV: bytes.Repeat([]byte{8}, 16)}
	// 密文长度必须是非零的分组整数倍。
	for _, ciphertext := range [][]byte{{}, bytes.Repeat([]byte{0}, 17)} {
		if _, err := Decrypt(alg, key, ciphertext); errorName(t, err) != ErrNameOperation {
			t.Fatalf("length %d: error = %v, want OperationError", len(ciphertext), err)
		}
	}

	// 填充字节被破坏时必须报错而不是返回错误明文。
	ciphertext, err := Encrypt(alg, key, []byte("data"))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[len(ciphertext)-1] ^= 0xff
	if _, err = Decrypt(alg, key, ciphertext); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
}

func TestUnpadPKCS7RejectsInvalidPadding(t *testing.T) {
	// 填充字节数为 0 或大于分组长度时都应判为无效。
	for _, last := range []byte{0, 17, 0xff} {
		data := bytes.Repeat([]byte{0}, aes.BlockSize)
		data[len(data)-1] = last
		if _, err := unpadPKCS7(data, aes.BlockSize); errorName(t, err) != ErrNameOperation {
			t.Fatalf("last byte %d: error = %v, want OperationError", last, err)
		}
	}

	// 填充字节不一致时也应判为无效。
	data := bytes.Repeat([]byte{0}, aes.BlockSize)
	data[len(data)-1] = 3
	data[len(data)-2] = 3
	data[len(data)-3] = 2
	if _, err := unpadPKCS7(data, aes.BlockSize); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}
}

func TestAESCTRMatchesStandardLibraryWithoutWrap(t *testing.T) {
	secret := bytes.Repeat([]byte{6}, 16)
	key := newSecretKey(AlgAESCTR, "", secret, UsageEncrypt, UsageDecrypt)
	counter := make([]byte, aes.BlockSize)
	data := bytes.Repeat([]byte{0xab}, 64)

	// 计数器从 0 开始且不回绕时，结果与标准库一致。
	alg := Algorithm{Name: AlgAESCTR, Counter: counter, Length: intPtr(64)}
	got, err := Encrypt(alg, key, data)
	if err != nil {
		t.Fatal(err)
	}

	block, err := aes.NewCipher(secret)
	if err != nil {
		t.Fatal(err)
	}
	want := make([]byte, len(data))
	cipher.NewCTR(block, counter).XORKeyStream(want, data)
	if !bytes.Equal(got, want) {
		t.Fatalf("AES-CTR = %x, want %x", got, want)
	}
}

func TestAESCTRWrapsWithinCounterBits(t *testing.T) {
	secret := bytes.Repeat([]byte{6}, 16)
	key := newSecretKey(AlgAESCTR, "", secret, UsageEncrypt, UsageDecrypt)
	block, err := aes.NewCipher(secret)
	if err != nil {
		t.Fatal(err)
	}

	// 计数器位长为 2，初始值为 3：第 1 个分组用计数器 3，随后回绕到 0、1、2，
	// 固定前缀保持不变，因此与标准库从 3 连续递增（会进位到前缀）的结果不同。
	counter := make([]byte, aes.BlockSize)
	counter[0] = 0xff
	counter[aes.BlockSize-1] = 0x03
	data := bytes.Repeat([]byte{0}, 4*aes.BlockSize)

	alg := Algorithm{Name: AlgAESCTR, Counter: counter, Length: intPtr(2)}
	got, err := Encrypt(alg, key, data)
	if err != nil {
		t.Fatal(err)
	}

	want := make([]byte, 0, len(data))
	for _, value := range []byte{3, 0, 1, 2} {
		iv := make([]byte, aes.BlockSize)
		copy(iv, counter)
		iv[aes.BlockSize-1] = value
		keystream := make([]byte, aes.BlockSize)
		cipher.NewCTR(block, iv).XORKeyStream(keystream, keystream)
		want = append(want, keystream...)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("AES-CTR with wrap = %x, want %x", got, want)
	}

	// 解密必须还原原始数据。
	plaintext, err := Decrypt(alg, key, got)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(plaintext, data) {
		t.Fatalf("plaintext = %x, want %x", plaintext, data)
	}
}

func TestAESCTRRejectsTooSmallCounterSpace(t *testing.T) {
	key := newSecretKey(AlgAESCTR, "", bytes.Repeat([]byte{6}, 16), UsageEncrypt, UsageDecrypt)
	alg := Algorithm{Name: AlgAESCTR, Counter: make([]byte, aes.BlockSize), Length: intPtr(1)}

	// 计数空间为 2 个分组，3 个分组的数据会导致计数器重复。
	data := bytes.Repeat([]byte{0}, 3*aes.BlockSize)
	if _, err := Encrypt(alg, key, data); errorName(t, err) != ErrNameData {
		t.Fatalf("error = %v, want DataError", err)
	}
}

func TestAESCTRRejectsInvalidParameters(t *testing.T) {
	key := newSecretKey(AlgAESCTR, "", bytes.Repeat([]byte{6}, 16), UsageEncrypt, UsageDecrypt)

	// counter 必须是 16 字节。
	short := Algorithm{Name: AlgAESCTR, Counter: make([]byte, 8), Length: intPtr(64)}
	if _, err := Encrypt(short, key, []byte("data")); errorName(t, err) != ErrNameOperation {
		t.Fatalf("error = %v, want OperationError", err)
	}

	// 缺少 length 属于参数缺失。
	missing := Algorithm{Name: AlgAESCTR, Counter: make([]byte, aes.BlockSize)}
	if _, err := Encrypt(missing, key, []byte("data")); errorName(t, err) != ErrNameType {
		t.Fatalf("error = %v, want TypeError", err)
	}

	// length 超出 1 到 128 的范围。
	for _, length := range []int{0, 129} {
		alg := Algorithm{Name: AlgAESCTR, Counter: make([]byte, aes.BlockSize), Length: intPtr(length)}
		if _, err := Encrypt(alg, key, []byte("data")); errorName(t, err) != ErrNameOperation {
			t.Fatalf("length %d: error = %v, want OperationError", length, err)
		}
	}
}
