// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	kernelSyncCommitWALVersion = 1
	kernelSyncCommitWALMaxSize = int64(64 * 1024 * 1024)
)

var kernelSyncCommitRecoveryMu sync.Mutex

type kernelSyncCommitWAL struct {
	Version   int                         `json:"version"`
	SessionID string                      `json:"sessionId"`
	Changes   []kernelSyncCommitWALChange `json:"changes"`
}

type kernelSyncCommitWALChange struct {
	Operation  string `json:"operation"`
	Path       string `json:"path"`
	TargetName string `json:"targetName"`
	StagedName string `json:"stagedName,omitempty"`
	BackupName string `json:"backupName,omitempty"`
	Size       int64  `json:"size,omitempty"`
	Hash       string `json:"hash,omitempty"`
}

func kernelSyncCommitWALDir() string {
	return filepath.Join(util.TempDir, "kernel-sync", "wal")
}

func kernelSyncCommitWALPath(sessionID string) string {
	return filepath.Join(kernelSyncCommitWALDir(), sessionID+".json")
}

func validKernelSyncCommitWALName(name, prefix string) bool {
	if len(name) != len(prefix)+32+len(".tmp") || !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".tmp") || filepath.Base(name) != name {
		return false
	}
	random := strings.TrimSuffix(strings.TrimPrefix(name, prefix), ".tmp")
	decoded, err := hex.DecodeString(random)
	return err == nil && len(decoded) == 16 && strings.ToLower(random) == random
}

func validKernelSyncCommitWALSessionID(sessionID string) bool {
	if len(sessionID) != 48 {
		return false
	}
	decoded, err := hex.DecodeString(sessionID)
	return err == nil && len(decoded) == 24 && strings.ToLower(sessionID) == sessionID
}

func validKernelSyncCommitWALHash(hash string) bool {
	if len(hash) != len(syncContentSHA256Prefix)+sha256.Size*2 || !strings.HasPrefix(hash, syncContentSHA256Prefix) {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(hash, syncContentSHA256Prefix))
	return err == nil && strings.ToLower(hash) == hash
}

func writeKernelSyncCommitWAL(sessionID string, prepared []*preparedKernelSyncChange) (string, error) {
	if !validKernelSyncCommitWALSessionID(sessionID) || len(prepared) == 0 || len(prepared) > kernelSyncMaxChanges {
		return "", errors.New("invalid kernel sync commit WAL")
	}
	wal := kernelSyncCommitWAL{Version: kernelSyncCommitWALVersion, SessionID: sessionID, Changes: make([]kernelSyncCommitWALChange, 0, len(prepared))}
	syncedParents := map[string]struct{}{}
	for _, item := range prepared {
		if item.parent == nil {
			return "", errors.New("invalid kernel sync commit WAL parent")
		}
		parentPath := filepath.Clean(filepath.Dir(item.guard.absPath))
		if _, synced := syncedParents[parentPath]; !synced {
			if err := syncKernelSyncCommitParent(item.parent); err != nil {
				return "", err
			}
			syncedParents[parentPath] = struct{}{}
		}
		change := kernelSyncCommitWALChange{
			Operation: item.change.Operation, Path: item.change.Path, TargetName: item.targetName,
			StagedName: item.stagedName, BackupName: item.backupName, Size: item.change.Size, Hash: item.change.Hash,
		}
		if err := validateKernelSyncCommitWALChange(change); err != nil {
			return "", err
		}
		wal.Changes = append(wal.Changes, change)
	}
	encoded, err := json.Marshal(wal)
	if err != nil {
		return "", err
	}
	if int64(len(encoded)) > kernelSyncCommitWALMaxSize {
		return "", errors.New("kernel sync commit WAL is too large")
	}
	dir := kernelSyncCommitWALDir()
	if err = os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	temporary, err := os.CreateTemp(dir, ".commit-wal-")
	if err != nil {
		return "", err
	}
	temporaryPath := temporary.Name()
	keep := false
	defer func() {
		_ = temporary.Close()
		if !keep {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err = temporary.Chmod(0600); err == nil {
		_, err = temporary.Write(encoded)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	walPath := kernelSyncCommitWALPath(sessionID)
	if err = moveStagedFile(temporaryPath, walPath, false); err != nil {
		return "", err
	}
	keep = true
	if err = syncKernelSyncCommitWALDir(dir); err != nil {
		_ = os.Remove(walPath)
		return "", err
	}
	return walPath, nil
}

func syncKernelSyncCommitParent(parent *os.Root) error {
	directory, err := parent.Open(".")
	if err != nil {
		if runtime.GOOS == "windows" {
			return nil
		}
		return err
	}
	err = directory.Sync()
	closeErr := directory.Close()
	if runtime.GOOS == "windows" {
		return nil
	}
	return errors.Join(err, closeErr)
}

func removeKernelSyncCommitWAL(walPath string) error {
	if err := os.Remove(walPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := syncKernelSyncCommitWALDir(filepath.Dir(walPath)); err != nil {
		logging.LogWarnf("sync removed kernel sync commit WAL directory failed: %s", err)
	}
	return nil
}

func syncKernelSyncCommitWALDir(dir string) error {
	directory, err := os.Open(dir)
	if err != nil {
		if runtime.GOOS == "windows" {
			return nil
		}
		return err
	}
	err = directory.Sync()
	closeErr := directory.Close()
	if runtime.GOOS == "windows" {
		return nil
	}
	return errors.Join(err, closeErr)
}

func validateKernelSyncCommitWALChange(change kernelSyncCommitWALChange) error {
	if change.Path == "" || change.TargetName == "" || filepath.Base(change.TargetName) != change.TargetName {
		return errors.New("invalid kernel sync commit WAL path")
	}
	if change.BackupName != "" && !validKernelSyncCommitWALName(change.BackupName, ".siyuan-sync-backup-") {
		return errors.New("invalid kernel sync commit WAL backup")
	}
	switch change.Operation {
	case "write":
		if !validKernelSyncCommitWALName(change.StagedName, ".siyuan-stage-") || change.Size < 0 || !validKernelSyncCommitWALHash(change.Hash) {
			return errors.New("invalid kernel sync commit WAL write")
		}
	case "delete":
		if change.StagedName != "" {
			return errors.New("invalid kernel sync commit WAL deletion")
		}
	default:
		return errors.New("invalid kernel sync commit WAL operation")
	}
	return nil
}

func readKernelSyncCommitWAL(walPath string) (kernelSyncCommitWAL, error) {
	info, err := os.Lstat(walPath)
	if err != nil {
		return kernelSyncCommitWAL{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > kernelSyncCommitWALMaxSize {
		return kernelSyncCommitWAL{}, errors.New("invalid kernel sync commit WAL file")
	}
	file, err := os.Open(walPath)
	if err != nil {
		return kernelSyncCommitWAL{}, err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, kernelSyncCommitWALMaxSize+1))
	decoder.DisallowUnknownFields()
	var wal kernelSyncCommitWAL
	if err = decoder.Decode(&wal); err != nil {
		return kernelSyncCommitWAL{}, err
	}
	var trailing any
	if err = decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("kernel sync commit WAL contains trailing data")
		}
		return kernelSyncCommitWAL{}, err
	}
	if wal.Version != kernelSyncCommitWALVersion || !validKernelSyncCommitWALSessionID(wal.SessionID) ||
		filepath.Base(walPath) != wal.SessionID+".json" || len(wal.Changes) == 0 || len(wal.Changes) > kernelSyncMaxChanges {
		return kernelSyncCommitWAL{}, errors.New("invalid kernel sync commit WAL header")
	}
	seen := map[string]struct{}{}
	for _, change := range wal.Changes {
		if err = validateKernelSyncCommitWALChange(change); err != nil {
			return kernelSyncCommitWAL{}, err
		}
		if _, exists := seen[change.Path]; exists {
			return kernelSyncCommitWAL{}, errors.New("duplicate kernel sync commit WAL path")
		}
		seen[change.Path] = struct{}{}
	}
	return wal, nil
}

type recoveringKernelSyncChange struct {
	walChange  kernelSyncCommitWALChange
	guard      workspacePathGuard
	parent     *os.Root
	targetName string
	sourceName string
}

// RecoverKernelSyncCommits 在启动同步前重做已持久化但尚未完成索引提交的文件批次。
func RecoverKernelSyncCommits() error {
	kernelSyncCommitRecoveryMu.Lock()
	defer kernelSyncCommitRecoveryMu.Unlock()
	dir := kernelSyncCommitWALDir()
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].Name() < entries[right].Name() })
	recovered := 0
	var errs []error
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		walPath := filepath.Join(dir, entry.Name())
		if err = recoverKernelSyncCommitWAL(walPath); err != nil {
			errs = append(errs, fmt.Errorf("recover kernel sync commit WAL %s: %w", entry.Name(), err))
			continue
		}
		recovered++
	}
	if recovered > 0 {
		kernelSyncReloadFiletree()
		kernelSyncIncSync()
	}
	return errors.Join(errs...)
}

func recoverKernelSyncCommitWAL(walPath string) error {
	wal, err := readKernelSyncCommitWAL(walPath)
	if err != nil {
		return err
	}
	guards := make([]workspacePathGuard, 0, len(wal.Changes))
	prepared := make([]*recoveringKernelSyncChange, 0, len(wal.Changes))
	documentTargets := make([]model.RawDocumentIndexTarget, 0)
	documentLocations := map[string]kernelSyncDocumentLocation{}
	for _, change := range wal.Changes {
		guard, resolveErr := resolveWorkspacePath(change.Path, true)
		if resolveErr != nil {
			return resolveErr
		}
		dataPath := filepath.Clean(util.DataDir)
		if !sameOrNestedWorkspacePath(dataPath, guard.absPath) || sameWorkspacePath(dataPath, guard.absPath) || guard.rejectsEncryptedBox() {
			return errors.New("kernel sync recovery must target plaintext /data descendants")
		}
		_, location, documentPath, locationErr := kernelSyncNotebookDocumentLocation(guard)
		if locationErr != nil {
			return locationErr
		}
		if documentPath {
			documentTargets = append(documentTargets, model.RawDocumentIndexTarget{BoxID: location.boxID, DocumentPath: location.path})
			documentLocations[change.Path] = location
		}
		guards = append(guards, guard)
		prepared = append(prepared, &recoveringKernelSyncChange{walChange: change, guard: guard})
	}
	var indexBatch *model.RawDocumentIndexBatch
	if len(documentTargets) > 0 {
		indexBatch, err = model.LockRawDocumentIndexBatch(documentTargets)
		if err != nil {
			return err
		}
		defer indexBatch.Unlock()
	}
	unlocks := lockWorkspacePaths(guards...)
	defer unlocks()
	defer func() {
		for _, item := range prepared {
			if item.parent != nil {
				_ = item.parent.Close()
			}
		}
	}()
	for _, item := range prepared {
		if err = item.guard.revalidate(); err != nil {
			return err
		}
		workspaceRoot, relativePath, openErr := item.guard.openWorkspaceRoot()
		if openErr != nil {
			return openErr
		}
		parent, targetName, parentErr := openRootParentForCommit(workspaceRoot, relativePath, item.walChange.Operation == "write")
		_ = workspaceRoot.Close()
		if parentErr != nil {
			return parentErr
		}
		if targetName != item.walChange.TargetName {
			_ = parent.Close()
			return errors.New("kernel sync recovery target changed")
		}
		item.parent, item.targetName = parent, targetName
		if item.walChange.Operation == "write" {
			item.sourceName = item.walChange.StagedName
			if _, statErr := parent.Stat(item.sourceName); os.IsNotExist(statErr) {
				item.sourceName = targetName
			} else if statErr != nil {
				return statErr
			}
			if err = validateKernelSyncRecoverySource(item); err != nil {
				return err
			}
		}
	}
	if indexBatch != nil {
		for _, item := range prepared {
			location, documentPath := documentLocations[item.walChange.Path]
			if !documentPath {
				continue
			}
			if item.walChange.Operation == "delete" {
				if _, err = indexBatch.PrepareRemoval(location.boxID, location.path); err != nil {
					return err
				}
				continue
			}
			source, openErr := item.parent.Open(item.sourceName)
			if openErr != nil {
				return openErr
			}
			info, statErr := source.Stat()
			if statErr == nil {
				_, statErr = indexBatch.PrepareUpsert(location.boxID, location.path, source, info.Size())
			}
			closeErr := source.Close()
			if statErr == nil {
				statErr = closeErr
			}
			if statErr != nil {
				return statErr
			}
		}
	}
	for _, item := range prepared {
		if item.walChange.Operation == "delete" {
			if err = item.parent.Remove(item.targetName); err != nil && !os.IsNotExist(err) {
				return err
			}
			continue
		}
		if item.sourceName != item.targetName {
			if err = commitRootStagedFile(item.parent, item.sourceName, item.targetName, false); err != nil {
				return err
			}
			item.sourceName = item.targetName
		}
	}
	syncedParents := map[string]struct{}{}
	for _, item := range prepared {
		parentPath := filepath.Clean(filepath.Dir(item.guard.absPath))
		if _, synced := syncedParents[parentPath]; synced {
			continue
		}
		if err = syncKernelSyncCommitParent(item.parent); err != nil {
			return err
		}
		syncedParents[parentPath] = struct{}{}
	}
	if indexBatch != nil {
		if err = indexBatch.Commit(); err != nil {
			return err
		}
	}
	for _, item := range prepared {
		if item.walChange.StagedName != "" {
			if removeErr := item.parent.Remove(item.walChange.StagedName); removeErr != nil && !os.IsNotExist(removeErr) {
				return removeErr
			}
		}
		if item.walChange.BackupName != "" {
			if removeErr := item.parent.Remove(item.walChange.BackupName); removeErr != nil && !os.IsNotExist(removeErr) {
				return removeErr
			}
		}
	}
	for parentPath := range syncedParents {
		delete(syncedParents, parentPath)
	}
	for _, item := range prepared {
		parentPath := filepath.Clean(filepath.Dir(item.guard.absPath))
		if _, synced := syncedParents[parentPath]; synced {
			continue
		}
		if err = syncKernelSyncCommitParent(item.parent); err != nil {
			return err
		}
		syncedParents[parentPath] = struct{}{}
	}
	return removeKernelSyncCommitWAL(walPath)
}

func validateKernelSyncRecoverySource(item *recoveringKernelSyncChange) error {
	source, err := item.parent.Open(item.sourceName)
	if err != nil {
		return err
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != item.walChange.Size {
		return errors.New("kernel sync recovery source size changed")
	}
	hash, err := syncContentHashReader(source)
	if err != nil {
		return err
	}
	if hash != item.walChange.Hash {
		return errors.New("kernel sync recovery source hash changed")
	}
	return nil
}
