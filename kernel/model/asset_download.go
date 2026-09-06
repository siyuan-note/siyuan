// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 资源下载不持有同步锁，避免调用方的笔记本读锁与同步后的笔记本更新互相等待。
var assetDownloadSourceMu sync.RWMutex

func assetDownloadStatePath() string {
	return filepath.Join(util.ConfDir, "asset-downloads.json")
}

func assetDownloadStateExists() (bool, error) {
	return dejavu.AssetDownloadStateExists(assetDownloadStatePath(), util.RepoDir)
}

// assetDownloadScope 只绑定资源来源，不将令牌、超时或并发等连接选项作为仓库身份。
func assetDownloadScope(provider int, c *cloud.Conf, key []byte) string {
	dir := c.Dir
	if provider == conf.ProviderS3 {
		dir = ""
	}
	identity := []string{fmt.Sprint(provider), dir, fmt.Sprintf("%x", sha256.Sum256(key))}
	switch provider {
	case conf.ProviderSiYuan:
		identity = append(identity, c.Server, c.UserID)
	case conf.ProviderS3:
		if c.S3 != nil {
			identity = append(identity, c.S3.Endpoint, c.S3.Bucket)
		}
	case conf.ProviderWebDAV:
		if c.WebDAV != nil {
			identity = append(identity, c.WebDAV.Endpoint, c.WebDAV.Username)
		}
	case conf.ProviderLocal:
		if c.Local != nil {
			identity = append(identity, filepath.Clean(c.Local.Endpoint))
		}
	}
	data, _ := json.Marshal(identity)
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

// DeferredSyncAssets 仅读取逻辑清单，不发起下载。
func DeferredSyncAssets() ([]*entity.File, error) {
	return deferredSyncAssets()
}

func deferredSyncAssets() ([]*entity.File, error) {
	exists, err := assetDownloadStateExists()
	if err != nil || !exists {
		return nil, err
	}
	if Conf.Repo == nil || len(Conf.Repo.Key) == 0 {
		return nil, errors.New(Conf.Language(377))
	}
	return dejavu.ReadDeferredAssets(assetDownloadStatePath(), Conf.Repo.Key)
}

// validateAssetDownloadSourceScope 在公布新的账号身份前保留未完成的资源与历史恢复来源。
func validateAssetDownloadSourceScope(scope string) error {
	exists, err := assetDownloadStateExists()
	if err != nil || !exists {
		return err
	}
	if Conf.Repo == nil || len(Conf.Repo.Key) == 0 {
		return errors.New(Conf.Language(377))
	}
	stored, err := dejavu.ReadAssetDownloadScope(assetDownloadStatePath(), Conf.Repo.Key)
	if err != nil || stored == scope {
		return err
	}
	return requireCompleteAssetDownloads()
}

func checkAssetDownloadAccess() error {
	if Conf.Sync == nil || !Conf.Sync.Enabled || Conf.GetUser() == nil {
		return errors.New(Conf.Language(376))
	}
	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			return errors.New(Conf.Language(376))
		}
	case conf.ProviderS3, conf.ProviderWebDAV, conf.ProviderLocal:
		if !IsPaidUser() {
			return errors.New(Conf.Language(376))
		}
	}
	return nil
}

func dataRelativeAssetPath(absPath string) (string, error) {
	if !filepath.IsAbs(absPath) {
		return "", fmt.Errorf("asset path must be absolute")
	}
	rel, err := filepath.Rel(util.DataDir, filepath.Clean(absPath))
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("asset path is outside data directory")
	}
	if rel == "." {
		return "/", nil
	}
	return "/" + filepath.ToSlash(rel), nil
}

// EnsureAssetLocal 在调用方完成访问校验后补齐资源，下载内容仍由原有读取流程认证。
func EnsureAssetLocal(absPath string) error {
	if _, err := os.Stat(absPath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	assetDownloadSourceMu.RLock()
	defer assetDownloadSourceMu.RUnlock()
	rel, err := dataRelativeAssetPath(absPath)
	if err != nil {
		return err
	}
	files, err := deferredSyncAssets()
	if err != nil {
		return err
	}
	for _, file := range files {
		if file.Path == rel {
			if repoFileNeedsDownload(file) {
				if err = checkAssetDownloadAccess(); err != nil {
					return err
				}
			}
			repo, repoErr := newSyncRepositoryWithAssetSourceLocked()
			if repoErr != nil {
				return repoErr
			}
			var downloaded bool
			if downloaded, err = repo.EnsureAsset(rel, newSyncContext()); err != nil {
				return fmt.Errorf("%s: %w", Conf.Language(376), err)
			}
			if downloaded {
				HandleAssetsChangeEvent(absPath)
			}
			return nil
		}
	}
	return &os.PathError{Op: "open", Path: absPath, Err: os.ErrNotExist}
}

// EnsureAssetPrefixLocal 补齐逻辑清单中的目录内容，不能仅遍历本地磁盘。
func EnsureAssetPrefixLocal(absPrefix string) error {
	prefix, err := dataRelativeAssetPath(absPrefix)
	if err != nil {
		return err
	}
	files, err := deferredSyncAssets()
	if err != nil || len(files) == 0 {
		return err
	}
	hasDeferred := false
	for _, file := range files {
		if file.Path == prefix || strings.HasPrefix(file.Path, strings.TrimSuffix(prefix, "/")+"/") {
			hasDeferred = true
			break
		}
	}
	if !hasDeferred {
		return nil
	}
	assetDownloadSourceMu.RLock()
	defer assetDownloadSourceMu.RUnlock()
	files, err = deferredSyncAssets()
	if err != nil {
		return err
	}
	var repo *dejavu.Repo
	for _, file := range files {
		if file.Path != prefix && !strings.HasPrefix(file.Path, strings.TrimSuffix(prefix, "/")+"/") {
			continue
		}
		if repoFileNeedsDownload(file) {
			if err = checkAssetDownloadAccess(); err != nil {
				return err
			}
		}
		if repo == nil {
			repo, err = newSyncRepositoryWithAssetSourceLocked()
			if err != nil {
				return err
			}
		}
		var downloaded bool
		if downloaded, err = repo.EnsureAsset(file.Path, newSyncContext()); err != nil {
			return fmt.Errorf("%s: %w", Conf.Language(376), err)
		}
		if downloaded {
			HandleAssetsChangeEvent(filepath.Join(util.DataDir, filepath.FromSlash(strings.TrimPrefix(file.Path, "/"))))
		}
	}
	return nil
}

// EnsureAllSyncAssets 用于完整导出和退出按需模式，不改变资源的逻辑版本。
func EnsureAllSyncAssets() error {
	assetDownloadSourceMu.RLock()
	defer assetDownloadSourceMu.RUnlock()
	return ensureAllSyncAssets()
}

func ensureAllSyncAssets() error {
	files, err := deferredSyncAssets()
	if err != nil || len(files) == 0 {
		return err
	}
	for _, file := range files {
		if repoFileNeedsDownload(file) {
			if err = checkAssetDownloadAccess(); err != nil {
				return err
			}
			break
		}
	}
	repo, err := newSyncRepositoryWithAssetSourceLocked()
	if err != nil {
		return err
	}
	if err = repo.EnsureAllAssets(newSyncContext()); err != nil {
		return fmt.Errorf("%s: %w", Conf.Language(376), err)
	}
	return nil
}

func requireCompleteAssetDownloads() error {
	files, err := deferredSyncAssets()
	if err != nil {
		return err
	}
	if len(files) != 0 {
		return errors.New(Conf.Language(377))
	}
	exists, err := assetDownloadStateExists()
	if err != nil || !exists {
		return err
	}
	repo, err := newRepositoryWithAssetSourceLocked()
	if err != nil {
		return err
	}
	incomplete, err := repo.HasIncompleteSnapshots()
	if err != nil {
		return err
	}
	if incomplete {
		return errors.New(Conf.Language(377))
	}
	return nil
}

// clearAssetDownloadState 在旧密钥仍可认证且全部恢复内容齐全时清除设备状态。
func clearAssetDownloadState() error {
	exists, err := assetDownloadStateExists()
	if err != nil || !exists {
		return err
	}
	repo, err := newRepositoryWithAssetSourceLocked()
	if err != nil {
		return err
	}
	return repo.ClearAssetDownloadState()
}

func SetSyncAssetDownloadMode(mode int) error {
	if mode != 0 && mode != 1 {
		return errors.New("invalid asset download mode")
	}
	lockSync()
	defer unlockSync()
	assetDownloadSourceMu.Lock()
	defer assetDownloadSourceMu.Unlock()
	if mode == 0 {
		if err := ensureAllSyncAssets(); err != nil {
			return err
		}
		exists, err := assetDownloadStateExists()
		if err != nil {
			return err
		}
		if exists {
			repo, repoErr := newRepositoryWithAssetSourceLocked()
			if repoErr != nil {
				return repoErr
			}
			incomplete, checkErr := repo.HasIncompleteSnapshots()
			if checkErr != nil {
				return checkErr
			}
			if incomplete {
				if err = checkAssetDownloadAccess(); err != nil {
					return err
				}
				if err = repo.EnsureAllSnapshotChunks(newSyncContext()); err != nil {
					return fmt.Errorf("%s: %w", Conf.Language(376), err)
				}
			}
		}
	}
	Conf.Sync.AssetDownloadMode = mode
	Conf.Save()
	return nil
}

// lockAssetSourceChange 与同步、首次下载串行化来源切换；释放函数可重复调用。
func lockAssetSourceChange() func() {
	lockSync()
	assetDownloadSourceMu.Lock()
	var once sync.Once
	return func() {
		once.Do(func() {
			assetDownloadSourceMu.Unlock()
			unlockSync()
		})
	}
}

func openRepoFileWithAssets(repo *dejavu.Repo, file *entity.File) ([]byte, error) {
	data, err := repo.OpenFile(file)
	if err == nil || !errors.Is(err, os.ErrNotExist) {
		return data, err
	}
	if err = checkAssetDownloadAccess(); err != nil {
		return nil, err
	}
	if err = repo.EnsureFileChunks(file, newSyncContext()); err != nil {
		return nil, fmt.Errorf("%s: %w", Conf.Language(376), err)
	}
	return repo.OpenFile(file)
}

// readRepoFileWithAssets 将仓库实例的创建和历史分块补齐纳入来源读锁。
func readRepoFileWithAssets(fileID string) ([]byte, *entity.File, error) {
	assetDownloadSourceMu.RLock()
	defer assetDownloadSourceMu.RUnlock()
	if Conf.Repo == nil || len(Conf.Repo.Key) == 0 {
		return nil, nil, errors.New(Conf.Language(26))
	}
	repo, err := newRepositoryWithAssetSourceLocked()
	if err != nil {
		return nil, nil, err
	}
	file, err := repo.GetFile(fileID)
	if err != nil {
		return nil, nil, err
	}
	if boxID := encryptedBoxIDFromRepoPath(file.Path); boxID != "" && !IsBoxUnlocked(boxID) {
		return nil, nil, errors.New(Conf.Language(314))
	}
	data, err := openRepoFileWithAssets(repo, file)
	return data, file, err
}

func ensureRepoSnapshotComplete(repo *dejavu.Repo, indexID string) error {
	index, err := repo.GetIndex(indexID)
	if err != nil {
		return err
	}
	return repo.GetFilesIter(index, func(file *entity.File) error {
		if !repoFileNeedsDownload(file) {
			return nil
		}
		if err := checkAssetDownloadAccess(); err != nil {
			return err
		}
		return repo.EnsureFileChunks(file, newSyncContext())
	})
}

func repoFileNeedsDownload(file *entity.File) bool {
	return repoFileNeedsDownloadWithCache(file, nil)
}

func repoFileNeedsDownloadWithCache(file *entity.File, chunkAvailability map[string]bool) bool {
	for _, chunkID := range file.Chunks {
		if len(chunkID) != 40 {
			return true
		}
		available, checked := chunkAvailability[chunkID]
		if !checked {
			_, err := os.Stat(filepath.Join(util.RepoDir, "objects", chunkID[:2], chunkID[2:]))
			available = err == nil
			if chunkAvailability != nil {
				chunkAvailability[chunkID] = available
			}
		}
		if !available {
			return true
		}
	}
	return false
}
