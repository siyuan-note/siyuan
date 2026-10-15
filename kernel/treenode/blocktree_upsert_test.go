package treenode

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
)

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
