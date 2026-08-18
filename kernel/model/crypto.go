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

package model

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/heif"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// kekVerifierMagic 是写入 KEKVerifier 的固定魔数。启用时用 KEK 加密它，校验主密码时解密比对。
var kekVerifierMagic = []byte("siyuan-encrypted-notebook")

const boxEncryptionSpec = 1

var encryptedAssetMagic = []byte{'S', 'Y', 'A', 'E'}

var errEncryptedNotebookPayloadFound = errors.New("encrypted notebook payload found")

// runtimeEncryptedBoxes 记录当前工作空间进程内已确认的加密笔记本身份，避免同步或外部删除配置后降级为普通笔记本。
// value 为确认身份时的 DataDir，防止测试或切换工作空间时复用其他工作空间的运行时状态。
var runtimeEncryptedBoxes sync.Map // map[string]string

// runtimeNormalBoxes 缓存已确认的普通笔记本，减少普通笔记本高频访问时的文件系统探测。
var runtimeNormalBoxes sync.Map // map[string]string

// IsEncryptedNotebookData 判断数据是否以当前文档或资源密文标识开头。
func IsEncryptedNotebookData(data []byte) bool {
	return util.IsCiphertext(data) || bytes.HasPrefix(data, encryptedAssetMagic)
}

func markRuntimeEncryptedBox(boxID string) {
	if ast.IsNodeIDPattern(boxID) {
		forgetRuntimeNormalBox(boxID)
		runtimeEncryptedBoxes.Store(boxID, filepath.Clean(util.DataDir))
	}
}

func forgetRuntimeEncryptedBox(boxID string) {
	dataDir, ok := runtimeEncryptedBoxes.Load(boxID)
	if ok && dataDir == filepath.Clean(util.DataDir) {
		runtimeEncryptedBoxes.Delete(boxID)
	}
	forgetRuntimeNormalBox(boxID)
}

func isRuntimeEncryptedBox(boxID string) bool {
	dataDir, ok := runtimeEncryptedBoxes.Load(boxID)
	return ok && dataDir == filepath.Clean(util.DataDir)
}

func markRuntimeNormalBox(boxID string) {
	if ast.IsNodeIDPattern(boxID) {
		runtimeNormalBoxes.Store(boxID, filepath.Clean(util.DataDir))
	}
}

func forgetRuntimeNormalBox(boxID string) {
	dataDir, ok := runtimeNormalBoxes.Load(boxID)
	if ok && dataDir == filepath.Clean(util.DataDir) {
		runtimeNormalBoxes.Delete(boxID)
	}
}

func isRuntimeNormalBox(boxID string) bool {
	dataDir, ok := runtimeNormalBoxes.Load(boxID)
	return ok && dataDir == filepath.Clean(util.DataDir)
}

// hasEncryptedNotebookPayload 在密钥身份文件缺失或损坏时检查磁盘密文标识，防止自动修复为普通笔记本。
func hasEncryptedNotebookPayload(boxID string) (bool, error) {
	if !ast.IsNodeIDPattern(boxID) {
		return false, errors.New("invalid notebook ID")
	}
	return hasEncryptedNotebookPayloadAtPath(filepath.Join(util.DataDir, boxID))
}

func hasEncryptedNotebookPayloadAtPath(boxDir string) (bool, error) {
	if !filelock.IsExist(boxDir) {
		return false, nil
	}
	err := filepath.WalkDir(boxDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || entry.Type()&os.ModeType != 0 {
			return nil
		}

		file, openErr := os.Open(path)
		if openErr != nil {
			return openErr
		}
		var header [4]byte
		n, readErr := io.ReadFull(file, header[:])
		closeErr := file.Close()
		if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
			return readErr
		}
		if closeErr != nil {
			return closeErr
		}
		if IsEncryptedNotebookData(header[:n]) {
			return errEncryptedNotebookPayloadFound
		}
		return nil
	})
	if errors.Is(err, errEncryptedNotebookPayloadFound) {
		return true, nil
	}
	return false, err
}

const encryptedAssetMetadataMaxSize = 1024 * 1024
const encryptedAssetChunkSize = 1024 * 1024
const encryptedAssetChunkMaxCiphertextSize = encryptedAssetChunkSize + 1024

type encryptedAssetMetadata struct {
	OriginalName string `json:"originalName"`
	Size         int64  `json:"size"`
	Chunks       uint64 `json:"chunks"`
}

// errMasterPasswordMigrationPending 表示改密已切换全局 verifier，但部分笔记本配置尚待恢复。
var errMasterPasswordMigrationPending = errors.New("master password migration is pending")

// notebookCryptoMu 串行化加密笔记本的控制面操作（Enable/Disable/Create/ChangeMasterPassword/Import/restore 等），
// 避免 ChangeMasterPassword 枚举与 CreateEncryptedBox 并发导致新笔记本用旧 KEK 但 verifier 已切换的不可恢复状态。
var notebookCryptoMu sync.Mutex

var masterPasswordMigrationMu sync.Mutex

// boxLifecycleLocks 为每个 box 提供一个 RWMutex，协调锁定操作与在途解密请求。
// 在途解密请求持读锁，LockBox 持写锁，确保锁定后不会有新的解密输出。
var boxLifecycleLocks = sync.Map{} // map[string]*sync.RWMutex

func acquireBoxReadLock(boxID string) {
	muI, _ := boxLifecycleLocks.LoadOrStore(boxID, &sync.RWMutex{})
	muI.(*sync.RWMutex).RLock()
}

func releaseBoxReadLock(boxID string) {
	if muI, ok := boxLifecycleLocks.Load(boxID); ok {
		muI.(*sync.RWMutex).RUnlock()
	}
}

func acquireBoxWriteLock(boxID string) {
	muI, _ := boxLifecycleLocks.LoadOrStore(boxID, &sync.RWMutex{})
	muI.(*sync.RWMutex).Lock()
}

func releaseBoxWriteLock(boxID string) {
	if muI, ok := boxLifecycleLocks.Load(boxID); ok {
		muI.(*sync.RWMutex).Unlock()
	}
}

// NotebookCryptoMuLock 锁定 notebookCryptoMu，供 api 层读取一致的状态快照。
func NotebookCryptoMuLock() { notebookCryptoMu.Lock() }

// NotebookCryptoMuUnlock 解锁 notebookCryptoMu。
func NotebookCryptoMuUnlock() { notebookCryptoMu.Unlock() }

// dataCryptoBackupPath 是全局 NotebookCrypto 的备份路径，位于 DataDir/.siyuan/ 下（进入 dejavu 同步范围）。
// MasterSalt 是加密体系的全局根基：conf/conf.json 丢失后若重新启用会生成新 salt，
// 导致旧 WrappedDEK 无法用相同主密码解开（KEK 随 salt 改变）。把整套 NotebookCrypto 备份到
// 同步目录，conf.json 丢失时通过同步恢复或本地备份即可重新解锁已有加密笔记本。
// MasterSalt/KEKVerifier 设计为可明文（salt 不保密，verifier 是密文），备份文件按明文 JSON 存储。
func dataCryptoBackupPath() string {
	return filepath.Join(util.DataDir, ".siyuan", "data-crypto-backup.json")
}

// notebookCryptoAuthPayload 生成密钥身份认证载荷。
// AutoLockMinutes 是本机运行策略，修改它不应使主密码和同步密钥候选失效。
func notebookCryptoAuthPayload(nc *conf.NotebookCrypto) conf.NotebookCrypto {
	tmp := *nc
	tmp.AutoLockMinutes = 0
	return tmp
}

// computeBackupChecksum 计算 NotebookCrypto 密钥身份字段的 SHA-256 校验和。
func computeBackupChecksum(nc *conf.NotebookCrypto) string {
	tmp := notebookCryptoAuthPayload(nc)
	tmp.Checksum = ""
	tmp.KEKMAC = nil
	data, _ := json.Marshal(tmp)
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// computeKEKMAC 用 KEK 计算备份的 HMAC-SHA256 认证码。
func computeKEKMAC(nc *conf.NotebookCrypto, kek []byte) []byte {
	tmp := notebookCryptoAuthPayload(nc)
	tmp.KEKMAC = nil
	data, _ := json.Marshal(tmp)
	mac := hmac.New(sha256.New, kek)
	mac.Write(data)
	return mac.Sum(nil)
}

// verifyKEKMAC 用 KEK 验证备份的 HMAC-SHA256 认证码。
func verifyKEKMAC(nc *conf.NotebookCrypto, kek []byte) bool {
	if nc == nil || len(nc.KEKMAC) == 0 || len(kek) == 0 {
		return false
	}
	expected := computeKEKMAC(nc, kek)
	return hmac.Equal(expected, nc.KEKMAC)
}

// prepareBackupForWrite 为写入准备备份元数据字段（Spec/BackupID/CreatedAt/Checksum）。
func prepareBackupForWrite(nc *conf.NotebookCrypto) {
	nc.Spec = conf.CurrentNotebookCryptoSpec
	if nc.BackupID == "" {
		nc.BackupID = util.RandString(16)
	}
	nc.CreatedAt = time.Now().Unix()
	nc.Checksum = computeBackupChecksum(nc)
}

// atomicWriteFile 原子写入：先写带随机后缀的临时文件再 rename，防止半写入文件残留，
// 同时避免多个写者竞争同一固定 tmp 文件名造成 lost update。
func atomicWriteFile(path string, data []byte) error {
	tmpPath := path + "." + gulu.Rand.String(7) + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// ExportNotebookCryptoBackup 把密钥备份文件复制到 export 目录，返回可下载的相对路径。
// 供用户主动导出保存，作为同步之外的独立恢复途径（详见设计文档 §4.1）。
// 备份文件本身不含主密码（salt 不保密、verifier 是密文），拿到它也解不开任何数据。
func ExportNotebookCryptoBackup() (downloadPath string, err error) {
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	backupPath := dataCryptoBackupPath()
	data, readErr := filelock.ReadFile(backupPath)
	if readErr != nil {
		if os.IsNotExist(readErr) {
			err = errors.New(Conf.Language(315))
			return
		}
		err = readErr
		return
	}
	exportBase := filepath.Join(util.TempDir, "export")
	if mkErr := os.MkdirAll(exportBase, 0755); mkErr != nil {
		err = mkErr
		return
	}
	// 用随机名避免不同用户/设备互相覆盖，文件名固定带易识别前缀
	fileName := "notebook-crypto-backup-" + gulu.Rand.String(7) + ".json"
	downloadPath = "/export/" + url.PathEscape(fileName)
	if writeErr := os.WriteFile(filepath.Join(exportBase, fileName), data, 0644); writeErr != nil {
		err = writeErr
		return
	}
	return
}

// ImportNotebookCryptoBackup 接收用户导入的密钥备份文件内容（JSON 字节），
// 校验为合法 NotebookCrypto 后写回 <DataDir>/.siyuan/data-crypto-backup.json 并装回本机 Conf。
// 用于新设备/重装后不依赖同步、手动恢复加密配置（详见设计文档 §4.1）。
// 安全：备份文件不含主密码（salt 不保密、verifier 是密文），导入只恢复配置，解锁仍需主密码。
// 防呆：本机已有完整且已启用的加密配置时拒绝导入，避免覆盖现有 salt/verifier 孤立现有 WrappedDEK。
// ImportNotebookCryptoBackup 接收用户导入的密钥备份文件内容（JSON 字节）+ 主密码，
// 校验主密码能解开备份里的 verifier 后才写回配置。防止 crafted 备份设置弱 KDFParams 等攻击。
// RecoveryRequired 状态允许导入，但候选 KEK 必须能解开所有现存笔记本和已删除笔记本历史。
func ImportNotebookCryptoBackup(data []byte, password string) error {
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	Conf.m.RLock()
	current := *Conf.NotebookCrypto
	Conf.m.RUnlock()
	if current.Enabled && notebookCryptoConfigurationComplete(&current) {
		return errors.New(Conf.Language(324))
	}

	nc := &conf.NotebookCrypto{}
	if err := json.Unmarshal(data, nc); err != nil {
		return errors.New(Conf.Language(317))
	}
	if !notebookCryptoConfigurationComplete(nc) {
		return errors.New(Conf.Language(317))
	}

	// 用导入的 salt + 用户输入的主密码派生 KEK，校验能否解开备份里的 verifier
	params, validErr := util.ValidateArgon2Params(nc.KDFParams)
	if validErr != nil {
		return errors.New(Conf.Language(317))
	}
	kek := util.DeriveKey(password, nc.MasterSalt, params)
	defer zeroAndClear(kek)
	if nc.Checksum != computeBackupChecksum(nc) {
		return errors.New(Conf.Language(317))
	}
	if !verifyKEKMAC(nc, kek) {
		return errors.New(Conf.Language(317))
	}
	decrypted, dErr := util.DecryptWithAAD(kek, nc.KEKVerifier, []byte("siyuan:kek-verifier"))
	if dErr != nil || string(decrypted) != string(kekVerifierMagic) {
		return errors.New(Conf.Language(311)) // 主密码错误
	}

	// 校验 KEK 能解密现存笔记本和已删除笔记本历史中的 WrappedDEK，避免导入不匹配的备份。
	if !verifyKEKAgainstExistingBoxes(kek) || !verifyKEKAgainstEncryptedHistory(kek) {
		return errors.New(Conf.Language(316)) // 密钥不匹配
	}

	nc.KDFParams = params // 确保写回 Conf 的参数已经通过完整校验。
	nc.Enabled = true

	// 先写 backup，再提交 conf；backup 失败时 conf 尚未改变，可重试
	if err := writeNotebookCryptoBackupData(nc, kek); err != nil {
		return fmt.Errorf("failed to persist key backup: %w", err)
	}
	Conf.m.Lock()
	*Conf.NotebookCrypto = *nc
	Conf.m.Unlock()
	Conf.Save()
	IncSync()
	return nil
}

// saveNotebookCryptoBackup 把当前 NotebookCrypto（含 MasterSalt/KEKVerifier/KDFParams）备份到 DataDir。
// kek 必须非 nil：在 Checksum 定型后计算 KEKMAC 并落盘，保证恢复路径可通过 MAC 校验。
// 无 KEK 生成的备份 KEKMAC 必为空，会被 deriveKEK/恢复路径拒绝，等于制造无法解锁的状态（详见设计 §19）。
func saveNotebookCryptoBackup(kek []byte) error {
	if kek == nil {
		// 无 KEK 时不得生成当前格式备份：KEKMAC 缺失会被 deriveKEK/恢复路径拒绝，
		// 生成即等于制造无法解锁的状态。
		return errors.New("cannot generate notebook crypto backup without KEK")
	}
	Conf.m.Lock()
	nc := *Conf.NotebookCrypto // 值拷贝
	prepareBackupForWrite(&nc)
	nc.KEKMAC = computeKEKMAC(&nc, kek)
	if !notebookCryptoConfigurationComplete(&nc) {
		Conf.m.Unlock()
		return errors.New("cannot save incomplete notebook crypto configuration")
	}
	Conf.NotebookCrypto.Spec = nc.Spec
	Conf.NotebookCrypto.BackupID = nc.BackupID
	Conf.NotebookCrypto.CreatedAt = nc.CreatedAt
	Conf.NotebookCrypto.Checksum = nc.Checksum
	Conf.NotebookCrypto.KEKMAC = nc.KEKMAC // 保持 Conf 与备份文件的 KEKMAC 一致
	Conf.m.Unlock()
	backupPath := dataCryptoBackupPath()
	if err := os.MkdirAll(filepath.Dir(backupPath), 0755); err != nil {
		return fmt.Errorf("mkdir notebook crypto backup dir failed: %w", err)
	}
	data, err := json.Marshal(nc)
	if err != nil {
		return fmt.Errorf("marshal notebook crypto backup failed: %w", err)
	}
	if err := atomicWriteFile(backupPath, data); err != nil {
		return fmt.Errorf("write notebook crypto backup failed: %w", err)
	}
	return nil
}

// writeNotebookCryptoBackupData 将指定的 NotebookCrypto 写入备份文件（不依赖 Conf.NotebookCrypto）。
// kek 必须非 nil：在 Checksum 定型后计算 KEKMAC，保证落盘 MAC 与落盘内容一致。
func writeNotebookCryptoBackupData(nc *conf.NotebookCrypto, kek []byte) error {
	if kek == nil {
		return errors.New("cannot generate notebook crypto backup without KEK")
	}
	prepareBackupForWrite(nc)
	nc.KEKMAC = computeKEKMAC(nc, kek)
	if !notebookCryptoConfigurationComplete(nc) {
		return errors.New("cannot write incomplete notebook crypto backup")
	}
	backupPath := dataCryptoBackupPath()
	if err := os.MkdirAll(filepath.Dir(backupPath), 0755); err != nil {
		return fmt.Errorf("mkdir notebook crypto backup dir failed: %w", err)
	}
	data, err := json.Marshal(nc)
	if err != nil {
		return fmt.Errorf("marshal notebook crypto backup failed: %w", err)
	}
	if err := atomicWriteFile(backupPath, data); err != nil {
		return fmt.Errorf("write notebook crypto backup failed: %w", err)
	}
	return nil
}

// verifyKEKAgainstExistingBoxes 用 KEK 对所有现有加密笔记本的 WrappedDEK 做无副作用解密校验。
// 优先尝试 conf 的 WrappedDEK，解密失败时 fallback 到 backup（与解锁路径一致）；
// GetBoxEncryption 报错时 fail-closed（元数据损坏的加密笔记本不能静默跳过）。
// 全部通过或不存在加密笔记本时返回 true。
func verifyKEKAgainstExistingBoxes(kek []byte) bool {
	boxIDs, err := listAllEncryptedBoxIDs()
	if err != nil {
		logging.LogErrorf("list encrypted notebooks failed: %s", err)
		return false
	}
	for _, id := range boxIDs {
		boxCrypt, err := GetBoxEncryption(id)
		if err != nil {
			return false // 元数据读取失败 → fail-closed
		}
		if boxCrypt == nil || len(boxCrypt.WrappedDEK) == 0 {
			return false // ListAllEncryptedBoxIDs 认定为加密但无可用 key material → fail-closed
		}
		if _, dErr := decryptWrappedDEK(id, boxCrypt, kek); dErr == nil {
			continue // 解密成功
		}
		// conf 的 WrappedDEK 无法解密：尝试 backup（与解锁路径 fallback 一致）
		backup, bErr := readNotebookCryptBackup(id)
		if bErr == nil && backup != nil && len(backup.WrappedDEK) > 0 &&
			!bytes.Equal(backup.WrappedDEK, boxCrypt.WrappedDEK) {
			if _, err2 := decryptWrappedDEK(id, backup, kek); err2 == nil {
				continue // backup 解密成功
			}
		}
		return false
	}
	return true
}

// loadNotebookCryptoBackup 从 DataDir 读取 NotebookCrypto 备份。文件不存在返回 (nil, nil)。
func loadNotebookCryptoBackup() (*conf.NotebookCrypto, error) {
	data, err := filelock.ReadFile(dataCryptoBackupPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	nc := &conf.NotebookCrypto{}
	if err := json.Unmarshal(data, nc); err != nil {
		return nil, err
	}
	if nc.Spec != conf.CurrentNotebookCryptoSpec {
		return nil, fmt.Errorf("unsupported notebook crypto backup spec [%d]", nc.Spec)
	}
	if !notebookCryptoConfigurationComplete(nc) {
		return nil, errors.New("notebook crypto backup is incomplete or corrupted")
	}
	return nc, nil
}

// removeNotebookCryptoBackup 删除备份文件（禁用加密功能时调用）。文件不存在视为成功。
func removeNotebookCryptoBackup() {
	if err := os.Remove(dataCryptoBackupPath()); err != nil && !os.IsNotExist(err) {
		logging.LogErrorf("remove notebook crypto backup failed: %s", err)
	}
}

// masterPasswordMigration 记录改密迁移的完整状态，用于崩溃后恢复。
type masterPasswordMigration struct {
	OldVerifier      []byte              `json:"oldVerifier"`
	NewVerifier      []byte              `json:"newVerifier"`
	NewVerifierNonce []byte              `json:"newVerifierNonce"`
	NewKDFParams     json.RawMessage     `json:"newKDFParams"`
	Boxes            []migrationBoxEntry `json:"boxes"`
}

type migrationBoxEntry struct {
	BoxID         string `json:"boxID"`
	NewSpec       int    `json:"newSpec"`
	NewWrappedDEK []byte `json:"newWrappedDEK"`
	NewWrapNonce  []byte `json:"newWrapNonce"`
	Metadata      []byte `json:"metadata"`
}

func masterPasswordMigrationPath() string {
	return filepath.Join(util.DataDir, ".siyuan", "master-password-migration.json")
}

func writeMasterPasswordMigration(m *masterPasswordMigration) error {
	masterPasswordMigrationMu.Lock()
	defer masterPasswordMigrationMu.Unlock()
	return writeMasterPasswordMigrationUnlocked(m)
}

func writeMasterPasswordMigrationUnlocked(m *masterPasswordMigration) error {
	p := masterPasswordMigrationPath()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return fmt.Errorf("mkdir master password migration dir failed: %w", err)
	}
	data, err := gulu.JSON.MarshalIndentJSON(m, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal master password migration failed: %w", err)
	}
	return filelock.WriteFile(p, data)
}

func readMasterPasswordMigration() (*masterPasswordMigration, error) {
	masterPasswordMigrationMu.Lock()
	defer masterPasswordMigrationMu.Unlock()
	return readMasterPasswordMigrationUnlocked()
}

func readMasterPasswordMigrationUnlocked() (*masterPasswordMigration, error) {
	p := masterPasswordMigrationPath()
	if !filelock.IsExist(p) {
		return nil, nil
	}
	data, err := filelock.ReadFile(p)
	if err != nil {
		return nil, fmt.Errorf("read master password migration failed: %w", err)
	}
	var m masterPasswordMigration
	if err = gulu.JSON.UnmarshalJSON(data, &m); err != nil {
		return nil, fmt.Errorf("unmarshal master password migration failed: %w", err)
	}
	return &m, nil
}

func removeMasterPasswordMigration() {
	masterPasswordMigrationMu.Lock()
	defer masterPasswordMigrationMu.Unlock()
	removeMasterPasswordMigrationUnlocked()
}

func removeMasterPasswordMigrationUnlocked() {
	p := masterPasswordMigrationPath()
	if err := filelock.Remove(p); err != nil && !os.IsNotExist(err) {
		logging.LogErrorf("remove master password migration failed: %s", err)
	}
}

func removeMasterPasswordMigrationBox(boxID string) {
	if boxID == "" {
		return
	}
	masterPasswordMigrationMu.Lock()
	defer masterPasswordMigrationMu.Unlock()

	mig, err := readMasterPasswordMigrationUnlocked()
	if err != nil || mig == nil {
		return
	}
	remaining := make([]migrationBoxEntry, 0, len(mig.Boxes))
	found := false
	for _, entry := range mig.Boxes {
		if entry.BoxID == boxID {
			found = true
			continue
		}
		remaining = append(remaining, entry)
	}
	if !found {
		return
	}
	if len(remaining) == 0 {
		removeMasterPasswordMigrationUnlocked()
		return
	}
	mig.Boxes = remaining
	if err = writeMasterPasswordMigrationUnlocked(mig); err != nil {
		logging.LogErrorf("remove notebook [%s] from master password migration failed: %s", boxID, err)
	}
}

// MasterPasswordMigrationStatus 返回是否存在待完成的改密迁移及受影响的笔记本。
func MasterPasswordMigrationStatus() (pending bool, boxIDs []string) {
	mig, err := readMasterPasswordMigration()
	if err != nil || mig == nil {
		return false, nil
	}
	for _, entry := range mig.Boxes {
		boxIDs = append(boxIDs, entry.BoxID)
	}
	return true, boxIDs
}

// recoverMasterPasswordMigration 在启动时检测并完成中断的改密迁移。
// 若 migration manifest 存在，根据全局 verifier 是否已切换决定恢复策略。
func recoverMasterPasswordMigration() {
	mig, err := readMasterPasswordMigration()
	if err != nil {
		logging.LogErrorf("read master password migration failed: %s", err)
		return
	}
	if mig == nil {
		return // 无待恢复的迁移
	}
	remaining := make([]migrationBoxEntry, 0, len(mig.Boxes))
	pendingRecovery := false
	for _, entry := range mig.Boxes {
		if !ast.IsNodeIDPattern(entry.BoxID) {
			logging.LogWarnf("drop invalid notebook [%s] from master password migration", entry.BoxID)
			continue
		}
		if !filelock.IsExist(filepath.Join(util.DataDir, entry.BoxID)) {
			deleted, historyErr := hasEncryptedNotebookDeleteHistory(entry.BoxID)
			if historyErr != nil {
				logging.LogWarnf("keep missing notebook [%s] in master password migration because delete history check failed: %s", entry.BoxID, historyErr)
				remaining = append(remaining, entry)
				pendingRecovery = true
				continue
			}
			if deleted {
				logging.LogInfof("drop deleted notebook [%s] from master password migration", entry.BoxID)
				continue
			}
			logging.LogWarnf("keep missing notebook [%s] in master password migration until synchronization or recovery restores it", entry.BoxID)
			remaining = append(remaining, entry)
			pendingRecovery = true
			continue
		}
		remaining = append(remaining, entry)
	}
	if pendingRecovery {
		mig.Boxes = remaining
		if writeErr := writeMasterPasswordMigration(mig); writeErr != nil {
			logging.LogErrorf("update master password migration with pending notebook failed: %s", writeErr)
			return
		}
		logging.LogInfof("postpone master password migration recovery until missing notebooks are restored")
		return
	}
	if len(remaining) != len(mig.Boxes) {
		mig.Boxes = remaining
		if len(mig.Boxes) == 0 {
			removeMasterPasswordMigration()
			return
		}
		if writeErr := writeMasterPasswordMigration(mig); writeErr != nil {
			logging.LogErrorf("update master password migration after notebook removal failed: %s", writeErr)
			return
		}
	}

	Conf.m.RLock()
	currentVerifier := Conf.NotebookCrypto.KEKVerifier
	Conf.m.RUnlock()

	if bytes.Equal(currentVerifier, mig.NewVerifier) {
		// Phase 2 已完成（verifier 已切换），补写未完成的 box
		for _, entry := range mig.Boxes {
			box := &Box{ID: entry.BoxID}
			boxConf := box.GetConf()
			if !boxConf.Encrypted || boxConf.BoxCrypt == nil {
				// conf 缺失/损坏：尝试从 per-notebook backup 重建
				backup, bErr := readNotebookCryptBackup(entry.BoxID)
				if bErr == nil && backup != nil && len(backup.WrappedDEK) > 0 {
					boxConf = box.GetConf() // 重新获取默认 conf
					boxConf.Encrypted = true
					boxConf.BoxCrypt = backup
					if saveErr := box.SaveConf(boxConf); saveErr != nil {
						logging.LogErrorf("rebuild encrypted conf from backup [%s] failed: %s", entry.BoxID, saveErr)
						return // 保留 manifest
					}
				} else {
					// conf 与 backup 均不可用：manifest 是该 box 加密密钥的权威来源（NewWrappedDEK/NewWrapNonce/NewSpec），
					// 直接从 manifest 重建 BoxCrypt，避免 conf+backup 双缺失时永久循环失败。boxConf 的非加密元数据
					// （Name 等）此时已随 conf 丢失，恢复为默认值，但 box 的文档树（.sy 文件）不受影响，数据可达性得以保全。
					logging.LogWarnf("rebuild encrypted box [%s] from migration manifest (conf and backup both unavailable)", entry.BoxID)
					boxConf = box.GetConf()
					boxConf.Encrypted = true
					boxConf.BoxCrypt = &conf.BoxEncryption{
						WrappedDEK: entry.NewWrappedDEK,
						WrapNonce:  entry.NewWrapNonce,
						Spec:       entry.NewSpec,
						Metadata:   entry.Metadata,
						CreatedAt:  time.Now().UnixMilli(),
					}
					if saveErr := box.SaveConf(boxConf); saveErr != nil {
						logging.LogErrorf("rebuild encrypted conf from manifest [%s] failed: %s", entry.BoxID, saveErr)
						return // 保留 manifest
					}
				}
			}
			// 若 WrappedDEK 已匹配则跳过写 conf，但仍需确保 per-notebook backup 是最新的
			if bytes.Equal(boxConf.BoxCrypt.WrappedDEK, entry.NewWrappedDEK) &&
				bytes.Equal(boxConf.BoxCrypt.Metadata, entry.Metadata) {
				if writeErr := writeNotebookCryptBackup(entry.BoxID, boxConf.BoxCrypt); writeErr != nil {
					logging.LogErrorf("refresh box crypt backup [%s] failed: %s", entry.BoxID, writeErr)
					return // 保留 manifest
				}
				continue
			}
			boxConf.BoxCrypt.WrappedDEK = entry.NewWrappedDEK
			boxConf.BoxCrypt.Spec = entry.NewSpec
			boxConf.BoxCrypt.WrapNonce = entry.NewWrapNonce
			boxConf.BoxCrypt.Metadata = append([]byte(nil), entry.Metadata...)
			if saveErr := box.SaveConf(boxConf); saveErr != nil {
				logging.LogErrorf("recover box conf [%s] failed: %s", entry.BoxID, saveErr)
				return // 保留 manifest
			}
			if writeErr := writeNotebookCryptBackup(entry.BoxID, boxConf.BoxCrypt); writeErr != nil {
				logging.LogErrorf("recover box crypt backup [%s] failed: %s", entry.BoxID, writeErr)
				return // 保留 manifest
			}
		}
		// 持久化全局 conf。此时没有新密码派生出的 KEK，不能为新备份生成可信 MAC，
		// 因此保留迁移清单和旧备份，待用户首次输入新密码后校验全部 WrappedDEK，再完成备份切换。
		Conf.Save()
		logging.LogInfof("master password migration data recovered, waiting for the new password to authenticate the backup")
	} else {
		// Phase 2 未完成：清除 manifest，保留旧 verifier + 旧 WrappedDEK，状态一致
		removeMasterPasswordMigration()
		logging.LogErrorf("master password migration was interrupted, please retry")
	}
}

// hasEncryptedNotebook 检查数据目录中是否存在加密笔记本，不依赖全局加密功能是否启用。
// EnableEncryptedNotebook 用它避免重新生成 MasterSalt，从而孤立旧 WrappedDEK。
func hasEncryptedNotebook() (bool, error) {
	ids, err := listAllEncryptedBoxIDs()
	return len(ids) > 0, err
}

// HasEncryptedNotebookHistory 检查历史目录中是否存在加密笔记本的历史快照。
// 笔记本删除后其 box 目录（含 .siyuan/conf.json 和 notebook-crypto-backup.json）会被
// 原样密文备份到历史目录（RemoveBox 的 filelock.Copy），但此时 IsEncryptedBox 已返回 false
// （box 目录已删）。因此 DisableEncryptedNotebook 不能只靠 ListAllEncryptedBoxIDs 判定——
// 已删除加密笔记本的历史仍依赖当前 MasterSalt/KEKVerifier 才能恢复，禁用并删除备份会让这些
// 历史永久锁死，违反设计 §19。本函数扫描历史目录识别这类依赖。
//
// 判定信号：历史条目 <HistoryDir>/<ts>-<op>/<boxID>/.siyuan/ 下存在
// notebook-crypto-backup.json（专为 box 删除后的恢复设计），或 conf.json 标记 Encrypted=true。
// boxID 用 ast.IsNodeIDPattern 校验，避免误判 assets/storage 等非 box 目录。
func scanEncryptedNotebookHistory() (bool, error) {
	boxDirs, err := encryptedNotebookHistoryBoxDirs()
	return len(boxDirs) > 0, err
}

func encryptedNotebookHistoryBoxDirs() (ret []string, err error) {
	entries, err := os.ReadDir(util.HistoryDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read history dir failed: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		// 历史快照目录：<ts>-<op>，其下是各 boxID 子目录
		snapshotDir := filepath.Join(util.HistoryDir, entry.Name())
		boxEntries, readErr := os.ReadDir(snapshotDir)
		if readErr != nil {
			return nil, fmt.Errorf("read history snapshot [%s] failed: %w", entry.Name(), readErr)
		}
		for _, boxEntry := range boxEntries {
			if !boxEntry.IsDir() || !ast.IsNodeIDPattern(boxEntry.Name()) {
				continue
			}
			encrypted, checkErr := isEncryptedHistoryBoxDir(filepath.Join(snapshotDir, boxEntry.Name()))
			if checkErr != nil {
				return nil, checkErr
			}
			if encrypted {
				ret = append(ret, filepath.Join(snapshotDir, boxEntry.Name()))
			}
		}
	}
	return ret, nil
}

func hasEncryptedNotebookDeleteHistory(boxID string) (bool, error) {
	if !ast.IsNodeIDPattern(boxID) {
		return false, errors.New("invalid notebook ID")
	}
	entries, err := os.ReadDir(util.HistoryDir)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("read history dir failed: %w", err)
	}

	deleteSuffix := "-" + HistoryOpDelete
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasSuffix(entry.Name(), deleteSuffix) {
			continue
		}
		boxDir := filepath.Join(util.HistoryDir, entry.Name(), boxID)
		if !filelock.IsExist(boxDir) {
			continue
		}
		encrypted, checkErr := isEncryptedHistoryBoxDir(boxDir)
		if checkErr != nil {
			return false, checkErr
		}
		if encrypted {
			return true, nil
		}
	}
	return false, nil
}

func verifyKEKAgainstEncryptedHistory(kek []byte) bool {
	boxDirs, err := encryptedNotebookHistoryBoxDirs()
	if err != nil {
		logging.LogErrorf("list encrypted notebook history failed: %s", err)
		return false
	}
	for _, boxDir := range boxDirs {
		boxID := filepath.Base(boxDir)
		candidates, readErr := readEncryptedHistoryBoxEncryptionCandidates(boxDir)
		if readErr != nil {
			logging.LogErrorf("read encrypted notebook history [%s] failed: %s", boxID, readErr)
			return false
		}
		matched := false
		for _, candidate := range candidates {
			dek, decryptErr := decryptWrappedDEK(boxID, candidate, kek)
			if decryptErr == nil {
				zeroAndClear(dek)
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

func readEncryptedHistoryBoxEncryptionCandidates(boxDir string) (ret []*conf.BoxEncryption, err error) {
	var candidateErrors []error
	backupPath := filepath.Join(boxDir, ".siyuan", "notebook-crypto-backup.json")
	if filelock.IsExist(backupPath) {
		if candidate, readErr := readBoxEncryptionFile(backupPath); readErr == nil {
			ret = append(ret, candidate)
		} else {
			candidateErrors = append(candidateErrors, readErr)
		}
	}

	confPath := filepath.Join(boxDir, ".siyuan", "conf.json")
	if filelock.IsExist(confPath) {
		data, readErr := filelock.ReadFile(confPath)
		if readErr != nil {
			candidateErrors = append(candidateErrors, readErr)
		} else {
			boxConf := conf.NewBoxConf()
			if readErr = gulu.JSON.UnmarshalJSON(data, boxConf); readErr != nil {
				candidateErrors = append(candidateErrors, readErr)
			} else if boxConf.Encrypted && boxConf.BoxCrypt != nil {
				if readErr = validateBoxEncryption(boxConf.BoxCrypt); readErr != nil {
					candidateErrors = append(candidateErrors, readErr)
				} else {
					ret = append(ret, boxConf.BoxCrypt)
				}
			}
		}
	}
	if len(ret) > 0 {
		return ret, nil
	}
	if len(candidateErrors) > 0 {
		return nil, errors.Join(candidateErrors...)
	}
	return nil, errors.New("encrypted notebook history has no valid key material")
}

// HasEncryptedNotebookHistory 在扫描失败时按存在依赖处理，避免调用方因 I/O 或权限错误删除恢复材料。
func HasEncryptedNotebookHistory() bool {
	hasHistory, err := scanEncryptedNotebookHistory()
	if err != nil {
		logging.LogErrorf("scan encrypted notebook history failed: %s", err)
		return true
	}
	return hasHistory
}

// isEncryptedHistoryBoxDir 判断历史目录中的 boxID 子目录是否属于加密笔记本。
// 优先看 notebook-crypto-backup.json（删除前随 box 目录整体备份，是加密身份的权威标识），
// 再 fallback 到 conf.json 的 Encrypted 标志。
func isEncryptedHistoryBoxDir(boxDir string) (bool, error) {
	siyuanDir := filepath.Join(boxDir, ".siyuan")
	backupPath := filepath.Join(siyuanDir, "notebook-crypto-backup.json")
	if _, err := os.Stat(backupPath); err == nil {
		return true, nil
	} else if !os.IsNotExist(err) {
		return false, fmt.Errorf("stat encrypted notebook history backup [%s] failed: %w", boxDir, err)
	}
	confPath := filepath.Join(siyuanDir, "conf.json")
	if _, err := os.Stat(confPath); err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("stat encrypted notebook history conf [%s] failed: %w", boxDir, err)
	}
	data, err := filelock.ReadFile(confPath)
	if err != nil {
		return false, fmt.Errorf("read encrypted notebook history conf [%s] failed: %w", boxDir, err)
	}
	var boxConf conf.BoxConf
	if err = gulu.JSON.UnmarshalJSON(data, &boxConf); err != nil {
		return false, fmt.Errorf("parse encrypted notebook history conf [%s] failed: %w", boxDir, err)
	}
	return boxConf.Encrypted, nil
}

// cachedDEKs 缓存已解锁加密笔记本的 DEK，按 boxID 索引。
// KEK 不全局缓存（"严格每笔记本单独解锁"语义）：UnlockBox 临时派生 KEK 解出 DEK 后即丢弃 KEK，
// 仅保留 per-box DEK 供后续读写加解密。
var (
	cachedDEKs     = map[string][]byte{}
	cachedDEKsLock sync.RWMutex
)

// boxLastAccess 记录每个加密笔记本最近一次真实用户交互或显式保活时间（unix 纳秒），供自动锁定 cron 使用。
// key: boxID, value: *atomic.Int64。UnlockBox 成功时初始化，Unmount 时清理。
var boxLastAccess sync.Map

// EnableEncryptedNotebookWithSync 在启用前先完成同步；同步恢复了既有配置时只校验原主密码。
func EnableEncryptedNotebookWithSync(password string) error {
	if len(password) == 0 {
		return errors.New("password must not be empty")
	}
	if err := SyncDataBeforeEnableEncryptedNotebook(); err != nil {
		return err
	}

	// 同步可能已经从其他设备恢复了完整配置。此时校验用户输入的是原主密码，不能再创建新的密钥体系。
	if NotebookCryptoEnabled() {
		notebookCryptoMu.Lock()
		defer notebookCryptoMu.Unlock()
		kek, err := deriveKEK(password)
		if kek != nil {
			zeroAndClear(kek)
		}
		return err
	}
	return EnableEncryptedNotebook(password)
}

// EnableEncryptedNotebook 启用加密笔记本功能：生成 MasterSalt、派生 KEK、写入校验值并持久化。
// 重复调用（已启用）返回错误，避免覆盖现有加密笔记本的密钥参数。
// KEK 不缓存——启用后用户需对每个加密笔记本单独调 UnlockBox 解锁。
func EnableEncryptedNotebook(password string) error {
	if len(password) == 0 {
		return errors.New("password must not be empty")
	}

	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	Conf.m.RLock()
	current := *Conf.NotebookCrypto
	Conf.m.RUnlock()
	if current.Enabled && notebookCryptoConfigurationComplete(&current) {
		return errors.New(Conf.Language(312))
	}

	hasEncrypted, listErr := hasEncryptedNotebook()
	if listErr != nil {
		return fmt.Errorf("list encrypted notebooks failed: %w", listErr)
	}
	hasHistory, historyErr := scanEncryptedNotebookHistory()
	if historyErr != nil {
		return fmt.Errorf("check encrypted notebook history failed: %w", historyErr)
	}
	hasBackup := filelock.IsExist(dataCryptoBackupPath())
	if hasEncrypted || hasHistory || hasBackup {
		// 现存笔记本、已删除笔记本历史或全局备份均表示已有密钥域，必须恢复并认证，不能生成新 MasterSalt。
		kek, restoreErr := tryRestoreNotebookCryptoFromBackupLocked(password)
		if kek != nil {
			zeroAndClear(kek)
		}
		if restoreErr != nil {
			if strings.Contains(restoreErr.Error(), Conf.Language(311)) {
				return errors.New(Conf.Language(311))
			}
			return errors.New(Conf.Language(315))
		}
		logging.LogInfof("encrypted notebook re-enabled with authenticated recovery key material")
		return nil
	}

	// 不存在任何密钥依赖或备份时生成新的 MasterSalt。
	salt, err := util.GenerateSalt()
	if err != nil {
		return err
	}
	Conf.m.RLock()
	kdfParams := Conf.NotebookCrypto.KDFParams
	Conf.m.RUnlock()
	params, validErr := util.ValidateArgon2Params(kdfParams)
	if validErr != nil {
		return validErr
	}
	kek := util.DeriveKey(password, salt, params)
	defer zeroAndClear(kek)

	// 用 KEK 加密固定魔数作为校验值，落盘后供后续 UnlockBox 离线校验
	verifierCT, err := util.EncryptWithAAD(kek, kekVerifierMagic, []byte("siyuan:kek-verifier"))
	if err != nil {
		return err
	}
	verifierNonce, nonceErr := util.EncryptionNonce(verifierCT)
	if nonceErr != nil {
		return nonceErr
	}

	Conf.m.Lock()
	previous := *Conf.NotebookCrypto
	Conf.NotebookCrypto.Enabled = true
	Conf.NotebookCrypto.MasterSalt = salt
	Conf.NotebookCrypto.KDFParams = params
	Conf.NotebookCrypto.KEKVerifier = verifierCT
	Conf.NotebookCrypto.VerifierNonce = verifierNonce
	Conf.m.Unlock()

	// 先持久化恢复备份，再提交 conf。此时尚无加密笔记本和历史依赖，任一步失败都不会孤立既有密文。
	if err := saveNotebookCryptoBackup(kek); err != nil {
		// 备份写失败则恢复启用前的内存配置；conf 尚未写入，无需再执行磁盘回滚。
		logging.LogErrorf("save notebook crypto backup failed: %s", err)
		Conf.m.Lock()
		*Conf.NotebookCrypto = previous
		Conf.m.Unlock()
		return fmt.Errorf("enable encrypted notebook failed: failed to persist key backup: %w", err)
	}
	// Conf.Save 内部会加 Conf.m，不能在持锁状态下调用（RWMutex 不可重入）。
	// 即使配置写入失败，已落盘的备份仍可在下次启动时恢复同一套密钥材料。
	Conf.Save()
	IncSync()
	return nil
}

// DisableEncryptedNotebook 关闭加密笔记本功能。前置：不能有加密笔记本存在，
// 且不能有依赖当前密钥备份的已删除笔记本历史（否则禁用并删除备份会让这些历史永久锁死，违反 §19）。
// 清除全局加密配置（MasterSalt/KEKVerifier），KEK/DEK 不再可用。
func DisableEncryptedNotebook() error {
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	// 检查是否还有加密笔记本（含 conf 损坏但存在备份的）
	ids, listErr := listAllEncryptedBoxIDs()
	if listErr != nil {
		return fmt.Errorf("list encrypted notebooks failed: %w", listErr)
	}
	if len(ids) > 0 {
		return errors.New("cannot disable encrypted notebook feature while encrypted notebooks exist, remove them first")
	}
	// 检查历史目录中是否存在已删除加密笔记本的历史快照：其恢复仍依赖当前 MasterSalt/KEKVerifier，
	// 删除备份前必须先清除这些历史（详见设计 §19）
	hasHistory, historyErr := scanEncryptedNotebookHistory()
	if historyErr != nil {
		return fmt.Errorf("check encrypted notebook history failed: %w", historyErr)
	}
	if hasHistory {
		return errors.New(Conf.Language(323))
	}

	Conf.m.Lock()
	Conf.NotebookCrypto.Enabled = false
	Conf.NotebookCrypto.MasterSalt = nil
	Conf.NotebookCrypto.KEKVerifier = nil
	Conf.NotebookCrypto.VerifierNonce = nil
	Conf.m.Unlock()

	Conf.Save()
	removeNotebookCryptoBackup() // 禁用时清理备份，避免残留旧密钥材料
	IncSync()
	return nil
}

// restoreNotebookCryptoConfigFromBackup 把备份里的 NotebookCrypto 配置装回本机 conf.json（不需主密码）。
// 用于数据同步/导入 Data.zip 后：备份文件随 DataDir 到达新设备，但本机 conf.json 的 NotebookCrypto 还是空的。
// 此时把 salt/verifier/KDFParams 装回并置 Enabled=true，让 UI 显示"已启用"，笔记本显示为锁定（解锁仍需主密码）。
// 前置：仅在本机 Enabled=false 时调用，避免覆盖正在使用的本机配置。
// 安全：salt 不保密、verifier 是密文，装回配置本身不暴露任何明文数据（解锁仍需主密码派生 KEK）。
func restoreNotebookCryptoConfigFromBackup() {
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	Conf.m.RLock()
	enabled := Conf.NotebookCrypto.Enabled
	Conf.m.RUnlock()
	if enabled {
		return // 本机已启用，不覆盖
	}
	backup, err := loadNotebookCryptoBackup()
	if err != nil || backup == nil || len(backup.MasterSalt) == 0 || len(backup.KEKVerifier) == 0 {
		return // 无可用备份，静默跳过
	}
	// 校验 KDFParams：非法参数时拒绝恢复
	params, validErr := util.ValidateArgon2Params(backup.KDFParams)
	if validErr != nil {
		logging.LogErrorf("skip restore notebook crypto: invalid KDFParams in backup: %s", validErr)
		return
	}
	backup.KDFParams = params

	backup.Enabled = true
	Conf.m.Lock()
	*Conf.NotebookCrypto = *backup
	Conf.m.Unlock()
	Conf.Save()
	logging.LogInfof("notebook crypto config restored from backup (auto-enable after sync/import)")
}

// tryRestoreNotebookCryptoFromBackupLocked 在本机 NotebookCrypto 未启用时，尝试从 DataDir 备份恢复。
// 数据同步到新设备后，本机 conf.json 的 NotebookCrypto 是空的（Enabled=false），但备份文件已随
// DataDir 同步过来。此时用户点加密笔记本输主密码，deriveKEK 会调本函数用主密码校验备份里的
// verifier，校验通过则装回 salt/verifier 并置 Enabled=true，让旧 WrappedDEK 可正常解开。
// 校验通过时同时返回已派生的 KEK（恢复用的 salt 与装回的 salt 相同，避免 deriveKEK 重复跑 Argon2id）。
// 返回错误表示恢复失败（备份缺失/主密码错），此时 KEK 为 nil。
func tryRestoreNotebookCryptoFromBackupLocked(password string) (kek []byte, err error) {
	backup, kek, err := deriveNotebookCryptoBackupCandidate(password)
	if err != nil {
		return nil, err
	}
	params, _ := util.ValidateArgon2Params(backup.KDFParams)

	backup.KDFParams = params // 确保写回 Conf 的参数已经通过完整校验。
	backup.Enabled = true
	Conf.m.Lock()
	backup.AutoLockMinutes = Conf.NotebookCrypto.AutoLockMinutes
	*Conf.NotebookCrypto = *backup
	Conf.m.Unlock()
	Conf.Save()
	// 恢复成功后同步重写备份，确保配置和备份内容一致。
	// 调用方已持有 notebookCryptoMu，且 writeNotebookCryptoBackupData 不再申请该锁，故无死锁；
	// 同步写避免与 ChangeMasterPassword 的并发备份写竞争同一文件（lost update 导致 verifier 被回退）。
	nc := *backup
	if err := writeNotebookCryptoBackupData(&nc, kek); err != nil {
		logging.LogWarnf("rewrite notebook crypto backup after restore failed: %s", err)
	}
	logging.LogInfof("notebook crypto restored from backup (e.g. after sync to a new device)")
	return kek, nil
}

// deriveNotebookCryptoBackupCandidate 对同步备份做无副作用验证，并确认它覆盖全部现有加密笔记本。
func deriveNotebookCryptoBackupCandidate(password string) (backup *conf.NotebookCrypto, kek []byte, err error) {
	backup, err = loadNotebookCryptoBackup()
	if err != nil || backup == nil || len(backup.MasterSalt) == 0 || len(backup.KEKVerifier) == 0 {
		return nil, nil, errors.New(Conf.Language(310))
	}
	params, validErr := util.ValidateArgon2Params(backup.KDFParams)
	if validErr != nil {
		return nil, nil, errors.New(Conf.Language(317))
	}
	kek = util.DeriveKey(password, backup.MasterSalt, params)
	decrypted, decryptErr := util.DecryptWithAAD(kek, backup.KEKVerifier, []byte("siyuan:kek-verifier"))
	if decryptErr != nil || string(decrypted) != string(kekVerifierMagic) {
		zeroAndClear(kek)
		return nil, nil, errors.New(Conf.Language(311))
	}
	if backup.Spec != conf.CurrentNotebookCryptoSpec || backup.Checksum == "" ||
		len(backup.KEKMAC) == 0 || !verifyKEKMAC(backup, kek) {
		zeroAndClear(kek)
		return nil, nil, errors.New(Conf.Language(316))
	}
	if !verifyKEKAgainstExistingBoxes(kek) || !verifyKEKAgainstEncryptedHistory(kek) {
		zeroAndClear(kek)
		return nil, nil, errors.New(Conf.Language(316))
	}
	backup.KDFParams = params
	return backup, kek, nil
}

// deriveKEK 从主密码派生 KEK 并校验。校验失败返回错误。KEK 仅在函数作用域内有效，调用方负责使用。
func deriveKEK(password string) ([]byte, error) {
	Conf.m.RLock()
	nc := *Conf.NotebookCrypto
	Conf.m.RUnlock()

	if !nc.Enabled {
		// 本机未启用：可能是数据同步到新设备后本机 conf.json 还没有加密配置。
		// 尝试从 DataDir 备份恢复（备份会随 DataDir 同步过来）；恢复成功时直接复用其派生的 KEK。
		kek, restoreErr := tryRestoreNotebookCryptoFromBackupLocked(password)
		if restoreErr != nil {
			return nil, restoreErr
		}
		return kek, nil // 恢复函数已校验过 verifier，KEK 直接可用
	}
	params, validErr := util.ValidateArgon2Params(nc.KDFParams)
	if validErr != nil {
		return nil, validErr
	}
	kek := util.DeriveKey(password, nc.MasterSalt, params)

	decrypted, err := util.DecryptWithAAD(kek, nc.KEKVerifier, []byte("siyuan:kek-verifier"))
	localPasswordValid := err == nil && string(decrypted) == string(kekVerifierMagic)
	mig, migErr := readMasterPasswordMigration()
	if !localPasswordValid {
		zeroAndClear(kek)
		// 本机没有进行中的改密事务时，允许采用随同步到达且能覆盖全部 WrappedDEK 的候选配置。
		if migErr == nil && mig == nil {
			backup, candidateKEK, candidateErr := deriveNotebookCryptoBackupCandidate(password)
			if candidateErr == nil {
				backup.Enabled = true
				backup.AutoLockMinutes = nc.AutoLockMinutes
				Conf.m.Lock()
				*Conf.NotebookCrypto = *backup
				Conf.m.Unlock()
				Conf.Save()
				logging.LogInfof("adopted synchronized notebook crypto configuration")
				return candidateKEK, nil
			}
		}
		return nil, errors.New(Conf.Language(311))
	}

	// 正常配置必须通过 KEKMAC 认证，不能把“MAC 缺失”当作兼容路径。
	migrationPending := migErr == nil && mig != nil && bytes.Equal(nc.KEKVerifier, mig.NewVerifier)
	if !migrationPending {
		backup, backupErr := loadNotebookCryptoBackup()
		backupMatchesConf := backupErr == nil && backup != nil &&
			bytes.Equal(backup.MasterSalt, nc.MasterSalt) &&
			bytes.Equal(backup.KEKVerifier, nc.KEKVerifier) &&
			backup.KDFParams == nc.KDFParams
		localAuthenticated := notebookCryptoConfigurationComplete(&nc) && verifyKEKMAC(&nc, kek)
		backupAuthenticated := backupMatchesConf && backup.Spec == conf.CurrentNotebookCryptoSpec &&
			backup.Checksum != "" && len(backup.KEKMAC) > 0 && verifyKEKMAC(backup, kek)
		if !localAuthenticated && !backupAuthenticated {
			zeroAndClear(kek)
			return nil, errors.New(Conf.Language(315))
		}
		if !verifyKEKAgainstExistingBoxes(kek) {
			zeroAndClear(kek)
			return nil, errors.New(Conf.Language(315))
		}
		if !localAuthenticated {
			backup.Enabled = true
			backup.AutoLockMinutes = nc.AutoLockMinutes
			Conf.m.Lock()
			*Conf.NotebookCrypto = *backup
			Conf.m.Unlock()
			Conf.Save()
			logging.LogInfof("repaired notebook crypto configuration from authenticated backup")
		} else if !backupAuthenticated {
			// 同步备份可能属于另一轮完整改密；只要本地配置仍与全部笔记本一致，就继续使用本地配置，
			// 不覆盖候选备份，等待其余 WrappedDEK 同步完成后由新密码采用。
			logging.LogWarnf("notebook crypto backup differs from usable local configuration; keeping both candidates")
		}
	}

	if migrationPending {
		// 崩溃恢复后的首次新密码验证：确认所有笔记本都已切换到新 KEK，再生成带认证的全局备份并结束迁移。
		if !verifyKEKAgainstExistingBoxes(kek) {
			zeroAndClear(kek)
			return nil, errMasterPasswordMigrationPending
		}
		if err = saveNotebookCryptoBackup(kek); err != nil {
			zeroAndClear(kek)
			return nil, fmt.Errorf("%w: %v", errMasterPasswordMigrationPending, err)
		}
		removeMasterPasswordMigration()
	}
	return kek, nil
}

// decryptBoxCrypt 用 KEK 解密 box 的 WrappedDEK。优先使用 GetBoxEncryption 的结果（conf → backup fallback），
// 若解密失败则尝试 backup 中不同的 WrappedDEK。
// 返回解密后的 DEK 和实际使用的 BoxCrypt（可能来自 backup）。
// 若 backup 被使用会自动修复 conf.json 和刷新 backup。
func decryptBoxCrypt(boxID string, kek []byte) (dek []byte, boxCrypt *conf.BoxEncryption, err error) {
	boxCrypt, err = GetBoxEncryption(boxID)
	if err != nil || boxCrypt == nil || len(boxCrypt.WrappedDEK) == 0 {
		return nil, nil, fmt.Errorf("no encrypted key material for box [%s]", boxID)
	}

	dek, err = decryptWrappedDEK(boxID, boxCrypt, kek)
	if err == nil {
		return dek, boxCrypt, nil
	}

	// 主 BoxCrypt 无法解密：尝试 backup 中不同的 WrappedDEK
	backup, bErr := readNotebookCryptBackup(boxID)
	if bErr == nil && backup != nil && len(backup.WrappedDEK) > 0 &&
		!bytes.Equal(backup.WrappedDEK, boxCrypt.WrappedDEK) {
		dek, err = decryptWrappedDEK(boxID, backup, kek)
		if err == nil {
			// backup 解密成功：修复 conf + 刷新 backup
			box := &Box{ID: boxID}
			boxConf := box.GetConf()
			boxConf.Encrypted = true
			boxConf.BoxCrypt = backup
			if saveErr := box.SaveConf(boxConf); saveErr != nil {
				logging.LogWarnf("fix encrypted box conf from backup [%s] failed: %s", boxID, saveErr)
			}
			if needWriteNotebookCryptBackup(boxID, backup) {
				if writeErr := writeNotebookCryptBackup(boxID, backup); writeErr != nil {
					logging.LogWarnf("refresh notebook crypt backup [%s] failed: %s", boxID, writeErr)
				}
			}
			return dek, backup, nil
		}
	}
	return nil, nil, fmt.Errorf("decrypt box [%s] failed: incorrect key or corrupted data", boxID)
}

// UnlockBox 用主密码派生 KEK，解出该笔记本的 DEK 并缓存。KEK 用完即弃，不全局缓存。
// 每次调用都跑一次 Argon2id（约 1 秒），严格满足"每笔记本单独解锁"语义。
func UnlockBox(boxID string, password string, boxEnc *conf.BoxEncryption) (err error) {
	invalidateEncryptedPublishAccessCache()
	if !ast.IsNodeIDPattern(boxID) {
		return errors.New("invalid notebook ID")
	}

	// 全局配置锁先于笔记本生命周期锁获取（设计 §17 锁顺序约定），避免与持子系统锁后回取配置锁的路径死锁。
	// notebookCryptoMu 持锁期间调用的 deriveKEK/conf 修复只申请 Conf.m/cachedDEKsLock，不回取 box 生命周期锁。
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()
	releaseTransition := holdEncryptedBoxTransition(boxID)
	defer releaseTransition()
	return unlockBoxHeld(boxID, password, boxEnc)
}

// UnlockAndMountBox 在同一个笔记本转换锁内完成解锁和挂载，挂载失败时回滚本次新建的解锁状态。
func UnlockAndMountBox(boxID, password string, boxEnc *conf.BoxEncryption) (alreadyMount bool, err error) {
	invalidateEncryptedPublishAccessCache()
	if !ast.IsNodeIDPattern(boxID) {
		return false, errors.New("invalid notebook ID")
	}

	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()
	releaseTransition := holdEncryptedBoxTransition(boxID)
	defer releaseTransition()

	wasUnlocked := IsBoxUnlocked(boxID)
	if err = unlockBoxHeld(boxID, password, boxEnc); err != nil {
		return false, err
	}
	alreadyMount, err = mountBox(boxID)
	if err != nil && !wasUnlocked {
		lockBoxWithPreparationHeld(boxID, nil)
	}
	return alreadyMount, err
}

func unlockBoxHeld(boxID string, password string, boxEnc *conf.BoxEncryption) (err error) {
	if _, busy := boxLock.Load(boxID); busy {
		return errors.New(Conf.language(239))
	}
	if boxEnc == nil || len(boxEnc.WrappedDEK) == 0 {
		setEncryptedBoxState(boxID, EncryptedBoxStateError)
		return errors.New("no encrypted key material for box")
	}
	if IsBoxUnlocked(boxID) {
		if GetEncryptedBoxState(boxID) == EncryptedBoxStateError {
			return errors.New(Conf.Language(316))
		}
		setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
		return nil
	}

	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocking)
	// 获取 box 写锁，与 LockBox/unmount0 串行化，防止并发锁/解锁导致 db/DEK 状态不一致
	acquireBoxWriteLock(boxID)
	finalState := EncryptedBoxStateLocked
	defer func() {
		releaseBoxWriteLock(boxID)
		setEncryptedBoxState(boxID, finalState)
	}()

	kek, err := deriveKEK(password)
	if err != nil {
		return err
	}
	defer zeroAndClear(kek)

	// 用 decryptBoxCrypt 统一处理解密 + backup fallback + conf 修复
	dek, trustedCrypt, err := decryptBoxCrypt(boxID, kek)
	if err != nil {
		finalState = EncryptedBoxStateError
		return errors.New(Conf.Language(316))
	}
	dekCached := false
	defer func() {
		if !dekCached {
			zeroAndClear(dek)
		}
	}()
	boxEnc = trustedCrypt
	markRuntimeEncryptedBox(boxID)
	metadataConf := &conf.BoxConf{Encrypted: true, BoxCrypt: boxEnc}
	if err = decryptBoxMetadata(boxID, metadataConf, dek); err != nil {
		finalState = EncryptedBoxStateError
		return errors.New(Conf.Language(316))
	}

	// 持锁保护"开 db + 缓存 DEK"的原子性，避免与并发的 LockBox 导致 db/DEK 不一致
	cachedDEKsLock.Lock()
	if err = sql.OpenEncryptedDB(boxID, dek); err != nil {
		cachedDEKsLock.Unlock()
		finalState = EncryptedBoxStateError
		return err
	}
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		sql.RemoveEncryptedDBFile(boxID) // 清理已创建的 content db 文件，避免遗留空加密库
		cachedDEKsLock.Unlock()
		finalState = EncryptedBoxStateError
		return err
	}
	cachedDEKs[boxID] = dek
	dekCached = true
	cachedDEKsLock.Unlock()

	// 初始化自动锁定访问时间戳，记录解锁时刻
	newVal := &atomic.Int64{}
	newVal.Store(time.Now().UnixNano())
	boxLastAccess.Store(boxID, newVal)

	// 修复 conf.json：若 conf 未正确标记加密状态则修正（例如从 backup 解锁后）
	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	if boxConf == nil || !boxConf.Encrypted || boxConf.BoxCrypt == nil ||
		len(boxConf.BoxCrypt.WrappedDEK) == 0 ||
		!bytes.Equal(boxConf.BoxCrypt.WrappedDEK, boxEnc.WrappedDEK) {
		boxConf.Encrypted = true
		boxConf.BoxCrypt = boxEnc
		if saveErr := box.SaveConf(boxConf); saveErr != nil {
			logging.LogWarnf("fix encrypted box conf [%s] failed: %s", boxID, saveErr)
		}
	}

	// 刷新 per-notebook backup（不存在或内容不一致时），便于 conf 损坏恢复
	if needWriteNotebookCryptBackup(boxID, boxEnc) {
		if err = writeNotebookCryptBackup(boxID, boxEnc); err != nil {
			logging.LogWarnf("write notebook crypt backup [%s] failed: %s", boxID, err)
		}
	}
	finalState = EncryptedBoxStateUnlocked
	return nil
}

// IsBoxUnlocked 返回该笔记本的 DEK 是否在内存（是否已解锁）。
func IsBoxUnlocked(boxID string) bool {
	if !ast.IsNodeIDPattern(boxID) {
		return false
	}
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	_, ok := cachedDEKs[boxID]
	return ok
}

func isBoxUnlockedForAccess(boxID string) bool {
	if !IsBoxUnlocked(boxID) {
		return false
	}
	state := GetEncryptedBoxState(boxID)
	return state == EncryptedBoxStateUnlocked || state == EncryptedBoxStateLocking
}

// LockBox 清除指定笔记本的 DEK 并删除其加密 db 文件。Unmount 单个加密笔记本或手动锁定时调用。
func LockBox(boxID string) {
	if !ast.IsNodeIDPattern(boxID) {
		logging.LogWarnf("refuse to lock encrypted notebook with invalid ID [%s]", boxID)
		return
	}
	lockBoxWithPreparation(boxID, nil)
}

// lockBoxWithPreparation 在关闭新操作并等待在途操作结束后执行锁定前准备，随后清除密钥和加密数据库。
func lockBoxWithPreparation(boxID string, prepare func()) {
	releaseTransition := holdEncryptedBoxTransition(boxID)
	defer releaseTransition()
	lockBoxWithPreparationHeld(boxID, prepare)
}

func lockBoxWithPreparationHeld(boxID string, prepare func()) {
	beginEncryptedBoxLock(boxID)
	FlushTxQueue()
	sql.FlushQueue()
	if prepare != nil {
		prepare()
	}
	acquireBoxWriteLock(boxID)
	defer func() {
		releaseBoxWriteLock(boxID)
		setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
	}()
	lockBoxHeld(boxID)
	// 单 box 锁定时需要在写锁保护下刷新全局缓存，避免锁定与缓存读取之间出现明文窗口。
	cache.ClearTreeCache()
	sql.ClearCache()
	cache.ClearDocsIAL()
	cache.ClearBlocksIAL()
	cache.ClearAVCache()
	ResetVirtualBlockRefCache()
}

// lockBoxHeld 在已持有 box 写锁的前提下执行该 box 的锁定清理（不含全局缓存刷新）。
func lockBoxHeld(boxID string) {
	// 此时已排空在途操作并持有 box 写锁，可以安全清除该笔记本的明文 HEIF 预览缓存。
	heif.ClearMemoryCache(boxID)
	RevokeManagedEncryptedExportsForBox(boxID)
	ClearRichClipboardBox(boxID)

	cachedDEKsLock.Lock()
	if dek, ok := cachedDEKs[boxID]; ok {
		zeroAndClear(dek)
		delete(cachedDEKs, boxID)
	}
	cachedDEKsLock.Unlock()
	mountedEncryptedBoxes.Delete(boxID)

	// 清理自动锁定访问时间戳
	boxLastAccess.Delete(boxID)

	// 仅在 backup 缺失时从 conf 补写。正常流程中 CreateEncryptedBox/UnlockBox/ChangeMasterPassword
	// 已刷新 backup，此处不再用未经解密验证的 BoxCrypt 覆盖已有 backup，
	// 避免 conf 中的坏 WrappedDEK 覆盖有效恢复源。
	if !filelock.IsExist(notebookCryptoBackupPath(boxID)) {
		box := &Box{ID: boxID}
		boxConf := box.GetConf()
		if boxConf != nil && boxConf.Encrypted && boxConf.BoxCrypt != nil && len(boxConf.BoxCrypt.WrappedDEK) > 0 {
			if err := writeNotebookCryptBackup(boxID, boxConf.BoxCrypt); err != nil {
				logging.LogWarnf("write notebook crypt backup [%s] failed: %s", boxID, err)
			}
		}
	}

	sql.RemoveEncryptedDBFile(boxID)
	treenode.RemoveEncryptedBlockTreeDBFile(boxID)
	// 清理 repo 临时目录中该加密 box 的解密文件（diff/rollback/sync conflicts）
	repoDirs := []string{
		filepath.Join(util.TempDir, "repo", "diff", boxID),
		filepath.Join(util.TempDir, "repo", "rollback", boxID),
	}
	for _, d := range repoDirs {
		if rmErr := os.RemoveAll(d); rmErr != nil {
			logging.LogWarnf("remove repo dir for box [%s] failed: %s", boxID, rmErr)
		}
	}
	// sync/conflicts 路径带时间戳前缀，用通配匹配
	if matches, globErr := filepath.Glob(filepath.Join(util.TempDir, "repo", "sync", "conflicts", "*", boxID)); globErr == nil {
		for _, m := range matches {
			if rmErr := os.RemoveAll(m); rmErr != nil {
				logging.LogWarnf("remove repo sync conflict dir for box [%s] failed: %s", boxID, rmErr)
			}
		}
	}
	// 清理临时导出目录中该加密 box 的临时导出（htmlmd/html/PDF）
	if rmErr := os.RemoveAll(filepath.Join(util.TempDir, "export", boxID)); rmErr != nil {
		logging.LogWarnf("remove export/[%s] dir failed: %s", boxID, rmErr)
	}
	// 清理动态引用锚文本缓存
	treenode.RemoveDynamicRefTexts(boxID)
}

// WrapNewDEK 用给定 KEK 生成随机 DEK 并包络，返回 BoxEncryption 元数据。
// KEK 由调用方临时派生（不来自全局缓存），调用方负责使用后丢弃。
// 同时返回原始 DEK，供调用方在创建场景下直接开 db 缓存，省去再次 Argon2id 派生。
func WrapNewDEK(boxID string, kek []byte) (*conf.BoxEncryption, []byte, error) {
	dek, err := util.GenerateDEK()
	if err != nil {
		return nil, nil, err
	}
	wrapped, err := util.EncryptWithAAD(kek, dek, wrappedDEKAAD(boxID))
	if err != nil {
		return nil, nil, err
	}
	return &conf.BoxEncryption{
		Spec:       boxEncryptionSpec,
		WrappedDEK: wrapped,
		WrapNonce:  mustEncryptionNonce(wrapped),
		CreatedAt:  time.Now().UnixMilli(),
	}, dek, nil
}

func wrappedDEKAAD(boxID string) []byte {
	return []byte("siyuan:wrapped-dek:" + boxID)
}

func decryptWrappedDEK(boxID string, enc *conf.BoxEncryption, kek []byte) ([]byte, error) {
	if err := validateWrappedDEKEnvelope(enc); err != nil {
		return nil, err
	}
	return util.DecryptWithAAD(kek, enc.WrappedDEK, wrappedDEKAAD(boxID))
}

func validateWrappedDEKEnvelope(enc *conf.BoxEncryption) error {
	if enc == nil || enc.Spec != boxEncryptionSpec {
		return errors.New("unsupported encrypted notebook key envelope")
	}
	if enc.CreatedAt <= 0 {
		return errors.New("encrypted notebook key envelope creation time is missing")
	}
	nonce, err := util.EncryptionNonce(enc.WrappedDEK)
	if err != nil {
		return fmt.Errorf("invalid encrypted notebook key envelope: %w", err)
	}
	if !bytes.Equal(nonce, enc.WrapNonce) {
		return errors.New("encrypted notebook key envelope nonce mismatch")
	}
	return nil
}

func validateBoxEncryption(enc *conf.BoxEncryption) error {
	if err := validateWrappedDEKEnvelope(enc); err != nil {
		return err
	}
	if _, err := util.EncryptionNonce(enc.Metadata); err != nil {
		return fmt.Errorf("invalid encrypted notebook metadata envelope: %w", err)
	}
	return nil
}

// mustEncryptionNonce 从刚刚成功生成的密文中提取 nonce。生成密文格式错误属于内部不变量被破坏，直接终止执行。
func mustEncryptionNonce(ciphertext []byte) []byte {
	nonce, err := util.EncryptionNonce(ciphertext)
	if err != nil {
		panic("extract encryption nonce failed: " + err.Error())
	}
	return nonce
}

// GetDEK 取已缓存的 DEK。返回副本，避免外部零化影响缓存。
// filesys/assets/db 加解密时调用。
func GetDEK(boxID string) ([]byte, error) {
	if !ast.IsNodeIDPattern(boxID) {
		return nil, errors.New("invalid notebook ID")
	}
	if IsEncryptedBox(boxID) && !isBoxUnlockedForAccess(boxID) {
		return nil, errors.New("encrypted notebook is not accessible")
	}
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	dek, ok := cachedDEKs[boxID]
	if !ok {
		return nil, errors.New("no DEK cached for box " + boxID)
	}
	ret := make([]byte, len(dek))
	copy(ret, dek)
	return ret, nil
}

// ClearDEK 清除指定笔记本的 DEK。Unmount 单个加密笔记本时调用。
func ClearDEK(boxID string) {
	LockBox(boxID)
}

// ChangeMasterPassword 改主密码：用旧密码校验后，用新密码派生新 KEK，
// 重新加密 verifier，并把所有加密笔记本的 WrappedDEK 用新 KEK 重新包络后写回各自的 BoxConf。
//
// 使用两阶段提交确保崩溃后可恢复：
//
//	Phase 0: 预计算所有新 WrappedDEK（内存）
//	Phase 1: 写入 migration manifest
//	Phase 2: 切换全局 verifier
//	Phase 3: 写入各 box conf + backup
//	Phase 4: 清除 manifest
//
// 注意：必须在所有加密笔记本都已 Unmount 的状态下调用（DEK 不在内存），否则新旧 KEK 切换会让缓存与磁盘不一致。
func ChangeMasterPassword(oldPassword, newPassword string) error {
	if len(newPassword) == 0 {
		return errors.New("new password must not be empty")
	}

	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	// 改密期间不能有已 Mount 的加密笔记本（DEK 在内存），否则新旧 KEK 切换会让缓存与磁盘不一致
	cachedDEKsLock.RLock()
	dekCount := len(cachedDEKs)
	cachedDEKsLock.RUnlock()
	if dekCount > 0 {
		return errors.New("cannot change master password while encrypted notebooks are unlocked (DEKs in memory), lock them first")
	}

	oldKEK, err := deriveKEK(oldPassword)
	if err != nil {
		return err
	}
	defer zeroAndClear(oldKEK)

	Conf.m.Lock()
	nc := Conf.NotebookCrypto
	Conf.m.Unlock()

	params, validErr := util.ValidateArgon2Params(nc.KDFParams)
	if validErr != nil {
		return validErr
	}
	newKEK := util.DeriveKey(newPassword, nc.MasterSalt, params)
	defer zeroAndClear(newKEK)
	newVerifier, err := util.EncryptWithAAD(newKEK, kekVerifierMagic, []byte("siyuan:kek-verifier"))
	if err != nil {
		return err
	}

	// Phase 0: 遍历所有加密笔记本（含 conf 损坏但存在备份的），预计算新 WrappedDEK（内存操作）
	// 允许 entries 为空：用户可能已启用加密功能但尚未创建加密笔记本，此时仍需更新全局 verifier 和 backup。
	encBoxIDs, listErr := listAllEncryptedBoxIDs()
	if listErr != nil {
		return fmt.Errorf("list encrypted notebooks failed: %w", listErr)
	}
	var entries []migrationBoxEntry
	for _, id := range encBoxIDs {
		dek, boxCrypt, dErr := decryptBoxCrypt(id, oldKEK)
		if dErr != nil {
			return errors.New(Conf.Language(316) + " [box=" + id + "]")
		}
		newWrapped, nErr := util.EncryptWithAAD(newKEK, dek, wrappedDEKAAD(id))
		if nErr != nil {
			return nErr
		}
		entries = append(entries, migrationBoxEntry{
			BoxID:         id,
			NewSpec:       boxEncryptionSpec,
			NewWrappedDEK: newWrapped,
			NewWrapNonce:  mustEncryptionNonce(newWrapped),
			Metadata:      append([]byte(nil), boxCrypt.Metadata...),
		})
	}

	// Phase 1: 持久化 migration manifest（崩溃后 recovery 的依据）
	newParamsJSON, _ := gulu.JSON.MarshalJSON(params)
	mig := &masterPasswordMigration{
		OldVerifier:      nc.KEKVerifier,
		NewVerifier:      newVerifier,
		NewVerifierNonce: mustEncryptionNonce(newVerifier),
		NewKDFParams:     newParamsJSON,
		Boxes:            entries,
	}
	if err = writeMasterPasswordMigration(mig); err != nil {
		return err
	}

	// Phase 2: 切换全局 verifier
	Conf.m.Lock()
	Conf.NotebookCrypto.KEKVerifier = newVerifier
	Conf.NotebookCrypto.VerifierNonce = mustEncryptionNonce(newVerifier)
	Conf.NotebookCrypto.KDFParams = params
	Conf.m.Unlock()

	// Conf.Save 内部会加 Conf.m，不能在持锁状态下调用（RWMutex 不可重入）
	Conf.Save()

	// Phase 3: 写入各 box conf + backup
	for _, entry := range entries {
		box := &Box{ID: entry.BoxID}
		boxConf := box.GetConf()
		if !boxConf.Encrypted || boxConf.BoxCrypt == nil {
			// conf 缺失/损坏：尝试从 per-notebook backup 重建
			backup, bErr := readNotebookCryptBackup(entry.BoxID)
			if bErr == nil && backup != nil && len(backup.WrappedDEK) > 0 {
				boxConf = box.GetConf()
				boxConf.Encrypted = true
				boxConf.BoxCrypt = backup
				if saveErr := box.SaveConf(boxConf); saveErr != nil {
					return fmt.Errorf("%w: %s", errMasterPasswordMigrationPending,
						fmt.Sprintf(Conf.Language(320), entry.BoxID+": rebuild encrypted conf from backup failed: "+saveErr.Error()))
				}
			} else {
				// conf 与 backup 均不可用：manifest 是该 box 加密密钥的权威来源，直接从 entry 重建 BoxCrypt，
				// 避免改密因瞬时 conf 损坏而中断（详见 recoverMasterPasswordMigration 中的对称处理）。
				logging.LogWarnf("rebuild encrypted box [%s] from migration entry (conf and backup both unavailable)", entry.BoxID)
				boxConf = box.GetConf()
				boxConf.Encrypted = true
				boxConf.BoxCrypt = &conf.BoxEncryption{
					WrappedDEK: entry.NewWrappedDEK,
					WrapNonce:  entry.NewWrapNonce,
					Spec:       entry.NewSpec,
					Metadata:   entry.Metadata,
					CreatedAt:  time.Now().UnixMilli(),
				}
				if saveErr := box.SaveConf(boxConf); saveErr != nil {
					return fmt.Errorf("%w: %s", errMasterPasswordMigrationPending,
						fmt.Sprintf(Conf.Language(320), entry.BoxID+": rebuild encrypted conf from migration entry failed: "+saveErr.Error()))
				}
			}
		}
		boxConf.BoxCrypt.WrappedDEK = entry.NewWrappedDEK
		boxConf.BoxCrypt.Spec = entry.NewSpec
		boxConf.BoxCrypt.WrapNonce = entry.NewWrapNonce
		boxConf.BoxCrypt.Metadata = append([]byte(nil), entry.Metadata...)
		if err = box.SaveConf(boxConf); err != nil {
			return fmt.Errorf("%w: %s", errMasterPasswordMigrationPending,
				fmt.Sprintf(Conf.Language(320), entry.BoxID+": save conf failed: "+err.Error()))
		}
		if err = writeNotebookCryptBackup(entry.BoxID, boxConf.BoxCrypt); err != nil {
			return fmt.Errorf("%w: %s", errMasterPasswordMigrationPending,
				fmt.Sprintf(Conf.Language(320), entry.BoxID+": update notebook crypt backup failed: "+err.Error()))
		}
	}

	// Phase 4: 先持久化全局备份，再清除 manifest，确保崩溃后可恢复
	if err = saveNotebookCryptoBackup(newKEK); err != nil {
		return fmt.Errorf("%w: %s", errMasterPasswordMigrationPending,
			fmt.Sprintf(Conf.Language(320), "save notebook crypto backup failed: "+err.Error()))
	}
	removeMasterPasswordMigration()
	IncSync()
	return nil
}

// IsEncryptedBox 判断给定 boxID 是否为加密笔记本。
// 配置缺失或损坏时依次检查运行时身份、独立备份和密文标识，任何检查错误都按加密笔记本处理。
func IsEncryptedBox(boxID string) bool {
	if !ast.IsNodeIDPattern(boxID) {
		return false
	}
	if isRuntimeEncryptedBox(boxID) {
		return true
	}
	if isRuntimeNormalBox(boxID) {
		return false
	}

	normalConf := false
	boxConfPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if filelock.IsExist(boxConfPath) {
		data, readErr := filelock.ReadFile(boxConfPath)
		if readErr == nil {
			boxConf := conf.NewBoxConf()
			if unmarshalErr := gulu.JSON.UnmarshalJSON(data, boxConf); unmarshalErr == nil {
				if boxConf.Encrypted {
					markRuntimeEncryptedBox(boxID)
					return true
				}
				normalConf = true
			}
		}
	}

	backupPath := notebookCryptoBackupPath(boxID)
	if filelock.IsExist(backupPath) {
		backup, err := readNotebookCryptBackup(boxID)
		if err != nil {
			logging.LogWarnf("failed to read notebook crypt backup for [%s]: %s", boxID, err)
			forgetRuntimeNormalBox(boxID)
			markRuntimeEncryptedBox(boxID)
			return true
		}
		if backup != nil && len(backup.WrappedDEK) > 0 {
			forgetRuntimeNormalBox(boxID)
			markRuntimeEncryptedBox(boxID)
			return true
		}
	}
	if normalConf {
		markRuntimeNormalBox(boxID)
		return false
	}

	found, err := hasEncryptedNotebookPayload(boxID)
	if err != nil {
		logging.LogWarnf("failed to inspect notebook encryption identity for [%s]: %s", boxID, err)
		forgetRuntimeNormalBox(boxID)
		markRuntimeEncryptedBox(boxID)
		return true
	}
	if found {
		forgetRuntimeNormalBox(boxID)
		markRuntimeEncryptedBox(boxID)
	}
	return found
}

// GetBoxEncryption 获取加密笔记本的 BoxEncryption（含 WrappedDEK）。
// 优先读 conf.json，若缺失/损坏则 fallback 到 per-notebook backup。
// 返回 nil 表示该 box 非加密；conf 标记加密但密钥材料缺失时返回明确错误。
func GetBoxEncryption(boxID string) (*conf.BoxEncryption, error) {
	if !ast.IsNodeIDPattern(boxID) {
		return nil, errors.New("invalid notebook ID")
	}
	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	confMarkedEncrypted := boxConf != nil && boxConf.Encrypted
	if confMarkedEncrypted {
		markRuntimeEncryptedBox(boxID)
	}

	// conf 中有完整的 BoxCrypt
	if confMarkedEncrypted && boxConf.BoxCrypt != nil && len(boxConf.BoxCrypt.WrappedDEK) > 0 {
		return boxConf.BoxCrypt, nil
	}

	// fallback 到 backup
	backup, err := readNotebookCryptBackup(boxID)
	if err != nil {
		return nil, err
	}
	if backup != nil && len(backup.WrappedDEK) > 0 {
		markRuntimeEncryptedBox(boxID)
		return backup, nil
	}

	// backup 也不可用
	if confMarkedEncrypted || IsEncryptedBox(boxID) {
		// conf 标记为加密但密钥材料缺失 → 明确错误（而非误报"未加密"）
		return nil, errors.New("encrypted notebook has no valid key material")
	}
	return nil, nil // 真正的非加密笔记本
}

// needWriteNotebookCryptBackup 检查是否需要写入/刷新 per-notebook backup。
// backup 不存在、或内容与 crypt 不一致时返回 true。
func needWriteNotebookCryptBackup(boxID string, crypt *conf.BoxEncryption) bool {
	existing, err := readNotebookCryptBackup(boxID)
	if err != nil || existing == nil {
		return true
	}
	return !bytes.Equal(existing.WrappedDEK, crypt.WrappedDEK) ||
		!bytes.Equal(existing.WrapNonce, crypt.WrapNonce) ||
		!bytes.Equal(existing.Metadata, crypt.Metadata) ||
		existing.Spec != crypt.Spec ||
		existing.CreatedAt != crypt.CreatedAt
}

// DeepCopyBoxEncryption 深拷贝 BoxEncryption（含 []byte 字段），输入 nil 时返回 nil。
// 供 api 层在反序列化请求体前保存加密字段的不可变快照。
func DeepCopyBoxEncryption(src *conf.BoxEncryption) *conf.BoxEncryption {
	if src == nil {
		return nil
	}
	return &conf.BoxEncryption{
		Spec:       src.Spec,
		WrappedDEK: append([]byte(nil), src.WrappedDEK...),
		WrapNonce:  append([]byte(nil), src.WrapNonce...),
		Metadata:   append([]byte(nil), src.Metadata...),
		CreatedAt:  src.CreatedAt,
	}
}

// listAllEncryptedBoxIDs 直接扫描笔记本配置、密钥备份、密文标识及当前进程身份，不触发配置修复等副作用。
func listAllEncryptedBoxIDs() ([]string, error) {
	ids := map[string]struct{}{}
	dirs, err := os.ReadDir(util.DataDir)
	if err != nil {
		return nil, err
	}
	for _, dir := range dirs {
		if !dir.IsDir() || !ast.IsNodeIDPattern(dir.Name()) {
			continue
		}
		boxID := dir.Name()
		encrypted := isRuntimeEncryptedBox(boxID)
		normalConf := false
		boxConfPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
		if !encrypted {
			data, readErr := filelock.ReadFile(boxConfPath)
			if readErr == nil {
				boxConf := conf.NewBoxConf()
				if unmarshalErr := gulu.JSON.UnmarshalJSON(data, boxConf); unmarshalErr == nil {
					encrypted = boxConf.Encrypted
					normalConf = !boxConf.Encrypted
				}
			}
		}
		if !encrypted {
			backup, backupErr := readNotebookCryptBackup(boxID)
			if backupErr != nil {
				return nil, backupErr
			}
			encrypted = backup != nil && len(backup.WrappedDEK) > 0
		}
		if !encrypted && !normalConf {
			found, inspectErr := hasEncryptedNotebookPayload(boxID)
			if inspectErr != nil {
				return nil, inspectErr
			}
			encrypted = found
		}
		if encrypted {
			markRuntimeEncryptedBox(boxID)
			ids[boxID] = struct{}{}
		}
	}
	runtimeEncryptedBoxes.Range(func(key, value any) bool {
		boxID, idOK := key.(string)
		dataDir, dirOK := value.(string)
		if idOK && dirOK && ast.IsNodeIDPattern(boxID) && dataDir == filepath.Clean(util.DataDir) {
			ids[boxID] = struct{}{}
		}
		return true
	})
	ret := make([]string, 0, len(ids))
	for boxID := range ids {
		ret = append(ret, boxID)
	}
	sort.Strings(ret)
	return ret, nil
}

// ListAllEncryptedBoxIDs 返回所有可枚举的加密笔记本。扫描失败时记录错误并返回空列表；
// 涉及密钥覆盖或删除的调用方必须直接使用 listAllEncryptedBoxIDs 并处理错误。
func ListAllEncryptedBoxIDs() []string {
	ids, err := listAllEncryptedBoxIDs()
	if err != nil {
		logging.LogErrorf("list encrypted notebooks failed: %s", err)
		return nil
	}
	return ids
}

// IsSameCryptoBoundary 判断 srcBox 与 dstBox 是否处于同一加密边界（跨 box 操作是否安全）。
// 普通笔记本之间允许（都不加密）；加密笔记本仅允许同一 box 内部操作——两个不同的加密笔记本各有独立 DEK，
// 之间互为"加密边界外"，跨 box 移动/合并会用错 DEK 导致密文损坏。供 MoveDocs/Doc2Heading 等跨 box 操作校验。
func IsSameCryptoBoundary(srcBox, dstBox string) bool {
	srcEnc := IsEncryptedBox(srcBox)
	dstEnc := IsEncryptedBox(dstBox)
	if !srcEnc && !dstEnc {
		return true // 普通↔普通：允许
	}
	return srcEnc && dstEnc && srcBox == dstBox // 加密：仅同一 box 内允许
}

// IsBlockRefCrossingBoundary 判断从 srcBoxID 引用 defBlockID 是否跨越加密边界。
// 加密笔记本禁止跨边界块引（双向）：加密笔记本的块只能引用同一加密笔记本内的块，普通 box 的块不能引用加密笔记本的块。
// 供 transaction 落库时兜底校验，防止手工输入/拖拽/粘贴/API 直调绕过前端搜索分流。
func IsBlockRefCrossingBoundary(srcBoxID, defBlockID string) bool {
	if "" == defBlockID {
		return false
	}
	if IsEncryptedBox(srcBoxID) {
		// 源在加密 box：def 块必须在同一加密 box（查加密 blocktree db）
		bt := treenode.GetBlockTreeInBox(defBlockID, srcBoxID)
		return nil == bt || bt.BoxID != srcBoxID
	}
	// 源在普通 box：def 块必须在普通 box（查全局 blocktree，且其 box 非加密）
	bt := treenode.GetBlockTree(defBlockID)
	if nil == bt {
		// 全局查不到时遍历加密笔记本查找，防止对向漏判（普通 box 引用加密笔记本块）
		for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
			if encBT := treenode.GetBlockTreeInBox(defBlockID, encBoxID); nil != encBT {
				bt = encBT
				break
			}
		}
	}
	if nil == bt {
		// 普通库未命中且锁定的加密 blocktree 不可查询时必须 fail-closed，否则只要知道加密块 ID，
		// 就能在加密笔记本锁定后把跨边界引用写入全局明文数据库。同一事务树内的新块由调用方单独放行。
		return normalBoxBlockRefCrossesBoundary(nil)
	}
	return normalBoxBlockRefCrossesBoundary(bt)
}

func normalBoxBlockRefCrossesBoundary(bt *treenode.BlockTree) bool {
	return bt == nil || IsEncryptedBox(bt.BoxID)
}

// IsEncryptedAssetPath 判断给定 asset 绝对路径是否属于加密笔记本。
// 供 server 层在缩略图等场景判断是否需跳过密文文件的处理。
func IsEncryptedAssetPath(absPath string) bool {
	boxID := ExtractBoxIDFromAssetsPath(absPath)
	return boxID != "" && IsEncryptedBox(boxID)
}

// GetDEKIfUnlocked 返回已解锁加密笔记本的 DEK（副本）。
// 非加密笔记本返回 (nil, nil)——filesys 据此原样读写，对普通笔记本透明。
// 加密但未解锁（DEK 不在内存）返回 (nil, error)——filesys 的加解密函数遇 error 后拒绝读写，
// 避免加密笔记本在未解锁状态下静默以明文落盘（深度防御，见 issue #18034）。
func GetDEKIfUnlocked(boxID string) ([]byte, error) {
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return nil, errors.New("invalid notebook ID")
	}
	if !IsEncryptedBox(boxID) {
		return nil, nil
	}
	repairEncryptedBoxStateFromDEK(boxID)
	if !isBoxUnlockedForAccess(boxID) {
		return nil, errors.New("encrypted notebook is locked, please unlock it first")
	}
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	dek, ok := cachedDEKs[boxID]
	if !ok {
		return nil, errors.New("encrypted notebook is locked, please unlock it first")
	}
	ret := make([]byte, len(dek))
	copy(ret, dek)
	return ret, nil
}

// HoldBoxReadLock 获取 box 读锁，防止 LockBox 在持锁期间清除缓存/临时文件。
// 调用方完成解密输出后必须调 ReleaseBoxReadLock。
func HoldBoxReadLock(boxID string) {
	if !IsEncryptedBox(boxID) {
		acquireBoxReadLock(boxID)
		return
	}
	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.lock.Lock()
	for lifecycle.state == EncryptedBoxStateUnlocking {
		lifecycle.condition.Wait()
	}
	acquireBoxReadLock(boxID)
	lifecycle.lock.Unlock()
}

// ReleaseBoxReadLock 释放 HoldBoxReadLock 获取的 box 读锁。
func ReleaseBoxReadLock(boxID string) {
	releaseBoxReadLock(boxID)
}

// extractBoxIDFromPath 从 data 目录下的绝对路径反推 boxID。
// 路径形如 <DataDir>/<boxID>/...，切出紧跟在 DataDir 后的一段。
// 若路径不在 DataDir 下或格式不符，返回空字符串。
func extractBoxIDFromPath(absPath string) string {
	return ExtractBoxIDFromAssetsPath(absPath)
}

// ExtractBoxIDFromAssetsPath 从 data 目录下的绝对路径（.sy 或 assets）反推 boxID。
// 供 server/api 层判断 asset 是否属于加密笔记本。路径形如 <DataDir>/<boxID>/...；
// 若不在 DataDir 下或 boxID 非合法 ID 模式，返回空串。
func ExtractBoxIDFromAssetsPath(absPath string) string {
	absPath = filepath.ToSlash(absPath)
	dataDir := filepath.ToSlash(util.DataDir)
	rel, err := filepath.Rel(dataDir, absPath)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	if strings.HasPrefix(rel, "..") || rel == "." || rel == "" {
		return ""
	}
	parts := strings.SplitN(rel, "/", 2)
	boxID := parts[0]
	if !ast.IsNodeIDPattern(boxID) {
		return ""
	}
	return boxID
}

// ExtractBoxIDFromHistoryPath 从历史目录下的绝对路径反推 boxID。
// 路径形如 <HistoryDir>/<timestamp>-<op>/<boxID>/...，切出紧跟在时间戳目录后的一段。
// 若路径不在 HistoryDir 下或 boxID 非合法 ID 模式，返回空串。
func ExtractBoxIDFromHistoryPath(absPath string) string {
	absPath = filepath.ToSlash(absPath)
	historyDir := filepath.ToSlash(util.HistoryDir)
	rel, err := filepath.Rel(historyDir, absPath)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	if strings.HasPrefix(rel, "..") || rel == "." || rel == "" {
		return ""
	}
	parts := strings.SplitN(rel, "/", 3)
	if len(parts) < 2 {
		return ""
	}
	// parts[0] = timestamp-op, parts[1] = boxID
	boxID := parts[1]
	if !ast.IsNodeIDPattern(boxID) {
		return ""
	}
	return boxID
}

// EncryptFile 用 fileKey（DEK 派生子密钥）加密 .sy 文档字节，AAD 绑定 boxID + 稳定文件基名（不含父目录）。
// relativePath 会先经 filesys.SyAAD 提取稳定文件基名（<rootID>.sy）并校验合法性，
// 与 filesys.encryptData/decryptData 共用同一 AAD 构造入口，保证加解密一致。
func EncryptFile(boxID, relativePath string, dek, plaintext []byte) ([]byte, error) {
	fileKey := util.DeriveSubKey(dek, "siyuan/file")
	aad, err := filesys.SyAAD(boxID, relativePath)
	if err != nil {
		return nil, err
	}
	return util.EncryptWithAAD(fileKey, plaintext, []byte(aad))
}

// DecryptFile 对应解密。
func DecryptFile(boxID, relativePath string, dek, ciphertext []byte) ([]byte, error) {
	fileKey := util.DeriveSubKey(dek, "siyuan/file")
	aad, err := filesys.SyAAD(boxID, relativePath)
	if err != nil {
		return nil, err
	}
	return util.DecryptWithAAD(fileKey, ciphertext, []byte(aad))
}

// EncryptAsset 生成单文件资源容器，名称元数据和内容分块分别认证加密。
func EncryptAsset(boxID, diskName, originalName string, dek, plaintext []byte) ([]byte, error) {
	originalName = filepath.Base(strings.TrimSpace(originalName))
	if originalName == "" || originalName == "." || strings.ContainsAny(originalName, `/\`) {
		originalName = diskName
	}
	chunkCount := uint64((len(plaintext) + encryptedAssetChunkSize - 1) / encryptedAssetChunkSize)
	if chunkCount == 0 {
		chunkCount = 1
	}
	metadata, err := json.Marshal(&encryptedAssetMetadata{
		OriginalName: originalName,
		Size:         int64(len(plaintext)),
		Chunks:       chunkCount,
	})
	if err != nil {
		return nil, err
	}
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	defer zeroAndClear(assetKey)
	aadPrefix := "siyuan:asset:" + boxID + ":assets/" + diskName
	encryptedMetadata, err := util.EncryptWithAAD(assetKey, metadata, []byte(aadPrefix+":metadata"))
	if err != nil {
		return nil, err
	}
	if len(encryptedMetadata) > encryptedAssetMetadataMaxSize {
		return nil, errors.New("encrypted asset metadata is too large")
	}
	ret := bytes.NewBuffer(make([]byte, 0, len(plaintext)+len(encryptedMetadata)+int(chunkCount)*64+12))
	ret.Write(encryptedAssetMagic)
	if err = binary.Write(ret, binary.BigEndian, uint32(len(encryptedMetadata))); err != nil {
		return nil, err
	}
	ret.Write(encryptedMetadata)
	for chunkIndex := uint64(0); chunkIndex < chunkCount; chunkIndex++ {
		start := int(chunkIndex) * encryptedAssetChunkSize
		end := start + encryptedAssetChunkSize
		if end > len(plaintext) {
			end = len(plaintext)
		}
		encryptedChunk, encryptErr := util.EncryptWithAAD(
			assetKey,
			plaintext[start:end],
			[]byte(fmt.Sprintf("%s:content:%d", aadPrefix, chunkIndex)),
		)
		if encryptErr != nil {
			return nil, encryptErr
		}
		if err = binary.Write(ret, binary.BigEndian, uint32(len(encryptedChunk))); err != nil {
			return nil, err
		}
		ret.Write(encryptedChunk)
	}
	if err = binary.Write(ret, binary.BigEndian, uint32(0)); err != nil {
		return nil, err
	}
	return ret.Bytes(), nil
}

func decryptAssetMetadata(boxID, diskName string, dek, ciphertext []byte) (metadata *encryptedAssetMetadata, contentOffset int, err error) {
	if len(ciphertext) < 8 || !bytes.Equal(ciphertext[:4], encryptedAssetMagic) {
		return nil, 0, errors.New("invalid encrypted asset format")
	}
	metadataSize := int(binary.BigEndian.Uint32(ciphertext[4:8]))
	if metadataSize < 1 || metadataSize > encryptedAssetMetadataMaxSize || 8+metadataSize+4 > len(ciphertext) {
		return nil, 0, errors.New("invalid encrypted asset metadata size")
	}
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	defer zeroAndClear(assetKey)
	aadPrefix := "siyuan:asset:" + boxID + ":assets/" + diskName
	plainMetadata, decryptErr := util.DecryptWithAAD(assetKey, ciphertext[8:8+metadataSize], []byte(aadPrefix+":metadata"))
	if decryptErr != nil {
		return nil, 0, decryptErr
	}
	metadata = &encryptedAssetMetadata{}
	if err = json.Unmarshal(plainMetadata, metadata); err != nil {
		return nil, 0, err
	}
	if metadata.OriginalName == "" || metadata.OriginalName == "." ||
		filepath.Base(metadata.OriginalName) != metadata.OriginalName || strings.ContainsAny(metadata.OriginalName, `/\`) {
		return nil, 0, errors.New("invalid encrypted asset original name")
	}
	if metadata.Size < 0 || metadata.Chunks == 0 {
		return nil, 0, errors.New("invalid encrypted asset content metadata")
	}
	return metadata, 8 + metadataSize, nil
}

// DecryptAssetWithName 解密资源内容并返回原始名称。
func DecryptAssetWithName(boxID, diskName string, dek, ciphertext []byte) (plaintext []byte, originalName string, err error) {
	var output bytes.Buffer
	originalName, err = DecryptAssetToWriter(boxID, diskName, dek, bytes.NewReader(ciphertext), &output)
	if err != nil {
		return nil, "", err
	}
	return output.Bytes(), originalName, nil
}

// DecryptAssetName 只解密资源的名称元数据，不处理资源内容。
func DecryptAssetName(boxID, diskName string, dek, ciphertext []byte) (originalName string, err error) {
	metadata, _, err := decryptAssetMetadata(boxID, diskName, dek, ciphertext)
	if err != nil {
		return "", err
	}
	return metadata.OriginalName, nil
}

// DecryptAssetNameFromReader 从资源头部解密名称元数据，不读取资源内容。
func DecryptAssetNameFromReader(boxID, diskName string, dek []byte, reader io.Reader) (originalName string, err error) {
	header := make([]byte, 8)
	if _, err = io.ReadFull(reader, header); err != nil {
		return "", err
	}
	if !bytes.Equal(header[:4], encryptedAssetMagic) {
		return "", errors.New("invalid encrypted asset format")
	}
	metadataSize := int(binary.BigEndian.Uint32(header[4:8]))
	if metadataSize < 1 || metadataSize > encryptedAssetMetadataMaxSize {
		return "", errors.New("invalid encrypted asset metadata size")
	}
	encryptedMetadata := make([]byte, metadataSize)
	if _, err = io.ReadFull(reader, encryptedMetadata); err != nil {
		return "", err
	}
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	defer zeroAndClear(assetKey)
	aadPrefix := "siyuan:asset:" + boxID + ":assets/" + diskName
	plainMetadata, decryptErr := util.DecryptWithAAD(assetKey, encryptedMetadata, []byte(aadPrefix+":metadata"))
	if decryptErr != nil {
		return "", decryptErr
	}
	metadata := &encryptedAssetMetadata{}
	if err = json.Unmarshal(plainMetadata, metadata); err != nil {
		return "", err
	}
	if metadata.OriginalName == "" || metadata.OriginalName == "." ||
		filepath.Base(metadata.OriginalName) != metadata.OriginalName || strings.ContainsAny(metadata.OriginalName, `/\`) {
		return "", errors.New("invalid encrypted asset original name")
	}
	if metadata.Size < 0 || metadata.Chunks == 0 {
		return "", errors.New("invalid encrypted asset content metadata")
	}
	return metadata.OriginalName, nil
}

// DecryptAssetToWriter 分块解密资源到 writer，避免大资源同时驻留密文和明文。
func DecryptAssetToWriter(boxID, diskName string, dek []byte, reader io.Reader, writer io.Writer) (originalName string, err error) {
	header := make([]byte, 8)
	if _, err = io.ReadFull(reader, header); err != nil {
		return "", err
	}
	if !bytes.Equal(header[:4], encryptedAssetMagic) {
		return "", errors.New("invalid encrypted asset format")
	}

	metadataSize := int(binary.BigEndian.Uint32(header[4:8]))
	if metadataSize < 1 || metadataSize > encryptedAssetMetadataMaxSize {
		return "", errors.New("invalid encrypted asset metadata size")
	}
	encryptedMetadata := make([]byte, metadataSize)
	if _, err = io.ReadFull(reader, encryptedMetadata); err != nil {
		return "", err
	}
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	defer zeroAndClear(assetKey)
	aadPrefix := "siyuan:asset:" + boxID + ":assets/" + diskName
	plainMetadata, decryptErr := util.DecryptWithAAD(assetKey, encryptedMetadata, []byte(aadPrefix+":metadata"))
	if decryptErr != nil {
		return "", decryptErr
	}
	metadata := &encryptedAssetMetadata{}
	if err = json.Unmarshal(plainMetadata, metadata); err != nil {
		return "", err
	}
	if metadata.OriginalName == "" || metadata.OriginalName == "." ||
		filepath.Base(metadata.OriginalName) != metadata.OriginalName || strings.ContainsAny(metadata.OriginalName, `/\`) {
		return "", errors.New("invalid encrypted asset original name")
	}
	if metadata.Size < 0 || metadata.Chunks == 0 {
		return "", errors.New("invalid encrypted asset content metadata")
	}

	var written int64
	for chunkIndex := uint64(0); chunkIndex < metadata.Chunks; chunkIndex++ {
		var encryptedSize uint32
		if err = binary.Read(reader, binary.BigEndian, &encryptedSize); err != nil {
			return "", err
		}
		if encryptedSize == 0 || encryptedSize > encryptedAssetChunkMaxCiphertextSize {
			return "", errors.New("invalid encrypted asset chunk size")
		}
		encryptedChunk := make([]byte, int(encryptedSize))
		if _, err = io.ReadFull(reader, encryptedChunk); err != nil {
			return "", err
		}
		plainChunk, chunkErr := util.DecryptWithAAD(
			assetKey,
			encryptedChunk,
			[]byte(fmt.Sprintf("%s:content:%d", aadPrefix, chunkIndex)),
		)
		if chunkErr != nil {
			return "", chunkErr
		}
		n, writeErr := writer.Write(plainChunk)
		written += int64(n)
		zeroAndClear(plainChunk)
		if writeErr != nil {
			return "", writeErr
		}
		if n != len(plainChunk) {
			return "", io.ErrShortWrite
		}
	}
	var terminator uint32
	if err = binary.Read(reader, binary.BigEndian, &terminator); err != nil {
		return "", err
	}
	if terminator != 0 || written != metadata.Size {
		return "", errors.New("invalid encrypted asset content length")
	}
	var trailing [1]byte
	if _, trailingErr := io.ReadFull(reader, trailing[:]); trailingErr != io.EOF {
		return "", errors.New("invalid trailing encrypted asset data")
	}
	return metadata.OriginalName, nil
}

// DecryptAsset 对应解密。
func DecryptAsset(boxID, diskName string, dek, ciphertext []byte) ([]byte, error) {
	plaintext, _, err := DecryptAssetWithName(boxID, diskName, dek, ciphertext)
	return plaintext, err
}

// notebookCryptoBackupPath 返回加密笔记本的独立 BoxCrypt 备份路径。
// 该文件在主 conf.json 丢失时用作"此笔记本是加密笔记本"的标识和降级恢复源。
// 与全局 NotebookCrypto 备份（<DataDir>/.siyuan/data-crypto-backup.json）配合使用，
// 全局备份存 MasterSalt/KEKVerifier，per-notebook 备份存 WrappedDEK/WrapNonce。
const notebookCryptoBackupFilename = "notebook-crypto-backup.json"

func notebookCryptoBackupPath(boxID string) string {
	return filepath.Join(util.DataDir, boxID, ".siyuan", notebookCryptoBackupFilename)
}

// writeNotebookCryptBackup 写入加密笔记本的 BoxCrypt 备份。
// 仅在 Encrypted=true 的笔记本上调用，配合 CreateEncryptedBox / ChangeMasterPassword 写入。
func writeNotebookCryptBackup(boxID string, crypt *conf.BoxEncryption) error {
	if !ast.IsNodeIDPattern(boxID) {
		return errors.New("invalid notebook ID")
	}
	if err := validateBoxEncryption(crypt); err != nil {
		return err
	}
	backupPath := notebookCryptoBackupPath(boxID)
	if err := os.MkdirAll(filepath.Dir(backupPath), 0755); err != nil {
		return fmt.Errorf("mkdir notebook crypt backup dir failed: %w", err)
	}
	data, err := gulu.JSON.MarshalIndentJSON(crypt, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal notebook crypt backup failed: %w", err)
	}
	if err := filelock.WriteFile(backupPath, data); err != nil {
		return fmt.Errorf("write notebook crypt backup failed: %w", err)
	}
	return nil
}

// readNotebookCryptBackup 读取加密笔记本的 BoxCrypt 备份。
// 备份文件不存在时返回 (nil, nil)，调用方据此区分"非加密笔记本"和"备份不存在"。
func readNotebookCryptBackup(boxID string) (*conf.BoxEncryption, error) {
	if !ast.IsNodeIDPattern(boxID) {
		return nil, errors.New("invalid notebook ID")
	}
	backupPath := notebookCryptoBackupPath(boxID)
	if !filelock.IsExist(backupPath) {
		return nil, nil
	}
	return readBoxEncryptionFile(backupPath)
}

func readBoxEncryptionFile(backupPath string) (*conf.BoxEncryption, error) {
	data, err := filelock.ReadFile(backupPath)
	if err != nil {
		return nil, fmt.Errorf("read notebook crypt backup failed: %w", err)
	}
	var crypt conf.BoxEncryption
	if err = gulu.JSON.UnmarshalJSON(data, &crypt); err != nil {
		return nil, fmt.Errorf("unmarshal notebook crypt backup failed: %w", err)
	}
	if err = validateBoxEncryption(&crypt); err != nil {
		return nil, err
	}
	return &crypt, nil
}

// copyAssetDecryptIfEncrypted 把 srcPath 的 asset 复制到 destPath。
// 若 srcPath 在已解锁的加密笔记本下，读密文→解密→写明文到 destPath（导出目录）；
// 否则走 filelock.Copy 原路径（字节级复制，密文/明文均可）。
func copyAssetDecryptIfEncrypted(srcPath, destPath string) error {
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return err
	}

	boxID := ExtractBoxIDFromAssetsPath(srcPath)
	if boxID != "" && IsEncryptedBox(boxID) {
		HoldBoxReadLock(boxID)
		defer ReleaseBoxReadLock(boxID)
		dek, err := GetDEKIfUnlocked(boxID)
		if err != nil {
			// 加密笔记本未解锁：fail-closed，拒绝复制（不复制密文，避免泄漏无效文件）
			return errors.New(Conf.Language(314))
		}
		raw, readErr := filelock.ReadFile(srcPath)
		if readErr != nil {
			return readErr
		}
		diskName := filepath.Base(srcPath)
		plain, decErr := DecryptAsset(boxID, diskName, dek, raw)
		if decErr != nil {
			return errors.New(Conf.Language(316))
		}
		if err := filelock.WriteFile(destPath, plain); err != nil {
			return err
		}
		return nil
	}
	return filelock.Copy(srcPath, destPath)
}

// CreateEncryptedBox 创建一个新的加密笔记本。可多次调用创建多个。
// 前置：加密功能已启用。创建时需要主密码（临时派生 KEK 用于 wrap DEK，用完即弃）。
// 创建后直接用生成的 DEK 打开加密 db 并缓存（已解锁状态），调用方随后调 openNotebook 即可挂载。
func CreateEncryptedBox(name, password string) (id string, err error) {
	return createEncryptedBox(name, password, EnsureBoxDoc)
}

func createEncryptedBox(name, password string, initializeBoxDoc func(string) (string, error)) (id string, err error) {
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	Conf.m.RLock()
	notebookCrypto := *Conf.NotebookCrypto
	Conf.m.RUnlock()
	if !notebookCrypto.Enabled || !notebookCryptoConfigurationComplete(&notebookCrypto) {
		return "", errors.New(Conf.Language(310))
	}

	kek, err := deriveKEK(password)
	if err != nil {
		return "", err
	}
	defer zeroAndClear(kek)

	id, err = createBox(name, false)
	if err != nil {
		return "", err
	}
	releaseTransition := holdEncryptedBoxTransition(id)
	defer releaseTransition()
	setEncryptedBoxState(id, EncryptedBoxStateUnlocking)

	// 若后续步骤失败，清理已创建的 box 目录和加密 db 文件，避免半创建状态
	createdBoxID := id
	defer func() {
		if err != nil {
			setEncryptedBoxState(createdBoxID, EncryptedBoxStateError)
			cleanupFailedEncryptedBox(createdBoxID)
			id = ""
		}
	}()

	enc, dek, err := WrapNewDEK(id, kek)
	if err != nil {
		return "", err
	}

	box := &Box{ID: id}
	boxConf := box.GetConf()
	boxConf.Encrypted = true
	boxConf.BoxCrypt = enc
	if err = encryptBoxMetadata(id, boxConf, dek); err != nil {
		return "", fmt.Errorf("encrypt notebook metadata failed: %w", err)
	}
	if err = box.SaveConf(boxConf); err != nil {
		return "", fmt.Errorf("save encrypted notebook conf failed: %w", err)
	}
	if err = writeNotebookCryptBackup(id, enc); err != nil {
		return "", fmt.Errorf("write notebook crypt backup failed: %w", err)
	}
	// 回读校验加密配置已落盘，避免写失败后按普通笔记本处理
	verifyConf := box.GetConf()
	if verifyConf == nil || !verifyConf.Encrypted || verifyConf.BoxCrypt == nil {
		err = errors.New("encrypted notebook metadata verification failed after write")
		return "", err
	}
	markRuntimeEncryptedBox(id)
	invalidateEncryptedPublishAccessCache()

	// 复用刚派生的 DEK 直接开 db + 缓存，省去再次 Argon2id 解锁
	cachedDEKsLock.Lock()
	if err = sql.OpenEncryptedDB(id, dek); err != nil {
		cachedDEKsLock.Unlock()
		return "", err
	}
	if err = treenode.OpenEncryptedBlockTreeDB(id, dek); err != nil {
		sql.CloseEncryptedDB(id)
		cachedDEKsLock.Unlock()
		return "", err
	}
	cachedDEKs[id] = dek
	cachedDEKsLock.Unlock()

	// DEK 和加密数据库就绪后允许内部初始化读取密钥，但在笔记本文档创建完成前不接纳外部请求。
	newVal := &atomic.Int64{}
	newVal.Store(time.Now().UnixNano())
	boxLastAccess.Store(id, newVal)
	setEncryptedBoxStateWithAdmission(id, EncryptedBoxStateUnlocked, false)

	if _, err = initializeBoxDoc(id); err != nil {
		return "", fmt.Errorf("initialize encrypted notebook document failed: %w", err)
	}

	setEncryptedBoxState(id, EncryptedBoxStateUnlocked)
	IncSync()
	return id, nil
}

// cleanupFailedEncryptedBox 清理创建失败的加密笔记本，清理目标必须是 DataDir 下的有效笔记本目录。
func cleanupFailedEncryptedBox(boxID string) {
	if !ast.IsNodeIDPattern(boxID) {
		logging.LogErrorf("refuse to cleanup failed encrypted box with invalid ID [%s]", boxID)
		return
	}

	dataDir := filepath.Clean(util.DataDir)
	boxDir := filepath.Clean(filepath.Join(dataDir, boxID))
	if boxDir == dataDir || filepath.Dir(boxDir) != dataDir {
		logging.LogErrorf("refuse to cleanup failed encrypted box outside data directory [%s]", boxDir)
		return
	}

	// 创建失败路径不经过常规锁定流程，防御性清理可能生成的明文 HEIF 预览缓存。
	heif.ClearMemoryCache(boxID)
	cachedDEKsLock.Lock()
	if cachedDEK, ok := cachedDEKs[boxID]; ok {
		zeroAndClear(cachedDEK)
		delete(cachedDEKs, boxID)
	}
	cachedDEKsLock.Unlock()
	mountedEncryptedBoxes.Delete(boxID)
	boxLastAccess.Delete(boxID)
	sql.RemoveEncryptedDBFile(boxID)
	treenode.RemoveEncryptedBlockTreeDBFile(boxID)
	removeEncryptedBoxLifecycle(boxID)
	forgetRuntimeEncryptedBox(boxID)
	removeMasterPasswordMigrationBox(boxID)
	if err := filelock.Remove(boxDir); err != nil {
		logging.LogErrorf("cleanup failed encrypted box [%s]: %s", boxID, err)
	}
}

// finalizeSyncedEncryptedBoxRemoval 在同步删除身份文件后等待在途操作结束，再清除本机密钥、挂载和索引生命周期。
func finalizeSyncedEncryptedBoxRemoval(boxID string) {
	if !ast.IsNodeIDPattern(boxID) {
		return
	}
	LockBox(boxID)
	removeMasterPasswordMigrationBox(boxID)
	removeEncryptedBoxLifecycle(boxID)
	forgetRuntimeEncryptedBox(boxID)
	invalidateEncryptedPublishAccessCache()
}

// zeroAndClear 把密钥字节清零后再置空，尽量减少密钥在内存中的残留时间。
func zeroAndClear(key []byte) {
	for i := range key {
		key[i] = 0
	}
}

// TouchUnlockedEncryptedBoxes 由真实用户交互或 headless 客户端的显式保活调用，刷新当前已解锁笔记本的闲置计时。
func TouchUnlockedEncryptedBoxes() {
	now := time.Now().UnixNano()
	cachedDEKsLock.RLock()
	boxIDs := make([]string, 0, len(cachedDEKs))
	for boxID := range cachedDEKs {
		boxIDs = append(boxIDs, boxID)
	}
	cachedDEKsLock.RUnlock()
	for _, boxID := range boxIDs {
		if val, ok := boxLastAccess.Load(boxID); ok {
			val.(*atomic.Int64).Store(now)
		}
	}
}

// AutoLockIdleEncryptedBoxesJob 检查所有已解锁的加密 notebook，将闲置超时的自动锁定。
// 由 cron 每分钟调用。阈值由 NotebookCrypto.AutoLockMinutes 控制（0 = 禁用）。
func AutoLockIdleEncryptedBoxesJob() {
	Conf.m.RLock()
	threshold := Conf.NotebookCrypto.AutoLockMinutes
	Conf.m.RUnlock()
	if threshold <= 0 {
		return
	}

	now := time.Now().UnixNano()
	thresholdNs := int64(time.Duration(threshold) * time.Minute)

	cachedDEKsLock.RLock()
	boxIDs := make([]string, 0, len(cachedDEKs))
	for id := range cachedDEKs {
		boxIDs = append(boxIDs, id)
	}
	cachedDEKsLock.RUnlock()

	for _, boxID := range boxIDs {
		if val, ok := boxLastAccess.Load(boxID); ok {
			lastAccess := val.(*atomic.Int64).Load()
			elapsed := now - lastAccess
			if elapsed >= thresholdNs {
				logging.LogInfof("auto-locking idle encrypted notebook [%s] (elapsed=%ds, threshold=%dm)", boxID, elapsed/1e9, threshold)
				// 先取笔记本名称再 Unmount：Unmount 会关闭笔记本，之后 Conf.Box 返回 nil 导致提示显示 boxID
				boxName := boxID
				if box := Conf.Box(boxID); nil != box {
					boxName = box.Name
				}
				Unmount(boxID)
				// 自动锁定会关闭正在编辑的文档，推一条提示避免用户以为崩溃
				util.PushMsg(fmt.Sprintf(Conf.Language(322), boxName), 0)
			}
		}
	}
}

// SetAutoLockMinutes 设置加密笔记本自动锁定闲置分钟数。0 表示禁用。
func SetAutoLockMinutes(minutes int) {
	if minutes < 0 {
		minutes = 0
	}
	Conf.m.Lock()
	Conf.NotebookCrypto.AutoLockMinutes = minutes
	Conf.m.Unlock()
}
