// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func checkDocumentAddressingConf(boxID string, data []byte) error {
	return filesys.CheckDocumentAddressing(boxID)
}

// documentAddressingPreflight 在整批写入和删除前检查快照的规范路径及源规格。
func documentAddressingPreflight(repo *dejavu.Repo) func(*dejavu.CheckoutPlan) error {
	return func(plan *dejavu.CheckoutPlan) error {
		if err := checkPasswordMigrationCheckout(plan); err != nil {
			return err
		}
		upserts := make([]string, 0, len(plan.Upserts))
		removes := make([]string, 0, len(plan.Removes))
		paths := map[string]string{}
		upsertBoxes, removedPaths := map[string]bool{}, map[string]bool{}
		seen := map[string]bool{}
		// 仓库索引统一使用前导斜杠和正斜杠；拒绝别名及重复目标，避免覆盖计划遮盖来源。
		checkPath := func(name string) error {
			if !strings.HasPrefix(name, "/") || strings.Contains(name, "\\") {
				return documentaddressing.ErrInvalid
			}
			key := name
			if runtime.GOOS == "windows" {
				for _, part := range strings.Split(name[1:], "/") {
					if strings.TrimRight(part, ". ") != part || strings.Contains(part, ":") {
						return documentaddressing.ErrInvalid
					}
				}
				key = strings.ToLower(key)
			}
			if seen[key] {
				return documentaddressing.ErrInvalid
			}
			seen[key] = true
			return nil
		}
		for _, file := range plan.Upserts {
			if err := checkPath(file.Path); err != nil {
				return err
			}
			upserts = append(upserts, file.Path)
			name := strings.TrimPrefix(file.Path, "/")
			paths[name] = file.Path
			boxID, _, _ := strings.Cut(name, "/")
			upsertBoxes[boxID] = true
		}
		for _, file := range plan.Removes {
			if err := checkPath(file.Path); err != nil {
				return err
			}
			removes = append(removes, file.Path)
			removedPaths[strings.TrimPrefix(file.Path, "/")] = true
		}
		if err := documentaddressing.CheckPaths(upserts, removes); err != nil {
			return err
		}
		for _, file := range plan.Upserts {
			name := strings.TrimPrefix(file.Path, "/")
			if !isDocumentAddressingSource([]string{name}) {
				continue
			}
			data, err := plan.ReadFile(file.Path)
			if err == nil {
				err = checkDocumentAddressingCheckoutSource(data)
			}
			if err != nil {
				return fmt.Errorf("document [%s]: %w", name, err)
			}
			if err = checkDocumentAddressingCheckoutCurrent(repo.DataPath, name); err != nil {
				return err
			}
		}
		deletedBoxes := map[string]bool{}
		for _, file := range plan.Removes {
			name := strings.TrimPrefix(file.Path, "/")
			if !isDocumentAddressingSource([]string{name}) {
				continue
			}
			boxID, _, _ := strings.Cut(name, "/")
			deleted, checked := deletedBoxes[boxID]
			if !checked {
				var err error
				if !upsertBoxes[boxID] {
					deleted, err = documentAddressingCheckoutRemovesNotebook(repo.DataPath, boxID, removedPaths)
				}
				if err != nil {
					return err
				}
				deletedBoxes[boxID] = deleted
			}
			if !deleted {
				if err := checkDocumentAddressingCheckoutCurrent(repo.DataPath, name); err != nil {
					return err
				}
			}
		}
		return nil
	}
}

func checkDocumentAddressingCheckoutCurrent(dataDir, name string) error {
	data, err := filelock.ReadFile(filepath.Join(dataDir, filepath.FromSlash(name)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	// 已识别的不支持版本或标题不能被覆盖或部分删除；普通损坏源仍可用合法历史恢复。
	if err = checkDocumentAddressingCheckoutSource(data); errors.Is(err, treenode.ErrSpecTooNew) ||
		errors.Is(err, documentaddressing.ErrInvalidTitle) {
		return fmt.Errorf("document [%s]: %w", name, err)
	}
	return nil
}

// documentAddressingCheckoutRemovesNotebook 仅在整本现存文件全部移除时保留无需解释内容的删除语义。
func documentAddressingCheckoutRemovesNotebook(dataDir, boxID string, removes map[string]bool) (bool, error) {
	deleted := true
	err := filepath.WalkDir(filepath.Join(dataDir, boxID), func(name string, entry os.DirEntry, err error) error {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil || entry.IsDir() {
			return err
		}
		relative, err := filepath.Rel(dataDir, name)
		if err != nil {
			return err
		}
		if !removes[filepath.ToSlash(relative)] {
			deleted = false
			return filepath.SkipAll
		}
		return nil
	})
	return deleted, err
}

// checkDocumentAddressingCheckoutSource 只解释普通源；密文同步保持原字节，不要求解锁或声明内容已认证。
// 仓库分块认证不代替笔记本认证，密文的格式及标题仍在解锁读取时检查。
func checkDocumentAddressingCheckoutSource(data []byte) error {
	if util.IsCiphertext(data) {
		return nil
	}
	return treenode.CheckSpecJSON(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))
}

func documentAddressingCheckoutHooks(repo *dejavu.Repo) dejavu.CheckoutHooks {
	return dejavu.CheckoutHooks{Preflight: documentAddressingPreflight(repo)}
}

// checkImportedDocumentAddressing 在重新生成 ID 或删除档案配置前校验原始笔记本文档身份。
func checkImportedDocumentAddressing(directory string) error {
	data, err := filelock.ReadFile(filepath.Join(directory, ".siyuan", boxDocMetaName))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil {
		var meta boxDocMeta
		if json.Unmarshal(data, &meta) != nil || meta.Spec != boxDocMetaSpec || !ast.IsNodeIDPattern(meta.BoxDocID) {
			return documentaddressing.ErrInvalid
		}
	}
	return nil
}

// checkDocumentAddressingCopy 在整批导入或历史恢复开始复制前检查规范路径及文档源规格。
func checkDocumentAddressingCopy(sourceRoot, boxID string) error {
	var upserts []string
	err := filepath.WalkDir(sourceRoot, func(name string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(sourceRoot, name)
		if err != nil {
			return err
		}
		if boxID != "" {
			rel = filepath.Join(boxID, rel)
		}
		upserts = append(upserts, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return err
	}
	if err := documentaddressing.CheckPaths(upserts, nil); err != nil {
		return err
	}
	for _, name := range upserts {
		if !isDocumentAddressingSource([]string{name}) {
			continue
		}
		relative := name
		if boxID != "" {
			relative = strings.TrimPrefix(name, boxID+"/")
		}
		data, err := filelock.ReadFile(filepath.Join(sourceRoot, filepath.FromSlash(relative)))
		if err != nil {
			return err
		}
		if err = checkDocumentAddressingCheckoutSource(data); err != nil {
			return err
		}
	}
	return nil
}

// backupUnsupportedNotebookAttributeViews 无法解析源文档时保留共享数据库的原始快照，避免丢失恢复材料。
func backupUnsupportedNotebookAttributeViews(historyDir string) error {
	directory := filepath.Join(util.DataDir, "storage", "av")
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		dest := filepath.Join(historyDir, "storage", "av", entry.Name())
		if _, err = os.Stat(dest); err == nil {
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err = filelock.Copy(filepath.Join(directory, entry.Name()), dest); err != nil {
			return err
		}
	}
	return nil
}
