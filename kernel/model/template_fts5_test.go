// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestApplyDocContentTemplatePreservesEditedFirstBlock(t *testing.T) {
	for _, kind := range []string{"empty", "text", "replacement", "empty-with-attributes", "nontext"} {
		t.Run(kind, func(t *testing.T) {
			fixture := setupTemplateDocTreeTransactionTest(t)
			templatePath := writeTemplateDocTreeTestFile(t, "Template body")
			tree, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			first := tree.Root.FirstChild
			switch kind {
			case "text":
				first.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Committed edit")})
			case "replacement":
				first.Unlink()
				first = treenode.NewParagraph("")
				first.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Replacement edit")})
				tree.Root.AppendChild(first)
			case "empty-with-attributes":
				first.SetIALAttr("custom-state", "edited")
			case "nontext":
				first.Unlink()
				first = &ast.Node{Type: ast.NodeThematicBreak, ID: ast.NewNodeID()}
				first.SetIALAttr("id", first.ID)
				tree.Root.AppendChild(first)
			}
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			if err = applyDocContentTemplate(filepath.Base(templatePath), fixture.targetID); err != nil {
				t.Fatal(err)
			}
			saved, err := filesys.LoadTree(tree.Box, tree.Path, NewLute())
			if err != nil {
				t.Fatal(err)
			}
			if kind == "empty" {
				if saved.Root.FirstChild.ID == first.ID || saved.Root.FirstChild.Next != nil {
					t.Fatal("empty placeholder was retained")
				}
			} else {
				retained := saved.Root.FirstChild
				if retained.ID != first.ID || retained.Type != first.Type || retained.Text() != first.Text() ||
					retained.IALAttr("custom-state") != first.IALAttr("custom-state") {
					t.Fatal("committed first-block edit was lost")
				}
			}
			if !strings.Contains(saved.Root.Text(), "Template body") {
				t.Fatal("template content was not appended")
			}
		})
	}
}
