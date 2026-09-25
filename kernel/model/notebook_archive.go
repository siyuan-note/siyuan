package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var notebookArchiveMu sync.Mutex
var notebookArchiveHistoryMu sync.Mutex

type NotebookArchiveCandidate struct {
	ID      string
	Current bool
}

type notebookArchiveOperation struct {
	State string   `json:"state"`
	Roots []string `json:"roots"`
}

func (operation *notebookArchiveOperation) valid() bool {
	switch operation.State {
	case "prepared", "committing", "committed", "importing", "imported", "import-failed":
	default:
		return false
	}
	seen := map[string]bool{}
	for _, root := range operation.Roots {
		if _, err := archiveSourcePath(root); err != nil || seen[root] {
			return false
		}
		seen[root] = true
	}
	return true
}

// ListNotebookArchiveCandidates 同时列出现存密文和只有历史的笔记本，不要求解锁或派生密钥。
func ListNotebookArchiveCandidates() ([]NotebookArchiveCandidate, error) {
	lockSync()
	defer unlockSync()
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()
	notebookArchiveHistoryMu.Lock()
	defer notebookArchiveHistoryMu.Unlock()
	return listNotebookArchiveCandidates()
}

func listNotebookArchiveCandidates() ([]NotebookArchiveCandidate, error) {
	ids := map[string]bool{}
	dirs, err := os.ReadDir(util.DataDir)
	if err != nil {
		return nil, err
	}
	for _, dir := range dirs {
		if dir.IsDir() && ast.IsNodeIDPattern(dir.Name()) && IsEncryptedBox(dir.Name()) {
			ids[dir.Name()] = true
		}
	}
	histories, err := encryptedNotebookHistoryBoxDirs()
	if err != nil {
		return nil, err
	}
	for _, history := range histories {
		id := filepath.Base(history)
		if _, exists := ids[id]; !exists {
			ids[id] = false
		}
	}
	err = walkNotebookArchiveSnapshots(func(repo *dejavu.Repo, index *entity.Index, files []*entity.File) error {
		for _, file := range files {
			parts := strings.Split(strings.TrimPrefix(file.Path, "/"), "/")
			if len(parts) != 3 || !ast.IsNodeIDPattern(parts[0]) || parts[1] != ".siyuan" {
				continue
			}
			encrypted := parts[2] == notebookCryptoBackupFilename
			if parts[2] == "conf.json" {
				data, err := openRepoFileWithAssets(repo, file)
				if err != nil {
					return err
				}
				var boxConf conf.BoxConf
				encrypted = json.Unmarshal(data, &boxConf) == nil && boxConf.Encrypted
			}
			if encrypted {
				if _, exists := ids[parts[0]]; !exists {
					ids[parts[0]] = false
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	ret := make([]NotebookArchiveCandidate, 0, len(ids))
	for id, current := range ids {
		ret = append(ret, NotebookArchiveCandidate{ID: id, Current: current})
	}
	sort.Slice(ret, func(i, j int) bool { return ret[i].ID < ret[j].ID })
	return ret, nil
}

func walkNotebookArchiveSnapshots(visit func(*dejavu.Repo, *entity.Index, []*entity.File) error) error {
	if util.RepoDir == "" {
		return nil
	}
	entries, err := os.ReadDir(filepath.Join(util.RepoDir, "indexes"))
	if os.IsNotExist(err) || err == nil && len(entries) == 0 {
		return nil
	}
	if err != nil {
		return err
	}
	if Conf.Repo == nil || len(Conf.Repo.Key) == 0 {
		return ErrNotebookArchiveBusy
	}
	assetDownloadSourceMu.RLock()
	defer assetDownloadSourceMu.RUnlock()
	repo, err := newRepositoryWithAssetSourceLocked()
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if len(entry.Name()) != 40 {
			continue
		}
		index, err := repo.GetIndex(entry.Name())
		if err != nil {
			return err
		}
		files, err := repo.GetFiles(index)
		if err != nil {
			return err
		}
		if err = visit(repo, index, files); err != nil {
			return err
		}
	}
	return nil
}

func notebookArchiveKeys() (map[string][]byte, error) {
	keys := map[string][]byte{}
	data, err := json.Marshal(currentNotebookCrypto())
	if err != nil {
		return nil, err
	}
	keys["keys/conf.json"] = data
	data, err = os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err == nil {
		var persisted struct {
			NotebookCrypto json.RawMessage `json:"notebookCrypto"`
		}
		if json.Unmarshal(data, &persisted) != nil {
			return nil, ErrNotebookArchiveInvalid
		}
		if len(persisted.NotebookCrypto) != 0 {
			keys["keys/persisted-conf.json"] = persisted.NotebookCrypto
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	for name, source := range map[string]string{"keys/backup.json": dataCryptoBackupPath(), "keys/migration.json": masterPasswordMigrationPath()} {
		data, err = os.ReadFile(source)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		keys[name] = data
	}
	return keys, nil
}

func notebookArchiveRoots(ids []string) ([]string, error) {
	roots := []string{}
	for _, id := range ids {
		if !ast.IsNodeIDPattern(id) {
			return nil, ErrNotebookArchiveInvalid
		}
		if info, err := os.Lstat(filepath.Join(util.DataDir, id)); err == nil {
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !IsEncryptedBox(id) {
				return nil, ErrNotebookArchiveInvalid
			}
			roots = append(roots, "data/"+id)
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}
	histories, err := os.ReadDir(util.HistoryDir)
	if os.IsNotExist(err) {
		return roots, nil
	}
	if err != nil {
		return nil, err
	}
	for _, history := range histories {
		if !history.IsDir() {
			continue
		}
		for _, id := range ids {
			root := "history/" + history.Name() + "/" + id
			source, err := archiveSourcePath(root)
			if err != nil {
				return nil, err
			}
			if info, statErr := os.Lstat(source); statErr == nil {
				if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
					return nil, ErrNotebookArchiveInvalid
				}
				roots = append(roots, root)
			} else if !os.IsNotExist(statErr) {
				return nil, statErr
			}
		}
	}
	sort.Strings(roots)
	return roots, nil
}

// holdNotebookArchiveBoxes 与普通删除共享准入锁，只处理已经锁定的笔记本，避免为了归档生成新历史。
func holdNotebookArchiveBoxes(ids []string) (func(), error) {
	var releases []func()
	release := func() {
		for i := len(releases) - 1; i >= 0; i-- {
			releases[i]()
		}
	}
	for _, id := range ids {
		if _, busy := boxLock.LoadOrStore(id, true); busy {
			release()
			return nil, ErrNotebookArchiveBusy
		}
		releases = append(releases, func() { boxLock.Delete(id) })
		releases = append(releases, holdEncryptedBoxTransition(id))
		if IsBoxUnlocked(id) {
			release()
			return nil, ErrNotebookArchiveBusy
		}
	}
	return release, nil
}

func writeNotebookArchiveOperation(directory string, operation *notebookArchiveOperation) error {
	data, err := json.Marshal(operation)
	if err != nil {
		return err
	}
	return atomicWriteFile(filepath.Join(directory, "operation.json"), data)
}

// PrepareNotebookArchive 先保存可独立读取的完整归档，下载取消时不改变任何源文件。
func PrepareNotebookArchive(ids []string) (archiveID, downloadPath string, err error) {
	notebookArchiveMu.Lock()
	defer notebookArchiveMu.Unlock()
	lockSync()
	defer unlockSync()
	notebookCryptoMu.Lock()
	defer notebookCryptoMu.Unlock()
	notebookArchiveHistoryMu.Lock()
	defer notebookArchiveHistoryMu.Unlock()
	if err = recoverNotebookArchiveOperations(); err != nil {
		return
	}
	if len(ids) == 0 {
		return "", "", ErrNotebookArchiveInvalid
	}
	ids = append([]string(nil), ids...)
	sort.Strings(ids)
	candidates, err := listNotebookArchiveCandidates()
	if err != nil {
		return
	}
	known := map[string]bool{}
	for _, candidate := range candidates {
		known[candidate.ID] = true
	}
	for i, id := range ids {
		if !known[id] || i > 0 && ids[i-1] == id {
			return "", "", ErrNotebookArchiveInvalid
		}
	}
	release, err := holdNotebookArchiveBoxes(ids)
	if err != nil {
		return
	}
	defer release()
	for _, id := range ids {
		if err = EnsureAssetPrefixLocal(filepath.Join(util.DataDir, id)); err != nil {
			return
		}
	}
	roots, err := notebookArchiveRoots(ids)
	if err != nil {
		return
	}
	archiveID = ast.NewNodeID()
	directory, _ := notebookArchiveDirectory(archiveID)
	payload := filepath.Join(directory, "payload")
	if err = os.MkdirAll(payload, 0700); err != nil {
		return
	}
	for _, root := range roots {
		source, _ := archiveSourcePath(root)
		err = archiveWalk(source, func(name, fullPath string) error {
			return archiveCopyFile(fullPath, filepath.Join(payload, filepath.FromSlash(root), filepath.FromSlash(name)))
		})
		if err != nil {
			return
		}
	}
	keys, err := notebookArchiveKeys()
	if err != nil {
		return
	}
	if err = os.MkdirAll(filepath.Join(payload, "keys"), 0700); err != nil {
		return
	}
	for name, data := range keys {
		if err = os.WriteFile(filepath.Join(payload, filepath.FromSlash(name)), data, 0600); err != nil {
			return
		}
	}
	err = collectNotebookArchiveSnapshots(payload, ids)
	if err != nil {
		return
	}
	manifest := &notebookArchiveManifest{Format: notebookArchiveFormat, Version: 1, ID: archiveID, Notebooks: ids, Roots: roots}
	if err = writeNotebookArchive(directory, manifest); err != nil {
		return
	}
	if _, err = readNotebookArchive(filepath.Join(directory, "archive.zip"), ""); err != nil {
		return
	}
	if err = checkNotebookArchiveSources(manifest); err != nil {
		return
	}
	if err = writeNotebookArchiveOperation(directory, &notebookArchiveOperation{State: "prepared", Roots: roots}); err != nil {
		return
	}
	name := "encrypted-notebooks-" + archiveID + ".zip"
	if err = archiveCopyFile(filepath.Join(directory, "archive.zip"), filepath.Join(util.TempDir, "export", name)); err != nil {
		return
	}
	return archiveID, "/export/" + name, nil
}

func collectNotebookArchiveSnapshots(payload string, ids []string) error {
	selected := map[string]bool{}
	for _, id := range ids {
		selected[id] = true
	}
	return walkNotebookArchiveSnapshots(func(repo *dejavu.Repo, index *entity.Index, files []*entity.File) error {
		var selectedFiles []*entity.File
		for _, file := range files {
			name := strings.TrimPrefix(file.Path, "/")
			parts := strings.Split(name, "/")
			if len(parts) > 1 && selected[parts[0]] {
				selectedFiles = append(selectedFiles, file)
			}
		}
		if len(selectedFiles) == 0 {
			return nil
		}
		for _, file := range files {
			name := strings.TrimPrefix(file.Path, "/")
			if name == ".siyuan/data-crypto-backup.json" || name == ".siyuan/master-password-migration.json" {
				selectedFiles = append(selectedFiles, file)
			}
		}
		for _, file := range selectedFiles {
			name := strings.TrimPrefix(file.Path, "/")
			if name == ".siyuan/data-crypto-backup.json" {
				name = "keys/backup.json"
			}
			if name == ".siyuan/master-password-migration.json" {
				name = "keys/migration.json"
			}
			if !archiveRelativePath(name) {
				return ErrNotebookArchiveInvalid
			}
			data, err := openRepoFileWithAssets(repo, file)
			if err != nil {
				return err
			}
			destination := filepath.Join(payload, "snapshots", index.ID, filepath.FromSlash(name))
			if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
				return err
			}
			if err = os.WriteFile(destination, data, 0600); err != nil {
				return err
			}
		}
		return nil
	})
}

func checkNotebookArchiveSources(manifest *notebookArchiveManifest) error {
	roots, err := notebookArchiveRoots(manifest.Notebooks)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(roots, manifest.Roots) {
		return ErrNotebookArchiveChanged
	}
	for _, root := range roots {
		source, _ := archiveSourcePath(root)
		files, err := archiveDirectoryFiles(source)
		if err != nil {
			return err
		}
		expected := map[string]notebookArchiveFile{}
		for name, file := range manifest.Files {
			if strings.HasPrefix(name, root+"/") {
				expected[strings.TrimPrefix(name, root+"/")] = file
			}
		}
		if !reflect.DeepEqual(files, expected) {
			return ErrNotebookArchiveChanged
		}
	}
	keys, err := notebookArchiveKeys()
	if err != nil {
		return err
	}
	for name, file := range manifest.Files {
		if strings.HasPrefix(name, "keys/") {
			actual, exists := keys[name]
			fingerprint, _ := archiveFingerprint(bytes.NewReader(actual))
			if !exists || fingerprint != file {
				return ErrNotebookArchiveChanged
			}
			delete(keys, name)
		}
	}
	if len(keys) != 0 {
		return ErrNotebookArchiveChanged
	}
	return checkNotebookArchiveSnapshots(manifest)
}

func checkNotebookArchiveSnapshots(manifest *notebookArchiveManifest) error {
	selected := map[string]bool{}
	for _, id := range manifest.Notebooks {
		selected[id] = true
	}
	return walkNotebookArchiveSnapshots(func(repo *dejavu.Repo, index *entity.Index, files []*entity.File) error {
		for _, file := range files {
			name := strings.TrimPrefix(file.Path, "/")
			parts := strings.Split(name, "/")
			if len(parts) < 2 || !selected[parts[0]] {
				continue
			}
			expected, exists := manifest.Files["snapshots/"+index.ID+"/"+name]
			if !exists {
				return ErrNotebookArchiveChanged
			}
			data, err := openRepoFileWithAssets(repo, file)
			if err != nil {
				return err
			}
			actual, err := archiveFingerprint(bytes.NewReader(data))
			if err != nil {
				return err
			}
			if actual != expected {
				return ErrNotebookArchiveChanged
			}
		}
		return nil
	})
}

// CommitNotebookArchive 将源目录移到归档旁的恢复目录，整个过程不调用会创建删除历史的普通删除接口。
func CommitNotebookArchive(id string, saved bool) error {
	if !saved {
		return ErrNotebookArchiveInvalid
	}
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
	directory, err := notebookArchiveDirectory(id)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(directory, "operation.json"))
	if err != nil {
		return err
	}
	operation := &notebookArchiveOperation{}
	if json.Unmarshal(data, operation) != nil || !operation.valid() {
		return ErrNotebookArchiveInvalid
	}
	if operation.State == "committed" {
		return nil
	}
	if operation.State != "prepared" {
		return ErrNotebookArchiveBusy
	}
	manifest, err := readNotebookArchive(filepath.Join(directory, "archive.zip"), "")
	if err != nil {
		return err
	}
	if manifest.ID != id || !reflect.DeepEqual(operation.Roots, manifest.Roots) {
		return ErrNotebookArchiveInvalid
	}
	release, err := holdNotebookArchiveBoxes(manifest.Notebooks)
	if err != nil {
		return err
	}
	defer release()
	if err = checkNotebookArchiveSources(manifest); err != nil {
		return err
	}
	operation.State = "committing"
	if err = writeNotebookArchiveOperation(directory, operation); err != nil {
		return err
	}
	for _, root := range operation.Roots {
		source, _ := archiveSourcePath(root)
		destination := filepath.Join(directory, "removed", filepath.FromSlash(root))
		if err = os.MkdirAll(filepath.Dir(destination), 0700); err == nil {
			err = os.Rename(source, destination)
		}
		if err != nil {
			if rollbackErr := rollbackNotebookArchive(directory, operation); rollbackErr != nil {
				return fmt.Errorf("%w: %v; %v", ErrNotebookArchiveBusy, err, rollbackErr)
			}
			return err
		}
	}
	operation.State = "committed"
	if err = writeNotebookArchiveOperation(directory, operation); err != nil {
		operation.State = "committing"
		_ = rollbackNotebookArchive(directory, operation)
		return err
	}
	for _, boxID := range manifest.Notebooks {
		removeHPathRefreshBox(boxID)
		maintainPinnedDocs(nil, boxID, "")
		ClearRichClipboardBox(boxID)
		RevokeManagedEncryptedExportsForBox(boxID)
		sql.RemoveEncryptedDBFile(boxID)
		treenode.RemoveEncryptedBlockTreeDBFile(boxID)
		forgetRuntimeEncryptedBox(boxID)
		removeEncryptedBoxLifecycle(boxID)
		evt := util.NewCmdResult("removeBox", 0, util.PushModeBroadcast)
		evt.Data = map[string]string{"box": boxID}
		util.PushEvent(evt)
	}
	IncSync()
	ReindexHistory()
	return nil
}

func rollbackNotebookArchive(directory string, operation *notebookArchiveOperation) error {
	for i := len(operation.Roots) - 1; i >= 0; i-- {
		root := operation.Roots[i]
		source, err := archiveSourcePath(root)
		if err != nil {
			return err
		}
		removed := filepath.Join(directory, "removed", filepath.FromSlash(root))
		if _, err = os.Lstat(removed); os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if _, err = os.Lstat(source); !os.IsNotExist(err) {
			return ErrNotebookArchiveBusy
		}
		if err = os.MkdirAll(filepath.Dir(source), 0700); err != nil {
			return err
		}
		if err = os.Rename(removed, source); err != nil {
			return err
		}
	}
	operation.State = "prepared"
	return writeNotebookArchiveOperation(directory, operation)
}

// recoverNotebookArchiveOperations 在启动挂载和同步之前回滚未提交的移动，保留全部原始文件。
func recoverNotebookArchiveOperations() error {
	entries, err := os.ReadDir(notebookArchiveBase())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || !ast.IsNodeIDPattern(entry.Name()) {
			continue
		}
		directory, _ := notebookArchiveDirectory(entry.Name())
		data, err := os.ReadFile(filepath.Join(directory, "operation.json"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		operation := &notebookArchiveOperation{}
		if json.Unmarshal(data, operation) != nil || !operation.valid() {
			return ErrNotebookArchiveInvalid
		}
		if operation.State == "committing" {
			if err = rollbackNotebookArchive(directory, operation); err != nil {
				logging.LogErrorf("recover encrypted notebook archive [%s] failed: %s", entry.Name(), err)
				return err
			}
		}
		if operation.State == "importing" {
			if err = rollbackNotebookArchiveImport(directory, operation); err != nil {
				return err
			}
		}
	}
	return nil
}

func checkPendingNotebookArchives() error {
	entries, err := os.ReadDir(notebookArchiveBase())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || !ast.IsNodeIDPattern(entry.Name()) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(notebookArchiveBase(), entry.Name(), "operation.json"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		var operation notebookArchiveOperation
		if json.Unmarshal(data, &operation) != nil || !operation.valid() || operation.State == "committing" || operation.State == "importing" {
			return ErrNotebookArchiveBusy
		}
	}
	return nil
}

// preserveNotebookCryptoBeforeDisable 确认本地快照已有完整离线归档，另存旧配置后才允许结束旧密钥域。
func preserveNotebookCryptoBeforeDisable() error {
	covered := map[string]notebookArchiveFile{}
	keys, err := notebookArchiveKeys()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(notebookArchiveBase())
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || !ast.IsNodeIDPattern(entry.Name()) {
			continue
		}
		directory, _ := notebookArchiveDirectory(entry.Name())
		data, readErr := os.ReadFile(filepath.Join(directory, "operation.json"))
		if os.IsNotExist(readErr) {
			continue
		}
		if readErr != nil {
			return readErr
		}
		var operation notebookArchiveOperation
		if json.Unmarshal(data, &operation) != nil || !operation.valid() {
			return ErrNotebookArchiveInvalid
		}
		if operation.State != "committed" {
			continue
		}
		manifest, readErr := readNotebookArchive(filepath.Join(directory, "archive.zip"), "")
		if readErr != nil {
			return readErr
		}
		// 已提交归档保留其生成时的密钥；之后重新启用或改密不影响这些旧快照的归档覆盖。
		for name, fingerprint := range manifest.Files {
			covered[name] = fingerprint
		}
	}
	err = walkNotebookArchiveSnapshots(func(repo *dejavu.Repo, index *entity.Index, files []*entity.File) error {
		encrypted := map[string]bool{}
		for _, file := range files {
			name := strings.TrimPrefix(file.Path, "/")
			parts := strings.Split(name, "/")
			if len(parts) != 3 || !ast.IsNodeIDPattern(parts[0]) || parts[1] != ".siyuan" {
				continue
			}
			if parts[2] == notebookCryptoBackupFilename {
				encrypted[parts[0]] = true
			}
			if parts[2] == "conf.json" {
				data, readErr := openRepoFileWithAssets(repo, file)
				if readErr != nil {
					return readErr
				}
				var boxConf conf.BoxConf
				if json.Unmarshal(data, &boxConf) == nil && boxConf.Encrypted {
					encrypted[parts[0]] = true
				}
			}
		}
		for _, file := range files {
			name := strings.TrimPrefix(file.Path, "/")
			if !encrypted[strings.Split(name, "/")[0]] {
				continue
			}
			expected, exists := covered["snapshots/"+index.ID+"/"+name]
			if !exists {
				return ErrNotebookArchiveChanged
			}
			data, readErr := openRepoFileWithAssets(repo, file)
			if readErr != nil {
				return readErr
			}
			actual, _ := archiveFingerprint(bytes.NewReader(data))
			if actual != expected {
				return ErrNotebookArchiveChanged
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	directory, _ := notebookArchiveDirectory(ast.NewNodeID())
	if err = os.MkdirAll(filepath.Join(directory, "keys"), 0700); err != nil {
		return err
	}
	for name, data := range keys {
		if err = atomicWriteFile(filepath.Join(directory, filepath.FromSlash(name)), data); err != nil {
			return err
		}
	}
	// 全部现存笔记本和历史已经移出；中断改密的原始恢复记录保存在上面的版本化密钥目录中。
	if _, exists := keys["keys/migration.json"]; exists {
		if err = os.Remove(masterPasswordMigrationPath()); err != nil {
			return err
		}
	}
	return nil
}
