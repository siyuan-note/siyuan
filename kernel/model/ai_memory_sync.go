// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"io"
	"os"
	"path"
	"strings"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/memory"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const memorySyncPrefix = memory.SyncPrefix

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
			return nil, memory.ErrInvalid
		}
		info, err := root.Lstat(part)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, memory.ErrInvalid
		}
		if i == len(parts)-1 {
			if !info.Mode().IsRegular() {
				return nil, memory.ErrInvalid
			}
			file, err := root.Open(part)
			if err != nil {
				return nil, err
			}
			defer file.Close()
			data, err := io.ReadAll(io.LimitReader(file, 2*1024*1024+1))
			if len(data) > 2*1024*1024 {
				return nil, memory.ErrInvalid
			}
			return data, err
		}
		if !info.IsDir() {
			return nil, memory.ErrInvalid
		}
		next, err := root.OpenRoot(part)
		if err != nil {
			return nil, err
		}
		root.Close()
		root = next
	}
	return nil, memory.ErrInvalid
}

// 记忆文件随普通数据同步和恢复；预检只检查路径，不改变仓库计划或当前记忆状态。
func memoryCheckoutPreflight(dataDir string, plan *dejavu.CheckoutPlan) error {
	for _, files := range [][]*entity.File{plan.Upserts, plan.Removes} {
		for _, file := range files {
			if !strings.HasPrefix(file.Path, memorySyncPrefix) {
				continue
			}
			if err := memoryCheckoutPath(dataDir, file.Path); err != nil {
				return err
			}
		}
	}
	return nil
}

// 不读取正文，确保损坏或超大的旧文件仍可被正常替换和删除。
func memoryCheckoutPath(dataDir, name string) error {
	parts := strings.Split(strings.TrimPrefix(name, "/"), "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.Contains(part, "\\") {
			return memory.ErrInvalid
		}
	}
	root, err := os.OpenRoot(dataDir)
	if err != nil {
		return err
	}
	defer func() { root.Close() }()
	for i, part := range parts {
		info, err := root.Lstat(part)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return memory.ErrInvalid
		}
		if i == len(parts)-1 {
			if !info.Mode().IsRegular() {
				return memory.ErrInvalid
			}
			return nil
		}
		if !info.IsDir() {
			return memory.ErrInvalid
		}
		next, err := root.OpenRoot(part)
		if err != nil {
			return err
		}
		root.Close()
		root = next
	}
	return memory.ErrInvalid
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
