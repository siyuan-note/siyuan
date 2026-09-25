package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func checkNotebookArchiveImportTarget() error {
	if NotebookCryptoLifecycleState(false) != NotebookCryptoStateDisabled {
		return ErrNotebookArchiveConfigured
	}
	for _, name := range []string{dataCryptoBackupPath(), masterPasswordMigrationPath()} {
		if _, err := os.Lstat(name); !os.IsNotExist(err) {
			return ErrNotebookArchiveConfigured
		}
	}
	ids, err := listAllEncryptedBoxIDs()
	if err != nil {
		return err
	}
	history, err := scanEncryptedNotebookHistory()
	if err != nil {
		return err
	}
	if len(ids) != 0 || history || Conf.Sync != nil && Conf.Sync.Enabled {
		return ErrNotebookArchiveConfigured
	}
	candidates, err := listNotebookArchiveCandidates()
	if err != nil {
		return err
	}
	if len(candidates) != 0 {
		return ErrNotebookArchiveConfigured
	}
	return nil
}

// ImportNotebookArchive 在独立暂存区认证恢复材料，所有校验成功后才把密文放入未配置密钥的工作区。
func ImportNotebookArchive(archivePath, password string, keyData []byte) error {
	notebookArchiveMu.Lock()
	defer notebookArchiveMu.Unlock()
	lockSync()
	defer unlockSync()
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()
	notebookArchiveHistoryMu.Lock()
	defer notebookArchiveHistoryMu.Unlock()
	if err := recoverNotebookArchiveOperations(); err != nil {
		return err
	}
	if err := checkNotebookArchiveImportTarget(); err != nil {
		return err
	}
	if password == "" {
		return ErrNotebookArchiveAuthentication
	}
	directory, _ := notebookArchiveDirectory(ast.NewNodeID())
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	// 上传原件始终保留在独立恢复目录中，失败时不修改或删除用户提供的归档。
	if err := archiveCopyFile(archivePath, filepath.Join(directory, "archive.zip")); err != nil {
		return err
	}
	payload := filepath.Join(directory, "payload")
	manifest, err := readNotebookArchive(filepath.Join(directory, "archive.zip"), payload)
	if err != nil {
		return err
	}
	nc, kek, err := authenticateNotebookArchive(payload, manifest, password, keyData)
	if err != nil {
		return err
	}
	defer zeroAndClear(kek)
	install := filepath.Join(directory, "install")
	roots, err := stageNotebookArchiveImport(payload, install, manifest)
	if err != nil {
		return err
	}
	for _, root := range roots {
		destination, err := archiveSourcePath(root)
		if err != nil {
			return err
		}
		if _, err = os.Lstat(destination); !os.IsNotExist(err) {
			return ErrNotebookArchiveConfigured
		}
	}
	// 密钥备份与密文目录共同登记。重启时回滚尚未提交的导入，不挂载部分恢复的数据。
	nc.Enabled = true
	nc.AutoLockMinutes = currentNotebookCrypto().AutoLockMinutes
	prepareBackupForWrite(nc)
	nc.KEKMAC = computeKEKMAC(nc, kek)
	backup, err := json.Marshal(nc)
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(directory, "import-key.json"), backup, 0600); err != nil {
		return err
	}
	operation := &notebookArchiveOperation{State: "importing", Roots: roots}
	if err = writeNotebookArchiveOperation(directory, operation); err != nil {
		return err
	}
	for _, root := range roots {
		destination, _ := archiveSourcePath(root)
		if err = os.MkdirAll(filepath.Dir(destination), 0700); err == nil {
			err = os.Rename(filepath.Join(install, filepath.FromSlash(root)), destination)
		}
		if err != nil {
			if rollbackErr := rollbackNotebookArchiveImport(directory, operation); rollbackErr != nil {
				return fmt.Errorf("%w: %v; %v", ErrNotebookArchiveBusy, err, rollbackErr)
			}
			return err
		}
	}
	if err = os.MkdirAll(filepath.Dir(dataCryptoBackupPath()), 0700); err == nil {
		err = atomicWriteFile(dataCryptoBackupPath(), backup)
	}
	if err != nil {
		_ = rollbackNotebookArchiveImport(directory, operation)
		return err
	}
	operation.State = "imported"
	if err = writeNotebookArchiveOperation(directory, operation); err != nil {
		operation.State = "importing"
		_ = rollbackNotebookArchiveImport(directory, operation)
		return err
	}
	Conf.m.Lock()
	Conf.NotebookCrypto = nc
	Conf.m.Unlock()
	Conf.Save()
	for _, root := range roots {
		if strings.HasPrefix(root, "data/") {
			id := path.Base(root)
			forgetRuntimeNormalBox(id)
			markRuntimeEncryptedBox(id)
		}
	}
	IncSync()
	ReindexHistory()
	return nil
}

func authenticateNotebookArchive(payload string, manifest *notebookArchiveManifest, password string, keyData []byte) (*conf.NotebookCrypto, []byte, error) {
	candidates := [][]byte{}
	if len(keyData) != 0 {
		candidates = append(candidates, keyData)
	}
	for _, name := range []string{"keys/conf.json", "keys/persisted-conf.json", "keys/backup.json"} {
		if data, err := os.ReadFile(filepath.Join(payload, filepath.FromSlash(name))); err == nil {
			candidates = append(candidates, data)
		}
	}
	var snapshotKeys []string
	for name := range manifest.Files {
		if strings.HasPrefix(name, "snapshots/") && strings.HasSuffix(name, "/keys/backup.json") {
			snapshotKeys = append(snapshotKeys, name)
		}
	}
	sort.Strings(snapshotKeys)
	for _, name := range snapshotKeys {
		if data, err := os.ReadFile(filepath.Join(payload, filepath.FromSlash(name))); err == nil {
			candidates = append(candidates, data)
		}
	}
	seen := map[string]bool{}
	for _, data := range candidates {
		if seen[string(data)] {
			continue
		}
		seen[string(data)] = true
		nc := &conf.NotebookCrypto{}
		if json.Unmarshal(data, nc) != nil || !notebookCryptoConfigurationComplete(nc) {
			continue
		}
		params, err := util.ValidateArgon2Params(nc.KDFParams)
		if err != nil {
			continue
		}
		kek := util.DeriveKey(password, nc.MasterSalt, params)
		verifier, err := util.DecryptWithAAD(kek, nc.KEKVerifier, []byte("siyuan:kek-verifier"))
		if err != nil || !bytes.Equal(verifier, kekVerifierMagic) || !verifyKEKMAC(nc, kek) {
			zeroAndClear(kek)
			continue
		}
		keys, err := decryptHistoryKEKs(kek, nc.HistoryKEKs)
		clearHistoryKEKs(keys)
		if err == nil {
			err = authenticateNotebookArchivePayload(payload, manifest, nc, kek)
		}
		if err == nil {
			return nc, kek, nil
		}
		zeroAndClear(kek)
	}
	return nil, nil, ErrNotebookArchiveAuthentication
}

func notebookArchiveBoxRoots(manifest *notebookArchiveManifest) []string {
	roots := append([]string(nil), manifest.Roots...)
	seen := map[string]bool{}
	for name := range manifest.Files {
		parts := strings.Split(name, "/")
		if len(parts) >= 4 && parts[0] == "snapshots" && ast.IsNodeIDPattern(parts[2]) {
			root := strings.Join(parts[:3], "/")
			if !seen[root] {
				roots = append(roots, root)
				seen[root] = true
			}
		}
	}
	sort.Strings(roots)
	return roots
}

func authenticateNotebookArchivePayload(payload string, manifest *notebookArchiveManifest, nc *conf.NotebookCrypto, kek []byte) error {
	roots := notebookArchiveBoxRoots(manifest)
	identities := map[string][]*conf.BoxEncryption{}
	rootIdentities := map[string][]*conf.BoxEncryption{}
	for _, root := range roots {
		boxDir := filepath.Join(payload, filepath.FromSlash(root))
		// 普通文档和资源历史只存密文，密钥包络保存在现存笔记本、删除历史或仓库快照中。
		hasIdentity := false
		for _, name := range []string{"conf.json", notebookCryptoBackupFilename} {
			if _, err := os.Stat(filepath.Join(boxDir, ".siyuan", name)); err == nil {
				hasIdentity = true
			} else if !os.IsNotExist(err) {
				return err
			}
		}
		if !hasIdentity && strings.HasPrefix(root, "history/") {
			continue
		}
		candidates, err := readEncryptedHistoryBoxEncryptionCandidates(boxDir)
		if err != nil {
			return err
		}
		rootIdentities[root] = candidates
		identities[path.Base(root)] = append(identities[path.Base(root)], candidates...)
	}
	for _, root := range roots {
		boxID := path.Base(root)
		boxDir := filepath.Join(payload, filepath.FromSlash(root))
		candidates := rootIdentities[root]
		if len(candidates) == 0 {
			candidates = identities[boxID]
		}
		authenticated := false
		for _, candidate := range candidates {
			dek, err := decryptWrappedDEKWithHistory(boxID, candidate, kek, nc)
			if err == nil {
				err = authenticateNotebookArchiveBox(boxDir, boxID, dek, candidate)
			}
			zeroAndClear(dek)
			if err == nil {
				authenticated = true
				break
			}
		}
		if !authenticated {
			return ErrNotebookArchiveAuthentication
		}
	}
	return nil
}

func authenticateNotebookArchiveBox(boxDir, boxID string, dek []byte, encryption *conf.BoxEncryption) error {
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted, boxConf.BoxCrypt = true, encryption
	if err := decryptBoxMetadata(boxID, boxConf, dek); err != nil {
		return err
	}
	documentIDs := map[string]bool{}
	return archiveWalk(boxDir, func(name, fullPath string) error {
		if strings.HasPrefix(name, "assets/") {
			input, err := os.Open(fullPath)
			if err != nil {
				return err
			}
			defer input.Close()
			_, err = DecryptAssetToWriter(boxID, path.Base(name), dek, input, io.Discard)
			return err
		}
		isDoc := strings.HasSuffix(name, ".sy")
		isAV := strings.HasPrefix(name, "storage/av/") && strings.HasSuffix(name, ".json")
		if !isDoc && !isAV {
			return nil
		}
		data, err := os.ReadFile(fullPath)
		if err != nil {
			return err
		}
		purpose, aad := "siyuan/file", ""
		if isDoc {
			aad, err = filesys.SyAAD(boxID, name)
			if err != nil {
				return err
			}
		} else {
			purpose = "siyuan/av"
			avID := strings.TrimSuffix(path.Base(name), ".json")
			aad = "siyuan:av:" + boxID + ":" + avID
			if avID == "mirror" || avID == "relation" {
				aad = "siyuan:av-" + avID + ":" + boxID
			}
		}
		key := util.DeriveSubKey(dek, purpose)
		defer zeroAndClear(key)
		plain, err := util.DecryptWithAAD(key, data, []byte(aad))
		defer zeroAndClear(plain)
		if err != nil {
			return err
		}
		if isDoc {
			tree, parseErr := loadTreeByData0(plain)
			if parseErr != nil || tree == nil || tree.Root == nil || tree.Root.ID+".sy" != path.Base(name) || documentIDs[tree.Root.ID] {
				return ErrNotebookArchiveInvalid
			}
			documentIDs[tree.Root.ID] = true
		} else if !json.Valid(plain) {
			return ErrNotebookArchiveInvalid
		} else if avID := strings.TrimSuffix(path.Base(name), ".json"); avID != "mirror" && avID != "relation" {
			definition, parseErr := av.ParseAttributeViewData(avID, plain)
			if parseErr != nil || definition.ID != avID {
				return ErrNotebookArchiveInvalid
			}
		}
		return nil
	})
}

// stageNotebookArchiveImport 将仓库快照转换为独立的笔记本删除历史，原归档仍保留原快照标识和路径。
func stageNotebookArchiveImport(payload, install string, manifest *notebookArchiveManifest) ([]string, error) {
	roots := []string{}
	used := map[string]bool{}
	for _, root := range manifest.Roots {
		used[root] = true
	}
	nextTime := time.Now()
	for _, root := range notebookArchiveBoxRoots(manifest) {
		destinationRoot := root
		if strings.HasPrefix(root, "snapshots/") {
			for {
				destinationRoot = "history/" + nextTime.Format("2006-01-02-150405") + "-delete/" + path.Base(root)
				nextTime = nextTime.Add(-time.Second)
				if !used[destinationRoot] {
					break
				}
			}
		}
		used[destinationRoot] = true
		source := filepath.Join(payload, filepath.FromSlash(root))
		destination := filepath.Join(install, filepath.FromSlash(destinationRoot))
		if err := os.MkdirAll(destination, 0700); err != nil {
			return nil, err
		}
		if err := archiveWalk(source, func(name, fullPath string) error {
			return archiveCopyFile(fullPath, filepath.Join(destination, filepath.FromSlash(name)))
		}); err != nil {
			return nil, err
		}
		roots = append(roots, destinationRoot)
	}
	return roots, nil
}

func rollbackNotebookArchiveImport(directory string, operation *notebookArchiveOperation) error {
	for i := len(operation.Roots) - 1; i >= 0; i-- {
		root := operation.Roots[i]
		destination, err := archiveSourcePath(root)
		if err != nil {
			return err
		}
		staged := filepath.Join(directory, "install", filepath.FromSlash(root))
		if _, err = os.Lstat(staged); err == nil {
			continue
		}
		if !os.IsNotExist(err) {
			return err
		}
		if _, err = os.Lstat(destination); os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if err = os.MkdirAll(filepath.Dir(staged), 0700); err != nil {
			return err
		}
		if err = os.Rename(destination, staged); err != nil {
			return err
		}
	}
	backup, err := os.ReadFile(dataCryptoBackupPath())
	if err == nil {
		expected, readErr := os.ReadFile(filepath.Join(directory, "import-key.json"))
		if readErr != nil || !bytes.Equal(backup, expected) {
			return ErrNotebookArchiveBusy
		}
		if err = os.Remove(dataCryptoBackupPath()); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	operation.State = "import-failed"
	return writeNotebookArchiveOperation(directory, operation)
}
