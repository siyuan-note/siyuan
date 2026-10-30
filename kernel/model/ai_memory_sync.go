// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const memorySyncPrefix = "/storage/ai/memos/"

// memorySyncRead 逐级拒绝链接，所有访问固定在工作空间中；不接受模型提供的文件路径。
func memorySyncRead(dataDir, name string) ([]byte, error) {
	root, err := os.OpenRoot(dataDir)
	if err != nil {
		return nil, err
	}
	defer func() { root.Close() }()
	parts := strings.Split(strings.TrimPrefix(name, "/"), "/")
	for i, part := range parts {
		if part == "" || part == "." || part == ".." || strings.Contains(part, "\\") {
			return nil, memo.ErrInvalid
		}
		info, err := root.Lstat(part)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, memo.ErrInvalid
		}
		if i == len(parts)-1 {
			if !info.Mode().IsRegular() {
				return nil, memo.ErrInvalid
			}
			file, err := root.Open(part)
			if err != nil {
				return nil, err
			}
			defer file.Close()
			data, err := io.ReadAll(io.LimitReader(file, 2*1024*1024+1))
			if len(data) > 2*1024*1024 {
				return nil, memo.ErrInvalid
			}
			return data, err
		}
		if !info.IsDir() {
			return nil, memo.ErrInvalid
		}
		next, err := root.OpenRoot(part)
		if err != nil {
			return nil, err
		}
		root.Close()
		root = next
	}
	return nil, memo.ErrInvalid
}

// memoryCheckoutPreflight 保留撤回和冲突证据，并在覆盖前隔离非因果更新。
// 计划是仓库提供的不可变副本；新保存的保护文件不在本次替换/删除集合中。
func memoryCheckoutPreflight(dataDir string, plan *dejavu.CheckoutPlan) error {
	store := memo.NewStore(dataDir)
	ctx := context.Background()
	for _, file := range plan.Upserts {
		if !strings.HasPrefix(file.Path, memorySyncPrefix) {
			continue
		}
		if file.Size > memo.MaxFileSize {
			return errors.New("memory checkout file exceeds size limit")
		}
		incoming, err := plan.ReadFile(file.Path)
		if err != nil {
			return err
		}
		current, readErr := memorySyncRead(dataDir, file.Path)
		if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
			return readErr
		}
		relative := strings.TrimPrefix(file.Path, memorySyncPrefix)
		parts := strings.Split(relative, "/")
		if (relative == "USER.md" || relative == "MEMORY.md") && readErr == nil && !bytes.Equal(current, incoming) {
			if err = store.PreserveProjection(ctx, relative, current); err != nil {
				return err
			}
		}
		if (strings.HasPrefix(relative, "conflicts/") || strings.HasPrefix(relative, "operations/") || strings.HasPrefix(relative, "legacy-projections/")) && readErr == nil && !bytes.Equal(current, incoming) {
			return errors.New("memory safety metadata would be replaced by checkout")
		}
		if len(parts) == 2 && parts[0] == "withdrawals" && strings.HasSuffix(parts[1], ".md") {
			id := strings.TrimSuffix(parts[1], ".md")
			if err = memo.ValidateWithdrawal(incoming, id); err != nil {
				return fmt.Errorf("invalid memory withdrawal: %w", err)
			}
			// 先应用远端撤回意图，再允许同批旧记录落盘，避免读取窗口短暂复活。
			if !bytes.Equal(current, incoming) {
				if _, err = store.PreserveWithdrawal(ctx, incoming, id); err != nil {
					return err
				}
			}
			if readErr == nil && !bytes.Equal(current, incoming) {
				if _, err = store.PreserveWithdrawal(ctx, current, id); err != nil {
					return err
				}
			}
		}
		if len(parts) == 2 && parts[0] == "records" && strings.HasSuffix(parts[1], ".md") {
			id := strings.TrimSuffix(parts[1], ".md")
			next, parseErr := memo.DecodeRecord(incoming, id)
			if parseErr != nil {
				versions := [][]byte{incoming}
				if readErr == nil {
					versions = append(versions, current)
				}
				if err = store.Quarantine(ctx, id, versions); err != nil {
					return err
				}
				continue
			}
			if readErr == nil && !bytes.Equal(current, incoming) {
				previous, previousErr := memo.DecodeRecord(current, id)
				if previousErr != nil || !memoryOperationsExtend(previous.Record.Operations, next.Record.Operations) {
					if err = store.Quarantine(ctx, id, [][]byte{current, incoming}); err != nil {
						return err
					}
				}
			}
		}
	}
	for _, file := range plan.Removes {
		relative := strings.TrimPrefix(file.Path, memorySyncPrefix)
		if relative == file.Path {
			continue
		}
		parts := strings.Split(relative, "/")
		if relative == "USER.md" || relative == "MEMORY.md" {
			current, readErr := memorySyncRead(dataDir, file.Path)
			if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
				return readErr
			}
			if readErr == nil {
				if err := store.PreserveProjection(ctx, relative, current); err != nil {
					return err
				}
			}
		}
		if len(parts) == 2 && parts[0] == "withdrawals" && strings.HasSuffix(parts[1], ".md") {
			current, err := memorySyncRead(dataDir, file.Path)
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return err
			}
			if _, err = store.PreserveWithdrawal(ctx, current, strings.TrimSuffix(parts[1], ".md")); err != nil {
				return err
			}
		}
		// 未解决冲突不能通过删除证据自动恢复为事实，保留证据并报告恢复被阻止。
		if strings.HasPrefix(relative, "conflicts/") || strings.HasPrefix(relative, "operations/") || strings.HasPrefix(relative, "legacy-projections/") {
			if _, err := memorySyncRead(dataDir, file.Path); errors.Is(err, os.ErrNotExist) {
				continue
			} else if err != nil {
				return err
			}
			return errors.New("memory safety metadata would be removed by checkout")
		}
	}
	return nil
}

func memoryOperationsExtend(previous, next []string) bool {
	if len(previous) == 0 || len(next) <= len(previous) {
		return false
	}
	set := map[string]bool{}
	for _, op := range next {
		set[op] = true
	}
	old := map[string]bool{}
	for _, op := range previous {
		if !set[op] {
			return false
		}
		old[op] = true
	}
	return len(set) > len(old)
}

// memorySyncSourcesChanged 仅通知真实变更的文档身份，模型整理不在仓库写锁内执行。
func memorySyncSourcesChanged(result *dejavu.MergeResult) {
	ids := []string{}
	databaseIDs := []string{}
	for _, file := range result.Upserts {
		if strings.HasSuffix(file.Path, ".sy") {
			ids = append(ids, strings.TrimSuffix(path.Base(file.Path), ".sy"))
		}
		if id := memoryDatabasePathID(file.Path); id != "" {
			databaseIDs = append(databaseIDs, id)
		}
	}
	for _, file := range result.Removes {
		if strings.HasSuffix(file.Path, ".sy") {
			ids = append(ids, strings.TrimSuffix(path.Base(file.Path), ".sy"))
		}
		if id := memoryDatabasePathID(file.Path); id != "" {
			databaseIDs = append(databaseIDs, id)
		}
	}
	if len(ids) > 0 {
		QueueAIMemorySources(ids)
	}
	QueueAIMemoryDatabaseSources(databaseIDs)
}

// memoryCommittedSourcesChanged 在事务成功并释放资源后才安排复核，失败事务不产生候选。
func memoryCommittedSourcesChanged(ids []string) {
	if len(ids) > 0 && !util.IsDisabledFeature("ai") {
		QueueAIMemorySources(ids)
	}
}
