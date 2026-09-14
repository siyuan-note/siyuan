//go:build fts5

package model

import (
	gosql "database/sql"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func TestCustomBlockSearchFTS(t *testing.T) {
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
	root := &ast.Node{Type: ast.NodeDocument, ID: "20260914000000-root001"}
	node := &ast.Node{Type: ast.NodeCustomBlock, ID: "20260914000000-custom1", CustomBlockInfo: "example/task", Tokens: []byte(`{"content":"采购清单 shopping"}`)}
	root.AppendChild(node)
	block := sql.BuildBlockFromNode(node, &parse.Tree{Root: root, ID: root.ID, Box: "20260729120000-box000", Path: "/" + root.ID + ".sy", HPath: "/Tasks"})
	insertSearchHPathTestBlock(t, db, block.ID, root.ID, "/Tasks", block.Content, block.Type)
	if _, err = db.Exec("INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild')"); err != nil {
		t.Fatal(err)
	}
	check := func(query string, types map[string]bool, want int) {
		t.Helper()
		cte, args := buildFTSAndHPathMatchesCTE("", query, "", "", nil, nil, buildTypeFilter(types, nil), "")
		var count int
		if err := db.QueryRow(cte+" SELECT COUNT(*) FROM matches", args...).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("query %q types %v: got %d, want %d", query, types, count, want)
		}
	}
	for _, query := range []string{"shopping", "采购清单"} {
		check(query, nil, 1)
		check(query, map[string]bool{"customBlock": true}, 1)
		check(query, map[string]bool{"paragraph": true}, 0)
		check(query, map[string]bool{"customBlock": false}, 0)
	}
	if _, err = db.Exec("UPDATE blocks_fts SET content = 'completed' WHERE rowid = 1"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE blocks SET content = 'completed' WHERE rowid = 1"); err != nil {
		t.Fatal(err)
	}
	check("shopping", nil, 0)
	check("completed", nil, 1)
}
