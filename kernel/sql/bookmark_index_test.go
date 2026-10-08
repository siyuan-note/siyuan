package sql

import (
	"html"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBookmarkAttributesFollowBlockIAL(t *testing.T) {
	engine := util.NewLute()
	for _, typed := range []string{"R&D", "<b>", "&lt;b&gt;", `"quoted"`, ""} {
		tree := parse.Parse("", []byte("hello"), engine.ParseOptions)
		tree.Root.ID = "20261008000000-root001"
		tree.Box, tree.Path = "box", "/doc.sy"
		node := tree.Root.FirstChild
		node.ID = "20261008000000-block01"
		node.SetIALAttr("bookmark", typed)
		block, attrs := buildBlockFromNode(node, tree)
		found := false
		for _, attr := range attrs {
			if attr.Name == "bookmark" {
				found = true
				if attr.Type != "b" || attr.BlockID != block.ID || attr.Value != typed ||
					html.UnescapeString(ialAttr(block.IAL, "bookmark")) != typed {
					t.Fatalf("bookmark attribute does not match block IAL: attr=%+v block=%+v", attr, block)
				}
			}
		}
		if !found {
			t.Fatalf("bookmark %q missing from block attributes", typed)
		}
	}
}

func TestBookmarkIndexPreservesBlockFieldsAndLabels(t *testing.T) {
	database := createGraphTestBlocksTable(t)
	previous := db
	db = database
	t.Cleanup(func() { db = previous })
	for _, stmt := range []string{
		"CREATE INDEX idx_blocks_id ON blocks(id)",
		"CREATE TABLE attributes (id, name, value, type, block_id, root_id, box, path)",
	} {
		if _, err := database.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	labels := []string{"R&amp;D", "&amp;lt;b&amp;gt;", "&quot;quoted&quot;", ""}
	for i, label := range labels {
		id := string(rune('a' + i))
		ial := `{: bookmark="` + label + `"}`
		if _, err := database.Exec("INSERT INTO blocks VALUES (?, '', ?, '', 'box', ?, '/doc', 'name', '', '', '', 'content', '', 'markdown', 8, 'p', '', ?, 0, '2026', '2027')", id, "root-"+id, "/"+id+".sy", ial); err != nil {
			t.Fatal(err)
		}
		if _, err := database.Exec("INSERT INTO attributes VALUES (?, 'bookmark', ?, 'b', ?, ?, 'box', ?)", id, label, id, "root-"+id, "/"+id+".sy"); err != nil {
			t.Fatal(err)
		}
	}
	// 同一块的重复属性不能产生重复书签，行级属性不能被当成块书签。
	if _, err := database.Exec("INSERT INTO attributes SELECT 'duplicate', name, value, type, block_id, root_id, box, path FROM attributes WHERE block_id = 'a'"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec("INSERT INTO attributes VALUES ('span', 'bookmark', 'inline', 's', 'child', 'root', '', '/')"); err != nil {
		t.Fatal(err)
	}
	rows, err := database.Query("SELECT * FROM blocks WHERE ial LIKE '%bookmark=%' ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	var before []*Block
	for rows.Next() {
		before = append(before, scanBlockRows(rows))
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	for i := 0; i < 2; i++ {
		if err = ensureBookmarkAttributesIndex(database); err != nil {
			t.Fatal(err)
		}
	}
	blocks := QueryBookmarkBlocks()
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].ID < blocks[j].ID })
	if !reflect.DeepEqual(blocks, before) {
		t.Fatalf("bookmark block fields changed: before=%+v after=%+v", before, blocks)
	}
	labelBlocks := QueryBookmarkLabelBlocks()
	sort.Slice(labelBlocks, func(i, j int) bool { return labelBlocks[i].Path < labelBlocks[j].Path })
	want := []*BookmarkLabelBlock{{Label: labels[0], Box: "box", Path: "/a.sy"},
		{Label: labels[1], Box: "box", Path: "/b.sy"}, {Label: labels[2], Box: "box", Path: "/c.sy"}}
	if !reflect.DeepEqual(labelBlocks, want) {
		t.Fatalf("bookmark label encoding or paths changed: %+v", labelBlocks)
	}
	wantLabels := append([]string(nil), labels[:3]...)
	sort.Strings(wantLabels)
	if actual := QueryBookmarkLabels(); !reflect.DeepEqual(actual, wantLabels) {
		t.Fatalf("labels=%v want=%v", actual, wantLabels)
	}
	for _, columns := range []string{"*", "ial, box, path"} {
		plan := queryPlanDetails(t, database, "SELECT "+columns+" FROM blocks WHERE "+bookmarkBlockPredicate)
		if !strings.Contains(plan, "idx_attributes_bookmark_block_id") || !strings.Contains(plan, "SEARCH blocks USING INDEX idx_blocks_id") {
			t.Fatalf("bookmark query does not use indexed attribute lookup: %s", plan)
		}
	}
	if _, err = database.Exec("DELETE FROM attributes WHERE name = 'bookmark' AND type = 'b'"); err != nil {
		t.Fatal(err)
	}
	if len(QueryBookmarkBlocks()) != 0 || len(QueryBookmarkLabels()) != 0 {
		t.Fatal("removed bookmark attributes still produce bookmarks")
	}
}
