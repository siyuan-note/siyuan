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
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
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
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// kekVerifierMagic 是写入 KEKVerifier 的固定魔数。启用时用 KEK 加密它，校验主密码时解密比对。
var kekVerifierMagic = []byte("siyuan-enc-v1")

const boxEncryptionSpec = 1

// errMasterPasswordMigrationPending 表示改密已切换全局 verifier，但部分笔记本配置尚待恢复。
var errMasterPasswordMigrationPending = errors.New("master password migration is pending")

// notebookCryptoMu 串行化加密笔记本的控制面操作（Enable/Disable/Create/ChangeMasterPassword/Import/restore 等），
// 避免 ChangeMasterPassword 枚举与 CreateEncryptedBox 并发导致新笔记本用旧 KEK 但 verifier 已切换的不可恢复状态。
var notebookCryptoMu sync.Mutex

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

// notebookCryptoBackupPath 是 NotebookCrypto 的备份路径，位于 DataDir/.siyuan/ 下（进入 dejavu 同步范围）。
// MasterSalt 是加密体系的全局根基：conf/conf.json 丢失后若重新启用会生成新 salt，
// 导致旧 WrappedDEK 无法用相同主密码解开（KEK 随 salt 改变）。把整套 NotebookCrypto 备份到
// 同步目录，conf.json 丢失时通过同步恢复或本地备份即可重新解锁已有加密笔记本。
// MasterSalt/KEKVerifier 设计为可明文（salt 不保密，verifier 是密文），备份文件按明文 JSON 存储。
func notebookCryptoBackupPath() string {
	return filepath.Join(util.DataDir, ".siyuan", "notebook-crypto-backup.json")
}

// computeBackupChecksum 计算 NotebookCrypto 备份的 SHA-256 校验和。
func computeBackupChecksum(nc *conf.NotebookCrypto) string {
	tmp := *nc
	tmp.Checksum = ""
	tmp.KEKMAC = nil
	data, _ := json.Marshal(tmp)
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// computeKEKMAC 用 KEK 计算备份的 HMAC-SHA256 认证码。
func computeKEKMAC(nc *conf.NotebookCrypto, kek []byte) []byte {
	tmp := *nc
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

	backupPath := notebookCryptoBackupPath()
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
// 校验为合法 NotebookCrypto 后写回 <DataDir>/.siyuan/notebook-crypto-backup.json 并装回本机 Conf。
// 用于新设备/重装后不依赖同步、手动恢复加密配置（详见设计文档 §4.1）。
// 安全：备份文件不含主密码（salt 不保密、verifier 是密文），导入只恢复配置，解锁仍需主密码。
// 防呆：本机已启用加密笔记本时拒绝导入，避免覆盖现有 salt/verifier 孤立现有 WrappedDEK。
// ImportNotebookCryptoBackup 接收用户导入的密钥备份文件内容（JSON 字节）+ 主密码，
// 校验主密码能解开备份里的 verifier 后才写回配置。防止 crafted 备份设置弱 KDFParams 等攻击。
// 本机已启用时拒绝（详见设计 §4.1）：导入会用导入备份的 MasterSalt/KEKVerifier 覆盖当前配置，
// 若有现存加密笔记本其 WrappedDEK 将被新 KEK 孤立（数据锁死）；即使无现存笔记本也拒绝，
// 避免覆盖后旧主密码失效造成用户困惑。换密钥材料应走“先禁用再导入”。
func ImportNotebookCryptoBackup(data []byte, password string) error {
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	// 已启用即拒绝（对齐设计 §4.1，与 api handler 注释一致）
	Conf.m.RLock()
	enabled := Conf.NotebookCrypto.Enabled
	Conf.m.RUnlock()
	if enabled {
		return errors.New(Conf.Language(324))
	}

	// 历史目录中存在已删除加密笔记本的历史时拒绝导入：导入会用新 MasterSalt 覆盖当前配置，
	// 这些历史的恢复仍依赖原 MasterSalt，覆盖后永久锁死（与 EnableEncryptedNotebook 的对称守卫一致）
	hasHistory, historyErr := scanEncryptedNotebookHistory()
	if historyErr != nil {
		return fmt.Errorf("check encrypted notebook history failed: %w", historyErr)
	}
	if hasHistory {
		return errors.New(Conf.Language(323))
	}

	nc := &conf.NotebookCrypto{}
	if err := json.Unmarshal(data, nc); err != nil {
		return errors.New(Conf.Language(317))
	}
	if len(nc.MasterSalt) == 0 || len(nc.KEKVerifier) == 0 {
		return errors.New(Conf.Language(317))
	}

	// 用导入的 salt + 用户输入的主密码派生 KEK，校验能否解开备份里的 verifier
	params, validErr := util.ValidateArgon2Params(nc.KDFParams)
	if validErr != nil {
		return errors.New(Conf.Language(317))
	}
	if nc.Spec != conf.CurrentNotebookCryptoSpec || nc.Checksum == "" || len(nc.KEKMAC) == 0 {
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
	decrypted, dErr := util.DecryptWithAAD(kek, nc.KEKVerifier, []byte("siyuan:v1:kek-verifier"))
	if dErr != nil || string(decrypted) != string(kekVerifierMagic) {
		return errors.New(Conf.Language(311)) // 主密码错误
	}

	// 若已有加密笔记本，校验 KEK 能解密其 WrappedDEK（防止导入 salt 不同的旧备份导致现有数据锁死）
	if !verifyKEKAgainstExistingBoxes(kek) {
		return errors.New(Conf.Language(316)) // 密钥不匹配
	}

	nc.KDFParams = params // 归一化：确保写回 Conf 的是校验后的参数（含默认值回退）
	nc.Enabled = true

	// 先写 backup，再提交 conf；backup 失败时 conf 尚未改变，可重试
	if err := writeNotebookCryptoBackupData(nc, kek); err != nil {
		return fmt.Errorf("failed to persist key backup: %w", err)
	}
	Conf.m.Lock()
	*Conf.NotebookCrypto = *nc
	Conf.m.Unlock()
	Conf.Save()
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
	Conf.NotebookCrypto.Spec = nc.Spec
	Conf.NotebookCrypto.BackupID = nc.BackupID
	Conf.NotebookCrypto.CreatedAt = nc.CreatedAt
	Conf.NotebookCrypto.Checksum = nc.Checksum
	Conf.NotebookCrypto.KEKMAC = nc.KEKMAC // 保持 Conf 与备份文件的 KEKMAC 一致
	Conf.m.Unlock()
	backupPath := notebookCryptoBackupPath()
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
	backupPath := notebookCryptoBackupPath()
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
	data, err := filelock.ReadFile(notebookCryptoBackupPath())
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
	conf.UpgradeSpec(nc)
	if nc.Spec != conf.CurrentNotebookCryptoSpec {
		return nil, fmt.Errorf("unsupported notebook crypto backup spec [%d]", nc.Spec)
	}
	if nc.Checksum == "" {
		return nil, errors.New("notebook crypto backup checksum is missing")
	}
	expected := computeBackupChecksum(nc)
	if nc.Checksum != expected {
		logging.LogWarnf("notebook crypto backup checksum mismatch: expected %s, got %s", expected, nc.Checksum)
		return nil, errors.New("notebook crypto backup is corrupted (checksum mismatch)")
	}
	return nc, nil
}

// removeNotebookCryptoBackup 删除备份文件（禁用加密功能时调用）。文件不存在视为成功。
func removeNotebookCryptoBackup() {
	if err := os.Remove(notebookCryptoBackupPath()); err != nil && !os.IsNotExist(err) {
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
}

func masterPasswordMigrationPath() string {
	return filepath.Join(util.DataDir, ".siyuan", "master-password-migration.json")
}

func writeMasterPasswordMigration(m *masterPasswordMigration) error {
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
	p := masterPasswordMigrationPath()
	if err := filelock.Remove(p); err != nil && !os.IsNotExist(err) {
		logging.LogErrorf("remove master password migration failed: %s", err)
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
						CreatedAt:  time.Now().UnixMilli(),
					}
					if saveErr := box.SaveConf(boxConf); saveErr != nil {
						logging.LogErrorf("rebuild encrypted conf from manifest [%s] failed: %s", entry.BoxID, saveErr)
						return // 保留 manifest
					}
				}
			}
			// 若 WrappedDEK 已匹配则跳过写 conf，但仍需确保 per-notebook backup 是最新的
			if bytes.Equal(boxConf.BoxCrypt.WrappedDEK, entry.NewWrappedDEK) {
				if writeErr := writeNotebookCryptBackup(entry.BoxID, boxConf.BoxCrypt); writeErr != nil {
					logging.LogErrorf("refresh box crypt backup [%s] failed: %s", entry.BoxID, writeErr)
					return // 保留 manifest
				}
				continue
			}
			boxConf.BoxCrypt.WrappedDEK = entry.NewWrappedDEK
			boxConf.BoxCrypt.Spec = entry.NewSpec
			boxConf.BoxCrypt.WrapNonce = entry.NewWrapNonce
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
// 笔记本删除后其 box 目录（含 .siyuan/conf.json 和 notebook-crypt-backup.json）会被
// 原样密文备份到历史目录（RemoveBox 的 filelock.Copy），但此时 IsEncryptedBox 已返回 false
// （box 目录已删）。因此 DisableEncryptedNotebook 不能只靠 ListAllEncryptedBoxIDs 判定——
// 已删除加密笔记本的历史仍依赖当前 MasterSalt/KEKVerifier 才能恢复，禁用并删除备份会让这些
// 历史永久锁死，违反设计 §19。本函数扫描历史目录识别这类依赖。
//
// 判定信号：历史条目 <HistoryDir>/<ts>-<op>/<boxID>/.siyuan/ 下存在
// notebook-crypt-backup.json（专为 box 删除后的恢复设计），或 conf.json 标记 Encrypted=true。
// boxID 用 ast.IsNodeIDPattern 校验，避免误判 assets/storage 等非 box 目录。
func scanEncryptedNotebookHistory() (bool, error) {
	entries, err := os.ReadDir(util.HistoryDir)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("read history dir failed: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		// 历史快照目录：<ts>-<op>，其下是各 boxID 子目录
		snapshotDir := filepath.Join(util.HistoryDir, entry.Name())
		boxEntries, readErr := os.ReadDir(snapshotDir)
		if readErr != nil {
			return false, fmt.Errorf("read history snapshot [%s] failed: %w", entry.Name(), readErr)
		}
		for _, boxEntry := range boxEntries {
			if !boxEntry.IsDir() || !ast.IsNodeIDPattern(boxEntry.Name()) {
				continue
			}
			encrypted, checkErr := isEncryptedHistoryBoxDir(filepath.Join(snapshotDir, boxEntry.Name()))
			if checkErr != nil {
				return false, checkErr
			}
			if encrypted {
				return true, nil
			}
		}
	}
	return false, nil
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
// 优先看 notebook-crypt-backup.json（删除前随 box 目录整体备份，是加密身份的权威标识），
// 再 fallback 到 conf.json 的 Encrypted 标志。
func isEncryptedHistoryBoxDir(boxDir string) (bool, error) {
	siyuanDir := filepath.Join(boxDir, ".siyuan")
	backupPath := filepath.Join(siyuanDir, "notebook-crypt-backup.json")
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

// EnableEncryptedNotebook 启用加密笔记本功能：生成 MasterSalt、派生 KEK、写入校验值并持久化。
// 重复调用（已启用）返回错误，避免覆盖现有加密笔记本的密钥参数。
// KEK 不缓存——启用后用户需对每个加密笔记本单独调 UnlockBox 解锁。
func EnableEncryptedNotebook(password string) error {
	if len(password) == 0 {
		return errors.New("password must not be empty")
	}

	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	Conf.m.Lock()
	if Conf.NotebookCrypto.Enabled {
		Conf.m.Unlock()
		return errors.New(Conf.Language(312))
	}
	Conf.m.Unlock()

	// 防呆：若已存在加密笔记本（磁盘上有 Encrypted=true 的 box），不能重新生成 MasterSalt。
	// conf.json 丢失后重新启用会派生新 KEK，导致旧 WrappedDEK 用相同主密码也无法解开（数据永久锁死）。
	// 此时必须从 DataDir 备份恢复原 MasterSalt/KEKVerifier，并用主密码校验通过后才算恢复成功。
	hasEncrypted, listErr := hasEncryptedNotebook()
	if listErr != nil {
		return fmt.Errorf("list encrypted notebooks failed: %w", listErr)
	}
	if hasEncrypted {
		if _, restoreErr := tryRestoreNotebookCryptoFromBackupLocked(password); restoreErr != nil {
			// 恢复失败：主密码错（恢复函数返回 311 文案）保持原提示；其余（备份缺失/损坏）提示需恢复备份
			if strings.Contains(restoreErr.Error(), Conf.Language(311)) {
				return errors.New(Conf.Language(311)) // 主密码错误
			}
			return errors.New(Conf.Language(315))
		}
		logging.LogInfof("encrypted notebook re-enabled with restored master key material from backup")
		return nil
	}

	// 防呆：历史目录中存在已删除加密笔记本的历史快照时，禁止重新生成 MasterSalt。
	// 这些历史的恢复仍依赖原 MasterSalt/KEKVerifier，生成新 salt 会让其永久锁死（违反设计 §4.1
	// “内核可枚举的加密恢复数据存在时禁止重新生成 MasterSalt”）。此时应先恢复全局密钥备份或清除历史。
	hasHistory, historyErr := scanEncryptedNotebookHistory()
	if historyErr != nil {
		return fmt.Errorf("check encrypted notebook history failed: %w", historyErr)
	}
	if hasHistory {
		return errors.New(Conf.Language(323))
	}

	// 不存在加密笔记本且无历史依赖：正常生成新 MasterSalt
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
	verifierCT, err := util.EncryptWithAAD(kek, kekVerifierMagic, []byte("siyuan:v1:kek-verifier"))
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
	backup, bErr := loadNotebookCryptoBackup()
	if bErr != nil || backup == nil || len(backup.MasterSalt) == 0 || len(backup.KEKVerifier) == 0 {
		// 备份不存在或不完整：无法恢复，调用方按"未启用"报错
		return nil, errors.New(Conf.Language(310))
	}
	params, validErr := util.ValidateArgon2Params(backup.KDFParams)
	if validErr != nil {
		return nil, errors.New(Conf.Language(317))
	}
	kek = util.DeriveKey(password, backup.MasterSalt, params)
	decrypted, dErr := util.DecryptWithAAD(kek, backup.KEKVerifier, []byte("siyuan:v1:kek-verifier"))
	if dErr != nil || string(decrypted) != string(kekVerifierMagic) {
		// 主密码错误（或备份损坏），不能恢复
		zeroAndClear(kek)
		return nil, errors.New(Conf.Language(311))
	}
	// 当前格式的备份必须携带有效 KEKMAC；缺失与不匹配都按篡改处理。
	if backup.Spec != conf.CurrentNotebookCryptoSpec || backup.Checksum == "" ||
		len(backup.KEKMAC) == 0 || !verifyKEKMAC(backup, kek) {
		zeroAndClear(kek)
		return nil, errors.New(Conf.Language(316))
	}

	// 若有加密笔记本，校验 KEK 能解密其 WrappedDEK（防止 salt 不匹配的备份导致数据锁死）
	if !verifyKEKAgainstExistingBoxes(kek) {
		zeroAndClear(kek)
		return nil, errors.New(Conf.Language(316)) // 密钥不匹配
	}

	backup.KDFParams = params // 归一化：确保写回 Conf 的是校验后的参数（含默认值回退）
	backup.Enabled = true
	Conf.m.Lock()
	*Conf.NotebookCrypto = *backup
	Conf.m.Unlock()
	Conf.Save()
	// 恢复成功后同步重写备份（补全 KEKMAC，升级旧备份为 Spec=1）。
	// 调用方已持有 notebookCryptoMu，且 writeNotebookCryptoBackupData 不再申请该锁，故无死锁；
	// 同步写避免与 ChangeMasterPassword 的并发备份写竞争同一文件（lost update 导致 verifier 被回退）。
	nc := *backup
	if err := writeNotebookCryptoBackupData(&nc, kek); err != nil {
		logging.LogWarnf("rewrite notebook crypto backup after restore failed: %s", err)
	}
	logging.LogInfof("notebook crypto restored from backup (e.g. after sync to a new device)")
	return kek, nil
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

	decrypted, err := util.DecryptWithAAD(kek, nc.KEKVerifier, []byte("siyuan:v1:kek-verifier"))
	if err != nil {
		zeroAndClear(kek)
		return nil, errors.New(Conf.Language(311))
	}
	if string(decrypted) != string(kekVerifierMagic) {
		zeroAndClear(kek)
		return nil, errors.New(Conf.Language(311))
	}

	// 正常配置必须通过 KEKMAC 认证，不能把“MAC 缺失”当作兼容路径，否则同步端攻击者可删除 MAC、
	// 重算无密钥 Checksum 后篡改 AutoLockMinutes 等安全配置。
	mig, migErr := readMasterPasswordMigration()
	migrationPending := migErr == nil && mig != nil && bytes.Equal(nc.KEKVerifier, mig.NewVerifier)
	if !migrationPending {
		backup, backupErr := loadNotebookCryptoBackup()
		backupMatchesConf := backupErr == nil && backup != nil &&
			bytes.Equal(backup.MasterSalt, nc.MasterSalt) &&
			bytes.Equal(backup.KEKVerifier, nc.KEKVerifier) &&
			backup.KDFParams == nc.KDFParams
		if !backupMatchesConf || backup.Spec != conf.CurrentNotebookCryptoSpec || backup.Checksum == "" ||
			len(backup.KEKMAC) == 0 || !verifyKEKMAC(backup, kek) {
			// 主密码已通过本地 verifier 验证（走到这里说明 kek 正确），但备份缺失或 KEKMAC 无效：
			// 属配置不完整而非密码错或密钥损坏，引导用户导入匹配的备份文件恢复（Language 315）。
			zeroAndClear(kek)
			return nil, errors.New(Conf.Language(315))
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
func UnlockBox(boxID string, password string, boxEnc *conf.BoxEncryption) error {
	if boxEnc == nil || len(boxEnc.WrappedDEK) == 0 {
		return errors.New("no encrypted key material for box")
	}

	// 全局配置锁先于笔记本生命周期锁获取（设计 §17 锁顺序约定），避免与持子系统锁后回取配置锁的路径死锁。
	// notebookCryptoMu 持锁期间调用的 deriveKEK/conf 修复只申请 Conf.m/cachedDEKsLock，不回取 box 生命周期锁。
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	// 获取 box 写锁，与 LockBox/unmount0 串行化，防止并发锁/解锁导致 db/DEK 状态不一致
	acquireBoxWriteLock(boxID)
	defer releaseBoxWriteLock(boxID)

	kek, err := deriveKEK(password)
	if err != nil {
		return err
	}
	defer zeroAndClear(kek)

	// 用 decryptBoxCrypt 统一处理解密 + backup fallback + conf 修复
	dek, trustedCrypt, err := decryptBoxCrypt(boxID, kek)
	if err != nil {
		return errors.New(Conf.Language(316))
	}
	boxEnc = trustedCrypt

	// 持锁保护"开 db + 缓存 DEK"的原子性，避免与并发的 LockBox 导致 db/DEK 不一致
	cachedDEKsLock.Lock()
	defer cachedDEKsLock.Unlock()
	if err = sql.OpenEncryptedDB(boxID, dek); err != nil {
		return err
	}
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		sql.RemoveEncryptedDBFile(boxID) // 清理已创建的 content db 文件，避免遗留空加密库
		return err
	}
	cachedDEKs[boxID] = dek

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
	return nil
}

// IsBoxUnlocked 返回该笔记本的 DEK 是否在内存（是否已解锁）。
func IsBoxUnlocked(boxID string) bool {
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	_, ok := cachedDEKs[boxID]
	return ok
}

// LockBox 清除指定笔记本的 DEK 并删除其加密 db 文件。Unmount 单个加密笔记本或手动锁定时调用。
func LockBox(boxID string) {
	FlushTxQueue()
	acquireBoxWriteLock(boxID)
	lockBoxHeld(boxID)
	releaseBoxWriteLock(boxID)
	// 单 box 锁定后需要刷新全局缓存（树/Block/IAL/AV）
	cache.ClearTreeCache()
	sql.ClearCache()
	cache.ClearDocsIAL()
	cache.ClearBlocksIAL()
	cache.ClearAVCache()
	ResetVirtualBlockRefCache()
}

// lockBoxHeld 在已持有 box 写锁的前提下执行该 box 的锁定清理（不含全局缓存刷新）。
func lockBoxHeld(boxID string) {
	RevokeManagedEncryptedExportsForBox(boxID)

	cachedDEKsLock.Lock()
	if dek, ok := cachedDEKs[boxID]; ok {
		zeroAndClear(dek)
		delete(cachedDEKs, boxID)
	}
	cachedDEKsLock.Unlock()

	// 清理自动锁定访问时间戳
	boxLastAccess.Delete(boxID)

	// 仅在 backup 缺失时从 conf 补写。正常流程中 CreateEncryptedBox/UnlockBox/ChangeMasterPassword
	// 已刷新 backup，此处不再用未经解密验证的 BoxCrypt 覆盖已有 backup，
	// 避免 conf 中的坏 WrappedDEK 覆盖有效恢复源。
	if !filelock.IsExist(notebookCryptBackupPath(boxID)) {
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
	return []byte("siyuan:v1:wrapped-dek:" + boxID)
}

func decryptWrappedDEK(boxID string, enc *conf.BoxEncryption, kek []byte) ([]byte, error) {
	if enc.Spec >= boxEncryptionSpec {
		return util.DecryptWithAAD(kek, enc.WrappedDEK, wrappedDEKAAD(boxID))
	}
	return util.DecryptWithAAD(kek, enc.WrappedDEK, wrappedDEKAAD(boxID))
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
	newVerifier, err := util.EncryptWithAAD(newKEK, kekVerifierMagic, []byte("siyuan:v1:kek-verifier"))
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
		dek, _, dErr := decryptBoxCrypt(id, oldKEK)
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
	return nil
}

// IsEncryptedBox 判断给定 boxID 是否为加密笔记本。
// 优先读 conf.json，若缺失/损坏则 fallback 到独立备份，避免 fail-open。
func IsEncryptedBox(boxID string) bool {
	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	if boxConf != nil && boxConf.Encrypted {
		return true
	}
	// 主 conf 缺失/损坏时检查独立备份，确认是否为加密笔记本
	backupPath := notebookCryptBackupPath(boxID)
	if !filelock.IsExist(backupPath) {
		return false // 无备份文件 → 非加密
	}
	backup, err := readNotebookCryptBackup(boxID)
	if err != nil {
		logging.LogWarnf("failed to read notebook crypt backup for [%s]: %s", boxID, err)
		return true // 备份存在但不可读 → fail-closed
	}
	return backup != nil && len(backup.WrappedDEK) > 0
}

// GetBoxEncryption 获取加密笔记本的 BoxEncryption（含 WrappedDEK）。
// 优先读 conf.json，若缺失/损坏则 fallback 到 per-notebook backup。
// 返回 nil 表示该 box 非加密；conf 标记加密但密钥材料缺失时返回明确错误。
func GetBoxEncryption(boxID string) (*conf.BoxEncryption, error) {
	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	confMarkedEncrypted := boxConf != nil && boxConf.Encrypted

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
		return backup, nil
	}

	// backup 也不可用
	if confMarkedEncrypted {
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
		CreatedAt:  src.CreatedAt,
	}
}

// ListAllEncryptedBoxIDs 扫描 data 目录下所有含 notebook-crypt-backup.json 的 box 目录，
// 补全 ListNotebooks 可能遗漏的 conf 损坏加密笔记本。供改密/禁用/检测等关键路径使用。
// 统一使用 IsEncryptedBox 作为"是否加密"的唯一判定入口。
func listAllEncryptedBoxIDs() ([]string, error) {
	var ids []string
	seen := map[string]bool{}

	// Pass 1: ListNotebooks 已返回的
	boxes, err := ListNotebooks()
	if err != nil {
		return nil, err
	}
	for _, b := range boxes {
		seen[b.ID] = true
		if IsEncryptedBox(b.ID) {
			ids = append(ids, b.ID)
		}
	}
	// Pass 2: 扫描 backup 文件，补充 ListNotebooks 遗漏的
	dirs, err := os.ReadDir(util.DataDir)
	if err != nil {
		return nil, err
	}
	for _, dir := range dirs {
		if !dir.IsDir() || !ast.IsNodeIDPattern(dir.Name()) || seen[dir.Name()] {
			continue
		}
		if IsEncryptedBox(dir.Name()) {
			ids = append(ids, dir.Name())
		}
	}
	return ids, nil
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
	if !IsEncryptedBox(boxID) {
		return nil, nil
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
	acquireBoxReadLock(boxID)
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

// EncryptAsset 用 assetKey（DEK 派生子密钥）加密 asset 字节，AAD 绑定 boxID + 磁盘文件名。
// diskName 为磁盘上的脱敏文件名（加密 box）或原始文件名（普通 box）。
func EncryptAsset(boxID, diskName string, dek, plaintext []byte) ([]byte, error) {
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	aad := "siyuan:v1:asset:" + boxID + ":assets/" + diskName
	return util.EncryptWithAAD(assetKey, plaintext, []byte(aad))
}

// DecryptAsset 对应解密。
func DecryptAsset(boxID, diskName string, dek, ciphertext []byte) ([]byte, error) {
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	aad := "siyuan:v1:asset:" + boxID + ":assets/" + diskName
	return util.DecryptWithAAD(assetKey, ciphertext, []byte(aad))
}

func EncryptAssetNameMapping(boxID string, dek, plaintext []byte) ([]byte, error) {
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	aad := "siyuan:v1:asset-names:" + boxID
	return util.EncryptWithAAD(assetKey, plaintext, []byte(aad))
}

func DecryptAssetNameMapping(boxID string, dek, ciphertext []byte) ([]byte, error) {
	assetKey := util.DeriveSubKey(dek, "siyuan/asset")
	aad := "siyuan:v1:asset-names:" + boxID
	return util.DecryptWithAAD(assetKey, ciphertext, []byte(aad))
}

// notebookCryptBackupPath 返回加密笔记本的独立 BoxCrypt 备份路径。
// 该文件在主 conf.json 丢失时用作"此笔记本是加密笔记本"的标识和降级恢复源。
// 与全局 NotebookCrypto 备份（<DataDir>/.siyuan/notebook-crypto-backup.json）配合使用，
// 全局备份存 MasterSalt/KEKVerifier，per-notebook 备份存 WrappedDEK/WrapNonce。
func notebookCryptBackupPath(boxID string) string {
	return filepath.Join(util.DataDir, boxID, ".siyuan", "notebook-crypt-backup.json")
}

// writeNotebookCryptBackup 写入加密笔记本的 BoxCrypt 备份。
// 仅在 Encrypted=true 的笔记本上调用，配合 CreateEncryptedBox / ChangeMasterPassword 写入。
func writeNotebookCryptBackup(boxID string, crypt *conf.BoxEncryption) error {
	backupPath := notebookCryptBackupPath(boxID)
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
	backupPath := notebookCryptBackupPath(boxID)
	if !filelock.IsExist(backupPath) {
		return nil, nil
	}
	data, err := filelock.ReadFile(backupPath)
	if err != nil {
		return nil, fmt.Errorf("read notebook crypt backup failed: %w", err)
	}
	var crypt conf.BoxEncryption
	if err = gulu.JSON.UnmarshalJSON(data, &crypt); err != nil {
		return nil, fmt.Errorf("unmarshal notebook crypt backup failed: %w", err)
	}
	return &crypt, nil
}

// copyAssetDecryptIfEncrypted 把 srcPath 的 asset 复制到 destPath。
// 若 srcPath 在已解锁的加密笔记本下，读密文→解密→写明文到 destPath（导出目录）；
// 否则走 filelock.Copy 原路径（字节级复制，密文/明文均可）。
func copyAssetDecryptIfEncrypted(srcPath, destPath string) error {
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
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()

	Conf.m.RLock()
	enabled := Conf.NotebookCrypto.Enabled
	Conf.m.RUnlock()
	if !enabled {
		return "", errors.New(Conf.Language(310))
	}

	kek, err := deriveKEK(password)
	if err != nil {
		return "", err
	}
	defer zeroAndClear(kek)

	id, err = CreateBox(name)
	if err != nil {
		return "", err
	}

	// 若后续步骤失败，清理已创建的 box 目录和加密 db 文件，避免半创建状态
	boxCreated := true
	defer func() {
		if err != nil && boxCreated {
			sql.RemoveEncryptedDBFile(id)
			treenode.RemoveEncryptedBlockTreeDBFile(id)
			boxDir := filepath.Join(util.DataDir, id)
			if rmErr := filelock.Remove(boxDir); rmErr != nil {
				logging.LogErrorf("cleanup failed encrypted box [%s]: %s", id, rmErr)
			}
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

	// 复用刚派生的 DEK 直接开 db + 缓存，省去再次 Argon2id 解锁
	cachedDEKsLock.Lock()
	defer cachedDEKsLock.Unlock()
	if err = sql.OpenEncryptedDB(id, dek); err != nil {
		return "", err
	}
	if err = treenode.OpenEncryptedBlockTreeDB(id, dek); err != nil {
		sql.CloseEncryptedDB(id)
		return "", err
	}
	cachedDEKs[id] = dek

	// 初始化自动锁定访问时间戳，与 UnlockBox 对称
	newVal := &atomic.Int64{}
	newVal.Store(time.Now().UnixNano())
	boxLastAccess.Store(id, newVal)

	IncSync()
	return id, nil
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
