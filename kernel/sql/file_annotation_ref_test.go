// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	stdsql "database/sql"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAnnotationRefRangeQueryPreservesExistingMatches(t *testing.T) {
	previousDB := db
	testDB, err := stdsql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db = testDB
	t.Cleanup(func() { db = previousDB; testDB.Close() })
	if _, err = db.Exec("CREATE TABLE file_annotation_refs (block_id, annotation_id)"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err = ensureFileAnnotationRefIndex(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"20261008000000-abcdefg", "", "a%_'\\", "标注"} {
		if _, err = db.Exec("DELETE FROM file_annotation_refs"); err != nil {
			t.Fatal(err)
		}
		for _, stored := range []string{id, id, id + "?", id + "?box=notebook", id + "#", id + "#view", id + "?中文", id + "@", id + "$", id + "x", "x" + id} {
			if _, err = db.Exec("INSERT INTO file_annotation_refs VALUES (?, ?)", stored, stored); err != nil {
				t.Fatal(err)
			}
		}
		rows, err := db.Query("SELECT block_id FROM file_annotation_refs WHERE annotation_id = ? OR substr(annotation_id, 1, ?) IN (?, ?)", id, len(id)+1, id+"?", id+"#")
		if err != nil {
			t.Fatal(err)
		}
		var before []string
		for rows.Next() {
			var blockID string
			if err = rows.Scan(&blockID); err != nil {
				t.Fatal(err)
			}
			before = append(before, blockID)
		}
		if err = rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
		after := QueryRefIDsByAnnotationID(id)
		sort.Strings(before)
		sort.Strings(after)
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("annotation %q changed matches: before=%v after=%v", id, before, after)
		}
	}
	plan := queryPlanDetails(t, db, fileAnnotationRefQuery, "id", "id?", "id@", "id#", "id$")
	if strings.Count(plan, "SEARCH file_annotation_refs USING INDEX idx_file_annotation_refs_annotation_id") != 3 || strings.Contains(plan, "SCAN file_annotation_refs") {
		t.Fatalf("annotation reference query still scans the table: %s", plan)
	}
}

func TestFileAnnotationRefsFromTree(t *testing.T) {
	const id = "20260912000000-abcdefg"
	for _, asset := range []string{"assets/a.pdf", "assets/a-20260912000001-abcdefg.pdf", "assets/folder/文档.PDF"} {
		for _, query := range []string{"", "?box=20260912000000-hijklmn&dataPath=/docs/a.sy"} {
			root := &ast.Node{Type: ast.NodeDocument, ID: "20260912000000-root001"}
			paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "20260912000000-block01"}
			root.AppendChild(paragraph)
			paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "file-annotation-ref",
				TextMarkFileAnnotationRefID: asset + "/" + id + query, TextMarkTextContent: "anchor"})
			_, refs := refsFromTree(&parse.Tree{Root: root, ID: root.ID, Box: "20260912000000-hijklmn"})
			if len(refs) != 1 || refs[0].AnnotationID != id || refs[0].FilePath != asset+query || refs[0].BlockID != paragraph.ID {
				t.Fatalf("incorrect annotation index for %q: %+v", asset+query, refs)
			}
		}
	}
}

func TestFileAnnotationMarkdownIndex(t *testing.T) {
	lute := util.NewLute()
	const annotationID = "20260912000000-abcdefg"
	for _, file := range []string{"assets/a.pdf", "assets/a-20260912000001-abcdefg.pdf", "assets/文档.PDF"} {
		for _, query := range []string{"", "?box=20260912000000-hijklmn&dataPath=/docs/a.sy"} {
			markdown := "<<" + file + "/" + annotationID + query + ` "anchor">>`
			tree := lute.BlockDOM2Tree(lute.Md2BlockDOM(markdown, false))
			tree.Box = "20260912000000-hijklmn"
			_, refs := refsFromTree(tree)
			if len(refs) != 1 || refs[0].AnnotationID != annotationID || refs[0].FilePath != file+query {
				t.Fatalf("Markdown annotation did not reach the index: %q, refs=%+v", markdown, refs)
			}
		}
	}
}

func TestQueryFileAnnotationRefsIncludesExistingIndexes(t *testing.T) {
	originalDB := db
	testDB, err := stdsql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db = testDB
	t.Cleanup(func() { db = originalDB; testDB.Close() })
	if _, err = db.Exec("CREATE TABLE file_annotation_refs (block_id TEXT, annotation_id TEXT)"); err != nil {
		t.Fatal(err)
	}
	const id = "20260912000000-abcdefg"
	for blockID, annotationID := range map[string]string{
		"plain": id, "query": id + "?box=20260912000000-hijklmn", "fragment": id + "#view",
		"other": "20260912000000-abcdefh", "prefix": id + "x", "suffix": "x" + id,
	} {
		if _, err = db.Exec("INSERT INTO file_annotation_refs VALUES (?, ?)", blockID, annotationID); err != nil {
			t.Fatal(err)
		}
	}
	got := map[string]bool{}
	for _, id := range QueryRefIDsByAnnotationID(id) {
		got[id] = true
	}
	if !reflect.DeepEqual(got, map[string]bool{"plain": true, "query": true, "fragment": true}) {
		t.Fatalf("unexpected annotation backlinks: %v", got)
	}

	boxDB, boxID := useEncryptedQueryTestDB(t)
	if _, err = boxDB.Exec("CREATE TABLE file_annotation_refs (block_id TEXT, annotation_id TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = boxDB.Exec("INSERT INTO file_annotation_refs VALUES (?, ?)", "encrypted", id+"?box="+boxID); err != nil {
		t.Fatal(err)
	}
	if got := QueryRefIDsByAnnotationIDInBox(id, boxID); !reflect.DeepEqual(got, []string{"encrypted"}) {
		t.Fatalf("encrypted backlinks crossed database scope: %v", got)
	}
	originalIsEncryptedBox := IsEncryptedBoxFn
	IsEncryptedBoxFn = func(id string) bool { return id == boxID }
	t.Cleanup(func() { IsEncryptedBoxFn = originalIsEncryptedBox })
	encryptedDBs.Delete(boxID)
	if got := QueryRefIDsByAnnotationIDInBox(id, boxID); len(got) != 0 {
		t.Fatalf("locked notebook fell back to global backlinks: %v", got)
	}
}
