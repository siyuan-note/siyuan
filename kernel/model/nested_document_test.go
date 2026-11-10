// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNestedDocumentMetadataRecovery(t *testing.T) {
	const helper = "SIYUAN_TEST_NESTED_DOCUMENT_RECOVERY"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestNestedDocumentMetadataRecovery$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("nested document subprocess: %v\n%s", err, output)
		}
		return
	}
	for _, state := range []string{"error", "building", "full-rebuild"} {
		t.Run(state, func(t *testing.T) {
			prepareHPathRefreshTest(t)
			t.Cleanup(backgroundRefreshWaitGroup.Wait)
			box := &Box{ID: ast.NewNodeID()}
			cfg := conf.NewBoxConf()
			cfg.Name, cfg.Closed = "Nested document", false
			if err := box.SaveConf(cfg); err != nil {
				t.Fatal(err)
			}
			tree, nested, paragraph := nestedDocumentRecoveryFixture(box.ID)
			engine := util.NewLute()
			data := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
			if err := os.WriteFile(filepath.Join(util.DataDir, box.ID, tree.Path), data, 0600); err != nil {
				t.Fatal(err)
			}
			treenode.IndexBlockTree(tree)
			if err := treenode.SetDocumentMetadataState(box.ID, "ready"); err != treenode.ErrDocumentMetadataUnavailable {
				t.Fatal("legacy nested document did not block notebook readiness", err)
			}
			if state == "full-rebuild" {
				sql.InitDatabase(true)
				indexBox(box.ID)
			} else {
				if err := treenode.SetDocumentMetadataState(box.ID, state); err != nil {
					t.Fatal(err)
				}
				recoverOpenedDocumentMetadata()
			}
			if treenode.DocumentMetadataState(box.ID) != "ready" {
				t.Fatal("notebook did not recover")
			}
			loaded, err := filesys.LoadTree(box.ID, tree.Path, engine)
			if err != nil || loaded.ID != tree.ID {
				t.Fatal("recovery changed document identity", err)
			}
			block := loaded.Root.FirstChild
			if block.Type != ast.NodeSuperBlock || block.ID != nested.ID ||
				block.IALAttr("title") != nested.IALAttr("title") || block.IALAttr("custom-test") != "preserved" {
				t.Fatal("recovery changed wrapper identity or attributes")
			}
			child := block.FirstChild.Next.Next
			if child.ID != paragraph.ID || string(child.FirstChild.Tokens) != "Preserved body" {
				t.Fatal("recovery changed body identity or content")
			}
			if indexed := treenode.GetBlockTreeInExactBox(nested.ID, box.ID); indexed == nil || indexed.Type != "s" {
				t.Fatal("stale nested document index survived", indexed)
			}
			if missing, err := treenode.MissingDocumentMetadata(box.ID); err != nil || len(missing) != 0 {
				t.Fatal("metadata is still incomplete", missing, err)
			}
			if _, err := CreateDocByParent(DocumentCreateRequest{Notebook: box.ID, ID: ast.NewNodeID(),
				TitleFormat: "plain", Title: "Created after recovery", Markdown: "New body"}); err != nil {
				t.Fatal("recovered notebook cannot create a document", err)
			}
		})
	}
}

func nestedDocumentRecoveryFixture(box string) (*parse.Tree, *ast.Node, *ast.Node) {
	tree := treenode.NewTree(box, "/"+ast.NewNodeID()+".sy", "/Root", "Root")
	tree.Root.FirstChild.Unlink()
	nested := &ast.Node{Type: ast.NodeDocument, ID: ast.NewNodeID(), Spec: "2"}
	nested.SetIALAttr("id", nested.ID)
	nested.SetIALAttr("title", "Nested title")
	nested.SetIALAttr("type", "doc")
	nested.SetIALAttr("updated", "20260701091344")
	nested.SetIALAttr("custom-test", "preserved")
	paragraph := treenode.NewParagraph("")
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Preserved body")})
	nested.AppendChild(paragraph)
	tree.Root.AppendChild(nested)
	return tree, nested, paragraph
}
