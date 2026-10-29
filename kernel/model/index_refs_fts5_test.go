// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	gosql "database/sql"
	"os"
	"os/exec"
	"reflect"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIndexRefsMatchesNormalIndex(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_INDEX_REFS") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestIndexRefsMatchesNormalIndex$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_INDEX_REFS=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("reference reindex subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	definition := newHPathTestDoc(t, box.ID, "/", "Definition", 1)
	for _, kind := range []string{"block", "embed", "title", "database", "annotation"} {
		tree := newHPathTestDoc(t, box.ID, "/", kind, 1)
		var node *ast.Node
		switch kind {
		case "block":
			node = treenode.NewParagraph("")
			node.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: definition.ID,
				TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Definition"})
		case "embed":
			node = &ast.Node{Type: ast.NodeBlockQueryEmbed, ID: ast.NewNodeID()}
			node.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte("select * from blocks where id='" + definition.ID + "'")})
		case "title":
			node = &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(), CalloutType: "NOTE", CalloutTitleExplicit: true,
				CalloutTitle: "((" + definition.ID + ` "Definition"))`}
			node.AppendChild(treenode.NewParagraph(""))
		case "database":
			view := av.NewAttributeView(ast.NewNodeID())
			view.KeyValues = append(view.KeyValues, &av.KeyValues{
				Key: &av.Key{ID: ast.NewNodeID(), Type: av.KeyTypeText},
				Values: []*av.Value{{Type: av.KeyTypeText, Text: &av.ValueText{Rich: &av.ValueTextRich{
					Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
					Content: "((" + definition.ID + ` "Definition"))`,
				}}}},
			})
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			node = &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: view.ID}
		case "annotation":
			node = treenode.NewParagraph("")
			node.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "file-annotation-ref",
				TextMarkFileAnnotationRefID: "assets/document.pdf/20261026000000-annot01", TextMarkTextContent: "Annotation"})
		}
		node.SetIALAttr("id", node.ID)
		tree.Root.AppendChild(node)
		if err := writeTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	sql.FlushQueue()
	database, err := gosql.Open("sqlite3_extended", util.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	read := func() []string {
		t.Helper()
		rows, err := database.Query("SELECT root_id || ':' || block_id || ':' || def_block_id || ':' || type FROM refs UNION ALL SELECT root_id || ':' || block_id || ':' || file_path || ':' || annotation_id FROM file_annotation_refs ORDER BY 1")
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var result []string
		for rows.Next() {
			var value string
			if err = rows.Scan(&value); err != nil {
				t.Fatal(err)
			}
			result = append(result, value)
		}
		if err = rows.Err(); err != nil {
			t.Fatal(err)
		}
		return result
	}
	want := read()
	if len(want) != 5 {
		t.Fatalf("normal index did not include all reference fixtures: %v", want)
	}
	for _, table := range []string{"refs", "file_annotation_refs"} {
		if _, err = database.Exec("DELETE FROM " + table); err != nil {
			t.Fatal(err)
		}
	}
	IndexRefs()
	sql.FlushQueue()
	if got := read(); !reflect.DeepEqual(got, want) {
		t.Fatalf("reference rebuild differs from normal indexing:\n got %v\nwant %v", got, want)
	}
}
