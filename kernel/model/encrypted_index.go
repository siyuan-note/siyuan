// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// openEncryptedBoxIndexes 只在源文档认证成功后重建不兼容或损坏的派生索引，保留源密文和密钥材料。
// 调用方持有笔记本写锁，且已验证密钥包络和笔记本元数据。
func openEncryptedBoxIndexes(boxID string, dek []byte) error {
	open := func() error {
		if err := sql.OpenEncryptedDB(boxID, dek); err != nil {
			return err
		}
		return treenode.OpenEncryptedBlockTreeDB(boxID, dek)
	}
	if err := open(); err == nil {
		return nil
	}
	sql.CloseEncryptedDB(boxID)
	treenode.CloseEncryptedBlockTreeDB(boxID)
	if err := authenticateEncryptedIndexDocuments(boxID, dek); err != nil {
		return fmt.Errorf("cannot rebuild encrypted indexes: %w", err)
	}
	sql.RemoveEncryptedDBFile(boxID)
	treenode.RemoveEncryptedBlockTreeDBFile(boxID)
	if err := open(); err != nil {
		sql.RemoveEncryptedDBFile(boxID)
		treenode.RemoveEncryptedBlockTreeDBFile(boxID)
		return err
	}
	return nil
}

func authenticateEncryptedIndexDocuments(boxID string, dek []byte) error {
	boxDir := filepath.Join(util.DataDir, boxID)
	ids := map[string]struct{}{}
	return filepath.WalkDir(boxDir, func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if filePath != boxDir && !ast.IsNodeIDPattern(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(entry.Name(), ".sy") {
			return nil
		}
		if entry.Type()&fs.ModeSymlink != 0 {
			return fmt.Errorf("encrypted document is a symbolic link [%s]", entry.Name())
		}
		data, err := filelock.ReadFile(filePath)
		if err != nil {
			return err
		}
		plain, err := DecryptFile(boxID, entry.Name(), dek, data)
		if err != nil {
			return err
		}
		tree, err := loadTreeByData0(plain)
		if err != nil {
			return err
		}
		if tree == nil || tree.Root == nil || tree.Root.ID+".sy" != entry.Name() {
			return fmt.Errorf("encrypted document root ID does not match filename [%s]", entry.Name())
		}
		if _, exists := ids[tree.Root.ID]; exists {
			return fmt.Errorf("duplicate encrypted document ID [%s]", tree.Root.ID)
		}
		ids[tree.Root.ID] = struct{}{}
		return nil
	})
}
