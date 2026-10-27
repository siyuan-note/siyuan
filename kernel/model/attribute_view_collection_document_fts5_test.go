// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func saveDocumentCollectionFixture(t *testing.T, tree *parse.Tree) {
	t.Helper()
	if err := indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
}

func addDocumentCollectionChild(t *testing.T, parent *parse.Tree) *parse.Tree {
	t.Helper()
	tree := treenode.NewTree(parent.Box, strings.TrimSuffix(parent.Path, ".sy")+"/"+ast.NewNodeID()+".sy", parent.HPath+"/Child", "Child")
	tree.Root.SetIALAttr("tags", "todo")
	saveDocumentCollectionFixture(t, tree)
	return tree
}

func TestDocumentCollectionCopiesCreateRowsWithoutResettingSource(t *testing.T) {
	for _, subtree := range []bool{false, true} {
		t.Run(map[bool]string{false: "document", true: "subtree"}[subtree], func(t *testing.T) {
			fixture, view, keyID := setupBlockCollectionTest(t)
			view.Automations.Rules[0].BlockSource.DocumentIDs = nil
			view.Automations.Rules[0].BlockSource.NotebookIDs = []string{fixture.box.ID}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
				t.Fatal(err)
			}
			view = readAttributeViewItemsTest(t, view.ID)
			originalRow := view.GetBlockValueByBoundID(fixture.sourceID)
			view.GetValue(keyID, originalRow.BlockID).Text.Content = "User value"
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			source, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			wantCopies := 1
			if subtree {
				addDocumentCollectionChild(t, source)
				wantCopies++
			}
			filename := filepath.Join(util.DataDir, source.Box, source.Path)
			original, err := os.ReadFile(filename)
			if err != nil {
				t.Fatal(err)
			}
			var copiedID string
			if subtree {
				copied, copyErr := DuplicateDocTree(source.ID)
				if copyErr != nil {
					t.Fatal(copyErr)
				}
				copiedID = copied.ID
			} else {
				if err = DuplicateDoc(source); err != nil {
					t.Fatal(err)
				}
				copiedID = source.ID
			}
			view = readAttributeViewItemsTest(t, view.ID)
			if len(view.GetBlockKeyValues().Values) != wantCopies+1 || view.GetBlockValueByBoundID(copiedID) == nil {
				t.Fatalf("copy did not collect every new document: %+v", view.GetBlockKeyValues().Values)
			}
			if view.GetValue(keyID, originalRow.BlockID).Text.Content != "User value" {
				t.Fatal("copy reset source row fields")
			}
			for _, row := range view.GetBlockKeyValues().Values {
				if row.Block.ID == fixture.sourceID {
					continue
				}
				if view.GetValue(keyID, row.BlockID).Text.Content != "New" {
					t.Fatal("copy row fields were not initialized")
				}
				tree, loadErr := LoadTreeByBlockID(row.Block.ID)
				if loadErr != nil || tree.Root.IALAttr(av.NodeAttrNameAvs) != view.ID {
					t.Fatalf("copy binding was not persisted: %v", loadErr)
				}
			}
			current, err := os.ReadFile(filename)
			if err != nil || !bytes.Equal(current, original) {
				t.Fatalf("copy changed its source: %v", err)
			}
		})
	}
}

func TestDocumentCollectionContentTemplateCollectsBlocksAndAttributes(t *testing.T) {
	for _, attributes := range []bool{false, true} {
		t.Run(map[bool]string{false: "tagged-block", true: "document-attributes"}[attributes], func(t *testing.T) {
			fixture, view, keyID := setupBlockCollectionTest(t)
			rule := view.Automations.Rules[0]
			rule.BlockSource.DocumentIDs = []string{fixture.targetID}
			if attributes {
				rule.BlockSource.Tags = nil
				rule.BlockSource.Attributes = []*av.AutomationBlockAttribute{{Name: "custom-state", Operator: "equals", Value: "active"}}
			} else {
				rule.BlockSource.Types = []string{"p"}
			}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			source, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			source.Root.SetIALAttr("custom-state", "active")
			source.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
			saveDocumentCollectionFixture(t, source)
			if _, err = DocSaveAsTemplate(fixture.sourceID, "collection-template", false); err != nil {
				t.Fatal(err)
			}
			if err = applyDocContentTemplate("collection-template.md", fixture.targetID); err != nil {
				t.Fatal(err)
			}
			view = readAttributeViewItemsTest(t, view.ID)
			rows := view.GetBlockKeyValues().Values
			if len(rows) != 1 || view.GetValue(keyID, rows[0].BlockID).Text.Content != "New" {
				t.Fatalf("template was not collected: %+v", rows)
			}
			if attributes {
				if rows[0].Block.ID != fixture.targetID {
					t.Fatal("template attributes collected the wrong document")
				}
				itemID := rows[0].BlockID
				view.GetValue(keyID, itemID).Text.Content = "User value"
				if err = av.SaveAttributeView(view); err != nil {
					t.Fatal(err)
				}
				if err = applyDocContentTemplate("collection-template.md", fixture.targetID); err != nil {
					t.Fatal(err)
				}
				view = readAttributeViewItemsTest(t, view.ID)
				if len(view.GetBlockKeyValues().Values) != 1 || view.GetValue(keyID, itemID).Text.Content != "User value" {
					t.Fatal("reapplying template reset or duplicated an existing row")
				}
			}
		})
	}
}

func TestDocumentCollectionMovesIncludeDescendantsAndPreserveRows(t *testing.T) {
	for _, notebook := range []bool{false, true} {
		t.Run(map[bool]string{false: "document-scope", true: "notebook-scope"}[notebook], func(t *testing.T) {
			fixture, view, keyID := setupBlockCollectionTest(t)
			toBox, toPath := fixture.box.ID, fixture.targetPath
			rule := view.Automations.Rules[0]
			rule.BlockSource.DocumentIDs = []string{fixture.targetID}
			if notebook {
				other := &Box{ID: ast.NewNodeID()}
				boxConf := conf.NewBoxConf()
				boxConf.Closed, boxConf.Name = false, "Other"
				if err := other.SaveConf(boxConf); err != nil {
					t.Fatal(err)
				}
				toBox, toPath = other.ID, "/"
				rule.BlockSource.DocumentIDs, rule.BlockSource.NotebookIDs = nil, []string{other.ID}
			}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			source, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			source.Root.SetIALAttr("tags", "todo")
			saveDocumentCollectionFixture(t, source)
			child := addDocumentCollectionChild(t, source)
			if err = MoveDocs([]string{source.Path}, toBox, toPath, nil); err != nil {
				t.Fatal(err)
			}
			view = readAttributeViewItemsTest(t, view.ID)
			if len(view.GetBlockKeyValues().Values) != 2 {
				t.Fatalf("move omitted descendants: %+v", view.GetBlockKeyValues().Values)
			}
			for _, id := range []string{source.ID, child.ID} {
				row := view.GetBlockValueByBoundID(id)
				if row == nil || view.GetValue(keyID, row.BlockID).Text.Content != "New" {
					t.Fatalf("move did not collect %s", id)
				}
				view.GetValue(keyID, row.BlockID).Text.Content = "User value"
			}
			if err = av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			current := treenode.GetBlockTreeInExactBox(source.ID, toBox)
			if err = MoveDocs([]string{current.Path}, fixture.box.ID, "/", nil); err != nil {
				t.Fatal(err)
			}
			if err = MoveDocs([]string{source.Path}, toBox, toPath, nil); err != nil {
				t.Fatal(err)
			}
			view = readAttributeViewItemsTest(t, view.ID)
			if len(view.GetBlockKeyValues().Values) != 2 {
				t.Fatal("re-entering scope duplicated rows")
			}
			for _, id := range []string{source.ID, child.ID} {
				row := view.GetBlockValueByBoundID(id)
				if row == nil || view.GetValue(keyID, row.BlockID).Text.Content != "User value" {
					t.Fatal("move reset user fields")
				}
			}
		})
	}
}

func TestDocumentCollectionCopyFailureCleansCreatedFiles(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	view.Automations.Rules[0].BlockSource.DocumentIDs = nil
	view.Automations.Rules[0].BlockSource.NotebookIDs = []string{fixture.box.ID}
	view.Automations.Spec = 2
	key, err := view.GetKey(keyID)
	if err != nil {
		t.Fatal(err)
	}
	key.Type = av.KeyTypeDate
	view.Automations.Rules[0].Actions[0].Fields[keyID] = &av.AutomationValue{Mode: "template", Template: "invalid date"}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	source, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	source.Root.SetIALAttr("tags", "todo")
	saveDocumentCollectionFixture(t, source)
	addDocumentCollectionChild(t, source)
	plan, err := prepareDuplicateDocTree(source.Box, source.Path)
	if err != nil {
		t.Fatal(err)
	}
	if err = plan.commit(filesys.WriteTree); err == nil {
		t.Fatal("expected invalid collection template to fail")
	}
	for _, tree := range plan.trees {
		if _, err = os.Stat(filepath.Join(util.DataDir, tree.Box, tree.Path)); !os.IsNotExist(err) {
			t.Fatalf("failed copy left document %s: %v", tree.Path, err)
		}
		if treenode.GetBlockTreeInExactBox(tree.ID, tree.Box) != nil {
			t.Fatal("failed copy left block-tree rows")
		}
	}
	if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("failed copy retained collected rows")
	}
}

func TestDocumentCollectionMoveWriteFailureKeepsNewLocation(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	rule := view.Automations.Rules[0]
	rule.Enabled = false
	rule.BlockSource.DocumentIDs = []string{fixture.targetID}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	before, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	before.Root.SetIALAttr("tags", "todo")
	saveDocumentCollectionFixture(t, before)
	if err = MoveDocs([]string{before.Path}, fixture.box.ID, fixture.targetPath, nil); err != nil {
		t.Fatal(err)
	}
	newPath := path.Join(strings.TrimSuffix(fixture.targetPath, ".sy"), before.ID+".sy")
	after, _, err := filesys.ReadTreeSnapshot(before.Box, newPath)
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(filepath.Join(util.DataDir, after.Box, after.Path))
	if err != nil {
		t.Fatal(err)
	}
	rule.Enabled = true
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	injected := errors.New("injected collection binding write failure")
	flushLock.Lock()
	_, err = writeDocumentsWithCollections([]*parse.Tree{after}, map[string]*parse.Tree{before.ID: before}, func(*parse.Tree) error { return injected })
	flushLock.Unlock()
	if !errors.Is(err, injected) {
		t.Fatalf("unexpected write result: %v", err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, before.Box, before.Path)); !os.IsNotExist(err) {
		t.Fatal("collection rollback recreated the old source path")
	}
	current, err := os.ReadFile(filepath.Join(util.DataDir, after.Box, after.Path))
	if err != nil || !bytes.Equal(current, original) {
		t.Fatalf("failed collection lost the moved document: %v", err)
	}
	if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("failed move collection retained a row")
	}
}
