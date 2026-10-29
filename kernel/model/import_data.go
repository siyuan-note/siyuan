// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const dataImportTTL = 30 * time.Minute

var dataImportMu sync.Mutex
var dataImportAccess sync.RWMutex
var dataImportRecoveryRequired atomic.Bool

func checkDataImportRecovery() error {
	if dataImportRecoveryRequired.Load() {
		return errors.New(Conf.Language(424))
	}
	return nil
}

type DataImportPlan struct {
	ID        string   `json:"id"`
	Conflicts []string `json:"conflicts"`
	Encrypted []string `json:"encrypted"`
}

type dataImportStage struct {
	Version int                            `json:"version"`
	Created int64                          `json:"created"`
	Plan    DataImportPlan                 `json:"plan"`
	Files   map[string]notebookArchiveFile `json:"files"`
}

func dataImportBase() string { return filepath.Join(util.ConfDir, "data-imports") }

func dataImportDirectory(id string) (string, error) {
	if !ast.IsNodeIDPattern(id) {
		return "", errors.New(Conf.Language(422))
	}
	directory := filepath.Join(dataImportBase(), id)
	if err := validateEncryptedCleanupPath(util.ConfDir, directory); err != nil {
		return "", err
	}
	return directory, nil
}

// PrepareDataImport 先在独占访问下恢复未完成批次，再保存上传原件和预检结果，不安装上传内容。
func PrepareDataImport(zipPath string) (plan DataImportPlan, err error) {
	if err = recoverDataImportsForPrepare(); err != nil {
		return
	}
	dataImportMu.Lock()
	defer dataImportMu.Unlock()
	if err = checkDataImportRecovery(); err != nil {
		return
	}
	plan = DataImportPlan{ID: ast.NewNodeID(), Conflicts: []string{}, Encrypted: []string{}}
	directory, err := dataImportDirectory(plan.ID)
	if err != nil {
		return
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, os.RemoveAll(directory))
		}
	}()
	if err = archiveCopyFile(zipPath, filepath.Join(directory, "source.zip")); err != nil {
		return
	}
	incoming := filepath.Join(directory, "incoming")
	if err = extractDataImport(filepath.Join(directory, "source.zip"), incoming); err != nil {
		return
	}
	identities, err := inspectDataImportNotebooks(incoming)
	if err != nil {
		return
	}
	plan = planDataImport(plan.ID, identities)
	files, err := archiveDirectoryFiles(incoming)
	if err != nil {
		return
	}
	stage := dataImportStage{Version: 1, Created: time.Now().Unix(), Plan: plan, Files: files}
	err = writeDataImportJSON(filepath.Join(directory, "stage.json"), stage)
	return
}

func planDataImport(id string, identities map[string]*conf.BoxEncryption) DataImportPlan {
	plan := DataImportPlan{ID: id, Conflicts: []string{}, Encrypted: []string{}}
	for boxID, crypt := range identities {
		if crypt != nil {
			plan.Encrypted = append(plan.Encrypted, boxID)
		}
		if _, err := os.Lstat(filepath.Join(util.DataDir, boxID)); err == nil && (crypt != nil || IsEncryptedBox(boxID)) {
			plan.Conflicts = append(plan.Conflicts, boxID)
		}
	}
	sort.Strings(plan.Conflicts)
	sort.Strings(plan.Encrypted)
	return plan
}

// extractDataImport 保留原有单层 Data.zip 容器，拒绝重复路径、跨平台歧义和链接条目。
func extractDataImport(zipPath, destination string) error {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer reader.Close()
	if len(reader.File) == 0 || len(reader.File) > notebookArchiveMaxEntries {
		return errors.New(Conf.Language(198))
	}
	root := ""
	seen := map[string]bool{}
	for _, file := range reader.File {
		name := strings.TrimSuffix(file.Name, "/")
		if !archiveRelativePath(name) || !file.Mode().IsRegular() && !file.FileInfo().IsDir() {
			return errors.New(Conf.Language(198))
		}
		parts := strings.SplitN(name, "/", 2)
		if root == "" {
			root = parts[0]
		}
		if parts[0] != root || len(parts) == 1 && !file.FileInfo().IsDir() {
			return errors.New(Conf.Language(198))
		}
		if seen[strings.ToLower(name)] {
			return errors.New(Conf.Language(198))
		}
		seen[strings.ToLower(name)] = true
		if len(parts) == 1 || file.FileInfo().IsDir() {
			continue
		}
		target := filepath.Join(destination, filepath.FromSlash(parts[1]))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		input, openErr := file.Open()
		if openErr != nil {
			return openErr
		}
		output, createErr := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if createErr != nil {
			input.Close()
			return createErr
		}
		_, copyErr := io.Copy(output, input)
		inputErr, outputErr := input.Close(), output.Close()
		if err = errors.Join(copyErr, inputErr, outputErr); err != nil {
			return err
		}
	}
	return nil
}

// inspectDataImportNotebooks 同时记录普通与加密身份，避免普通来源覆盖现有加密目录。
func inspectDataImportNotebooks(root string) (map[string]*conf.BoxEncryption, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	identities := map[string]*conf.BoxEncryption{}
	if err = validateDataImportNotebookPaths(root, entries); err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".sy") {
			return nil, errors.New(Conf.Language(198))
		}
		if !entry.IsDir() || !ast.IsNodeIDPattern(entry.Name()) {
			continue
		}
		boxID := entry.Name()
		directory := filepath.Join(root, boxID)
		data, readErr := os.ReadFile(filepath.Join(directory, ".siyuan", "conf.json"))
		var boxConf *conf.BoxConf
		if readErr == nil {
			boxConf = conf.NewBoxConf()
			if err = json.Unmarshal(data, boxConf); err != nil {
				return nil, err
			}
		} else if !os.IsNotExist(readErr) {
			return nil, readErr
		}
		var backup *conf.BoxEncryption
		backupPath := filepath.Join(directory, ".siyuan", notebookCryptoBackupFilename)
		if _, statErr := os.Lstat(backupPath); statErr == nil {
			backup, err = readBoxEncryptionFile(backupPath)
			if err != nil {
				return nil, err
			}
		} else if !os.IsNotExist(statErr) {
			return nil, statErr
		}
		var crypt *conf.BoxEncryption
		if boxConf != nil && boxConf.Encrypted {
			crypt = boxConf.BoxCrypt
			if crypt == nil || validateBoxEncryption(crypt) != nil {
				crypt = backup
			}
			if crypt == nil {
				return nil, errors.New(Conf.Language(316))
			}
		} else if boxConf != nil && backup != nil {
			return nil, fmt.Errorf(Conf.Language(423), boxID)
		} else {
			crypt = backup
		}
		payload, payloadErr := hasEncryptedNotebookPayloadAtPath(directory)
		if payloadErr != nil {
			return nil, payloadErr
		}
		if crypt == nil && payload {
			return nil, errors.New(Conf.Language(316))
		}
		if crypt != nil {
			if err = validateBoxEncryption(crypt); err != nil {
				return nil, err
			}
		}
		identities[boxID] = crypt
	}
	return identities, nil
}

// validateDataImportNotebookPaths 拒绝非规范 ID，并逐级核对已有目录项，防止大小写和短文件名别名绕过身份检查。
func validateDataImportNotebookPaths(root string, entries []os.DirEntry) error {
	for _, entry := range entries {
		if name := entry.Name(); ast.IsNodeIDPattern(strings.ToLower(name)) && !ast.IsNodeIDPattern(name) {
			return errors.New(Conf.Language(198))
		}
	}
	directories := map[string]map[string]bool{}
	return archiveWalk(root, func(name, _ string) error {
		parent := util.DataDir
		for _, part := range strings.Split(name, "/") {
			names, cached := directories[parent]
			if !cached {
				children, err := os.ReadDir(parent)
				if os.IsNotExist(err) {
					return nil
				}
				if err != nil {
					return err
				}
				names = map[string]bool{}
				for _, child := range children {
					names[child.Name()] = true
				}
				directories[parent] = names
			}
			parent = filepath.Join(parent, part)
			if names[part] {
				continue
			}
			if _, err := os.Lstat(parent); err == nil {
				return errors.New(Conf.Language(198))
			} else if !os.IsNotExist(err) {
				return err
			}
			return nil
		}
		return nil
	})
}

func loadDataImportStage(id string) (string, *dataImportStage, error) {
	directory, stage, err := readDataImportStage(id)
	if err != nil {
		return "", nil, err
	}
	if time.Now().Unix()-stage.Created > int64(dataImportTTL.Seconds()) || stage.Created > time.Now().Unix() {
		return "", nil, errors.New(Conf.Language(422))
	}
	return directory, stage, nil
}

func readDataImportStage(id string) (string, *dataImportStage, error) {
	directory, err := dataImportDirectory(id)
	if err != nil {
		return "", nil, err
	}
	data, err := os.ReadFile(filepath.Join(directory, "stage.json"))
	stage := &dataImportStage{}
	if err != nil || json.Unmarshal(data, stage) != nil || stage.Version != 1 || stage.Plan.ID != id || stage.Created <= 0 {
		return "", nil, errors.New(Conf.Language(422))
	}
	if _, err = os.Lstat(filepath.Join(directory, "operation.json")); !os.IsNotExist(err) {
		return "", nil, errors.New(Conf.Language(422))
	}
	return directory, stage, nil
}

func CancelDataImport(id string) error {
	dataImportMu.Lock()
	defer dataImportMu.Unlock()
	directory, _, err := readDataImportStage(id)
	if err != nil {
		return err
	}
	return os.RemoveAll(directory)
}

// CommitDataImport 在预检全部通过后提交按路径覆盖；跳过的目录与密钥材料保持原样。
func CommitDataImport(id, mode, password string) (skipped []string, err error) {
	dataImportAccess.Lock()
	defer dataImportAccess.Unlock()
	dataImportMu.Lock()
	defer dataImportMu.Unlock()
	lockSync()
	defer unlockSync()
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()
	if mode != "skip" && mode != "overwrite" {
		return nil, errors.New(Conf.Language(422))
	}
	if err = recoverDataImports(); err != nil {
		return
	}
	if err = checkPendingNotebookArchives(); err != nil {
		return
	}
	if migration, migrationErr := readMasterPasswordMigration(); migrationErr != nil || migration != nil {
		return nil, errors.New(Conf.Language(239))
	}
	directory, stage, err := loadDataImportStage(id)
	if err != nil {
		return
	}
	incoming := filepath.Join(directory, "incoming")
	files, err := archiveDirectoryFiles(incoming)
	if err != nil || !reflect.DeepEqual(files, stage.Files) {
		return nil, errors.New(Conf.Language(422))
	}
	identities, err := inspectDataImportNotebooks(incoming)
	if err != nil {
		return
	}
	if !reflect.DeepEqual(planDataImport(id, identities), stage.Plan) {
		return nil, errors.New(Conf.Language(422))
	}
	skipped = []string{}
	if mode == "skip" {
		skipped = append(skipped, stage.Plan.Conflicts...)
	}
	var encrypted []string
	for _, boxID := range stage.Plan.Encrypted {
		if !slices.Contains(skipped, boxID) {
			encrypted = append(encrypted, boxID)
		}
	}
	for _, boxID := range stage.Plan.Conflicts {
		if !slices.Contains(skipped, boxID) && (identities[boxID] == nil || !IsEncryptedBox(boxID)) {
			return nil, fmt.Errorf(Conf.Language(423), boxID)
		}
	}
	var nc *conf.NotebookCrypto
	var kek []byte
	if len(encrypted) != 0 {
		nc, kek, err = dataImportKey(incoming, password, encrypted, identities)
		if err != nil {
			return
		}
		defer zeroAndClear(kek)
	}
	// 生命周期锁先阻止新的访问并排空既有请求，随后才冻结编辑队列和复制磁盘快照。
	for _, boxID := range encrypted {
		release := holdEncryptedBoxTransition(boxID)
		defer release()
		if IsEncryptedBox(boxID) {
			mounted := isEncryptedBoxMounted(boxID)
			lockBoxWithPreparationHeld(boxID, func() {
				if mounted {
					GenerateFileHistoryForBox(&Box{ID: boxID})
				}
			})
		}
	}
	FlushTxQueue()
	flushLock.Lock()
	defer flushLock.Unlock()
	if txQueueSize() != 0 {
		return nil, errors.New(Conf.Language(239))
	}
	install := filepath.Join(directory, "install")
	if err = validateEncryptedCleanupPath(directory, install); err != nil {
		return
	}
	if err = os.RemoveAll(install); err != nil {
		return
	}
	if err = os.MkdirAll(install, 0700); err != nil {
		return
	}
	if err = stageDataImportFiles(incoming, install, skipped); err != nil {
		return
	}
	for _, boxID := range encrypted {
		if err = stageEncryptedDataImport(incoming, install, boxID, identities[boxID], nc, kek); err != nil {
			return
		}
	}
	if nc != nil {
		nc.Enabled = true
		prepareBackupForWrite(nc)
		nc.KEKMAC = computeKEKMAC(nc, kek)
		if err = writeDataImportJSON(filepath.Join(install, ".siyuan", "data-crypto-backup.json"), nc); err != nil {
			return
		}
		if !verifyKEKAgainstExistingBoxes(kek, nc) || !verifyKEKAgainstEncryptedHistory(kek, nc) {
			return nil, errors.New(Conf.Language(316))
		}
	}
	keys, err := notebookArchiveKeys()
	if err != nil {
		return nil, err
	}
	for name, data := range keys {
		if err = writeDataImportBytes(filepath.Join(directory, name), data); err != nil {
			return nil, err
		}
	}
	if err = applyDataImport(directory, install, copyDataImportFile); err != nil {
		return
	}
	if nc != nil {
		Conf.m.Lock()
		Conf.NotebookCrypto = nc
		Conf.m.Unlock()
		Conf.Save()
	}
	for _, boxID := range encrypted {
		forgetRuntimeNormalBox(boxID)
		markRuntimeEncryptedBox(boxID)
		setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
	}
	IncSync()
	return
}

func stageDataImportFiles(source, target string, skipped []string) error {
	return archiveWalk(source, func(name, fullPath string) error {
		lower := strings.ToLower(name)
		if slices.Contains(skipped, strings.SplitN(name, "/", 2)[0]) || lower == ".siyuan/data-crypto-backup.json" ||
			lower == ".siyuan/master-password-migration.json" {
			return nil
		}
		return copyDataImportFile(fullPath, filepath.Join(target, filepath.FromSlash(name)))
	})
}

func stageEncryptedDataImport(incoming, install, boxID string, crypt *conf.BoxEncryption, nc *conf.NotebookCrypto, kek []byte) error {
	dek, err := decryptWrappedDEKWithHistory(boxID, crypt, kek, nc)
	if err != nil {
		return errors.New(Conf.Language(316))
	}
	defer zeroAndClear(dek)
	if err = authenticateNotebookArchiveBox(filepath.Join(incoming, boxID), boxID, dek, crypt); err != nil {
		return err
	}
	current := filepath.Join(util.DataDir, boxID)
	merged := filepath.Join(install, boxID)
	if _, statErr := os.Lstat(current); statErr == nil {
		local, readErr := GetBoxEncryption(boxID)
		if readErr != nil || local == nil {
			return fmt.Errorf(Conf.Language(423), boxID)
		}
		localDEK, decryptErr := decryptWrappedDEKWithHistory(boxID, local, kek, nc)
		same := decryptErr == nil && bytes.Equal(localDEK, dek)
		zeroAndClear(localDEK)
		if !same {
			return fmt.Errorf(Conf.Language(423), boxID)
		}
		// 先保留本机独有路径，再覆盖来源路径；不把旧文件隐式删除为镜像恢复。
		if err = archiveWalk(current, func(name, p string) error {
			target := filepath.Join(merged, filepath.FromSlash(name))
			if _, existsErr := os.Lstat(target); existsErr == nil {
				return nil
			} else if !os.IsNotExist(existsErr) {
				return existsErr
			}
			return copyDataImportFile(p, target)
		}); err != nil {
			return err
		}
	} else if !os.IsNotExist(statErr) {
		return statErr
	}
	if err = authenticateNotebookArchiveBox(merged, boxID, dek, crypt); err != nil {
		return err
	}
	boxConf := conf.NewBoxConf()
	if data, readErr := os.ReadFile(filepath.Join(merged, ".siyuan", "conf.json")); readErr == nil {
		if err = json.Unmarshal(data, boxConf); err != nil {
			return err
		}
	} else if !os.IsNotExist(readErr) {
		return readErr
	}
	boxConf.Encrypted, boxConf.Closed, boxConf.BoxCrypt = true, true, crypt
	clearBoxMetadata(boxConf)
	if err = writeDataImportJSON(filepath.Join(merged, ".siyuan", "conf.json"), boxConf); err != nil {
		return err
	}
	return writeDataImportJSON(filepath.Join(merged, ".siyuan", notebookCryptoBackupFilename), crypt)
}

// dataImportKey 优先使用本机认证配置；候选必须保留当前及历史 KEK，避免旧备份回退密码。
func dataImportKey(incoming, password string, encrypted []string, identities map[string]*conf.BoxEncryption) (*conf.NotebookCrypto, []byte, error) {
	current := currentNotebookCrypto()
	candidates := []*conf.NotebookCrypto{current}
	if data, err := os.ReadFile(filepath.Join(incoming, ".siyuan", "data-crypto-backup.json")); err == nil {
		candidate := &conf.NotebookCrypto{}
		if json.Unmarshal(data, candidate) == nil {
			candidates = append(candidates, candidate)
		}
	}
	for _, nc := range candidates {
		if !notebookCryptoConfigurationComplete(nc) || password == "" {
			continue
		}
		kek := util.DeriveKey(password, nc.MasterSalt, nc.KDFParams)
		verifier, err := util.DecryptWithAAD(kek, nc.KEKVerifier, []byte("siyuan:kek-verifier"))
		if err != nil || !bytes.Equal(verifier, kekVerifierMagic) || !verifyKEKMAC(nc, kek) ||
			!dataImportPreservesKeys(current, nc, kek) || !verifyKEKAgainstExistingBoxes(kek, nc) || !verifyKEKAgainstEncryptedHistory(kek, nc) {
			zeroAndClear(kek)
			continue
		}
		valid := true
		for _, id := range encrypted {
			dek, decryptErr := decryptWrappedDEKWithHistory(id, identities[id], kek, nc)
			if decryptErr == nil {
				decryptErr = authenticateNotebookArchiveBox(filepath.Join(incoming, id), id, dek, identities[id])
			}
			if decryptErr == nil && IsEncryptedBox(id) {
				local, localErr := GetBoxEncryption(id)
				if localErr != nil || local == nil {
					decryptErr = errors.New(Conf.Language(316))
				} else {
					localDEK, localDecryptErr := decryptWrappedDEKWithHistory(id, local, kek, nc)
					if localDecryptErr != nil || !bytes.Equal(localDEK, dek) {
						decryptErr = errors.New(Conf.Language(316))
					}
					zeroAndClear(localDEK)
				}
			}
			zeroAndClear(dek)
			if decryptErr != nil {
				valid = false
				break
			}
		}
		if !valid {
			zeroAndClear(kek)
			continue
		}
		nc.AutoLockMinutes = current.AutoLockMinutes
		return nc, kek, nil
	}
	return nil, nil, errors.New(Conf.Language(316))
}

func dataImportPreservesKeys(current, candidate *conf.NotebookCrypto, kek []byte) bool {
	keys, err := decryptHistoryKEKs(kek, candidate.HistoryKEKs)
	if err != nil {
		return false
	}
	defer func() { clearHistoryKEKs(keys) }()
	if !notebookCryptoConfigurationComplete(current) {
		return NotebookCryptoLifecycleState(false) == NotebookCryptoStateDisabled
	}
	if !bytes.Equal(current.MasterSalt, candidate.MasterSalt) {
		return false
	}
	keys = append(keys, bytes.Clone(kek))
	for _, key := range keys {
		verifier, decryptErr := util.DecryptWithAAD(key, current.KEKVerifier, []byte("siyuan:kek-verifier"))
		if decryptErr != nil || !bytes.Equal(verifier, kekVerifierMagic) || !verifyKEKMAC(current, key) {
			continue
		}
		previous, historyErr := decryptHistoryKEKs(key, current.HistoryKEKs)
		defer clearHistoryKEKs(previous)
		if historyErr != nil {
			return false
		}
		for _, old := range previous {
			if !slices.ContainsFunc(keys, func(kept []byte) bool { return bytes.Equal(kept, old) }) {
				return false
			}
		}
		return true
	}
	return false
}

func writeDataImportJSON(p string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeDataImportBytes(p, data)
}

func writeDataImportBytes(p string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	return writeEncryptedCleanupData(p, data)
}
