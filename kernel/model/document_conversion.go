// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// Callers hold flushLock from snapshot loading through conversion. The existing
// durable source journal retains exact bytes (ciphertext for encrypted notebooks)
// and compensates both document writes, including interrupted conversions.
func commitDocumentConversion(source, target *parse.Tree, sourceBefore, targetBefore []byte, removeSource bool, write func(*parse.Tree) error) (err error) {
	if source.Box == target.Box && source.Path == target.Path {
		return errors.New("conversion source and target must differ")
	}
	for _, box := range []string{source.Box, target.Box} {
		if err := AcquireEncryptedBoxOperation(box); err != nil {
			return err
		}
		defer ReleaseEncryptedBoxOperation(box)
	}
	sourceFile := &documentSourceFile{Box: source.Box, Path: source.Path, Before: sourceBefore, After: sourceBefore}
	targetFile := &documentSourceFile{Box: target.Box, Path: target.Path, Before: targetBefore, After: targetBefore}
	for _, file := range []*documentSourceFile{sourceFile, targetFile} {
		name, pathErr := file.filename()
		if pathErr != nil {
			return pathErr
		}
		current, readErr := os.ReadFile(name)
		if os.IsNotExist(readErr) {
			current, readErr = nil, nil
		}
		if readErr != nil {
			return readErr
		}
		if !bytes.Equal(current, file.Before) {
			return util.ErrFileChanged
		}
	}
	j := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Files: []*documentSourceFile{sourceFile, targetFile}}
	if err = j.save(); err != nil {
		return err
	}
	tx := &Transaction{sourceJournal: j, trees: map[string]*parse.Tree{source.ID: source, target.ID: target}}
	committed := false
	defer func() {
		if !committed {
			tx.rollbackDocumentSources()
			err = errors.Join(err, tx.sourceRollbackErr)
		}
		tx.releaseDocumentSources(committed)
	}()
	save := func(tree *parse.Tree, file *documentSourceFile) error {
		return filesys.RecordTreeWrites(tree, file.Before, func(data []byte) error {
			file.After = data
			return j.save()
		}, func() error { return write(tree) })
	}
	if removeSource {
		sourceFile.After = nil
		if err = j.save(); err != nil {
			return err
		}
		err = filesys.MutateDocumentSources([]*treenode.BlockTree{{ID: source.ID, RootID: source.ID, BoxID: source.Box, Path: source.Path}}, func() error {
			return removeIndexRepairSourceIfUnchanged(filepath.Join(util.DataDir, source.Box, source.Path), sourceBefore)
		})
		if err != nil {
			return err
		}
	} else if err = save(source, sourceFile); err != nil {
		return err
	}
	if err = save(target, targetFile); err != nil {
		return err
	}
	if removeSource {
		treenode.RemoveBlockTreesByRootID(source.Box, source.ID)
	} else if err = treenode.ReplaceBlockTree(source); err != nil {
		return err
	}
	if err = treenode.ReplaceBlockTree(target); err != nil {
		return err
	}
	if err = tx.commitDocumentSources(); err != nil {
		return err
	}
	committed = true
	if removeSource {
		cache.RemoveTreeDataInBox(source.ID, source.Box)
		cache.RemoveDocIALInBox(source.Path, source.Box)
	}
	return nil
}
