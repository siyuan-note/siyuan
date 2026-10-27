// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var upsertTestTables = []auxiliaryIndexTable{spanIndex, assetIndex, attributeIndex, refIndex, fileAnnotationIndex,
	{name: "blocks", columns: "id,parent_id,root_id,hash,box,path,hpath,name,alias,memo,tag,content,fcontent,markdown,length,type,subtype,ial,sort,created,updated"}}

func newUpsertTestTree(size int) *parse.Tree {
	tree := treenode.NewTree("20261019000000-box0001", "/"+auxiliaryTestRoot+".sy", "/Index baseline", "Index baseline")
	tree.Root.FirstChild.Unlink()
	tree.Root.SetIALAttr("tags", "document-tag")
	for i := range size {
		paragraph := treenode.NewParagraph(fmt.Sprintf("20261019010000-%07d", i))
		paragraph.SetIALAttr("custom-note", "unchanged")
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("original paragraph content ")})
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "tag"})
		tree.Root.AppendChild(paragraph)
	}
	return tree
}

func upsertTableSnapshots(t testing.TB, database *sql.DB, withIDs bool) map[string][]string {
	t.Helper()
	result := map[string][]string{}
	for _, table := range upsertTestTables {
		result[table.name] = auxiliaryTableSnapshot(t, database, table, withIDs)
	}
	return result
}

func TestUpsertTreeLargeDocumentDoesNotRewriteUnchangedAuxiliaryRows(t *testing.T) {
	previousDB, previousDisabled := db, cacheDisabled
	previousCached, previousIgnore, previousDir := IndexIgnoreCached, indexIgnore, util.DataDir
	IndexIgnoreCached, indexIgnore, cacheDisabled, util.DataDir = true, nil, true, t.TempDir()
	t.Cleanup(func() {
		db, cacheDisabled = previousDB, previousDisabled
		IndexIgnoreCached, indexIgnore, util.DataDir = previousCached, previousIgnore, previousDir
		ClearCache()
	})
	database := newDeletePathTestDB(t, false)
	db = database
	tree := newUpsertTestTree(20000)
	write := func(full bool) {
		t.Helper()
		tx, err := database.Begin()
		if err != nil {
			t.Fatal(err)
		}
		defer closeTxPreparedStmts(tx)
		defer tx.Rollback()
		if full {
			err = indexTree(tx, tree, nil)
		} else {
			err = upsertTree(tx, tree, nil)
		}
		if err == nil {
			err = commitTx(tx)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	write(true)
	for _, table := range upsertTestTables[:5] {
		for _, operation := range []string{"INSERT", "DELETE", "UPDATE"} {
			execDeletePathTestSQL(t, database, "CREATE TRIGGER forbid_"+table.name+operation+" BEFORE "+operation+
				" ON "+table.name+" BEGIN SELECT RAISE(ABORT, 'unchanged auxiliary row was written'); END")
		}
	}
	tree.Root.FirstChild.FirstChild.Tokens = []byte("changed ordinary paragraph content ")
	write(false)
	var content string
	if err := database.QueryRow("SELECT content FROM blocks WHERE id = ?", tree.Root.FirstChild.ID).Scan(&content); err != nil ||
		!strings.Contains(content, "changed ordinary") {
		t.Fatalf("block was not updated: %q, %v", content, err)
	}
	execDeletePathTestSQL(t, database, "INSERT INTO blocks_fts(blocks_fts, rank) VALUES('integrity-check', 1)")
}

func TestUpsertTreeMatchesCompleteIndexAndPreservesUnchangedRows(t *testing.T) {
	for _, scoped := range []bool{false, true} {
		t.Run(fmt.Sprint(scoped), func(t *testing.T) {
			previousDB, previousDisabled := db, cacheDisabled
			previousCached, previousIgnore, previousDir := IndexIgnoreCached, indexIgnore, util.DataDir
			IndexIgnoreCached, indexIgnore, cacheDisabled, util.DataDir = true, nil, true, t.TempDir()
			t.Cleanup(func() {
				db, cacheDisabled = previousDB, previousDisabled
				IndexIgnoreCached, indexIgnore, util.DataDir = previousCached, previousIgnore, previousDir
				ClearCache()
			})
			database := newDeletePathTestDB(t, scoped)
			db = database
			tree := newUpsertTestTree(3)
			var decoy *sql.DB
			if scoped {
				decoy = newDeletePathTestDB(t, false)
				db = decoy
				encryptedDBs.Store(tree.Box, database)
				t.Cleanup(func() { encryptedDBs.Delete(tree.Box) })
				execDeletePathTestSQL(t, decoy, "INSERT INTO attributes VALUES ('decoy', 'custom-note', 'private decoy', 'b', ?, ?, ?, ?)",
					tree.Root.FirstChild.ID, tree.ID, tree.Box, tree.Path)
			}
			asset := "assets/upsert-" + ast.NewNodeID() + ".png"
			if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(util.DataDir, asset), []byte("fixture asset"), 0600); err != nil {
				t.Fatal(err)
			}
			cache.SetAssetHash("initial-asset-hash", asset)
			t.Cleanup(func() { cache.RemoveAssetHash("initial-asset-hash"); cache.RemoveAssetHash("changed-asset-hash") })
			attached := tree.Root.FirstChild.Next
			attached.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: asset, TextMarkTextContent: "asset"})
			attached.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: "20261019000000-target1", TextMarkBlockRefSubtype: "s", TextMarkTextContent: "reference"})
			annotation := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "file-annotation-ref", TextMarkFileAnnotationRefID: "assets/test.pdf/20261019000000-annot01", TextMarkTextContent: "annotation"}
			attached.AppendChild(annotation)
			write := func(full bool) error {
				tx, err := beginTxForBox(tree.Box)
				if err != nil {
					return err
				}
				defer closeTxPreparedStmts(tx)
				defer tx.Rollback()
				if full {
					err = indexTree(tx, tree, nil)
				} else {
					err = upsertTree(tx, tree, nil)
				}
				if err != nil {
					return err
				}
				return commitTx(tx)
			}
			if err := write(true); err != nil {
				t.Fatal(err)
			}
			oracle := newDeletePathTestDB(t, scoped)
			compare := func() {
				t.Helper()
				tx, err := oracle.Begin()
				if err != nil {
					t.Fatal(err)
				}
				if err = deleteByRootID(tx, tree.ID, nil); err == nil {
					err = indexTree(tx, tree, nil)
				}
				if err == nil {
					err = commitTx(tx)
				}
				closeTxPreparedStmts(tx)
				tx.Rollback()
				if err != nil {
					t.Fatal(err)
				}
				if got, want := upsertTableSnapshots(t, database, false), upsertTableSnapshots(t, oracle, false); !reflect.DeepEqual(got, want) {
					for table, values := range want {
						if !reflect.DeepEqual(got[table], values) {
							t.Errorf("%s differs from complete index: got=%v want=%v", table, got[table], values)
						}
					}
					t.FailNow()
				}
				execDeletePathTestSQL(t, database, "INSERT INTO blocks_fts(blocks_fts, rank) VALUES('integrity-check', 1)")
			}
			before := upsertTableSnapshots(t, database, true)
			tree.Root.FirstChild.FirstChild.Tokens = []byte("changed ordinary paragraph content ")
			if err := write(false); err != nil {
				t.Fatal(err)
			}
			for _, table := range upsertTestTables[:5] {
				if got := auxiliaryTableSnapshot(t, database, table, true); !reflect.DeepEqual(got, before[table.name]) {
					t.Fatalf("ordinary text edit rewrote unchanged %s records", table.name)
				}
			}
			compare()
			// 源块哈希未变时，外部资源元数据仍需比较并更新。
			cache.SetAssetHash("changed-asset-hash", asset)
			if err := write(false); err != nil {
				t.Fatal(err)
			}
			compare()
			attached.SetIALAttr("custom-note", "changed")
			attached.FirstChild.Next.TextMarkTextContent = "changed-tag"
			annotation.TextMarkTextContent = "changed annotation anchor"
			if err := write(false); err != nil {
				t.Fatal(err)
			}
			compare()
			attached.Unlink()
			added := treenode.NewParagraph("20261019010000-added01")
			added.SetIALAttr("custom-note", "new")
			added.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "new tag"})
			tree.Root.AppendChild(added)
			if err := write(false); err != nil {
				t.Fatal(err)
			}
			compare()
			before = upsertTableSnapshots(t, database, true)
			for range 2 {
				if err := write(false); err != nil {
					t.Fatal(err)
				}
			}
			if got := upsertTableSnapshots(t, database, true); !reflect.DeepEqual(got, before) {
				t.Fatal("repeated final snapshots rewrote committed rows")
			}
			execDeletePathTestSQL(t, database, "CREATE TRIGGER fail_attribute BEFORE INSERT ON attributes WHEN new.value = 'fail' BEGIN SELECT RAISE(ABORT, 'injected upsert failure'); END")
			tree.Root.FirstChild.FirstChild.Tokens = []byte("failed text update")
			tree.Root.FirstChild.SetIALAttr("custom-note", "fail")
			if err := write(false); err == nil || !strings.Contains(err.Error(), "injected upsert failure") {
				t.Fatalf("expected injected failure, got %v", err)
			}
			if got := upsertTableSnapshots(t, database, true); !reflect.DeepEqual(got, before) {
				t.Fatal("failed upsert left partial block or auxiliary updates")
			}
			execDeletePathTestSQL(t, database, "INSERT INTO blocks_fts(blocks_fts, rank) VALUES('integrity-check', 1)")
			if scoped {
				if got := deletePathTestIDs(t, decoy, "SELECT value FROM attributes"); !reflect.DeepEqual(got, []string{"private decoy"}) {
					t.Fatalf("scoped update changed global rows with the same document IDs: %v", got)
				}
			}
		})
	}
}
