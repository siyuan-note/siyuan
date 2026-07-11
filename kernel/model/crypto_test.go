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
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// setDEKForTest 把指定 DEK 直接注入 boxID 的缓存，绕过 UnlockBox 的 Argon2id 派生，便于纯内存测试。
func setDEKForTest(boxID string, dek []byte) {
	cachedDEKsLock.Lock()
	defer cachedDEKsLock.Unlock()
	cachedDEKs[boxID] = dek
}

// TestIsBoxUnlockedLifecycle 验证 DEK 缓存的存在/缺失状态。
func TestIsBoxUnlockedLifecycle(t *testing.T) {
	LockAllBoxes() // 确保初始干净
	boxID := "lifecycle-test-box"
	if IsBoxUnlocked(boxID) {
		t.Fatalf("box should not be unlocked after LockAllBoxes")
	}
	dek, _ := util.GenerateDEK()
	setDEKForTest(boxID, dek)
	if !IsBoxUnlocked(boxID) {
		t.Fatalf("box should be unlocked after setDEKForTest")
	}
	LockBox(boxID)
	if IsBoxUnlocked(boxID) {
		t.Fatalf("box should be locked after LockBox")
	}
}

// TestLockAllBoxes 验证 LockAllBoxes 清空所有 DEK。
func TestLockAllBoxes(t *testing.T) {
	dek1, _ := util.GenerateDEK()
	dek2, _ := util.GenerateDEK()
	setDEKForTest("box-a", dek1)
	setDEKForTest("box-b", dek2)

	LockAllBoxes()
	for _, id := range []string{"box-a", "box-b"} {
		if IsBoxUnlocked(id) {
			t.Fatalf("box %q should be locked after LockAllBoxes", id)
		}
	}
}

// TestGetDEKReturnsErrorAfterLock 验证 LockBox 后 GetDEK 报错。
func TestGetDEKReturnsErrorAfterLock(t *testing.T) {
	dek, _ := util.GenerateDEK()
	boxID := "get-dek-test-box"
	setDEKForTest(boxID, dek)

	got, err := GetDEK(boxID)
	if err != nil {
		t.Fatalf("GetDEK before lock failed: %v", err)
	}
	if !bytes.Equal(dek, got) {
		t.Fatalf("GetDEK returned wrong DEK")
	}

	LockBox(boxID)
	if _, err := GetDEK(boxID); err == nil {
		t.Fatalf("GetDEK should fail after LockBox")
	}
}

// TestWrapNewDEKRoundTrip 验证用 KEK 生成 DEK → 包络 → 解包 → 还原。
func TestWrapNewDEKRoundTrip(t *testing.T) {
	kek, _ := util.GenerateDEK()
	defer LockAllBoxes()

	boxEnc, _, err := WrapNewDEK("wrap-roundtrip-box", kek)
	if err != nil {
		t.Fatalf("WrapNewDEK failed: %v", err)
	}
	if len(boxEnc.WrappedDEK) == 0 || len(boxEnc.WrapNonce) != 12 {
		t.Fatalf("BoxEncryption fields malformed: wrappedDEK=%d wrapNonce=%d", len(boxEnc.WrappedDEK), len(boxEnc.WrapNonce))
	}

	boxID := "wrap-roundtrip-box"
	if err := UnwrapDEK(boxID, boxEnc, kek); err != nil {
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
	boxEnc, _, _ := WrapNewDEK("wrong-kek-box", kek1)

	kek2, _ := util.GenerateDEK()
	defer LockAllBoxes()

	if err := UnwrapDEK("wrong-kek-box", boxEnc, kek2); err == nil {
		t.Fatalf("UnwrapDEK with wrong KEK should fail")
	}
}

// TestWrapNewDEKProducesUniqueDEKs 验证两次调用 WrapNewDEK 生成不同的 DEK（随机性）。
func TestWrapNewDEKProducesUniqueDEKs(t *testing.T) {
	kek, _ := util.GenerateDEK()
	defer LockAllBoxes()

	enc1, dek1, _ := WrapNewDEK("uniq-box-1", kek)
	enc2, dek2, _ := WrapNewDEK("uniq-box-2", kek)

	// WrapNewDEK 现在同时返回原始 DEK，可直接比对随机性
	if bytes.Equal(dek1, dek2) {
		t.Fatalf("two WrapNewDEK calls produced identical DEKs (not random?)")
	}

	// 同时验证包络后解包能还原出相同的 DEK
	UnwrapDEK("uniq-box-1", enc1, kek)
	UnwrapDEK("uniq-box-2", enc2, kek)
	unwrappedDek1, _ := GetDEK("uniq-box-1")
	unwrappedDek2, _ := GetDEK("uniq-box-2")
	if !bytes.Equal(unwrappedDek1, dek1) || !bytes.Equal(unwrappedDek2, dek2) {
		t.Fatalf("UnwrapDEK did not restore the original DEK")
	}
}

// TestBoxEncryptionRoundTripViaUtil 验证 conf.BoxEncryption 的字段能正确往返加解密（端到端，绕过缓存）。
func TestBoxEncryptionRoundTripViaUtil(t *testing.T) {
	kek, _ := util.GenerateDEK()
	originalDEK, _ := util.GenerateDEK()

	wrapped, _ := util.EncryptWithAAD(kek, originalDEK, wrappedDEKAAD(""))
	boxEnc := &conf.BoxEncryption{
		WrappedDEK: wrapped,
		WrapNonce:  wrapped[:12],
	}

	recoveredDEK, err := decryptWrappedDEK("", boxEnc, kek)
	if err != nil {
		t.Fatalf("Decrypt wrapped DEK failed: %v", err)
	}
	if !bytes.Equal(originalDEK, recoveredDEK) {
		t.Fatalf("DEK round-trip mismatch")
	}
}

// TestUnmount0ClearsDEKForUnmountedEncryptedBox 验证安全修复：加密笔记本在
// "已解锁（DEK 在内存）但未挂载（不在 GetOpenedBoxes）"的状态下调用 unmount0，
// DEK 仍应被清除，否则锁定后认证 API 仍可读取明文。
// 直接测试 clearDEKIfUnlockedEncryptedBox（unmount0 在 box==nil 分支调用的清理逻辑），
// 避免依赖未初始化的全局 Conf。
func TestUnmount0ClearsDEKForUnmountedEncryptedBox(t *testing.T) {
	boxID := "unmount-unlocked-test-box"

	// 临时替换 DataDir，创建加密 box 的 conf.json，让 IsEncryptedBox 返回 true
	origDataDir := util.DataDir
	tempDir := t.TempDir()
	util.DataDir = tempDir
	defer func() {
		util.DataDir = origDataDir
		LockAllBoxes() // 测试后清理所有 DEK 缓存
	}()

	// 写入加密 box 的 conf.json
	confDir := filepath.Join(tempDir, boxID, ".siyuan")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatalf("mkdir conf dir failed: %v", err)
	}
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	boxConf.Closed = true // 未挂载（关闭状态）
	confData, _ := gulu.JSON.MarshalIndentJSON(boxConf, "", "  ")
	if err := os.WriteFile(filepath.Join(confDir, "conf.json"), confData, 0644); err != nil {
		t.Fatalf("write conf.json failed: %v", err)
	}

	// 确认 IsEncryptedBox 返回 true
	if !IsEncryptedBox(boxID) {
		t.Fatalf("precondition failed: IsEncryptedBox should return true")
	}

	// 注入 DEK 模拟已解锁状态
	dek, _ := util.GenerateDEK()
	setDEKForTest(boxID, dek)
	if !IsBoxUnlocked(boxID) {
		t.Fatalf("precondition failed: box should be unlocked after setDEKForTest")
	}

	// 调用清理逻辑（unmount0 在 box 未挂载分支调用的函数）
	clearDEKIfUnlockedEncryptedBox(boxID)

	// 验证 DEK 已被清除
	if IsBoxUnlocked(boxID) {
		t.Fatalf("DEK should be cleared for unlocked encrypted box")
	}
}

// TestLockAllBoxesConcurrentReads 验证 LockAllBoxes 与并发读操作（持 box 读锁）正确串行化。
func TestLockAllBoxesConcurrentReads(t *testing.T) {
	// 注入 3 个 box 的 DEK
	boxes := []string{"concurrent-a", "concurrent-b", "concurrent-c"}
	for _, id := range boxes {
		dek, _ := util.GenerateDEK()
		setDEKForTest(id, dek)
	}

	// 启动 goroutine 持续获取读锁（模拟在途解密操作）
	stop := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					for _, id := range boxes {
						HoldBoxReadLock(id)
						time.Sleep(time.Microsecond)
						ReleaseBoxReadLock(id)
					}
				}
			}
		}()
	}

	time.Sleep(10 * time.Millisecond) // 给 goroutine 时间开始获取读锁
	LockAllBoxes()
	close(stop)
	wg.Wait()

	for _, id := range boxes {
		if IsBoxUnlocked(id) {
			t.Fatalf("box %q should be locked after concurrent LockAllBoxes", id)
		}
	}
}

// TestBackupUpgradeFromSpec0 验证旧格式备份（Spec=0）能被正确升级。
func TestBackupUpgradeFromSpec0(t *testing.T) {
	origDataDir := util.DataDir
	tempDir := t.TempDir()
	util.DataDir = tempDir
	defer func() { util.DataDir = origDataDir }()

	// 写 Spec=0 旧格式备份（模拟同步/导入带来的旧备份）
	oldBackup := &conf.NotebookCrypto{
		Enabled:     true,
		MasterSalt:  []byte("oldsalt1234567890"),
		KEKVerifier: []byte("test-verifier"),
	}
	backupPath := filepath.Join(tempDir, ".siyuan", "notebook-crypto-backup.json")
	os.MkdirAll(filepath.Dir(backupPath), 0755)
	data, _ := json.Marshal(oldBackup)
	os.WriteFile(backupPath, data, 0644)

	// 加载：应识别为 Spec=0 并升级
	nc, err := loadNotebookCryptoBackup()
	if err != nil {
		t.Fatalf("loadNotebookCryptoBackup failed: %v", err)
	}
	if nc.Spec != 1 {
		t.Fatalf("expected Spec=1 after upgrade, got %d", nc.Spec)
	}

	// 写入升级后的备份（prepareBackupForWrite 会补全 Checksum 和 Generation）
	prepareBackupForWrite(nc)
	backupDir := filepath.Join(tempDir, ".siyuan")
	os.MkdirAll(backupDir, 0755)
	data, _ = json.Marshal(nc)
	os.WriteFile(backupPath, data, 0644)

	// 重新加载，校验和应通过
	nc2, err := loadNotebookCryptoBackup()
	if err != nil {
		t.Fatalf("reload backup failed: %v", err)
	}
	if nc2.Generation < 1 {
		t.Fatalf("expected Generation>=1, got %d", nc2.Generation)
	}
	if nc2.Checksum == "" {
		t.Fatalf("expected non-empty Checksum after write")
	}
}

// TestBackupChecksumCorruption 验证校验和可检测备份损坏。
func TestBackupChecksumCorruption(t *testing.T) {
	origDataDir := util.DataDir
	tempDir := t.TempDir()
	util.DataDir = tempDir
	defer func() { util.DataDir = origDataDir }()

	// 创建有效备份
	nc := &conf.NotebookCrypto{
		Enabled:    true,
		MasterSalt: []byte("corrupt-test-salt12"),
	}
	prepareBackupForWrite(nc)
	backupPath := filepath.Join(tempDir, ".siyuan", "notebook-crypto-backup.json")
	os.MkdirAll(filepath.Dir(backupPath), 0755)
	data, _ := json.Marshal(nc)
	os.WriteFile(backupPath, data, 0644)

	// 验证正常加载
	nc1, err := loadNotebookCryptoBackup()
	if err != nil {
		t.Fatalf("loadNotebookCryptoBackup should succeed with valid backup: %v", err)
	}
	if nc1.Spec != 1 {
		t.Fatalf("expected Spec=1, got %d", nc1.Spec)
	}

	// 篡改 MasterSalt 一个字节
	nc.MasterSalt[0] ^= 0xFF
	// 不更新 Checksum（模拟磁盘损坏）
	data, _ = json.Marshal(nc)
	os.WriteFile(backupPath, data, 0644)

	// 应检测到损坏
	_, err = loadNotebookCryptoBackup()
	if err == nil {
		t.Fatalf("loadNotebookCryptoBackup should fail with corrupted backup")
	}
}

// TestBackupKEKMACVerification 验证 KEKMAC 认证码正确性。
func TestBackupKEKMACVerification(t *testing.T) {
	nc := &conf.NotebookCrypto{
		Enabled:    true,
		MasterSalt: []byte("kekmac-test-salt12"),
	}
	prepareBackupForWrite(nc)

	correctKek, _ := util.GenerateDEK()
	nc.KEKMAC = computeKEKMAC(nc, correctKek)

	// 正确 KEK 验证通过
	if !verifyKEKMAC(nc, correctKek) {
		t.Fatalf("verifyKEKMAC should pass with correct KEK")
	}

	// 错误 KEK 验证失败
	wrongKek, _ := util.GenerateDEK()
	if verifyKEKMAC(nc, wrongKek) {
		t.Fatalf("verifyKEKMAC should fail with wrong KEK")
	}
}

// TestLockBoxConcurrentReads 验证 LockBox（单 box）能与在途读锁正确串行化。
func TestLockBoxConcurrentReads(t *testing.T) {
	LockAllBoxes() // 清理初始状态
	boxID := "concurrent-single-box"
	dek, _ := util.GenerateDEK()
	setDEKForTest(boxID, dek)

	stop := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					HoldBoxReadLock(boxID)
					time.Sleep(time.Microsecond)
					ReleaseBoxReadLock(boxID)
				}
			}
		}()
	}

	time.Sleep(10 * time.Millisecond)
	LockBox(boxID)
	close(stop)
	wg.Wait()

	if IsBoxUnlocked(boxID) {
		t.Fatalf("box should be locked after concurrent LockBox")
	}
}

// TestLockBoxClearsTempDirs 验证 LockBox 删除 per-box 临时目录。
func TestLockBoxClearsTempDirs(t *testing.T) {
	boxID := "temp-cleanup-box"
	dek, _ := util.GenerateDEK()
	setDEKForTest(boxID, dek)

	origTempDir := util.TempDir
	tempDir := t.TempDir()
	util.TempDir = tempDir
	defer func() {
		util.TempDir = origTempDir
		LockAllBoxes()
	}()

	// 创建模拟临时目录和文件
	exportDir := filepath.Join(tempDir, "export", boxID)
	repoDiffDir := filepath.Join(tempDir, "repo", "diff", boxID)
	repoRollbackDir := filepath.Join(tempDir, "repo", "rollback", boxID)
	for _, d := range []string{exportDir, repoDiffDir, repoRollbackDir} {
		if err := os.MkdirAll(d, 0755); err != nil {
			t.Fatalf("mkdir %s failed: %v", d, err)
		}
		if err := os.WriteFile(filepath.Join(d, "test.txt"), []byte("test"), 0644); err != nil {
			t.Fatalf("write test file failed: %v", err)
		}
	}

	LockBox(boxID)

	for _, d := range []string{exportDir, repoDiffDir, repoRollbackDir} {
		if _, err := os.Stat(d); !os.IsNotExist(err) {
			t.Fatalf("temp dir %s should be removed by LockBox", d)
		}
	}
}

// TestLockAllBoxesClearsGlobalTempDirs 验证 LockAllBoxes 清理全局临时目录。
func TestLockAllBoxesClearsGlobalTempDirs(t *testing.T) {
	// 注入少量 DEK 确保 LockAllBoxes 走 per-box + global 清理路径
	for _, id := range []string{"global-cleanup-a", "global-cleanup-b"} {
		dek, _ := util.GenerateDEK()
		setDEKForTest(id, dek)
	}

	origTempDir := util.TempDir
	tempDir := t.TempDir()
	util.TempDir = tempDir
	defer func() {
		util.TempDir = origTempDir
	}()

	// 创建全局临时目录
	exportDir := filepath.Join(tempDir, "export", "repo")
	repoDir := filepath.Join(tempDir, "repo", "sync", "conflicts", "test-timestamp", "global-cleanup-a")
	for _, d := range []string{exportDir, repoDir} {
		if err := os.MkdirAll(d, 0755); err != nil {
			t.Fatalf("mkdir %s failed: %v", d, err)
		}
	}
	if err := os.WriteFile(filepath.Join(repoDir, "test.txt"), []byte("test"), 0644); err != nil {
		t.Fatalf("write test file failed: %v", err)
	}

	LockAllBoxes()

	// 全局 temp 目录应该被清空
	for _, d := range []string{filepath.Join(tempDir, "export"), filepath.Join(tempDir, "repo")} {
		if _, err := os.Stat(d); !os.IsNotExist(err) {
			t.Fatalf("global temp dir %s should be removed by LockAllBoxes", d)
		}
	}
}
