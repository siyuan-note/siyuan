// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
)

func TestNestedDocumentIndexRepair(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box := withDocumentMetadataDB(t, encrypted)
			tree := NewTree(box, "/20260701111533-6sraog7.sy", "/Root", "Root")
			nested := &ast.Node{Type: ast.NodeDocument, ID: "20260609092353-ysnx8qo"}
			nested.SetIALAttr("id", nested.ID)
			nested.AppendChild(NewParagraph(""))
			tree.Root.AppendChild(nested)
			IndexBlockTree(tree)
			if err := SetDocumentMetadataState(box, "ready"); err != ErrDocumentMetadataUnavailable {
				t.Fatal("nested document fixture did not block metadata readiness", err)
			}
			// 同 ID 的真实文档及其他来源记录不能随嵌套文档一起清理。
			for _, source := range []struct{ box, root, path string }{
				{box, nested.ID, "/" + nested.ID + ".sy"},
				{"other-box", tree.ID, tree.Path},
				{box, tree.ID, "/other.sy"},
			} {
				if _, err := execForBox(box, `INSERT INTO blocktrees
					(id, root_id, parent_id, box_id, path, type) VALUES (?, ?, '', ?, ?, 'd')`,
					nested.ID, source.root, source.box, source.path); err != nil {
					t.Fatal(err)
				}
			}
			realDocument := NewTree(box, "/"+nested.ID+".sy", "/Real document", "Real document")
			tx, err := beginTxForBox(box)
			if err != nil {
				t.Fatal(err)
			}
			if err = upsertDocumentMetadata(tx, realDocument); err != nil {
				tx.Rollback()
				t.Fatal(err)
			}
			if err = tx.Commit(); err != nil {
				t.Fatal(err)
			}
			FixNestedDocumentNodes(tree.Root)
			IndexBlockTree(tree)
			var repaired, unrelated int
			if err := queryRowForBox(box, `SELECT COUNT(*) FROM blocktrees WHERE box_id=? AND root_id=? AND path=?
				AND id=? AND type='s'`, box, tree.ID, tree.Path, nested.ID).Scan(&repaired); err != nil || repaired != 1 {
				t.Fatal("converted block is not indexed exactly once", repaired, err)
			}
			if err := queryRowForBox(box, "SELECT COUNT(*) FROM blocktrees WHERE id=? AND type='d'", nested.ID).
				Scan(&unrelated); err != nil || unrelated != 3 {
				t.Fatal("repair removed unrelated document records", unrelated, err)
			}
			var title string
			if err := queryRowForBox(box, "SELECT title_text FROM document_metadata WHERE box_id=? AND id=?", box, nested.ID).
				Scan(&title); err != nil || title != "Real document" {
				t.Fatal("repair removed metadata belonging to the real document", title, err)
			}
			if _, err := execForBox(box, "DELETE FROM blocktrees WHERE id=? AND type='d'", nested.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := GetDocumentMetadata(box, tree.ID); err != nil {
				t.Fatal("repair removed root metadata", err)
			}
			if err := SetDocumentMetadataState(box, "ready"); err != nil {
				t.Fatal("repaired notebook is not ready", err)
			}
		})
	}
}

func TestNestedDocumentIndexRepairRollsBack(t *testing.T) {
	for _, failure := range []string{"update", "insert"} {
		t.Run(failure, func(t *testing.T) {
			box := withDocumentMetadataDB(t, false)
			tree := NewTree(box, "/20260701111533-6sraog7.sy", "/Root", "Root")
			nested := &ast.Node{Type: ast.NodeDocument, ID: "20260609092353-ysnx8qo"}
			paragraph := NewParagraph("20260701111533-9bkenzf")
			nested.AppendChild(paragraph)
			tree.Root.AppendChild(nested)
			IndexBlockTree(tree)
			trigger := `CREATE TRIGGER fail_nested_repair BEFORE UPDATE ON blocktrees
				WHEN NEW.type='s' BEGIN SELECT RAISE(ABORT, 'injected update failure'); END`
			if failure == "insert" {
				trigger = `CREATE TRIGGER fail_nested_repair BEFORE INSERT ON blocktrees
					WHEN NEW.id='20260701111533-9bkenzf' BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END`
			}
			if _, err := db.Exec(trigger); err != nil {
				t.Fatal(err)
			}
			FixNestedDocumentNodes(tree.Root)
			if err := UpsertBlockTreePendingWithError(tree); err == nil {
				t.Fatal("index repair failure was hidden")
			}
			if old := GetBlockTreeInExactBox(nested.ID, box); old == nil || old.Type != "d" {
				t.Fatal("failed repair lost the original index", old)
			}
			if _, err := GetDocumentMetadata(box, tree.ID); err != nil {
				t.Fatal("failed repair lost root metadata", err)
			}
		})
	}
}

func TestUpsertNestedBlockTree(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name := "plain"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			const boxID = "20261009000000-box0001"
			dsn := filepath.Join(t.TempDir(), "blocktree.db")
			if encrypted {
				dsn += "?_key=x'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'"
			}
			database, err := sql.Open("sqlite3_extended", dsn)
			if err != nil {
				t.Fatal(err)
			}
			previousDB := db
			if encrypted {
				if err = initEncryptedBlockTreeTables(database); err != nil {
					t.Fatal(err)
				}
				encryptedBlockTreeDBs.Store(boxID, database)
			} else {
				db = database
				initDBTables()
			}
			t.Cleanup(func() {
				if encrypted {
					CloseEncryptedBlockTreeDB(boxID)
				} else {
					db = previousDB
					database.Close()
				}
			})
			tree := NewTree(boxID, "/20261009000001-doc0001.sy", "/Original", "Original")
			tree.Root.FirstChild.Unlink()
			parent := tree.Root
			var nodes []*ast.Node
			for i, typ := range []ast.NodeType{ast.NodeList, ast.NodeListItem, ast.NodeBlockquote, ast.NodeParagraph} {
				n := &ast.Node{Type: typ, ID: []string{"20261009000002-list001", "20261009000003-item001",
					"20261009000004-quote01", "20261009000005-para001"}[i]}
				n.SetIALAttr("updated", "20261009000000")
				parent.AppendChild(n)
				parent = n
				nodes = append(nodes, n)
			}
			check := func(want int) {
				t.Helper()
				var count, distinct int
				if err := database.QueryRow("SELECT COUNT(*), COUNT(DISTINCT id) FROM blocktrees WHERE root_id = ?", tree.ID).
					Scan(&count, &distinct); err != nil || count != want || distinct != want {
					t.Fatalf("rows=%d, distinct=%d, want=%d, err=%v", count, distinct, want, err)
				}
				for _, n := range nodes {
					bt := GetBlockTreeInBox(n.ID, boxID)
					if bt == nil || bt.ParentID != n.Parent.ID || bt.HPath != tree.HPath || bt.Path != tree.Path ||
						bt.Updated != n.IALAttr("updated") {
						t.Fatalf("incorrect index for %s: %+v", n.ID, bt)
					}
				}
			}
			UpsertBlockTree(tree)
			check(5)
			tree.HPath = "/Renamed"
			UpsertBlockTree(tree)
			check(5)
			// 父容器改变时，时间戳不变的后代也要更新；其他分支仍须单独检查。
			nodes[2].Unlink()
			nodes[0].AppendChild(nodes[2])
			nodes[0].SetIALAttr("updated", "20261009000001")
			nodes[1].SetIALAttr("updated", "20261009000002")
			UpsertBlockTree(tree)
			check(5)
			nodes[3].SetIALAttr("updated", "20261009000003")
			UpsertBlockTree(tree)
			check(5)
		})
	}
}
