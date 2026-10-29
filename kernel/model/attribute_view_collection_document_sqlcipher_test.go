// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentCollectionEncryptedCopiesTemplatesAndMoves(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "select": "Select"}}
	box := newStructuredTitlesEncryptedBox(t)
	root := createStructuredTitlesEncryptedDoc(t, box, nil, "Source")
	child := createStructuredTitlesEncryptedDoc(t, box, &root.ID, "Child")
	target := createStructuredTitlesEncryptedDoc(t, box, nil, "Target")
	for _, document := range []*treenode.DocumentPath{root, child} {
		tree, _, err := filesys.ReadTreeSnapshot(box, document.Path)
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
		if err = indexWriteTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
	}
	view := av.NewAttributeView(ast.NewNodeID())
	keyID := ast.NewNodeID()
	view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Name: "Status", Type: av.KeyTypeText}})
	view.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{
		ID: ast.NewNodeID(), Name: "Collect", Trigger: "block", Enabled: true,
		BlockSource: &av.AutomationBlockSource{NotebookIDs: []string{box}, Types: []string{"p"}, Tags: []string{"todo"}},
		Actions: []*av.AutomationAction{{Type: "collect", Target: "current", Fields: map[string]*av.AutomationValue{
			keyID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "New"}}},
		}}},
	}}}
	av.SetAVBoxID(view.ID, box)
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	readView := func(want int) *av.AttributeView {
		t.Helper()
		stored, err := av.ParseAttributeViewForIndexInBox(view.ID, box)
		if err != nil || len(stored.GetBlockKeyValues().Values) != want {
			t.Fatalf("private collection rows: want=%d view=%+v err=%v", want, stored, err)
		}
		return stored
	}
	source, _, err := filesys.ReadTreeSnapshot(box, root.Path)
	if err != nil {
		t.Fatal(err)
	}
	original := structuredTitlesCiphertext(t, root)
	if err = DuplicateDoc(source); err != nil {
		t.Fatal(err)
	}
	readView(1)
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, root.Path), original)
	if _, err = DuplicateDocTree(root.ID); err != nil {
		t.Fatal(err)
	}
	view = readView(3)
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, root.Path), original)
	view.Automations.Rules[0].BlockSource.NotebookIDs = nil
	view.Automations.Rules[0].BlockSource.DocumentIDs = []string{target.ID}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err = MoveDocs([]string{root.Path}, box, target.Path, nil); err != nil {
		t.Fatal(err)
	}
	readView(5)
	current := treenode.GetBlockTreeInExactBox(root.ID, box)
	if current == nil {
		t.Fatal("moved encrypted source disappeared")
	}
	template := filepath.Join(util.DataDir, "templates", "encrypted-collection.md")
	if err = os.MkdirAll(filepath.Dir(template), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(template, []byte("#todo#"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = applyDocContentTemplate(filepath.Base(template), root.ID); err != nil {
		t.Fatal(err)
	}
	view = readView(6)
	sql.FlushQueue()
	for _, row := range view.GetBlockKeyValues().Values {
		if sql.GetBlock(row.Block.ID) != nil {
			t.Fatal("private collection leaked into the global index")
		}
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("private collection created a plaintext database")
	}
	if err = filepath.WalkDir(filepath.Join(util.DataDir, box), func(p string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(p, ".sy") {
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil || !util.IsCiphertext(data) {
			t.Fatalf("encrypted document became plaintext: %s %v", p, err)
		}
		relative, err := filepath.Rel(filepath.Join(util.DataDir, box), p)
		if err != nil {
			return err
		}
		_, _, err = filesys.ReadTreeSnapshot(box, "/"+filepath.ToSlash(relative))
		return err
	}); err != nil {
		t.Fatal(err)
	}
}
