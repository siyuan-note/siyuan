// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 历史恢复以持久化原始字节为补偿边界，解析投影只参与字段和关联变化计算。
type attributeViewHistoryRecovery struct {
	journal   *documentSourceJournal
	files     map[string]*documentSourceFile
	relations map[string]bool
	releases  []func()
	written   bool
	committed bool
}

func newAttributeViewHistoryRecovery() *attributeViewHistoryRecovery {
	return &attributeViewHistoryRecovery{
		journal: &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending"},
		files:   map[string]*documentSourceFile{}, relations: map[string]bool{},
	}
}

func (recovery *attributeViewHistoryRecovery) remember(file *documentSourceFile) (*documentSourceFile, error) {
	filename, err := file.filename()
	if err != nil {
		return nil, err
	}
	if existing := recovery.files[filename]; existing != nil {
		if !equalDocumentSource(existing.After, file.Before) {
			return nil, util.ErrFileChanged
		}
		return existing, nil
	}
	recovery.files[filename] = file
	recovery.journal.Files = append(recovery.journal.Files, file)
	return file, nil
}

func (recovery *attributeViewHistoryRecovery) record(file *documentSourceFile, before, after []byte) error {
	if !equalDocumentSource(file.After, before) {
		return util.ErrFileChanged
	}
	if err := recovery.journal.checkSources(); err != nil {
		return err
	}
	previous := file.After
	file.After = bytes.Clone(after)
	if err := recovery.journal.save(); err != nil {
		file.After = previous
		return err
	}
	recovery.written = true
	return nil
}

func (recovery *attributeViewHistoryRecovery) readCurrent(id, boxID string) (*av.AttributeView, error) {
	if !ast.IsNodeIDPattern(id) || boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return nil, av.ErrInvalidAttributeViewID
	}
	filename, boundary := av.FindAttributeViewPathInBox(id, boxID)
	if filename == "" {
		filename, boundary = boundAttributeViewHistoryPath(util.DataDir, boxID, id), boxID
	}
	if boundary != boxID {
		return nil, errors.New("database history crosses notebook encryption boundaries")
	}
	stored, err := filelock.ReadFile(filename)
	missing := os.IsNotExist(err)
	if err != nil && !missing {
		return nil, err
	}
	var current *av.AttributeView
	var incomplete *av.MissingLayoutError
	if !missing {
		plain := stored
		if boxID != "" {
			if !util.IsCiphertext(stored) {
				return nil, errors.New("encrypted database recovery is plaintext")
			}
			plain, err = av.DecryptAVData(boxID, id, stored)
		} else if util.IsCiphertext(stored) {
			return nil, errors.New("encrypted database recovery has no notebook context")
		}
		if err != nil {
			return nil, err
		}
		current, err = av.ParseAttributeViewRecoveryData(id, plain)
		if err != nil {
			return nil, fmt.Errorf("load attribute view [%s] failed: %w", filename, err)
		}
		if err = current.ValidateLayouts(); err != nil && !errors.As(err, &incomplete) {
			return nil, err
		}
	} else {
		current = av.NewAttributeView(id)
	}
	_, watched := recovery.files[filename]
	file, err := recovery.remember(&documentSourceFile{Kind: "database", Box: boxID,
		Path: "/storage/av/" + id + ".json", Before: bytes.Clone(stored), After: bytes.Clone(stored)})
	if err != nil {
		return nil, err
	}
	if !watched {
		if incomplete != nil {
			if err = recovery.preserveOriginal(file); err != nil {
				return nil, err
			}
		}
		av.SetAVBoxID(id, boxID)
		recovery.releases = append(recovery.releases, av.RecordHistorySourceWrites(current, func(_ string, before, after []byte) error {
			return recovery.record(file, before, after)
		}))
	}
	if !recovery.relations[boxID] {
		recovery.relations[boxID] = true
		recovery.releases = append(recovery.releases, av.RecordRelationWrites(boxID, func(box string, before, after []byte) error {
			file, recordErr := recovery.remember(&documentSourceFile{Kind: "relations", Box: box,
				Path: "/storage/av/relations.msgpack", Before: bytes.Clone(before), After: bytes.Clone(before)})
			if recordErr != nil {
				return recordErr
			}
			return recovery.record(file, before, after)
		}))
	}
	if missing {
		return nil, av.ErrViewNotFound
	}
	return current, nil
}

// 受损源按已有第 1 版归档格式另存，活动事务使用独立 ID 以保留启动补偿能力。
func (recovery *attributeViewHistoryRecovery) preserveOriginal(file *documentSourceFile) error {
	backup := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "committed",
		Files: []*documentSourceFile{{Kind: file.Kind, Box: file.Box, Path: file.Path,
			Before: bytes.Clone(file.Before), After: bytes.Clone(file.Before)}}}
	if err := backup.save(); err != nil {
		return err
	}
	if err := archiveDocumentSource(backup); err != nil {
		return err
	}
	return backup.remove()
}

func (recovery *attributeViewHistoryRecovery) recordTree(tree *parse.Tree, before, after []byte) error {
	file, err := recovery.remember(&documentSourceFile{Box: tree.Box, Path: tree.Path,
		Before: bytes.Clone(before), After: bytes.Clone(before)})
	if err != nil {
		return err
	}
	return recovery.record(file, before, after)
}

func (recovery *attributeViewHistoryRecovery) writeTree(tree *parse.Tree, write func() error) error {
	_, before, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
	if os.IsNotExist(err) {
		before, err = nil, nil
	}
	if err != nil {
		return err
	}
	return filesys.RecordTreeWrites(tree, before, func(after []byte) error {
		return recovery.recordTree(tree, before, after)
	}, write)
}

func (recovery *attributeViewHistoryRecovery) commit() error {
	if !recovery.written {
		return nil
	}
	for _, file := range recovery.journal.Files {
		filename, err := file.filename()
		if err != nil {
			return err
		}
		actual, err := filelock.ReadFile(filename)
		if os.IsNotExist(err) {
			actual, err = nil, nil
		}
		if err != nil {
			return err
		}
		if !equalDocumentSource(actual, file.After) {
			return fmt.Errorf("%w: %s", util.ErrFileChanged, filename)
		}
	}
	recovery.journal.State = "committed"
	if err := recovery.journal.save(); err != nil {
		recovery.journal.State = "pending"
		return err
	}
	recovery.committed = true
	return nil
}

func (tx *Transaction) finishHistoryRecovery(result *error) {
	recovery := tx.historyRecovery
	for _, release := range recovery.releases {
		release()
	}
	if *result != nil && recovery.written && !recovery.committed {
		rollbackErr := recovery.journal.rollback()
		if rollbackErr == nil {
			for _, file := range recovery.journal.Files {
				if file.Kind == "database" {
					av.NotifyAttributeViewSaved(strings.TrimSuffix(filepath.Base(file.Path), ".json"), file.Box)
				} else if file.Kind == "" {
					tree, _, readErr := filesys.ReadTreeSnapshot(file.Box, file.Path)
					if os.IsNotExist(readErr) && file.Before == nil {
						id := util.GetTreeID(file.Path)
						treenode.RemoveBlockTreesByRootID(file.Box, id)
						sql.RemoveTreeQueue(file.Box, id)
						readErr = nil
					} else if readErr == nil {
						readErr = treenode.ReplaceBlockTree(tree)
						sql.UpsertTreeQueue(tree)
					}
					rollbackErr = errors.Join(rollbackErr, readErr)
				}
			}
		}
		if errors.Is(rollbackErr, util.ErrFileChanged) {
			rollbackErr = errors.Join(rollbackErr, archiveDocumentSource(recovery.journal))
		}
		*result = errors.Join(*result, rollbackErr)
		if rollbackErr != nil {
			util.MarkIndexFixDirty()
		} else if err := recovery.journal.remove(); err != nil {
			*result = errors.Join(*result, err)
		}
	} else if recovery.committed {
		if err := recovery.journal.remove(); err != nil {
			logging.LogWarnf("retain committed history recovery [%s]: %s", recovery.journal.ID, err)
		}
	}
	// 文件补偿由原始字节记录执行，逻辑对象快照仅用于成功后的历史失效处理。
	if state := tx.attributeViewRollback; state != nil {
		state.views, state.createdViews, state.trees = nil, nil, nil
	}
	tx.finishAttributeViewMutation(*result != nil)
	tx.historyRecovery = nil
}
