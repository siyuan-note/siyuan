package model

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var sortConfRecoveryLock sync.Mutex

// recoverSortConfMap 先保存损坏原文，再从同路径快照或可用整数条目恢复排序。
func recoverSortConfMap(confPath string, data []byte) (map[string]int, error) {
	relPath, ok := dataRelativePath(util.DataDir, confPath)
	if !ok {
		return nil, fmt.Errorf("sort conf outside data directory [%s]", confPath)
	}
	backupRoot := filepath.Join(util.WorkspaceDir, "corrupted")
	if err := os.MkdirAll(backupRoot, 0700); err != nil {
		return nil, err
	}
	backupDir, err := os.MkdirTemp(backupRoot, time.Now().Format("2006-01-02-150405")+"-sort-")
	if err != nil {
		return nil, err
	}
	backupPath := filepath.Join(backupDir, filepath.FromSlash(strings.TrimPrefix(relPath, "/")))
	if err = os.MkdirAll(filepath.Dir(backupPath), 0700); err != nil {
		return nil, err
	}
	if err = filelock.WriteFile(backupPath, data); err != nil {
		return nil, fmt.Errorf("backup sort conf [%s]: %w", confPath, err)
	}
	logging.LogWarnf("backed up corrupted sort conf [%s] to [%s]", confPath, backupPath)

	recovered, snapshotID, err := sortConfFromSnapshots(relPath)
	if err != nil {
		return nil, err
	}
	if recovered == nil {
		recovered = salvageSortConfMap(data)
		logging.LogWarnf("recover sort conf [%s] without a usable snapshot, preserving [%d] integer entries", confPath, len(recovered))
	} else {
		logging.LogInfof("recover sort conf [%s] from snapshot [%s]", confPath, snapshotID)
	}
	if err = writeSortConfMap(confPath, recovered); err != nil {
		return nil, err
	}
	IncSyncIfNeeded(confPath)
	return recovered, nil
}

func salvageSortConfMap(data []byte) map[string]int {
	ret := map[string]int{}
	var entries map[string]json.RawMessage
	if json.Unmarshal(data, &entries) != nil {
		return ret
	}
	for id, raw := range entries {
		var value int
		if string(raw) != "null" && json.Unmarshal(raw, &value) == nil {
			ret[id] = value
		}
	}
	return ret
}

func sortConfFromSnapshots(relPath string) (map[string]int, string, error) {
	// 未配置快照密钥或没有本地索引时不访问云端，直接使用原文件中的可用条目。
	if Conf.Repo == nil || len(Conf.Repo.Key) == 0 {
		return nil, "", nil
	}
	if _, err := os.Stat(filepath.Join(util.RepoDir, "indexes")); err != nil {
		if os.IsNotExist(err) {
			return nil, "", nil
		}
		return nil, "", err
	}
	repo, err := newRepository()
	if err != nil {
		return nil, "", err
	}
	seen := map[string]bool{}
	for page := 1; ; page++ {
		indexes, _, pageCount, err := repo.GetIndexes(page, 64)
		if err != nil {
			return nil, "", err
		}
		for _, index := range indexes {
			for _, fileID := range index.Files {
				if seen[fileID] {
					continue
				}
				seen[fileID] = true
				file, err := repo.GetFile(fileID)
				if err != nil {
					return nil, "", err
				}
				if file.Path != relPath {
					continue
				}
				data, err := repo.OpenFile(file)
				if err != nil {
					// 认证失败或仓库损坏时保留原配置，不能把恢复失败当作没有快照。
					return nil, "", err
				}
				var entries map[string]json.RawMessage
				if json.Unmarshal(data, &entries) != nil || entries == nil {
					continue
				}
				ret := salvageSortConfMap(data)
				if len(ret) == len(entries) {
					return ret, index.ID, nil
				}
			}
		}
		if page >= pageCount {
			return nil, "", nil
		}
	}
}
