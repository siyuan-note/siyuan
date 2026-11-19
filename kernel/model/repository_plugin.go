// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"

	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func pluginSnapshotRoots(name string) ([]string, error) {
	if !archiveRelativePath(name) || strings.Contains(name, "/") {
		return nil, errors.New("invalid plugin name")
	}
	return []string{"plugins/" + name, "storage/petal/" + name}, nil
}

func pluginSnapshotFiles(repo *dejavu.Repo, index *entity.Index, roots []string) (files []*entity.File, counts [2]apicontract.PluginSnapshotStat, err error) {
	err = repo.GetFilesIter(index, func(file *entity.File) error {
		name := strings.TrimPrefix(file.Path, "/")
		for i, root := range roots {
			if strings.HasPrefix(name, root+"/") {
				if !archiveRelativePath(name) {
					return errors.New("invalid plugin snapshot path")
				}
				files = append(files, file)
				counts[i].Count++
				counts[i].Size += file.Size
			}
		}
		return nil
	})
	return
}

func GetPluginSnapshots(name string, page int) (ret apicontract.PluginSnapshotsData, err error) {
	ret.Snapshots = []*apicontract.PluginSnapshot{}
	roots, err := pluginSnapshotRoots(name)
	if err != nil {
		return ret, err
	}
	repo, err := newRepository()
	if err != nil {
		return ret, err
	}
	type fileStat struct {
		group int
		size  int64
	}
	cache := map[string]fileStat{}
	_, _, err = repo.GetIndexesIter(1, math.MaxInt, func(index *entity.Index) error {
		var counts [2]apicontract.PluginSnapshotStat
		for _, id := range index.Files {
			stat, cached := cache[id]
			if !cached {
				file, readErr := repo.GetFile(id)
				if readErr != nil {
					return readErr
				}
				stat = fileStat{group: -1, size: file.Size}
				name := strings.TrimPrefix(file.Path, "/")
				for group, root := range roots {
					if strings.HasPrefix(name, root+"/") {
						if !archiveRelativePath(name) {
							return errors.New("invalid plugin snapshot path")
						}
						stat.group = group
					}
				}
				cache[id] = stat
			}
			if stat.group >= 0 {
				counts[stat.group].Count++
				counts[stat.group].Size += stat.size
			}
		}
		if counts[0].Count+counts[1].Count > 0 {
			ret.Snapshots = append(ret.Snapshots, &apicontract.PluginSnapshot{
				ID: index.ID, Created: index.Created, Memo: index.Memo, Program: counts[0], Data: counts[1],
			})
		}
		return nil
	})
	if err == nil {
		ret.Snapshots, ret.PageCount, ret.TotalCount = repoSnapshotPage(ret.Snapshots, page,
			func(item *apicontract.PluginSnapshot) int64 { return item.Created })
	}
	return
}

// RestorePluginSnapshot 在写入前读取并认证全部目标文件，以同一时间点替换两个目录。
func RestorePluginSnapshot(name, id string) (backupID string, err error) {
	roots, err := pluginSnapshotRoots(name)
	if err != nil {
		return "", err
	}
	if len(id) != 40 || strings.Trim(id, "0123456789abcdef") != "" {
		return "", errors.New("invalid snapshot ID")
	}
	FlushTxQueue()
	lockSync()
	defer unlockSync()
	if err = checkDataImportRecovery(); err != nil {
		return "", err
	}
	repo, err := newRepository()
	if err != nil {
		return "", err
	}
	index, err := repo.GetIndex(id)
	if err != nil {
		return "", err
	}
	files, _, err := pluginSnapshotFiles(repo, index, roots)
	if err != nil {
		return "", err
	}
	if len(files) == 0 {
		return "", errors.New("plugin not found in snapshot")
	}
	stage, err := os.MkdirTemp(filepath.Dir(filepath.Clean(util.DataDir)), ".plugin-restore-")
	if err != nil {
		return "", err
	}
	keepStage := false
	defer func() {
		if !keepStage {
			os.RemoveAll(stage)
		}
	}()
	seen := map[string]bool{}
	for _, file := range files {
		name := strings.TrimPrefix(file.Path, "/")
		key := strings.ToLower(name)
		if seen[key] {
			return "", errors.New("duplicate plugin snapshot path")
		}
		seen[key] = true
		data, readErr := repo.OpenFile(file)
		if readErr != nil {
			return "", readErr
		}
		if int64(len(data)) != file.Size {
			return "", errors.New("invalid plugin snapshot file size")
		}
		target := filepath.Join(stage, "install", filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return "", err
		}
		if err = os.WriteFile(target, data, 0644); err != nil {
			return "", err
		}
	}
	// 停用状态属于共享插件配置，恢复目录后仍保持停用，避免旧实例自动重新载入。
	petal, err := updatePetal(name, func(petal *Petal) error { petal.Enabled = false; return nil })
	if err != nil {
		return "", err
	}
	if OnKernelPluginStop != nil {
		OnKernelPluginStop(petal)
	}
	PushReloadPlugin(nil, hashset.New(name), nil, nil, "", "")
	backupID, _, err = CreateRepoSnapshotWithFullCheck("Backup before plugin restore: "+name, true)
	if err != nil {
		return "", err
	}
	if err = installPluginSnapshot(stage, roots, os.Rename); err != nil {
		UpdateSyncConf(func(s *conf.Sync) { s.Enabled = false })
		keepStage = true
		return backupID, fmt.Errorf("%w; backup snapshot: %s; recovery files: %s", err, backupID, stage)
	}
	IncSyncIfNeeded(filepath.Join(util.DataDir, roots[0]), filepath.Join(util.DataDir, roots[1]))
	return
}

func installPluginSnapshot(stage string, roots []string, rename func(string, string) error) (err error) {
	type installedRoot struct {
		target, backup         string
		hadOriginal, installed bool
	}
	var applied []*installedRoot
	defer func() {
		if err == nil {
			return
		}
		for i := len(applied) - 1; i >= 0; i-- {
			entry := applied[i]
			if entry.installed {
				err = errors.Join(err, os.RemoveAll(entry.target))
			}
			if entry.hadOriginal {
				err = errors.Join(err, os.Rename(entry.backup, entry.target))
			}
		}
	}()
	for i, root := range roots {
		target := filepath.Join(util.DataDir, filepath.FromSlash(root))
		if err = validateEncryptedCleanupPath(util.DataDir, target); err != nil {
			return
		}
		entry := &installedRoot{target: target, backup: filepath.Join(stage, fmt.Sprintf("before-%d", i))}
		if info, statErr := os.Lstat(target); statErr == nil {
			if !info.IsDir() {
				return errors.New("plugin target is not a directory")
			}
			if err = rename(target, entry.backup); err != nil {
				return
			}
			entry.hadOriginal = true
		} else if !os.IsNotExist(statErr) {
			return statErr
		}
		applied = append(applied, entry)
		source := filepath.Join(stage, "install", filepath.FromSlash(root))
		if _, statErr := os.Stat(source); os.IsNotExist(statErr) {
			continue
		} else if statErr != nil {
			return statErr
		}
		if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return
		}
		if err = rename(source, target); err != nil {
			return
		}
		entry.installed = true
	}
	return
}
