// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestStructuredTitlesCreationAndIdentity(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_STRUCTURED_TITLES") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStructuredTitlesCreationAndIdentity$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_STRUCTURED_TITLES=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("structured titles: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Titles", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	ordinary := newHPathTestDoc(t, box.ID, "/", "Existing", 1)
	oldSource, _ := os.ReadFile(filepath.Join(util.DataDir, box.ID, ordinary.Path))
	if err := treenode.SetDocumentMetadataState(box.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	create := func(parent *string, title string) *treenode.DocumentPath {
		t.Helper()
		ret, err := CreateDocByParent(DocumentCreateRequest{Notebook: box.ID, ParentID: parent, ID: ast.NewNodeID(),
			TitleFormat: "plain", Title: title, Markdown: "body"})
		if err != nil || ret.Title.Text != title {
			t.Fatalf("create %q: %+v %v", title, ret, err)
		}
		return ret
	}
	literal := create(nil, "A/B")
	t.Run("plain scope paths and rendered result paths", func(t *testing.T) {
		const title = "A&amp;B<tag>"
		doc := create(nil, title)
		hPath, err := GetFullHPathByID(doc.ID)
		if err != nil || hPath != boxConf.Name+"/"+title {
			t.Fatalf("search scope path is not literal text: %q, %v", hPath, err)
		}
		result := fromSQLBlock(&sql.Block{ID: doc.ID, RootID: doc.ID, Box: box.ID, Type: "d", HPath: "/" + title}, "", 0)
		if result.HPath != util.EscapeHTML("/"+title) {
			t.Fatalf("search result path is not escaped HTML: %q", result.HPath)
		}
	})
	parent := create(nil, "A")
	child := create(&parent.ID, "B")
	if literal.DisplayPath != child.DisplayPath || literal.Depth != 1 || child.Depth != 2 {
		t.Fatal("display path changed identity")
	}
	for _, item := range []struct {
		segments []string
		id       string
	}{{[]string{"A/B"}, literal.ID}, {[]string{"A", "B"}, child.ID}} {
		resolved, err := ResolveDocPath(box.ID, "root", nil, item.segments)
		if err != nil || resolved.Resolved == nil || resolved.Resolved.ID != item.id {
			t.Fatal(resolved, err)
		}
	}
	leaf := create(&literal.ID, "C/../D &amp; **literal**")
	loaded, err := filesys.LoadTree(box.ID, leaf.Path, util.NewLute())
	if err != nil || loaded.Root.Spec != treenode.DocumentTitleSpec {
		t.Fatal("title spec not recorded", err)
	}
	leafBefore, _ := os.ReadFile(filepath.Join(util.DataDir, box.ID, leaf.Path))
	if err = RenameDoc(box.ID, literal.Path, "Parent/renamed"); err != nil {
		t.Fatal(err)
	}
	leafAfter, _ := os.ReadFile(filepath.Join(util.DataDir, box.ID, leaf.Path))
	if !bytes.Equal(leafBefore, leafAfter) {
		t.Fatal("parent rename rewrote descendant source")
	}
	paths, missing, err := GetDocPaths(box.ID, []string{leaf.ID})
	if err != nil || len(missing) != 0 || paths[0].Depth != 2 || paths[0].Segments[0].Text != "Parent/renamed" ||
		paths[0].Title.Text != leaf.Title.Text {
		t.Fatal(paths, missing, err)
	}
	if ids, err := GetIDsByHPath("/A/B", box.ID); err != nil || len(ids) != 1 || ids[0] != child.ID {
		t.Fatal(err)
	}
	if _, err = CreateWithMarkdown("", box.ID, "/Plain", "", parent.ID, ast.NewNodeID(), false, "", nil); err != nil {
		t.Fatal(err)
	}
	newSource, _ := os.ReadFile(filepath.Join(util.DataDir, box.ID, ordinary.Path))
	if !bytes.Equal(oldSource, newSource) || ordinary.Root.Spec != treenode.BaseSpec {
		t.Fatal("unused title capability upgraded an existing source")
	}

	for _, test := range []struct {
		markdown, title string
		typeOf          ast.NodeType
		convert         func(string, string, string, string, bool) (string, string, error)
	}{
		{"# Heading/part\n\nBody", "Heading/part", ast.NodeHeading, Heading2Doc},
		{"- Item/part", "Item/part", ast.NodeListItem, ListItem2Doc},
	} {
		source, createErr := CreateDocByParent(DocumentCreateRequest{Notebook: box.ID, ID: ast.NewNodeID(),
			TitleFormat: "plain", Title: "Conversion source", Markdown: test.markdown})
		if createErr != nil {
			t.Fatal(createErr)
		}
		tree, loadErr := filesys.LoadTree(box.ID, source.Path, util.NewLute())
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		blockID := ""
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && n.Type == test.typeOf {
				blockID = n.ID
				return ast.WalkStop
			}
			return ast.WalkContinue
		})
		_, convertedPath, convertErr := test.convert(blockID, box.ID, "/", "", false)
		if convertErr != nil {
			t.Fatal(convertErr)
		}
		converted, loadErr := filesys.LoadTree(box.ID, convertedPath, util.NewLute())
		if loadErr != nil || treenode.ReadDocumentTitle(converted.Root).Text != test.title ||
			converted.Root.Spec != treenode.DocumentTitleSpec {
			t.Fatal("conversion changed literal title or source spec", test.title, loadErr)
		}
	}

	// 新模式的旧模板也拒绝同名祖先，不任取匹配项；显式标题中的斜杠保持原文。
	create(nil, "A")
	boxConf.DocCreateSavePath = "/A/Leaf"
	if err = box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if _, err = PlanDocumentCreation(DocumentPlanRequest{Notebook: box.ID, Purpose: "document", ID: ast.NewNodeID()}); err == nil {
		t.Fatal("ambiguous legacy template selected an arbitrary ancestor")
	}
	title := "Literal/final"
	plan, err := PlanDocumentCreation(DocumentPlanRequest{Notebook: box.ID, Purpose: "document", ID: ast.NewNodeID(),
		ContextID: &literal.ID, Placement: "child", Title: &title})
	if err != nil || len(plan.Steps) != 1 || plan.Title != title {
		t.Fatal(plan, err)
	}
}
