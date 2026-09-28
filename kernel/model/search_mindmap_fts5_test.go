//go:build fts5

package model

import (
	gosql "database/sql"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func TestMindmapSearchFTS(t *testing.T) {
	setSearchCaseSensitive(t, true)
	db, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	for _, stmt := range []string{
		"CREATE TABLE blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated)",
		"CREATE VIRTUAL TABLE blocks_fts USING fts5(id UNINDEXED, parent_id UNINDEXED, root_id UNINDEXED, hash UNINDEXED, box UNINDEXED, path UNINDEXED, hpath UNINDEXED, name, alias, memo, tag, content, fcontent, markdown UNINDEXED, length UNINDEXED, type UNINDEXED, subtype UNINDEXED, ial, sort UNINDEXED, created UNINDEXED, updated UNINDEXED, content='blocks', content_rowid='rowid')",
	} {
		if _, err = db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	root := &ast.Node{Type: ast.NodeDocument, ID: "20260929000000-root001"}
	mindmap := &ast.Node{Type: ast.NodeMindmap, ID: "20260929000000-map0001", ListData: &ast.ListData{}}
	item := &ast.Node{Type: ast.NodeMindmapItem, ID: "20260929000000-item001", ListData: &ast.ListData{}}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "20260929000000-para001"}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("shopping")})
	item.AppendChild(paragraph)
	mindmap.AppendChild(item)
	root.AppendChild(mindmap)
	tree := &parse.Tree{Root: root, ID: root.ID, Box: "20260929000000-box0001", Path: "/" + root.ID + ".sy", HPath: "/Tasks"}
	for _, n := range []*ast.Node{mindmap, item, paragraph} {
		block := sql.BuildBlockFromNode(n, tree)
		insertSearchHPathTestBlock(t, db, block.ID, root.ID, "/Tasks", block.Content, block.Type)
	}
	if _, err = db.Exec("INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild')"); err != nil {
		t.Fatal(err)
	}
	check := func(filter string, want int) {
		t.Helper()
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM blocks_fts WHERE blocks_fts MATCH 'shopping' AND " + filter).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("%s: got %d, want %d", filter, count, want)
		}
	}
	for _, tc := range []struct {
		types map[string]bool
		want  int
	}{
		{nil, 2},
		{map[string]bool{"mindmap": true}, 1},
		{map[string]bool{"mindmapItem": true}, 1},
		{map[string]bool{"mindmap": true, "mindmapItem": true}, 2},
		{map[string]bool{"paragraph": true}, 1},
		{map[string]bool{"list": true, "listItem": true}, 0},
		{map[string]bool{"mindmap": false, "mindmapItem": false}, 0},
	} {
		check(buildTypeFilter(tc.types, nil), tc.want)
	}
	// 引用和嵌入候选搜索共用全局类型过滤。
	Conf.Search.Mindmap = new(true)
	Conf.Search.MindmapItem = new(false)
	check("type IN "+Conf.Search.TypeFilter(), 2)
	Conf.Search.Mindmap = new(false)
	Conf.Search.MindmapItem = new(true)
	check("type IN "+Conf.Search.TypeFilter(), 2)
	Conf.Search.MindmapItem = new(false)
	check("type IN "+Conf.Search.TypeFilter(), 1)
}
