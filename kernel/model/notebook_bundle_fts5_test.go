// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestImportNotebooksSYWithAddressingFloor(t *testing.T) {
	const sourceBox, targetBox = "20261024000000-abcdefg", "20261024000001-hijklmn"
	const sourceDoc, targetDoc = "20261024000002-opqrstu", "20261024000003-vwxyzab"
	setupExportRelatedTest(t, sourceBox, targetBox)
	setupNotebookDocumentImportDatabase(t)
	original := map[string][]byte{}
	for index, boxID := range []string{sourceBox, targetBox} {
		box := &Box{ID: boxID}
		boxConf := box.GetConf()
		boxConf.Name = fmt.Sprintf("Named Notebook %d", index)
		if err := box.SaveConf(boxConf); err != nil {
			t.Fatal(err)
		}
		floor := []byte(`{"version":1,"notebook":"` + boxID + `","minimumMode":2}`)
		if err := os.WriteFile(filepath.Join(util.DataDir, boxID, documentaddressing.FloorPath), floor, 0644); err != nil {
			t.Fatal(err)
		}
		id, title := sourceDoc, "Source"
		if index == 1 {
			id, title = targetDoc, "Target"
		}
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+title, title)
		if index == 0 {
			paragraph := treenode.NewParagraph(ast.NewNodeID())
			paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
				TextMarkBlockRefID: targetDoc, TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Target"})
			tree.Root.AppendChild(paragraph)
		}
		writeExportRelatedTestTree(t, tree)
		name := filepath.Join(util.DataDir, boxID, id+".sy")
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		original[name] = data
		if _, err = os.Stat(boxDocMetaPath(boxID)); !os.IsNotExist(err) {
			t.Fatal("fixture must not depend on notebook document metadata", err)
		}
	}
	archive, err := exportedFilePath(ExportNotebooksSY([]string{sourceBox, targetBox}))
	if err != nil {
		t.Fatal(err)
	}
	imported, bundle, err := ImportSYNotebookBundle(archive)
	if err != nil || !bundle || len(imported) != 2 {
		t.Fatalf("notebook bundle round trip failed: %v, %v, %v", imported, bundle, err)
	}
	roots := map[string]*ast.Node{}
	for _, boxID := range imported {
		if boxID == sourceBox || boxID == targetBox {
			t.Fatal("import reused a source notebook identity")
		}
		root := filepath.Join(util.DataDir, boxID)
		if err = checkImportedDocumentAddressing(root); err != nil {
			t.Fatal("imported addressing floor does not match the new notebook", err)
		}
		entries, readErr := os.ReadDir(root)
		if readErr != nil {
			t.Fatal(readErr)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sy") {
				continue
			}
			tree, loadErr := filesys.LoadTree(boxID, "/"+entry.Name(), util.NewLute())
			if loadErr != nil {
				t.Fatal(loadErr)
			}
			if tree.ID == sourceDoc || tree.ID == targetDoc {
				t.Fatal("import reused a source document identity")
			}
			roots[treenode.ReadDocumentTitle(tree.Root).Text] = tree.Root
		}
	}
	if len(roots) != 2 || roots["Source"] == nil || roots["Target"] == nil {
		t.Fatalf("imported documents are missing: %v", roots)
	}
	references := 0
	ast.Walk(roots["Source"], func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeTextMark && node.TextMarkType == "block-ref" {
			references++
			if node.TextMarkBlockRefID != roots["Target"].ID {
				t.Errorf("cross-notebook reference was not remapped: %s", node.TextMarkBlockRefID)
			}
		}
		return ast.WalkContinue
	})
	if references != 1 {
		t.Fatalf("got %d cross-notebook references, want 1", references)
	}
	for name, before := range original {
		if after, readErr := os.ReadFile(name); readErr != nil || !bytes.Equal(after, before) {
			t.Fatal("round trip changed the source document", readErr)
		}
	}
}
