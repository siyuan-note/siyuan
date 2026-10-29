// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func (tx *Transaction) usesDocumentSourceJournal() bool {
	if len(tx.DoOperations) == 0 {
		return false // Committed document replacements provide their own snapshot/rollback boundary.
	}
	for _, op := range tx.DoOperations {
		if op == nil {
			continue
		}
		if op.Action == "restoreCreatedDoc" || op.Action == "removeCreatedDoc" {
			return false // These operations retain their existing document-tree compensation.
		}
	}
	return true
}

func (tx *Transaction) documentSource(tree *parse.Tree) *documentSourceFile {
	if tx.sourceJournal != nil {
		for _, file := range tx.sourceJournal.Files {
			if file.Kind == "" && file.Box == tree.Box && file.Path == tree.Path {
				return file
			}
		}
	}
	return nil
}

func (tx *Transaction) sourceDatabase(id, box string) *documentSourceFile {
	if tx.sourceJournal != nil {
		for _, file := range tx.sourceJournal.Files {
			if file.Kind == "database" && file.Box == box && file.Path == "/storage/av/"+id+".json" {
				return file
			}
		}
	}
	return nil
}

func (tx *Transaction) watchSourceDatabase(view *av.AttributeView) {
	if tx == nil || view == nil || !tx.usesDocumentSourceJournal() {
		return
	}
	filename, boundary := av.FindAttributeViewPath(view.ID)
	key := boundary + "/" + view.ID
	if tx.sourceDatabaseBefore == nil {
		tx.sourceDatabaseBefore = map[string]*documentSourceFile{}
	}
	if tx.sourceDatabaseBefore[key] != nil {
		return
	}
	original, err := os.ReadFile(filename)
	if os.IsNotExist(err) {
		original, err = nil, nil
	}
	if err != nil {
		tx.sourceErr = err
	}
	entry := &documentSourceFile{Kind: "database", Box: boundary, Path: "/storage/av/" + view.ID + ".json", Before: original, After: original}
	tx.sourceDatabaseBefore[key] = entry
	release := av.RecordSourceWrites(view, func() bool { return tx.sourceJournal != nil || tx.sourceErr != nil }, func(box string, before, after []byte) error {
		if tx.sourceErr != nil {
			return tx.sourceErr
		}
		if tx.sourceJournal == nil {
			entry.After = after
			return nil
		}
		file := tx.sourceDatabase(view.ID, box)
		if file == nil {
			if !bytes.Equal(before, entry.After) {
				return util.ErrFileChanged
			}
			file = entry
			tx.sourceJournal.Files = append(tx.sourceJournal.Files, file)
		} else if !bytes.Equal(before, file.After) {
			return util.ErrFileChanged
		}
		file.After = after
		tx.sourceJournal.Forward = false
		return tx.sourceJournal.save()
	})
	tx.sourceWatchers = append(tx.sourceWatchers, release)
}

// Relation configuration can save several databases without touching a document.
// Establish the durable boundary before its first save, including old targets.
func (tx *Transaction) prepareRelationSourceJournal(op *Operation) error {
	if !tx.usesDocumentSourceJournal() {
		return nil
	}
	source, err := av.ParseAttributeView(op.AvID)
	if err != nil {
		return err
	}
	_, boundary := av.FindAttributeViewPath(source.ID)
	ids := []string{source.ID, op.ID}
	if key, _ := source.GetKey(op.KeyID); key != nil && key.Relation != nil && key.Relation.IsTwoWay {
		ids = append(ids, key.Relation.AvID)
	}
	for _, id := range ids {
		_, box := av.FindAttributeViewPath(id)
		if box != boundary {
			return errors.New("cross-boundary database relation")
		}
		if _, err = tx.readAttributeViewForMutation(id, "", box); err != nil {
			return err
		}
	}
	if tx.sourceErr != nil {
		return tx.sourceErr
	}
	if tx.sourceJournal == nil {
		tx.sourceJournal = &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending"}
		for _, file := range tx.sourceDatabaseBefore {
			name, _ := file.filename()
			file.After, err = os.ReadFile(name)
			if err != nil {
				return err
			}
			tx.sourceJournal.Files = append(tx.sourceJournal.Files, file)
		}
	}
	tx.sourceJournal.Forward = false
	if err = tx.sourceJournal.save(); err != nil {
		return err
	}
	if tx.sourceRelationBoundaries == nil {
		tx.sourceRelationBoundaries = map[string]bool{}
	}
	if !tx.sourceRelationBoundaries[boundary] {
		tx.sourceRelationBoundaries[boundary] = true
		tx.sourceWatchers = append(tx.sourceWatchers, av.RecordRelationWrites(boundary, func(box string, before, after []byte) error {
			var file *documentSourceFile
			for _, candidate := range tx.sourceJournal.Files {
				if candidate.Kind == "relations" && candidate.Box == box {
					file = candidate
					break
				}
			}
			if file == nil {
				file = &documentSourceFile{Kind: "relations", Box: box, Path: "/storage/av/relations.msgpack", Before: before, After: before}
				tx.sourceJournal.Files = append(tx.sourceJournal.Files, file)
			}
			if !bytes.Equal(before, file.After) {
				return util.ErrFileChanged
			}
			file.After = after
			return tx.sourceJournal.save()
		}))
	}
	return nil
}

func (tx *Transaction) readDocumentSource(box, p string) (*parse.Tree, []byte, error) {
	if !tx.usesDocumentSourceJournal() {
		tree, err := filesys.LoadTree(box, p, tx.luteEngine)
		return tree, nil, err
	}
	return filesys.LoadTreeSnapshot(box, p, tx.luteEngine)
}

func (tx *Transaction) rememberDocumentSource(tree *parse.Tree) error {
	if !tx.usesDocumentSourceJournal() || tx.documentSource(tree) != nil {
		return nil
	}
	_, original, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, tx.luteEngine)
	if os.IsNotExist(err) {
		original, err = nil, nil
	}
	if err != nil {
		return err
	}
	return tx.rememberDocumentSourceBytes(tree, original)
}

func (tx *Transaction) rememberDocumentSourceBytes(tree *parse.Tree, original []byte) error {
	if !tx.usesDocumentSourceJournal() || tx.documentSource(tree) != nil {
		return nil
	}
	if tx.sourceLeases == nil {
		tx.sourceLeases = map[string]bool{}
	}
	if IsEncryptedBox(tree.Box) && !tx.sourceLeases[tree.Box] {
		if err := AcquireEncryptedBoxOperation(tree.Box); err != nil {
			return err
		}
		tx.sourceLeases[tree.Box] = true
	}
	if tx.sourceJournal == nil {
		tx.sourceJournal = &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Forward: true}
		for _, entry := range tx.sourceDatabaseBefore {
			name, err := entry.filename()
			if err != nil {
				return err
			}
			current, err := os.ReadFile(name)
			if os.IsNotExist(err) {
				current, err = nil, nil
			}
			if err != nil {
				return err
			}
			if bytes.Equal(current, entry.Before) {
				continue
			}
			entry.After = current
			tx.sourceJournal.Files = append(tx.sourceJournal.Files, entry)
			tx.sourceJournal.Forward = false
		}
	}
	tx.sourceJournal.Files = append(tx.sourceJournal.Files, &documentSourceFile{Box: tree.Box, Path: tree.Path, Before: original, After: original})
	return tx.sourceJournal.save()
}

func (tx *Transaction) recordDocumentWrite(tree *parse.Tree, write func() error) error {
	file := tx.documentSource(tree)
	if file == nil {
		return write()
	}
	return filesys.RecordTreeWrites(tree, file.Before, func(data []byte) error {
		file.After = data
		if len(tx.sourceJournal.Files) > 1 {
			tx.sourceJournal.Forward = false
		}
		return tx.sourceJournal.save()
	}, write)
}

func (tx *Transaction) commitDocumentSources() error {
	if tx.sourceJournal == nil {
		return nil
	}
	tx.sourceJournal.State = "committed"
	if err := tx.sourceJournal.save(); err != nil {
		tx.sourceJournal.State = "pending"
		return err
	}
	return nil
}

func (tx *Transaction) rollbackDocumentSources() {
	if tx.sourceJournal == nil {
		return
	}
	j := tx.sourceJournal
	clearAttrs := func(tree *parse.Tree) {
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.IsBlock() {
				cache.RemoveBlockIALInBox(node.ID, tree.Box)
			}
			return ast.WalkContinue
		})
	}
	for _, tree := range tx.trees {
		clearAttrs(tree)
	}
	if err := j.rollback(); err != nil {
		tx.sourceRollbackErr = errors.Join(tx.sourceRollbackErr, err)
		util.MarkIndexFixDirty()
		logging.LogErrorf("restore transaction sources [%s] failed: %s", j.ID, err)
	}
	// Rebuild from actual authenticated sources, including failure before the first save.
	// Queue replacement after any already-enqueued partial saves so SQL converges to the rollback.
	for _, file := range j.Files {
		if file.Kind == "relations" || file.Kind == "flashcard" {
			continue
		}
		if file.Kind == "database" {
			id := strings.TrimSuffix(path.Base(file.Path), ".json")
			av.NotifyAttributeViewSaved(id, file.Box)
			ReloadAttrView(id)
			continue
		}
		tree, _, err := filesys.ReadTreeSnapshot(file.Box, file.Path)
		if os.IsNotExist(err) && file.Before == nil {
			id := util.GetTreeID(file.Path)
			treenode.RemoveBlockTreesByRootID(file.Box, id)
			sql.RemoveTreeQueue(file.Box, id)
			continue
		}
		if err == nil {
			clearAttrs(tree)
			sql.UpsertTreeQueue(tree)
			err = treenode.ReplaceBlockTree(tree)
		}
		if err != nil {
			tx.sourceRollbackErr = errors.Join(tx.sourceRollbackErr, err)
		}
	}
	if tx.sourceRollbackErr == nil {
		if err := os.Remove(j.filename()); err != nil {
			tx.sourceRollbackErr = err
		}
	}
}

func (tx *Transaction) releaseDocumentSources(committed bool) {
	for _, release := range tx.sourceWatchers {
		release()
	}
	tx.sourceWatchers = nil
	tx.sourceDatabaseBefore = nil
	tx.sourceRelationBoundaries = nil
	if committed && tx.sourceJournal != nil {
		if err := os.Remove(tx.sourceJournal.filename()); err != nil {
			logging.LogWarnf("retain committed transaction recovery [%s]: %s", tx.sourceJournal.ID, err)
		}
	}
	for box := range tx.sourceLeases {
		ReleaseEncryptedBoxOperation(box)
	}
	tx.sourceJournal, tx.sourceLeases = nil, nil
}
