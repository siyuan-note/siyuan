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

package model

import (
	"bytes"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// setKEKForTest 把指定 KEK 注入内存缓存，跳过 EnableEncryptedNotebook 的落盘流程，便于纯内存测试。
func setKEKForTest(kek []byte) {
	cachedKEKLock.Lock()
	defer cachedKEKLock.Unlock()
	cachedKEK = kek
}

// TestIsKEKUnlockedLifecycle 验证 KEK 缓存的存在/缺失状态。
func TestIsKEKUnlockedLifecycle(t *testing.T) {
	LockKEK() // 确保初始干净
	if IsKEKUnlocked() {
		t.Fatalf("KEK should not be available after LockKEK")
	}
	kek, _ := util.GenerateDEK()
	setKEKForTest(kek)
	if !IsKEKUnlocked() {
		t.Fatalf("KEK should be available after setKEKForTest")
	}
	LockKEK()
	if IsKEKUnlocked() {
		t.Fatalf("KEK should be cleared after LockKEK")
	}
}

// TestWrapUnwrapDEKRoundTrip 验证生成 DEK → 包络 → 解包 → 还原。
func TestWrapUnwrapDEKRoundTrip(t *testing.T) {
	kek, _ := util.GenerateDEK()
	setKEKForTest(kek)
	defer LockKEK()

	boxEnc, err := WrapNewDEK()
	if err != nil {
		t.Fatalf("WrapNewDEK failed: %v", err)
	}
	if len(boxEnc.WrappedDEK) == 0 || len(boxEnc.WrapNonce) != 12 {
		t.Fatalf("BoxEncryption fields malformed: wrappedDEK=%d wrapNonce=%d", len(boxEnc.WrappedDEK), len(boxEnc.WrapNonce))
	}

	boxID := "test-box-123"
	if err := UnwrapDEK(boxID, boxEnc); err != nil {
		t.Fatalf("UnwrapDEK failed: %v", err)
	}
	dek, err := GetDEK(boxID)
	if err != nil {
		t.Fatalf("GetDEK failed: %v", err)
	}
	if len(dek) != 32 {
		t.Fatalf("expected 32-byte DEK, got %d", len(dek))
	}
}

// TestUnwrapDEKWithWrongKEK 验证用错误的 KEK 解包失败（GCM MAC 校验）。
func TestUnwrapDEKWithWrongKEK(t *testing.T) {
	kek1, _ := util.GenerateDEK()
	setKEKForTest(kek1)
	boxEnc, _ := WrapNewDEK()

	// 换一个错误的 KEK
	kek2, _ := util.GenerateDEK()
	setKEKForTest(kek2)
	defer LockKEK()

	if err := UnwrapDEK("wrong-kek-box", boxEnc); err == nil {
		t.Fatalf("UnwrapDEK with wrong KEK should fail")
	}
}

// TestClearDEK 验证 ClearDEK 后 DEK 不可再取。
func TestClearDEK(t *testing.T) {
	kek, _ := util.GenerateDEK()
	setKEKForTest(kek)
	defer LockKEK()

	boxEnc, _ := WrapNewDEK()
	boxID := "clear-test-box"
	UnwrapDEK(boxID, boxEnc)

	ClearDEK(boxID)
	if _, err := GetDEK(boxID); err == nil {
		t.Fatalf("GetDEK should fail after ClearDEK")
	}
}

// TestLockKEKClearsAllDEKs 验证 LockKEK 同时清空所有 DEK。
func TestLockKEKClearsAllDEKs(t *testing.T) {
	kek, _ := util.GenerateDEK()
	setKEKForTest(kek)

	boxEnc1, _ := WrapNewDEK()
	boxEnc2, _ := WrapNewDEK()
	UnwrapDEK("box-a", boxEnc1)
	UnwrapDEK("box-b", boxEnc2)

	LockKEK()
	for _, id := range []string{"box-a", "box-b"} {
		if _, err := GetDEK(id); err == nil {
			t.Fatalf("GetDEK(%q) should fail after LockKEK", id)
		}
	}
}

// TestWrapNewDEKRequiresKEK 验证 KEK 未缓存时 WrapNewDEK 报错。
func TestWrapNewDEKRequiresKEK(t *testing.T) {
	LockKEK()
	if _, err := WrapNewDEK(); err == nil {
		t.Fatalf("WrapNewDEK should fail when KEK not cached")
	}
}

// TestBoxEncryptionRoundTripViaUtil 验证 conf.BoxEncryption 的字段能正确往返加解密（端到端，绕过缓存）。
func TestBoxEncryptionRoundTripViaUtil(t *testing.T) {
	kek, _ := util.GenerateDEK()
	originalDEK, _ := util.GenerateDEK()

	wrapped, _ := util.Encrypt(kek, originalDEK)
	boxEnc := &conf.BoxEncryption{
		WrappedDEK: wrapped,
		WrapNonce:  wrapped[:12],
	}

	// 模拟 UnwrapDEK 的核心：用 KEK 解开
	recoveredDEK, err := util.Decrypt(kek, boxEnc.WrappedDEK)
	if err != nil {
		t.Fatalf("Decrypt wrapped DEK failed: %v", err)
	}
	if !bytes.Equal(originalDEK, recoveredDEK) {
		t.Fatalf("DEK round-trip mismatch")
	}
}
