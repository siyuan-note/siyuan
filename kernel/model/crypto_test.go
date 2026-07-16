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
	"fmt"
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
	LockBox("lifecycle-test-box") // 确保初始干净
	boxID := "lifecycle-test-box"
	if IsBoxUnlocked(boxID) {
		t.Fatalf("box should not be unlocked after LockBox")
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
	defer LockBox("wrap-roundtrip-box")

	boxEnc, _, err := WrapNewDEK("wrap-roundtrip-box", kek)
	if err != nil {
		t.Fatalf("WrapNewDEK failed: %v", err)
	}
	if len(boxEnc.WrappedDEK) == 0 || len(boxEnc.WrapNonce) != 12 {
		t.Fatalf("BoxEncryption fields malformed: wrappedDEK=%d wrapNonce=%d", len(boxEnc.WrappedDEK), len(boxEnc.WrapNonce))
	}

	dek, err := decryptWrappedDEK("wrap-roundtrip-box", boxEnc, kek)
	if err != nil {
		t.Fatalf("decryptWrappedDEK failed: %v", err)
	}
	if len(dek) != 32 {
		t.Fatalf("expected 32-byte DEK, got %d", len(dek))
	}
}

// TestDecryptWrappedDEKWithWrongKEK 验证用错误的 KEK 解密 WrappedDEK 失败（GCM MAC 校验）。
func TestDecryptWrappedDEKWithWrongKEK(t *testing.T) {
	kek1, _ := util.GenerateDEK()
	boxEnc, _, _ := WrapNewDEK("wrong-kek-box", kek1)

	kek2, _ := util.GenerateDEK()
	defer LockBox("wrong-kek-box")

	if _, err := decryptWrappedDEK("wrong-kek-box", boxEnc, kek2); err == nil {
		t.Fatalf("decryptWrappedDEK with wrong KEK should fail")
	}
}

// TestWrapNewDEKProducesUniqueDEKs 验证两次调用 WrapNewDEK 生成不同的 DEK（随机性）。
func TestWrapNewDEKProducesUniqueDEKs(t *testing.T) {
	kek, _ := util.GenerateDEK()
	defer LockBox("uniq-box-1")
	defer LockBox("uniq-box-2")

	_, dek1, _ := WrapNewDEK("uniq-box-1", kek)
	_, dek2, _ := WrapNewDEK("uniq-box-2", kek)

	// WrapNewDEK 同时返回原始 DEK，可直接比对随机性
	if bytes.Equal(dek1, dek2) {
		t.Fatalf("two WrapNewDEK calls produced identical DEKs (not random?)")
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
		LockBox("unmount-unlocked-test-box") // 测试后清理 DEK 缓存
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

// TestBackupRejectsUnsupportedSpec 验证非当前版本的备份被明确拒绝，不执行静默升级或降级。
func TestBackupRejectsUnsupportedSpec(t *testing.T) {
	for _, spec := range []int{0, conf.CurrentNotebookCryptoSpec + 1} {
		t.Run(fmt.Sprintf("spec-%d", spec), func(t *testing.T) {
			origDataDir := util.DataDir
			util.DataDir = t.TempDir()
			defer func() { util.DataDir = origDataDir }()

			backup := &conf.NotebookCrypto{Spec: spec}
			backupPath := filepath.Join(util.DataDir, ".siyuan", "notebook-crypto-backup.json")
			if err := os.MkdirAll(filepath.Dir(backupPath), 0755); err != nil {
				t.Fatal(err)
			}
			data, _ := json.Marshal(backup)
			if err := os.WriteFile(backupPath, data, 0644); err != nil {
				t.Fatal(err)
			}

			if _, err := loadNotebookCryptoBackup(); err == nil {
				t.Fatalf("unsupported notebook crypto spec [%d] should be rejected", spec)
			}
		})
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

// TestDeriveKEKRejectsTamperedBackupMAC 验证 verifier 正确但备份 MAC 被篡改时仍拒绝派生。
func TestDeriveKEKRejectsTamperedBackupMAC(t *testing.T) {
	origDataDir := util.DataDir
	util.DataDir = t.TempDir()
	defer func() { util.DataDir = origDataDir }()

	password := "authenticated-backup-test"
	salt, _ := util.GenerateSalt()
	params := util.DefaultArgon2Params()
	kek := util.DeriveKey(password, salt, params)
	verifier, _ := util.EncryptWithAAD(kek, kekVerifierMagic, []byte("siyuan:v1:kek-verifier"))
	nc := conf.NotebookCrypto{
		Enabled:     true,
		MasterSalt:  salt,
		KDFParams:   params,
		KEKVerifier: verifier,
		Spec:        1,
		KEKMAC:      []byte("tampered"),
	}
	prepareBackupForWrite(&nc)
	nc.KEKMAC = []byte("tampered")
	backupPath := filepath.Join(util.DataDir, ".siyuan", "notebook-crypto-backup.json")
	if err := os.MkdirAll(filepath.Dir(backupPath), 0755); err != nil {
		t.Fatal(err)
	}
	backupData, _ := json.Marshal(&nc)
	if err := os.WriteFile(backupPath, backupData, 0644); err != nil {
		t.Fatal(err)
	}

	originalConf := Conf
	Conf = NewAppConf()
	Conf.NotebookCrypto = &nc
	defer func() { Conf = originalConf }()

	if derived, err := deriveKEK(password); err == nil {
		zeroAndClear(derived)
		t.Fatalf("deriveKEK should reject a backup with an invalid KEKMAC")
	}
}

// TestDeriveKEKAllowsLocalAutoLockChange 验证本机修改自动锁定时间不会使已认证的密钥备份失效。
func TestDeriveKEKAllowsLocalAutoLockChange(t *testing.T) {
	origDataDir := util.DataDir
	util.DataDir = t.TempDir()
	defer func() { util.DataDir = origDataDir }()

	password := "local-auto-lock-test"
	salt, _ := util.GenerateSalt()
	params := util.DefaultArgon2Params()
	kek := util.DeriveKey(password, salt, params)
	defer zeroAndClear(kek)
	verifier, _ := util.EncryptWithAAD(kek, kekVerifierMagic, []byte("siyuan:v1:kek-verifier"))
	backup := &conf.NotebookCrypto{
		Enabled:         true,
		MasterSalt:      salt,
		KDFParams:       params,
		KEKVerifier:     verifier,
		AutoLockMinutes: 5,
	}
	if err := writeNotebookCryptoBackupData(backup, kek); err != nil {
		t.Fatal(err)
	}

	local := *backup
	local.AutoLockMinutes = 30
	originalConf := Conf
	Conf = NewAppConf()
	Conf.NotebookCrypto = &local
	defer func() { Conf = originalConf }()

	derived, err := deriveKEK(password)
	if err != nil {
		t.Fatalf("deriveKEK rejected a local AutoLockMinutes change: %v", err)
	}
	zeroAndClear(derived)
}

// TestDeepCopyBoxEncryptionPreservesSpec 验证保存笔记本配置前的深拷贝不会丢失包络版本。
func TestDeepCopyBoxEncryptionPreservesSpec(t *testing.T) {
	src := &conf.BoxEncryption{Spec: 1, WrappedDEK: []byte{1, 2}, WrapNonce: []byte{3, 4}, CreatedAt: 5}
	got := DeepCopyBoxEncryption(src)
	if got.Spec != src.Spec {
		t.Fatalf("BoxEncryption.Spec changed during deep copy: got %d want %d", got.Spec, src.Spec)
	}
}

// TestUnknownBlockRefFailsClosed 验证普通库无法定位定义块时按跨边界处理，防止锁定加密块 ID 被写入全局库。
func TestUnknownBlockRefFailsClosed(t *testing.T) {
	if !normalBoxBlockRefCrossesBoundary(nil) {
		t.Fatalf("an unresolved block reference should fail closed")
	}
}

// TestBackupMACRoundTrip 验证 writeNotebookCryptoBackupData(nc, kek) 写入的备份，
// 重新加载后 verifyKEKMAC 能通过——即 MAC 在 prepareBackupForWrite 之后计算（顺序正确）。
func TestBackupMACRoundTrip(t *testing.T) {
	origDataDir := util.DataDir
	tempDir := t.TempDir()
	util.DataDir = tempDir
	defer func() { util.DataDir = origDataDir }()

	password := "round-trip-test"
	salt, _ := util.GenerateSalt()
	params := util.DefaultArgon2Params()
	kek := util.DeriveKey(password, salt, params)
	defer zeroAndClear(kek)

	verifierCT, _ := util.EncryptWithAAD(kek, kekVerifierMagic, []byte("siyuan:v1:kek-verifier"))
	nc := &conf.NotebookCrypto{
		Enabled:     true,
		MasterSalt:  salt,
		KDFParams:   params,
		KEKVerifier: verifierCT,
	}

	// 通过 writeNotebookCryptoBackupData 写入（内部 prepareBackupForWrite 后计算 MAC）
	if err := writeNotebookCryptoBackupData(nc, kek); err != nil {
		t.Fatalf("writeNotebookCryptoBackupData failed: %v", err)
	}

	// 重新加载，验证 Checksum 和 MAC 均通过
	loaded, err := loadNotebookCryptoBackup()
	if err != nil {
		t.Fatalf("loadNotebookCryptoBackup failed: %v", err)
	}
	if loaded.Spec >= 1 && len(loaded.KEKMAC) > 0 && !verifyKEKMAC(loaded, kek) {
		t.Fatalf("verifyKEKMAC failed on round-trip backup (MAC was computed in wrong order)")
	}
}

// TestLockBoxConcurrentReads 验证 LockBox（单 box）能与在途读锁正确串行化。
func TestLockBoxConcurrentReads(t *testing.T) {
	LockBox("concurrent-single-box") // 清理初始状态
	boxID := "concurrent-single-box"
	dek, _ := util.GenerateDEK()
	setDEKForTest(boxID, dek)

	stop := make(chan struct{})
	var wg sync.WaitGroup
	for range 5 {
		wg.Go(func() {
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
		})
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
		LockBox("temp-cleanup-box")
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

// TestEncryptFileAADBoundToBaseNameNotPath 验证 .sy 密文 AAD 绑定稳定文件基名而非父目录。
// 同一基名、不同父目录加密出的密文，可用任一父目录路径解密；基名变化或 box 变化则解密失败。
// 这是同 box 内移动文档可原样 Rename 密文（不重新封装）的密码学保证。
func TestEncryptFileAADBoundToBaseNameNotPath(t *testing.T) {
	boxID := "20240101120000-boxaaaaa"
	dek, _ := util.GenerateDEK()
	base := "20240101120000-1a2b3c4.sy"
	plain := []byte(`{"ID":"20240101120000-1a2b3c4","Properties":{"title":"doc"}}`)

	// 用父目录 A 加密
	ct, err := EncryptFile(boxID, "/20240101120000-parentA/"+base, dek, plain)
	if err != nil {
		t.Fatalf("EncryptFile failed: %v", err)
	}

	// 用父目录 B（及裸基名）解密：必须成功——AAD 只绑基名
	if got, err := DecryptFile(boxID, "/20240101120000-parentB/"+base, dek, ct); err != nil {
		t.Fatalf("decrypt with different parent dir should succeed: %v", err)
	} else if string(got) != string(plain) {
		t.Fatalf("decrypted content mismatch")
	}
	if got, err := DecryptFile(boxID, base, dek, ct); err != nil {
		t.Fatalf("decrypt with bare base name should succeed: %v", err)
	} else if string(got) != string(plain) {
		t.Fatalf("decrypted content mismatch")
	}

	// 用不同基名解密：必须失败——AAD 绑定基名
	otherBase := "20240101120000-zzzzzzz.sy"
	if _, err := DecryptFile(boxID, otherBase, dek, ct); err == nil {
		t.Fatal("decrypt with different base name must fail")
	}

	// 用不同 boxID 解密：必须失败——AAD 绑定 boxID
	otherBox := "20240101120000-otherbox"
	if _, err := DecryptFile(otherBox, base, dek, ct); err == nil {
		t.Fatal("decrypt with different boxID must fail")
	}
}

// TestEncryptFileRejectsInvalidBaseName 验证非法基名（非 .sy、非节点 ID）直接拒绝加密，
// 不产生可用于落盘的密文，避免把任意路径当 AAD 绑定物。
func TestEncryptFileRejectsInvalidBaseName(t *testing.T) {
	boxID := "20240101120000-boxaaaaa"
	dek, _ := util.GenerateDEK()
	plain := []byte("test")

	if _, err := EncryptFile(boxID, "/dir/random.txt", dek, plain); err == nil {
		t.Fatal("should reject non-.sy extension")
	}
	if _, err := EncryptFile(boxID, "/dir/notanid.sy", dek, plain); err == nil {
		t.Fatal("should reject non-node-id stem")
	}
}

// TestDecryptFileRejectsInvalidBaseName 验证解密路径同样拒绝非法基名。
func TestDecryptFileRejectsInvalidBaseName(t *testing.T) {
	boxID := "20240101120000-boxaaaaa"
	dek, _ := util.GenerateDEK()
	ct := []byte("ciphertext-bytes")

	if _, err := DecryptFile(boxID, "/dir/random.txt", dek, ct); err == nil {
		t.Fatal("should reject non-.sy extension on decrypt")
	}
	if _, err := DecryptFile(boxID, "/dir/notanid.sy", dek, ct); err == nil {
		t.Fatal("should reject non-node-id stem on decrypt")
	}
}

// TestEnabledWithoutBackupReturnsRecoveryError 验证「已启用但密钥备份缺失」不锁死全部笔记本：
// 启动回填已删除（无 KEK 生成的备份 KEKMAC 必空，会被解锁路径拒绝），deriveKEK 在此情形返回
// 恢复提示（Language 315，引导用户导入匹配备份），而非误报密钥损坏（316），且不在磁盘制造无效备份。
func TestEnabledWithoutBackupReturnsRecoveryError(t *testing.T) {
	origDataDir := util.DataDir
	tempDir := t.TempDir()
	util.DataDir = tempDir
	defer func() { util.DataDir = origDataDir }()

	password := "recovery-test-pw"
	salt, _ := util.GenerateSalt()
	params := util.DefaultArgon2Params()
	kek := util.DeriveKey(password, salt, params)
	defer zeroAndClear(kek)

	// 构造本机已启用、本机 verifier 有效的配置（主密码能派生出可用 KEK），但不写备份文件
	verifierCT, _ := util.EncryptWithAAD(kek, kekVerifierMagic, []byte("siyuan:v1:kek-verifier"))
	nc := &conf.NotebookCrypto{
		Enabled:     true,
		MasterSalt:  salt,
		KDFParams:   params,
		KEKVerifier: verifierCT,
	}
	originalConf := Conf
	Conf = NewAppConf()
	Conf.NotebookCrypto = nc
	defer func() { Conf = originalConf }()

	_, err := deriveKEK(password)
	if err == nil {
		t.Fatal("deriveKEK should fail when enabled but backup is missing")
	}
	// 主密码正确（verifier 通过），故不应报「密码错」（311）或「密钥损坏」（316），
	// 而应报「需恢复」（315）引导用户导入匹配备份
	if err.Error() != Conf.Language(315) {
		t.Fatalf("expected recovery hint (Language 315), got: %v", err)
	}

	// 关键：不在磁盘制造无效备份——备份文件应仍不存在
	if _, statErr := os.Stat(notebookCryptoBackupPath()); !os.IsNotExist(statErr) {
		t.Fatalf("backup file should not be generated during deriveKEK; stat err=%v", statErr)
	}
}

// TestSaveNotebookCryptoBackupRejectsNilKEK 验证无 KEK 时拒绝生成备份（收口）：
// nil KEK 生成的备份 KEKMAC 必空，会被解锁/恢复路径拒绝，等于制造无法解锁的状态。
func TestSaveNotebookCryptoBackupRejectsNilKEK(t *testing.T) {
	origDataDir := util.DataDir
	util.DataDir = t.TempDir()
	defer func() { util.DataDir = origDataDir }()

	originalConf := Conf
	Conf = NewAppConf()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	defer func() { Conf = originalConf }()

	if err := saveNotebookCryptoBackup(nil); err == nil {
		t.Fatal("saveNotebookCryptoBackup(nil) should be rejected")
	}
	if err := writeNotebookCryptoBackupData(Conf.NotebookCrypto, nil); err == nil {
		t.Fatal("writeNotebookCryptoBackupData(nc, nil) should be rejected")
	}
}

func TestEncryptedNotebookHistoryScanFailsClosed(t *testing.T) {
	originalHistoryDir := util.HistoryDir
	historyPath := filepath.Join(t.TempDir(), "history") + "\x00"
	util.HistoryDir = historyPath
	defer func() { util.HistoryDir = originalHistoryDir }()

	if _, err := scanEncryptedNotebookHistory(); err == nil {
		t.Fatal("unreadable history structure should return an error")
	}
	if !HasEncryptedNotebookHistory() {
		t.Fatal("public history dependency check should fail closed on scan errors")
	}
}

func TestListEncryptedNotebooksReturnsScanError(t *testing.T) {
	originalDataDir := util.DataDir
	dataPath := filepath.Join(t.TempDir(), "data") + "\x00"
	util.DataDir = dataPath
	defer func() { util.DataDir = originalDataDir }()

	if _, err := listAllEncryptedBoxIDs(); err == nil {
		t.Fatal("invalid data directory should return a scan error")
	}
}

func TestEnableEncryptedNotebookRestoresConfigWhenBackupWriteFails(t *testing.T) {
	originalConf := Conf
	originalDataDir := util.DataDir
	originalHistoryDir := util.HistoryDir
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, ".siyuan"), []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	Conf = NewAppConf()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.FileTree = conf.NewFileTree()
	util.DataDir = dataDir
	util.HistoryDir = filepath.Join(dataDir, "history")
	defer func() {
		Conf = originalConf
		util.DataDir = originalDataDir
		util.HistoryDir = originalHistoryDir
	}()

	before, err := json.Marshal(Conf.NotebookCrypto)
	if err != nil {
		t.Fatal(err)
	}
	if err = EnableEncryptedNotebook("backup-write-failure"); err == nil {
		t.Fatal("enable encrypted notebook should fail when the recovery backup cannot be written")
	}
	after, err := json.Marshal(Conf.NotebookCrypto)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("failed enable should restore the complete in-memory notebook crypto configuration")
	}
}
