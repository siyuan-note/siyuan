// SiYuan - Refactor your thinking
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

package util

import (
	"bytes"
	"testing"
)

// TestArgon2KDFConsistency 验证同一 password+salt+params 多次派生结果一致。
func TestArgon2KDFConsistency(t *testing.T) {
	params := Argon2Params{Memory: 8 * 1024, Iterations: 1, Parallelism: 1, KeyLength: 32}
	salt := []byte("0123456789abcdef")
	k1 := DeriveKey("password", salt, params)
	k2 := DeriveKey("password", salt, params)
	if !bytes.Equal(k1, k2) {
		t.Fatalf("Argon2id derived keys differ for same inputs")
	}
	if len(k1) != 32 {
		t.Fatalf("expected 32-byte key, got %d", len(k1))
	}
}

// TestArgon2KDFDifferentPasswords 验证不同密码派生出不同密钥。
func TestArgon2KDFDifferentPasswords(t *testing.T) {
	params := Argon2Params{Memory: 8 * 1024, Iterations: 1, Parallelism: 1, KeyLength: 32}
	salt := []byte("0123456789abcdef")
	k1 := DeriveKey("password1", salt, params)
	k2 := DeriveKey("password2", salt, params)
	if bytes.Equal(k1, k2) {
		t.Fatalf("different passwords derived the same key")
	}
}

// TestAESGCMRoundTrip 验证加密→解密还原原文。
func TestAESGCMRoundTrip(t *testing.T) {
	key, err := GenerateDEK()
	if err != nil {
		t.Fatalf("GenerateDEK failed: %v", err)
	}
	plaintext := []byte("hello 思源加密笔记本")
	ct, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	pt, err := Decrypt(key, ct)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}
	if !bytes.Equal(plaintext, pt) {
		t.Fatalf("round-trip mismatch: got %q want %q", pt, plaintext)
	}
}

// TestAESGCMSamePlaintextDifferentCiphertext 验证同一明文多次加密结果不同（随机 nonce）。
func TestAESGCMSamePlaintextDifferentCiphertext(t *testing.T) {
	key, _ := GenerateDEK()
	plaintext := []byte("same content")
	ct1, _ := Encrypt(key, plaintext)
	ct2, _ := Encrypt(key, plaintext)
	if bytes.Equal(ct1, ct2) {
		t.Fatalf("same plaintext produced identical ciphertext (nonce not random?)")
	}
	// 但两者都应能正确解密
	if pt, err := Decrypt(key, ct1); err != nil || !bytes.Equal(pt, plaintext) {
		t.Fatalf("ct1 decrypt failed")
	}
	if pt, err := Decrypt(key, ct2); err != nil || !bytes.Equal(pt, plaintext) {
		t.Fatalf("ct2 decrypt failed")
	}
}

// TestAESGCMWrongKey 验证错误密钥解密失败。
func TestAESGCMWrongKey(t *testing.T) {
	key1, _ := GenerateDEK()
	key2, _ := GenerateDEK()
	plaintext := []byte("secret")
	ct, _ := Encrypt(key1, plaintext)
	if _, err := Decrypt(key2, ct); err == nil {
		t.Fatalf("Decrypt with wrong key should fail")
	}
}

// TestAESGCMTamperedCiphertext 验证篡改密文后解密失败（GCM 完整性校验）。
func TestAESGCMTamperedCiphertext(t *testing.T) {
	key, _ := GenerateDEK()
	plaintext := []byte("integrity check")
	ct, _ := Encrypt(key, plaintext)
	// 翻转最后一个字节（落在 GCM tag 区域）
	ct[len(ct)-1] ^= 0xff
	if _, err := Decrypt(key, ct); err == nil {
		t.Fatalf("Decrypt of tampered ciphertext should fail")
	}
}

// TestAESGCMInvalidKeyLength 验证非 32 字节密钥被拒绝。
func TestAESGCMInvalidKeyLength(t *testing.T) {
	shortKey := []byte("too-short")
	if _, err := Encrypt(shortKey, []byte("x")); err == nil {
		t.Fatalf("Encrypt with short key should fail")
	}
}

// TestGenerateSaltUnique 验证生成的 salt 足够随机（两次调用结果不同）。
func TestGenerateSaltUnique(t *testing.T) {
	s1, err := GenerateSalt()
	if err != nil {
		t.Fatalf("GenerateSalt failed: %v", err)
	}
	if len(s1) != 16 {
		t.Fatalf("expected 16-byte salt, got %d", len(s1))
	}
	s2, _ := GenerateSalt()
	if bytes.Equal(s1, s2) {
		t.Fatalf("two salts should differ")
	}
}
